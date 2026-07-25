"use client";

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { AccessToken, TrackSource, type VideoGrant } from "livekit-server-sdk";
import { SignJWT } from "jose";
import {
  Braces,
  CalendarDays,
  Check,
  CheckCircle2,
  Clipboard,
  Crown,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  MonitorPlay,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Users,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const STORAGE_KEY = "livekit-token-generator-settings";
const DEFAULT_TTL = 7200;

const ttlPresets = [
  { value: "1800", label: "30 分钟" },
  { value: "7200", label: "2 小时（默认）" },
  { value: "21600", label: "6 小时" },
  { value: "86400", label: "24 小时" },
  { value: "end-of-day", label: "今天结束" },
] as const;

const videoPermissions = [
  ["roomJoin", "加入房间", "允许以参与者身份加入指定房间"],
  ["roomCreate", "创建房间", "允许创建房间"],
  ["roomList", "列出房间", "允许列出房间"],
  ["roomRecord", "开始录制", "允许开始录制"],
  ["roomAdmin", "房间管理", "允许控制指定房间"],
  ["ingressAdmin", "Ingress 管理", "允许管理 ingress 资源"],
  ["canPublish", "发布媒体", "允许发布音视频轨道"],
  ["canSubscribe", "订阅媒体", "允许订阅其他参与者的轨道"],
  ["canPublishData", "发布数据", "允许发布数据消息"],
  ["canUpdateOwnMetadata", "更新自身信息", "允许更新自己的 metadata"],
  ["hidden", "隐藏参与者", "作为隐藏参与者加入"],
  ["recorder", "录制参与者", "标记为正在录制房间"],
  ["agent", "Agent worker", "作为 Agent Framework worker 连接"],
  ["canSubscribeMetrics", "订阅指标", "允许订阅 metrics"],
  ["canManageAgentSession", "管理 Agent session", "允许管理 RemoteSession"],
] as const;

const trackSources = [
  ["camera", "摄像头"],
  ["microphone", "麦克风"],
  ["screen_share", "屏幕"],
  ["screen_share_audio", "屏幕声音"],
] as const;

const trackSourceValues: Record<(typeof trackSources)[number][0], TrackSource> = {
  camera: TrackSource.CAMERA,
  microphone: TrackSource.MICROPHONE,
  screen_share: TrackSource.SCREEN_SHARE,
  screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
};

type Attribute = { key: string; value: string };
type GrantKey = (typeof videoPermissions)[number][0];
type PublishSource = (typeof trackSources)[number][0];
type Claims = Record<string, unknown>;
type RoleKey = "streamer" | "director" | "admin" | "custom";
type Icon = ComponentType<{ className?: string }>;
type StoredSettings = {
  apiKey: string;
  identity: string;
  name: string;
  ttl: string;
  room: string;
  metadata: string;
  kind: string;
  sha256: string;
  roomPreset: string;
  roomConfig: string;
  attributes: Attribute[];
  role: RoleKey;
};

const allVideoGrant = Object.fromEntries(videoPermissions.map(([key]) => [key, true])) as Partial<Record<GrantKey, boolean>>;
const allTrackSources = trackSources.map(([value]) => value) as PublishSource[];

const roleOptions: { key: RoleKey; label: string; description: string; icon: Icon; grant: Partial<Record<GrantKey, boolean>>; canPublishSources: PublishSource[] }[] = [
  { key: "streamer", label: "推流选手", description: "加入房间，发布摄像头或屏幕，并发送数据", icon: Radio, grant: { roomJoin: true, canPublish: true, canPublishData: true }, canPublishSources: ["camera", "screen_share"] },
  { key: "director", label: "导播", description: "隐藏身份接收房间画面，只观看不发布内容", icon: MonitorPlay, grant: { roomJoin: true, hidden: true, canSubscribe: true }, canPublishSources: [] },
  { key: "admin", label: "管理员", description: "拥有全部房间、媒体和扩展服务权限", icon: Crown, grant: allVideoGrant, canPublishSources: allTrackSources },
  { key: "custom", label: "自定义", description: "按需选择每一项权限", icon: SlidersHorizontal, grant: {}, canPublishSources: [] },
];

function readStoredSettings(): Partial<StoredSettings> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return {};
  }
}

