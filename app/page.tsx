"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, CircleHelp, Copy, Eye, EyeOff, FlipHorizontal, Gauge, Info, KeyRound, Lightbulb, MonitorUp, Radio, RefreshCw, Settings2, ShieldCheck, Signal, Square, Video, Wifi } from "lucide-react";
import { LocalVideoTrack, Room, RoomEvent, Track, createLocalVideoTrack } from "livekit-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const SERVER_URL = "wss://live.07210700.xyz";
const TOKEN_KEY = "livekit-contest-token";
const GUIDE_KEY = "livekit-contest-guide-seen";
const resolutions = [{ value: "720p", label: "720P", width: 1280, height: 720 }, { value: "1080p", label: "1080P", width: 1920, height: 1080 }, { value: "4k", label: "4K", width: 3840, height: 2160 }];
const frameRates = [30, 60];
const bitrates = [4, 8, 12, 20];
type ScreenWakeLock = { release: () => Promise<void> };
type NavigatorWithWakeLock = Navigator & { wakeLock?: { request: (type: "screen") => Promise<ScreenWakeLock> } };

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<LocalVideoTrack | null>(null);
  const roomRef = useRef<Room | null>(null);
  const wakeLockRef = useRef<ScreenWakeLock | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [resolution, setResolution] = useState("720p");
  const [frameRate, setFrameRate] = useState("60");
  const [bitrate, setBitrate] = useState("6");
  const [token, setToken] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem(TOKEN_KEY) ?? "");
  const [rememberToken, setRememberToken] = useState(true);
  const [showToken, setShowToken] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [orientationOpen, setOrientationOpen] = useState(() => typeof window === "undefined" || window.localStorage.getItem(GUIDE_KEY) !== "true");
  const [guideOpen, setGuideOpen] = useState(false);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>(["等待操作。浏览器摄像头权限尚未请求"]);
  const selectedResolution = resolutions.find((item) => item.value === resolution) ?? resolutions[0];
  const addLog = (message: string) => setLogs((current) => [`${new Date().toLocaleTimeString()}  ${message}`, ...current].slice(0, 8));

  const refreshCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const available = devices.filter((device) => device.kind === "videoinput");
      setCameras(available);
      setCameraId((current) => current || available.find((device) => /back|rear|后置/i.test(device.label))?.deviceId || available[0]?.deviceId || "");
      addLog(`检测到 ${available.length} 个摄像头`);
    } catch (cameraError) { setError(cameraError instanceof Error ? cameraError.message : "无法读取摄像头列表"); }
  }, []);

  useEffect(() => {
    return () => { trackRef.current?.stop(); roomRef.current?.disconnect(); wakeLockRef.current?.release(); };
  }, []);

  function releaseCameraTrack() {
    if (videoRef.current) {
      trackRef.current?.detach(videoRef.current);
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    trackRef.current?.stop();
    trackRef.current = null;
    setIsPreviewing(false);
  }

  async function createCameraTrack() {
    const deviceId = cameraId ? { exact: cameraId } : undefined;
    try {
      return await createLocalVideoTrack({ deviceId, frameRate: Number(frameRate), resolution: { width: selectedResolution.width, height: selectedResolution.height } });
    } catch (error) {
      if (!(error instanceof DOMException) || !["OverconstrainedError", "NotReadableError"].includes(error.name)) throw error;
      addLog(`${selectedResolution.label}/${frameRate}FPS 不可用，尝试兼容模式`);
      return createLocalVideoTrack({ deviceId, frameRate: 30, resolution: { width: 640, height: 480 } });
    }
  }

  async function startPreview() {
    setError("");
    releaseCameraTrack();
    try {
      const track = await createCameraTrack();
      trackRef.current = track;
      if (videoRef.current) track.attach(videoRef.current);
      setIsPreviewing(true);
      await refreshCameras();
      addLog(`预览已启动：${selectedResolution.label} / ${frameRate} FPS`);
    } catch (previewError) {
      const message = previewError instanceof DOMException && previewError.name === "NotAllowedError"
        ? "浏览器拒绝了摄像头权限，请点击地址栏左侧的摄像头图标并选择允许，然后重新点击开始预览。"
        : previewError instanceof DOMException && previewError.name === "NotFoundError"
          ? "没有检测到可用摄像头，请检查摄像头连接或关闭占用摄像头的其他程序。"
          : previewError instanceof DOMException && previewError.name === "NotReadableError"
            ? "摄像头已授权但无法读取，通常是被微信、会议软件、OBS 或其他浏览器标签占用。请关闭这些程序后点击刷新，再重新预览。"
          : previewError instanceof Error ? previewError.message : "启动摄像头失败，请检查浏览器权限";
      setError(message);
      addLog(`摄像头启动失败：${previewError instanceof Error ? previewError.name : "unknown"}`);
    }
  }

  async function keepScreenAwake() {
    const wakeLockNavigator = navigator as NavigatorWithWakeLock;
    if (wakeLockNavigator.wakeLock && !wakeLockRef.current) { wakeLockRef.current = await wakeLockNavigator.wakeLock.request("screen"); setWakeLockActive(true); addLog("已开启保持屏幕常亮"); }
  }

  async function startStreaming() {
    if (!token.trim()) { setError("请先填写 LiveKit Token"); return; }
    setError("");
    try {
      if (!trackRef.current) await startPreview();
      const room = new Room();
      room.on(RoomEvent.Disconnected, () => { setIsStreaming(false); addLog("已断开 LiveKit 房间"); });
      await room.connect(SERVER_URL, token.trim());
      const track = trackRef.current;
      if (!track) throw new Error("摄像头轨道未准备好");
      await room.localParticipant.publishTrack(track, { source: Track.Source.Camera, simulcast: false, videoEncoding: { maxBitrate: Number(bitrate) * 1_000_000, maxFramerate: Number(frameRate) } });
      roomRef.current = room;
      setIsStreaming(true);
      if (rememberToken) window.localStorage.setItem(TOKEN_KEY, token.trim()); else window.localStorage.removeItem(TOKEN_KEY);
      await keepScreenAwake();
      addLog(`推流已连接：${SERVER_URL}`);
    } catch (streamError) { roomRef.current?.disconnect(); setError(streamError instanceof Error ? streamError.message : "连接或发布失败，请检查 Token"); addLog("推流启动失败"); }
  }

  async function stopStreaming() {
    roomRef.current?.disconnect(); roomRef.current = null; releaseCameraTrack();
    wakeLockRef.current?.release(); wakeLockRef.current = null; setWakeLockActive(false); setIsStreaming(false); setIsPreviewing(false); addLog("推流已停止，摄像头已释放");
  }

  function closeOrientation() { window.localStorage.setItem(GUIDE_KEY, "true"); setOrientationOpen(false); }

  return (
    <main className="min-h-screen overflow-hidden bg-[#f4f7f5] text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between border-b border-slate-200/80 pb-5"><div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-lg shadow-emerald-200"><Video /></div><div><p className="text-lg font-semibold tracking-tight">选手推流台</p><p className="text-xs text-slate-500">LiveKit camera uplink</p></div></div><div className="flex items-center gap-2"><Badge variant={isStreaming ? "default" : "secondary"}>{isStreaming ? "正在推流" : "未连接"}</Badge><Button variant="ghost" size="icon" onClick={() => setGuideOpen(true)} aria-label="查看使用指引"><CircleHelp /></Button></div></header>
        <section className="grid flex-1 gap-6 py-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.8fr)] lg:items-start">
          <div className="flex flex-col gap-5"><div className="flex items-end justify-between gap-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">01 / Preview</p><h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">画面准备好了，<br /><span className="text-emerald-600">就可以上场。</span></h1></div><Badge variant="outline" className="mb-1 hidden gap-1.5 sm:inline-flex"><ShieldCheck /> 浏览器直连</Badge></div><div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-950 shadow-2xl shadow-slate-300/60 ring-1 ring-slate-900/10"><video ref={videoRef} autoPlay muted playsInline className="size-full object-contain" />{!isPreviewing && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400"><div className="flex size-16 items-center justify-center rounded-full border border-slate-700 bg-slate-900"><Camera /></div><p className="text-sm">点击右侧「开始预览」打开摄像头</p></div>}<div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-slate-950/70 px-3 py-1.5 text-xs text-white backdrop-blur"><span className={`size-2 rounded-full ${isStreaming ? "bg-red-400" : isPreviewing ? "bg-amber-400" : "bg-slate-500"}`} />{isStreaming ? "LIVE" : isPreviewing ? "PREVIEW" : "OFFLINE"}</div>{isStreaming && <div className="absolute bottom-4 right-4 rounded-lg bg-slate-950/70 px-3 py-2 text-xs text-white backdrop-blur"><Signal className="mr-1 inline size-3" />{selectedResolution.label} · {frameRate} FPS · {bitrate} Mbps</div>}</div><div className="grid gap-3 sm:grid-cols-3"><Stat icon={<Gauge />} label="当前清晰度" value={selectedResolution.label} /><Stat icon={<Radio />} label="帧率" value={`${frameRate} FPS`} /><Stat icon={<Wifi />} label="目标码率" value={`${bitrate} Mbps`} /></div></div>
          <div className="flex flex-col gap-4"><Card className="border-0 bg-white/80 shadow-xl shadow-slate-200/60 ring-1 ring-slate-200/80"><CardHeader><div className="mb-1 flex items-center justify-between"><CardTitle className="flex items-center gap-2 text-xl"><Settings2 className="text-emerald-600" />推流设置</CardTitle><Badge variant="outline">可随时调整</Badge></div><CardDescription>默认配置适合大多数比赛场景，也可以按设备性能微调。</CardDescription></CardHeader><CardContent className="flex flex-col gap-5"><Setting label="摄像头" hint="默认优先选择带 back / 后置 的设备"><div className="flex gap-2"><Select value={cameraId} onValueChange={setCameraId}><SelectTrigger className="w-full"><SelectValue placeholder="选择摄像头" /></SelectTrigger><SelectContent>{cameras.map((camera, index) => <SelectItem key={camera.deviceId} value={camera.deviceId}>{camera.label || `摄像头 ${index + 1}`}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" onClick={() => void refreshCameras()} aria-label="刷新摄像头列表"><RefreshCw /></Button><Button variant="outline" size="icon" onClick={() => setCameraId(cameras[(cameras.findIndex((camera) => camera.deviceId === cameraId) + 1) % cameras.length]?.deviceId ?? "")} disabled={cameras.length < 2} aria-label="切换摄像头"><FlipHorizontal /></Button></div></Setting><div className="grid gap-3 sm:grid-cols-3"><Setting label="清晰度"><Select value={resolution} onValueChange={setResolution}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{resolutions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></Setting><Setting label="帧率"><Select value={frameRate} onValueChange={setFrameRate}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{frameRates.map((item) => <SelectItem key={item} value={`${item}`}>{item} FPS</SelectItem>)}</SelectContent></Select></Setting><Setting label="码率"><Select value={bitrate} onValueChange={setBitrate}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{bitrates.map((item) => <SelectItem key={item} value={`${item}`}>{item} Mbps</SelectItem>)}</SelectContent></Select></Setting></div><Setting label="LiveKit Token" hint="Token 仅保存在你的浏览器中"><div className="relative"><Input value={token} onChange={(event) => setToken(event.target.value)} type={showToken ? "text" : "password"} placeholder="粘贴选手 Token" className="pr-10" /><Button type="button" variant="ghost" size="icon-sm" className="absolute right-1 top-0.5" onClick={() => setShowToken((visible) => !visible)} aria-label={showToken ? "隐藏 Token" : "显示 Token"}>{showToken ? <EyeOff /> : <Eye />}</Button></div></Setting><div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5"><div className="flex items-center gap-2 text-sm"><KeyRound className="size-4 text-slate-500" />自动记住 Token</div><Switch checked={rememberToken} onCheckedChange={setRememberToken} aria-label="自动记住 Token" /></div><div className="flex items-center justify-between text-xs text-slate-500"><span>服务器地址</span><button onClick={() => void navigator.clipboard.writeText(SERVER_URL)} className="flex items-center gap-1 font-mono text-slate-700 hover:text-emerald-700" title="复制服务器地址">{SERVER_URL}<Copy className="size-3" /></button></div></CardContent><CardFooter className="flex-col gap-2"><Button className="h-12 w-full bg-emerald-600 text-base shadow-lg shadow-emerald-200 hover:bg-emerald-700" onClick={() => void (isStreaming ? stopStreaming() : startStreaming())}>{isStreaming ? <><Square />停止推流</> : <><MonitorUp />开始推流</>}</Button><Button variant="outline" className="w-full" onClick={() => void startPreview()} disabled={isStreaming}>{isPreviewing ? "重新应用摄像头设置" : "开始预览"}</Button></CardFooter></Card>{error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><strong>需要处理：</strong> {error}</div>}<Card size="sm" className="border-0 bg-slate-950 text-slate-200 shadow-lg"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm text-white"><Info className="size-4 text-emerald-400" />开发调试信息</CardTitle></CardHeader><CardContent className="flex flex-col gap-2 font-mono text-[11px] leading-relaxed text-slate-400"><div className="flex justify-between"><span>room status</span><span className="text-emerald-300">{isStreaming ? "connected" : "idle"}</span></div><div className="flex justify-between"><span>device count</span><span>{cameras.length}</span></div><div className="flex justify-between"><span>wake lock</span><span>{wakeLockActive ? "active" : "inactive"}</span></div><div className="mt-2 border-t border-slate-800 pt-2 text-slate-500">{logs.map((log) => <p key={log}>{log}</p>)}</div></CardContent></Card></div>
        </section><footer className="flex flex-col gap-2 border-t border-slate-200/80 pt-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span className="flex items-center gap-1.5"><Lightbulb className="size-3.5 text-amber-500" />横屏推流效果更好，请提前确认摄像头权限。</span><span>Powered by LiveKit · {SERVER_URL}</span></footer>
      </div>
      <Dialog open={orientationOpen} onOpenChange={setOrientationOpen}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2 text-xl"><MonitorUp className="text-emerald-600" />横屏效果更好</DialogTitle><DialogDescription className="pt-2 leading-6">建议选手使用横屏设备并将摄像头固定好。开始推流后页面会尽量保持屏幕常亮，避免比赛过程中画面中断。</DialogDescription></DialogHeader><div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900"><p className="font-medium">快速开始</p><p className="mt-1 text-emerald-800">1. 允许摄像头权限　2. 检查画面　3. 填 Token 后开始推流</p></div><DialogFooter><Button onClick={closeOrientation}>知道了，开始准备</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={guideOpen} onOpenChange={setGuideOpen}><DialogContent><DialogHeader><DialogTitle>三步完成推流</DialogTitle><DialogDescription>给第一次使用的选手的简短指引。</DialogDescription></DialogHeader><div className="flex flex-col gap-4 py-2">{[["01", "打开摄像头", "选择后置摄像头或点击切换按钮，先开始预览。"], ["02", "确认画面参数", "默认 720P / 60FPS / 8Mbps；4K 需要设备和网络支持。"], ["03", "填写 Token 并推流", "粘贴比赛方提供的 Token，点击开始推流即可。"]].map(([number, title, description]) => <div key={number} className="flex gap-3"><div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">{number}</div><div><p className="font-medium">{title}</p><p className="mt-0.5 text-sm text-muted-foreground">{description}</p></div></div>)}</div><DialogFooter><Button onClick={() => setGuideOpen(false)}><Check />明白了</Button></DialogFooter></DialogContent></Dialog>
    </main>
  );
}

function Setting({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="flex flex-col gap-2 text-sm font-medium"><span>{label}{hint && <span className="ml-2 text-xs font-normal text-muted-foreground">{hint}</span>}</span>{children}</label>; }
function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white/60 px-3 py-3"><div className="text-emerald-600">{icon}</div><div><p className="text-[11px] text-slate-500">{label}</p><p className="font-semibold">{value}</p></div></div>; }