function decodeJwtPart(part: string) {
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Claims;
}

function parseToken(token: string) {
  const [encodedHeader, encodedPayload] = token.split(".");
  if (!encodedHeader || !encodedPayload) throw new Error("JWT 格式无效");
  return { header: decodeJwtPart(encodedHeader), payload: decodeJwtPart(encodedPayload) };
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default function TokenGeneratorPage() {
  const [initialSettings] = useState(readStoredSettings);
  const initialRole = getRole(initialSettings.role ?? "streamer").key;
  const [apiKey, setApiKey] = useState(initialSettings.apiKey ?? "");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [identity, setIdentity] = useState(initialSettings.identity ?? "");
  const [name, setName] = useState(initialSettings.name ?? "");
  const [ttl, setTtl] = useState(initialSettings.ttl ?? String(DEFAULT_TTL));
  const [ttlMode, setTtlMode] = useState(getTtlMode(initialSettings.ttl ?? String(DEFAULT_TTL)));
  const [customExpiry, setCustomExpiry] = useState(() => createCustomExpiry(initialSettings.ttl ?? String(DEFAULT_TTL)));
  const [room, setRoom] = useState(initialSettings.room ?? "");
  const [metadata, setMetadata] = useState(initialSettings.metadata ?? "");
  const [kind, setKind] = useState(initialSettings.kind ?? "");
  const [sha256, setSha256] = useState(initialSettings.sha256 ?? "");
  const [roomPreset, setRoomPreset] = useState(initialSettings.roomPreset ?? "");
  const [roomConfig, setRoomConfig] = useState(initialSettings.roomConfig ?? "");
  const [attributes, setAttributes] = useState<Attribute[]>(initialSettings.attributes?.length ? initialSettings.attributes : [{ key: "", value: "" }]);
  const [role, setRole] = useState<RoleKey>(initialRole);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [sipEnabled, setSipEnabled] = useState(false);
  const [inferenceEnabled, setInferenceEnabled] = useState(false);
  const [observabilityEnabled, setObservabilityEnabled] = useState(false);
  const [videoGrant, setVideoGrant] = useState<Partial<Record<GrantKey, boolean>>>(() => getRole(initialRole).grant);
  const [canPublishSources, setCanPublishSources] = useState<PublishSource[]>(() => getRole(initialRole).canPublishSources);
  const [sipAdmin, setSipAdmin] = useState(false);
  const [sipCall, setSipCall] = useState(false);
  const [inferencePerform, setInferencePerform] = useState(false);
  const [observabilityWrite, setObservabilityWrite] = useState(false);
  const [token, setToken] = useState("");
  const [tokenData, setTokenData] = useState<{ header: Claims; payload: Claims } | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ apiKey, identity, name, ttl, room, metadata, kind, sha256, roomPreset, roomConfig, attributes, role }));
  }, [apiKey, identity, name, ttl, room, metadata, kind, sha256, roomPreset, roomConfig, attributes, role]);

  const filledAttributes = useMemo(
    () => Object.fromEntries(attributes.filter(({ key }) => key.trim()).map(({ key, value }) => [key.trim(), value])),
    [attributes],
  );

  function setGrant(key: GrantKey, checked: boolean) {
    setVideoGrant((current) => ({ ...current, [key]: checked }));
  }

  function toggleSource(source: PublishSource, checked: boolean) {
    setCanPublishSources((current) => checked ? [...current, source] : current.filter((item) => item !== source));
  }

  function applyRole(nextRole: RoleKey) {
    setRole(nextRole);
    if (nextRole === "custom") {
      setVideoGrant({});
      setCanPublishSources([]);
      setSipEnabled(false);
      setInferenceEnabled(false);
      setObservabilityEnabled(false);
      return;
    }
    const nextOption = getRole(nextRole);
    setVideoGrant(nextOption.grant);
    setCanPublishSources(nextOption.canPublishSources);
    const isAdmin = nextRole === "admin";
    setSipEnabled(isAdmin);
    setSipAdmin(isAdmin);
    setSipCall(isAdmin);
    setInferenceEnabled(isAdmin);
    setInferencePerform(isAdmin);
    setObservabilityEnabled(isAdmin);
    setObservabilityWrite(isAdmin);
  }

  function updateCustomExpiry(nextExpiry: Date) {
    setCustomExpiry(nextExpiry);
    setTtl(String(Math.max(1, Math.floor((nextExpiry.getTime() - Date.now()) / 1000))));
  }

  function updateTtlMode(value: string) {
    setTtlMode(value);
    if (value === "custom") {
      updateCustomExpiry(createCustomExpiry(ttl));
      return;
    }
    if (value === "end-of-day") {
      const next = new Date();
      next.setHours(23, 59, 59, 0);
      updateCustomExpiry(next);
      return;
    }
    setTtl(value);
  }

  function updateCustomSeconds(value: string) {
    setTtl(value);
    const seconds = Number(value);
    if (Number.isFinite(seconds)) setCustomExpiry(new Date(Date.now() + seconds * 1000));
  }

  async function generateToken() {
    setError("");
    setTokenData(null);
    if (!apiKey.trim() || !apiSecret) {
      setError("请填写 API Key 和 API Secret。");
      return;
    }
    if (!identity.trim() && videoEnabled && videoGrant.roomJoin) {
      setError("请填写 Identity，方便 LiveKit 识别这位参与者。");
      return;
    }
    if ((videoGrant.roomJoin || videoGrant.roomAdmin) && videoEnabled && !room.trim()) {
      setError("请填写 Room，告诉 Token 要进入哪个房间。");
      return;
    }
    const ttlSeconds = ttlMode === "custom" || ttlMode === "end-of-day" ? Math.ceil((customExpiry.getTime() - Date.now()) / 1000) : Number(ttl);
    if ((ttlMode === "custom" || ttlMode === "end-of-day") && ttlSeconds <= 0) {
      setError("到期时间必须晚于当前时间。");
      return;
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      setError("有效期必须是大于 0 的整数秒数。");
      return;
    }

    let parsedRoomConfig: unknown;
    if (roomConfig.trim()) {
      try {
        parsedRoomConfig = JSON.parse(roomConfig);
      } catch {
        setError("RoomConfig 必须是有效的 JSON。");
        return;
      }
    }

    try {
      const accessToken = new AccessToken(apiKey.trim(), apiSecret, { identity: identity.trim() || undefined, name: name.trim() || undefined, metadata: metadata || undefined, attributes: Object.keys(filledAttributes).length ? filledAttributes : undefined, ttl: ttlSeconds });
      if (videoEnabled) {
        const grant: VideoGrant = { ...videoGrant };
        if (room.trim()) grant.room = room.trim();
        if (canPublishSources.length) grant.canPublishSources = canPublishSources.map((source) => trackSourceValues[source]);
        accessToken.addGrant(grant);
      }
      if (sipEnabled) accessToken.addSIPGrant({ admin: sipAdmin, call: sipCall });
      if (inferenceEnabled) accessToken.addInferenceGrant({ perform: inferencePerform });
      if (observabilityEnabled) accessToken.addObservabilityGrant({ write: observabilityWrite });
      if (kind.trim()) accessToken.kind = kind.trim();
      if (sha256.trim()) accessToken.sha256 = sha256.trim();
      if (roomPreset.trim()) accessToken.roomPreset = roomPreset.trim();
      if (parsedRoomConfig !== undefined) accessToken.roomConfig = parsedRoomConfig as NonNullable<AccessToken["roomConfig"]>;
      const sdkToken = await accessToken.toJwt();
      const sdkPayload = parseToken(sdkToken).payload;
      const generated = await new SignJWT(sdkPayload).setProtectedHeader({ alg: "HS256", typ: "JWT" }).sign(new TextEncoder().encode(apiSecret));
      setToken(generated);
      setTokenData(parseToken(generated));
      toast.success("Token 已生成");
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Token 生成失败。");
    }
  }

  async function copyValue(value: string, message: string) {
    await navigator.clipboard.writeText(value);
    toast.success(message);
  }

  function downloadToken() {
    const blob = new Blob([token], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `livekit-token-${identity.trim() || "participant"}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Token TXT 已下载");
  }

  function clearForm() {
    setApiKey(""); setApiSecret(""); setIdentity(""); setName(""); setRoom(""); setMetadata(""); setKind(""); setSha256(""); setRoomPreset(""); setRoomConfig(""); setAttributes([{ key: "", value: "" }]); setRole("streamer"); setVideoGrant(getRole("streamer").grant); setCanPublishSources(getRole("streamer").canPublishSources); setSipEnabled(false); setInferenceEnabled(false); setObservabilityEnabled(false); setTtl(String(DEFAULT_TTL)); setTtlMode(String(DEFAULT_TTL)); setCustomExpiry(createCustomExpiry(String(DEFAULT_TTL))); setToken(""); setTokenData(null); setError("");
  }

  const payloadText = tokenData ? prettyJson(tokenData.payload) : "";
  const headerText = tokenData ? prettyJson(tokenData.header) : "";

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f5f7f4] text-slate-950">
      <div className="pointer-events-none fixed inset-0 opacity-70 [background-image:linear-gradient(rgba(15,23,42,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.035)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="relative mx-auto max-w-4xl px-4 py-5 sm:px-8 sm:py-8">
        <header className="mb-7 flex flex-col gap-5 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-end sm:justify-between"><div><div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-700"><span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />赛事工具</div><h1 className="font-heading text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">生成比赛 Token</h1><p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">填写参与者信息，选择身份，然后生成可以直接使用的访问凭证。</p></div><label className="flex items-center gap-3 self-start rounded-full border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-600 shadow-sm sm:self-auto"><span className="flex items-center gap-1.5"><SlidersHorizontal className="size-3.5 text-emerald-600" />开发者模式</span><Switch checked={debugMode} onCheckedChange={(value) => setDebugMode(value === true)} aria-label="开启开发者模式" /></label></header>

        <div className="flex flex-col gap-5">
          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_20px_60px_rgba(15,23,42,0.07)]"><SectionHeader icon={<KeyRound />} eyebrow="第一步" title="访问凭据" description="用于在浏览器本地签名，不会上传到服务器。" action={<Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800"><LockKeyhole data-icon="inline-start" />不上传</Badge>} /><div className="grid gap-5 border-t border-slate-100 px-5 py-5 sm:grid-cols-2 sm:px-7"><Field label="API Key" required><Input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="APIxxxxxxxxxxxx" autoComplete="off" /></Field><Field label="API Secret" required><div className="relative"><Input value={apiSecret} onChange={(event) => setApiSecret(event.target.value)} type={showSecret ? "text" : "password"} placeholder="仅在当前页面使用" autoComplete="new-password" className="pr-10" /><button type="button" onClick={() => setShowSecret((visible) => !visible)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700" aria-label={showSecret ? "隐藏 API Secret" : "显示 API Secret"}>{showSecret ? <EyeOff /> : <Eye />}</button></div></Field></div></section>

          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_20px_60px_rgba(15,23,42,0.07)]"><SectionHeader icon={<Users />} eyebrow="第二步" title="参与者" description="告诉我们谁要进入哪个房间，以及凭证多久失效。" /><div className="grid gap-5 border-t border-slate-100 px-5 py-5 sm:grid-cols-2 sm:px-7"><Field label="Identity" required={videoEnabled && videoGrant.roomJoin === true}><Input value={identity} onChange={(event) => setIdentity(event.target.value)} placeholder="例如：player-001" /></Field><Field label="显示名称"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="可选" /></Field><Field label="Room" required={videoEnabled && (videoGrant.roomJoin === true || videoGrant.roomAdmin === true)}><Input value={room} onChange={(event) => setRoom(event.target.value)} placeholder="例如：final-match" /></Field><Field label="有效期"><ExpiryPicker mode={ttlMode} ttl={ttl} customExpiry={customExpiry} onModeChange={updateTtlMode} onCustomSecondsChange={updateCustomSeconds} onCustomExpiryChange={updateCustomExpiry} /></Field><div className="flex items-end"><p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">凭证只在这段时间内有效，到期后需要重新生成。</p></div></div></section>

          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_20px_60px_rgba(15,23,42,0.07)]"><SectionHeader icon={<ShieldCheck />} eyebrow="第三步" title="选择身份" description="权限会自动配置，不需要逐项勾选。" /><div className="border-t border-slate-100 px-5 py-5 sm:px-7"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{roleOptions.filter((option) => debugMode || option.key !== "custom").map((option) => { const IconComponent = option.icon; const selected = role === option.key; return <button key={option.key} type="button" onClick={() => applyRole(option.key)} className={`group flex min-h-24 items-start gap-3 rounded-xl border p-3.5 text-left transition-all ${selected ? "border-emerald-500 bg-emerald-50/80 shadow-[0_0_0_3px_rgba(16,185,129,0.1)]" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`} aria-pressed={selected}><span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500 group-hover:bg-slate-200"}`}><IconComponent /></span><span className="min-w-0"><span className="flex items-center gap-2 text-sm font-medium text-slate-900">{option.label}{selected && <Check className="size-3.5 text-emerald-600" />}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span></span></button>; })}</div>{role === "custom" && !debugMode && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">自定义权限需要先打开右上角的“开发者模式”。</p>}</div></section>

          {debugMode && <DeveloperSettings videoEnabled={videoEnabled} onVideoEnabledChange={setVideoEnabled} videoGrant={videoGrant} setGrant={setGrant} role={role} canPublishSources={canPublishSources} toggleSource={toggleSource} sipEnabled={sipEnabled} onSipEnabledChange={setSipEnabled} sipAdmin={sipAdmin} setSipAdmin={setSipAdmin} sipCall={sipCall} setSipCall={setSipCall} inferenceEnabled={inferenceEnabled} onInferenceEnabledChange={setInferenceEnabled} inferencePerform={inferencePerform} setInferencePerform={setInferencePerform} observabilityEnabled={observabilityEnabled} onObservabilityEnabledChange={setObservabilityEnabled} observabilityWrite={observabilityWrite} setObservabilityWrite={setObservabilityWrite} metadata={metadata} setMetadata={setMetadata} attributes={attributes} setAttributes={setAttributes} kind={kind} setKind={setKind} sha256={sha256} setSha256={setSha256} roomPreset={roomPreset} setRoomPreset={setRoomPreset} roomConfig={roomConfig} setRoomConfig={setRoomConfig} />}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><Button type="button" variant="ghost" onClick={clearForm}><RefreshCw data-icon="inline-start" />清空表单</Button><Button type="button" size="lg" onClick={() => void generateToken()} className="h-11 bg-slate-950 px-6 text-white shadow-lg shadow-slate-950/10 hover:bg-emerald-700"><Braces data-icon="inline-start" />生成 Access Token</Button></div>{error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{error}</div>}
          {token && <TokenResult token={token} tokenData={{ header: headerText, payload: payloadText }} onCopy={() => void copyValue(token, "Token 已复制")} onDownload={downloadToken} onRegenerate={() => void generateToken()} />}
        </div>
      </div>
    </main>
  );
}

function DeveloperSettings({ videoEnabled, onVideoEnabledChange, videoGrant, setGrant, role, canPublishSources, toggleSource, sipEnabled, onSipEnabledChange, sipAdmin, setSipAdmin, sipCall, setSipCall, inferenceEnabled, onInferenceEnabledChange, inferencePerform, setInferencePerform, observabilityEnabled, onObservabilityEnabledChange, observabilityWrite, setObservabilityWrite, metadata, setMetadata, attributes, setAttributes, kind, setKind, sha256, setSha256, roomPreset, setRoomPreset, roomConfig, setRoomConfig }: { videoEnabled: boolean; onVideoEnabledChange: (value: boolean) => void; videoGrant: Partial<Record<GrantKey, boolean>>; setGrant: (key: GrantKey, checked: boolean) => void; role: RoleKey; canPublishSources: PublishSource[]; toggleSource: (source: PublishSource, checked: boolean) => void; sipEnabled: boolean; onSipEnabledChange: (value: boolean) => void; sipAdmin: boolean; setSipAdmin: (value: boolean) => void; sipCall: boolean; setSipCall: (value: boolean) => void; inferenceEnabled: boolean; onInferenceEnabledChange: (value: boolean) => void; inferencePerform: boolean; setInferencePerform: (value: boolean) => void; observabilityEnabled: boolean; onObservabilityEnabledChange: (value: boolean) => void; observabilityWrite: boolean; setObservabilityWrite: (value: boolean) => void; metadata: string; setMetadata: (value: string) => void; attributes: Attribute[]; setAttributes: React.Dispatch<React.SetStateAction<Attribute[]>>; kind: string; setKind: (value: string) => void; sha256: string; setSha256: (value: string) => void; roomPreset: string; setRoomPreset: (value: string) => void; roomConfig: string; setRoomConfig: (value: string) => void }) {
  return <details className="group overflow-hidden rounded-2xl border border-slate-300 bg-slate-50/90" open><summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 sm:px-7"><span className="flex items-center gap-3"><span className="flex size-8 items-center justify-center rounded-lg bg-slate-800 text-white"><Braces /></span><span><span className="block text-sm font-semibold text-slate-900">开发者设置</span><span className="mt-0.5 block text-xs text-slate-500">完整配置 LiveKit 支持的权限和 Claims</span></span></span><ChevronDown className="transition-transform group-open:rotate-180" /></summary><div className="border-t border-slate-200 px-5 py-5 sm:px-7"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium text-slate-800">VideoGrant</p><p className="mt-1 text-xs text-slate-500">当前身份模板会自动设置以下权限。</p></div><Switch checked={videoEnabled} onCheckedChange={(value) => onVideoEnabledChange(value === true)} aria-label="启用 VideoGrant" /></div>{videoEnabled && <div className="mt-4 grid gap-1 sm:grid-cols-2">{videoPermissions.map(([key, label, description]) => <ToggleRow key={key} checked={videoGrant[key] === true} onCheckedChange={(checked) => setGrant(key, checked)} label={label} description={`${key} · ${description}`} disabled={role !== "custom"} />)}</div>}{videoEnabled && <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4"><p className="mb-2 text-xs font-medium text-slate-700">canPublishSources</p><div className="grid gap-1 sm:grid-cols-2">{trackSources.map(([value, label]) => <ToggleRow key={value} checked={canPublishSources.includes(value)} onCheckedChange={(checked) => toggleSource(value, checked)} label={label} description={value} disabled={role !== "custom"} />)}</div></div>}{role !== "custom" && <p className="mt-3 text-xs text-slate-500">当前使用“{getRole(role).label}”模板。选择“自定义”后可以逐项修改权限。</p>}<div className="mt-6 grid gap-5 border-t border-slate-200 pt-5 sm:grid-cols-2"><Field label="Metadata"><textarea value={metadata} onChange={(event) => setMetadata(event.target.value)} placeholder="可选的参与者信息" className="min-h-24 w-full resize-y rounded-md border border-input bg-white px-2.5 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30" /></Field><Field label="Attributes" hint="Record<string, string>"><div className="flex flex-col gap-2">{attributes.map((attribute, index) => <div className="flex gap-2" key={`${index}-${attribute.key}`}><Input value={attribute.key} onChange={(event) => setAttributes((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} placeholder="key" /><Input value={attribute.value} onChange={(event) => setAttributes((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} placeholder="value" /><Button type="button" variant="ghost" size="icon" onClick={() => setAttributes((current) => current.length === 1 ? [{ key: "", value: "" }] : current.filter((_, itemIndex) => itemIndex !== index))} aria-label="删除 attribute"><Trash2 /></Button></div>)}<Button type="button" variant="outline" size="sm" onClick={() => setAttributes((current) => [...current, { key: "", value: "" }])}><Plus data-icon="inline-start" />添加 attribute</Button></div></Field><Field label="RoomConfig" hint="RoomConfiguration JSON"><textarea value={roomConfig} onChange={(event) => setRoomConfig(event.target.value)} placeholder={'{\n  "agents": { ... }\n}'} className="min-h-28 w-full resize-y rounded-md border border-input bg-white px-2.5 py-2 font-mono text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30" /></Field><div className="grid gap-5 sm:col-span-2 sm:grid-cols-3"><Field label="Kind"><Input value={kind} onChange={(event) => setKind(event.target.value)} placeholder="standard" /></Field><Field label="SHA-256"><Input value={sha256} onChange={(event) => setSha256(event.target.value)} placeholder="hash" /></Field><Field label="Room preset"><Input value={roomPreset} onChange={(event) => setRoomPreset(event.target.value)} placeholder="preset name" /></Field></div></div><div className="mt-6 grid gap-5 border-t border-slate-200 pt-5 sm:grid-cols-3"><GrantSection title="SIPGrant" enabled={sipEnabled} onEnabledChange={onSipEnabledChange}><ToggleRow checked={sipAdmin} onCheckedChange={setSipAdmin} label="管理 SIP resources" description="admin" /><ToggleRow checked={sipCall} onCheckedChange={setSipCall} label="发起 outbound calls" description="call" /></GrantSection><GrantSection title="InferenceGrant" enabled={inferenceEnabled} onEnabledChange={onInferenceEnabledChange}><ToggleRow checked={inferencePerform} onCheckedChange={setInferencePerform} label="执行 inference" description="perform" /></GrantSection><GrantSection title="ObservabilityGrant" enabled={observabilityEnabled} onEnabledChange={onObservabilityEnabledChange}><ToggleRow checked={observabilityWrite} onCheckedChange={setObservabilityWrite} label="写入 observability data" description="write" /></GrantSection></div></div></details>;
}

function TokenResult({ token, tokenData, onCopy, onDownload, onRegenerate }: { token: string; tokenData: { header: string; payload: string }; onCopy: () => void; onDownload: () => void; onRegenerate: () => void }) {
  return <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-[0_20px_60px_rgba(16,185,129,0.1)]"><div className="flex flex-col gap-4 bg-emerald-50/80 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" /><div><h2 className="font-semibold text-emerald-950">Token 已生成</h2><p className="mt-1 text-sm text-emerald-800/75">可以复制给连接工具，或下载为 TXT 文件。</p></div></div><div className="flex flex-wrap gap-2 sm:justify-end"><Button type="button" onClick={onCopy} className="bg-emerald-700 text-white hover:bg-emerald-800"><Clipboard data-icon="inline-start" />复制 Token</Button><Button type="button" variant="outline" onClick={onDownload} className="border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-100"><Download data-icon="inline-start" />下载 TXT</Button><Button type="button" variant="ghost" onClick={onRegenerate} className="text-emerald-800 hover:bg-emerald-100"><RefreshCw data-icon="inline-start" />重新生成</Button></div></div><details className="group border-t border-emerald-100"><summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-xs font-medium text-slate-600 sm:px-7"><span>查看 Token 内容</span><ChevronDown className="transition-transform group-open:rotate-180" /></summary><div className="grid gap-4 border-t border-slate-100 bg-slate-50/60 px-5 py-5 sm:grid-cols-2 sm:px-7"><div><p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400">header</p><pre className="max-h-40 overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-300">{tokenData.header}</pre></div><div><p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400">payload</p><pre className="max-h-40 overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-300">{tokenData.payload}</pre></div><div className="sm:col-span-2"><p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400">compact JWT</p><p className="max-h-20 overflow-auto break-all rounded-lg border border-slate-200 bg-white p-3 font-mono text-[10px] leading-5 text-slate-500">{token}</p></div></div></details></section>;
}

function ExpiryPicker({ mode, ttl, customExpiry, onModeChange, onCustomSecondsChange, onCustomExpiryChange }: { mode: string; ttl: string; customExpiry: Date; onModeChange: (value: string) => void; onCustomSecondsChange: (value: string) => void; onCustomExpiryChange: (value: Date) => void }) {
  const [shortcut, setShortcut] = useState("");
  function applyShortcut(value: string) { if (!value) return; const next = new Date(); if (value === "hour") next.setHours(next.getHours() + 1); if (value === "end-of-day") next.setHours(23, 59, 59, 0); if (value === "tomorrow") next.setDate(next.getDate() + 1); if (value === "week") next.setDate(next.getDate() + 7); setShortcut(value); onCustomExpiryChange(next); }
  function selectDate(date?: Date) { if (!date) return; const next = new Date(customExpiry); next.setFullYear(date.getFullYear(), date.getMonth(), date.getDate()); setShortcut(""); onCustomExpiryChange(next); }
  function selectTime(value: string) { const [hours, minutes] = value.split(":").map(Number); if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return; const next = new Date(customExpiry); next.setHours(hours, minutes, 0, 0); setShortcut(""); onCustomExpiryChange(next); }
  return <div className="flex flex-col gap-2"><Select value={mode} onValueChange={onModeChange}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{ttlPresets.map((preset) => <SelectItem key={preset.value} value={preset.value}>{preset.label}</SelectItem>)}<SelectItem value="custom">自定义</SelectItem></SelectContent></Select>{mode === "custom" && <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3"><ToggleGroup type="single" value={shortcut} onValueChange={applyShortcut} variant="outline" size="sm" className="flex-wrap"><ToggleGroupItem value="hour">1 小时后</ToggleGroupItem><ToggleGroupItem value="end-of-day">今天结束</ToggleGroupItem><ToggleGroupItem value="tomorrow">明天此时</ToggleGroupItem><ToggleGroupItem value="week">7 天后</ToggleGroupItem></ToggleGroup><div className="flex flex-col gap-2 sm:flex-row"><Popover><PopoverTrigger asChild><Button type="button" variant="outline" className="min-w-0 flex-1 justify-start font-normal"><CalendarDays data-icon="inline-start" />{formatExpiry(customExpiry)}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" required selected={customExpiry} onSelect={selectDate} /></PopoverContent></Popover><Input type="time" value={formatExpiryTime(customExpiry)} onChange={(event) => selectTime(event.target.value)} className="sm:w-32" aria-label="自定义到期时间" /></div><div className="flex items-center gap-2"><Input value={ttl} onChange={(event) => onCustomSecondsChange(event.target.value)} type="number" min="1" step="1" placeholder="输入 TTL" aria-label="自定义有效期秒数" /><span className="shrink-0 text-xs text-slate-500">秒</span></div></div>}</div>;
}

function SectionHeader({ icon, eyebrow, title, description, action }: { icon: ReactNode; eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="flex items-start justify-between gap-4 px-5 py-5 sm:px-7"><div className="flex items-start gap-3"><span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">{icon}</span><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400">{eyebrow}</p><h2 className="mt-1 text-base font-semibold text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div></div>{action}</div>;
}

function ToggleRow({ checked, label, description, onCheckedChange, disabled }: { checked: boolean; label: string; description: string; onCheckedChange: (checked: boolean) => void; disabled?: boolean }) {
  return <label className={`flex items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-slate-200 hover:bg-white"}`}><Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onCheckedChange(value === true)} className="mt-0.5" /><span className="min-w-0"><span className="block text-sm font-medium text-slate-800">{label}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span></span></label>;
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: ReactNode }) {
  return <label className="block min-w-0"><span className="mb-2 flex items-center gap-1 text-xs font-medium text-slate-700">{label}{required && <span className="text-emerald-600">*</span>}{hint && <span className="font-normal text-slate-400">{hint}</span>}</span>{children}</label>;
}

function GrantSection({ title, enabled, onEnabledChange, children }: { title: string; enabled: boolean; onEnabledChange: (value: boolean) => void; children: ReactNode }) {
  return <div><div className="flex items-center justify-between gap-3"><p className="font-mono text-xs font-medium text-slate-700">{title}</p><Switch size="sm" checked={enabled} onCheckedChange={(value) => onEnabledChange(value === true)} aria-label={`启用 ${title}`} /></div>{enabled && <div className="mt-2 flex flex-col gap-1">{children}</div>}</div>;
}

function getRole(role: RoleKey) {
  return roleOptions.find((option) => option.key === role) ?? roleOptions[0];
}

function getTtlMode(ttl: string) {
  return ttlPresets.some((preset) => preset.value === ttl) ? ttl : "custom";
}

function createCustomExpiry(ttl: string) {
  const seconds = Number(ttl);
  return new Date(Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_TTL) * 1000);
}

function formatExpiry(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatExpiryTime(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
