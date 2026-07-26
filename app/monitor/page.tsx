"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CircleStop,
  ClipboardPaste,
  Expand,
  Eye,
  EyeOff,
  KeyRound,
  PanelRightOpen,
  Radio,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Users,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { Room, RoomEvent, Track, VideoQuality } from "livekit-client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const SERVER_KEY = "livekit_director_server";
const TOKEN_KEY = "livekit_director_token";
const serverUrls = [
  { value: "wss://live.07210700.xyz", label: "主服务器" },
  { value: "wss://live.yee.autos:7880", label: "备用服务器" },
];

type ParticipantView = {
  identity: string;
  name: string;
  hasVideo: boolean;
  isSpeaking: boolean;
};

function participantLabel(identity: string, name?: string) {
  return name?.trim() || identity;
}

export default function MonitorPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<Room | null>(null);
  const currentIdentityRef = useRef<string | null>(null);
  const hasAutoConnectedRef = useRef(false);
  const hasRestoredConfigurationRef = useRef(false);
  const attachedTrackRef = useRef<Track | null>(null);
  const [serverUrl, setServerUrl] = useState(serverUrls[0].value);
  const [token, setToken] = useState("");
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [currentIdentity, setCurrentIdentity] = useState<string | null>(null);
  const [status, setStatus] = useState<"offline" | "connecting" | "online">(
    "offline",
  );
  const [statusMessage, setStatusMessage] = useState("等待导播连接");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoRotation, setVideoRotation] = useState(0);
  const [isConfigurationRestored, setIsConfigurationRestored] = useState(false);
  const openSidebar = useCallback(() => {
    setIsSidebarOpen(true);
  }, []);
  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  const syncParticipants = useCallback((room: Room) => {
    const nextParticipants = Array.from(room.remoteParticipants.values())
      .map((participant) => ({
        identity: participant.identity,
        name: participantLabel(participant.identity, participant.name),
        hasVideo: Array.from(participant.videoTrackPublications.values()).some(
          (publication) => Boolean(publication.track),
        ),
        isSpeaking: participant.isSpeaking,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    setParticipants(nextParticipants);
  }, []);

  const clearVideo = useCallback(() => {
    if (attachedTrackRef.current && videoRef.current) {
      attachedTrackRef.current.detach(videoRef.current);
    }
    attachedTrackRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  }, []);

  const setSelectedIdentity = useCallback((identity: string | null) => {
    currentIdentityRef.current = identity;
    setCurrentIdentity(identity);
  }, []);

  const updateSelectedVideo = useCallback((identity: string) => {
    const room = roomRef.current;
    const video = videoRef.current;
    const participant = room?.remoteParticipants.get(identity);
    if (!room || !participant || !video) return;

    const videoPublication = Array.from(
      participant.videoTrackPublications.values(),
    ).find((publication) => Boolean(publication.track));
    if (!videoPublication?.track) return;

    videoPublication.setVideoQuality(VideoQuality.HIGH);
    clearVideo();
    videoPublication.track.attach(video);
    attachedTrackRef.current = videoPublication.track;
  }, [clearVideo]);

  const selectParticipant = useCallback((identity: string) => {
    if (currentIdentityRef.current === identity && attachedTrackRef.current) {
      return;
    }
    setSelectedIdentity(identity);
    clearVideo();
    if (roomRef.current) syncParticipants(roomRef.current);
    updateSelectedVideo(identity);
  }, [clearVideo, setSelectedIdentity, syncParticipants, updateSelectedVideo]);

  const selectFirstAvailable = useCallback(() => {
    const room = roomRef.current;
    const firstAvailable = Array.from(room?.remoteParticipants.values() || []).find(
      (participant) =>
        Array.from(participant.videoTrackPublications.values()).some(
          (publication) => Boolean(publication.track),
        ),
    );
    if (firstAvailable) selectParticipant(firstAvailable.identity);
  }, [selectParticipant]);

  const handleTrackSubscribed = useCallback((
    track: Track,
    _publication: unknown,
    participant: { identity: string },
  ) => {
    if (track.kind !== Track.Kind.Video) return;
    const selectedIdentity = currentIdentityRef.current;
    if (roomRef.current) syncParticipants(roomRef.current);
    if (!selectedIdentity) {
      selectParticipant(participant.identity);
    } else if (selectedIdentity === participant.identity) {
      updateSelectedVideo(participant.identity);
    }
  }, [selectParticipant, syncParticipants, updateSelectedVideo]);

  const connect = useCallback(async (nextToken: string) => {
    const cleanToken = nextToken.trim();
    if (!cleanToken) {
      toast.error("Token 不能为空");
      openSidebar();
      return;
    }

    setStatus("connecting");
    setStatusMessage("正在连接 LiveKit 房间");
    roomRef.current?.disconnect();
    clearVideo();
    setSelectedIdentity(null);
    setParticipants([]);

    const room = new Room({ adaptiveStream: false, dynacast: false });
    roomRef.current = room;
    room.on(RoomEvent.ParticipantConnected, () => syncParticipants(room));
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      syncParticipants(room);
      if (participant.identity === currentIdentityRef.current) {
        setSelectedIdentity(null);
        clearVideo();
        window.setTimeout(selectFirstAvailable, 0);
      }
    });
    room.on(RoomEvent.ParticipantMetadataChanged, () => syncParticipants(room));
    room.on(RoomEvent.ActiveSpeakersChanged, () => syncParticipants(room));
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (videoRef.current) track.detach(videoRef.current);
      if (roomRef.current) syncParticipants(roomRef.current);
      if (track === attachedTrackRef.current) {
        clearVideo();
        window.setTimeout(selectFirstAvailable, 0);
      }
    });

    try {
      await room.connect(serverUrl, cleanToken);
      window.localStorage.setItem(TOKEN_KEY, cleanToken);
      setToken(cleanToken);
      setStatus("online");
      setStatusMessage("房间在线，正在监听选手画面");
      setIsSidebarOpen(false);
      syncParticipants(room);
      window.setTimeout(() => {
        const available = Array.from(room.remoteParticipants.values()).find(
          (participant) =>
            Array.from(participant.videoTrackPublications.values()).some(
              (publication) => Boolean(publication.track),
            ),
        );
        if (available) selectParticipant(available.identity);
      }, 0);
    } catch (error) {
      room.disconnect();
      roomRef.current = null;
      setStatus("offline");
      setStatusMessage("连接失败，请检查 Token");
      toast.error(error instanceof Error ? error.message : "LiveKit 连接失败");
      openSidebar();
    }
  }, [clearVideo, handleTrackSubscribed, openSidebar, selectFirstAvailable, selectParticipant, serverUrl, setSelectedIdentity, syncParticipants]);

  useEffect(() => {
    if (!hasRestoredConfigurationRef.current) return;
    window.localStorage.setItem(SERVER_KEY, serverUrl);
  }, [serverUrl]);

  useEffect(() => {
    const restoreConfiguration = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const serverIndex = params.get("server");
      const savedServer = window.localStorage.getItem(SERVER_KEY);
      const nextServerUrl =
        serverIndex !== null
          ? serverIndex === "1"
            ? serverUrls[1].value
            : serverUrls[0].value
          : serverUrls.some((server) => server.value === savedServer)
            ? savedServer!
            : serverUrls[0].value;

      hasRestoredConfigurationRef.current = true;
      setServerUrl(nextServerUrl);
      setToken(
        params.get("token") || window.localStorage.getItem(TOKEN_KEY) || "",
      );
      setIsConfigurationRestored(true);
    }, 0);

    return () => window.clearTimeout(restoreConfiguration);
  }, []);

  useEffect(() => {
    const savedToken = window.localStorage.getItem(TOKEN_KEY) || "";
    const initialToken = token.trim() || savedToken;
    if (
      isConfigurationRestored &&
      initialToken &&
      !hasAutoConnectedRef.current
    ) {
      hasAutoConnectedRef.current = true;
      void connect(initialToken);
    }

    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    const videoElement = videoRef.current;
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      roomRef.current?.disconnect();
      if (attachedTrackRef.current && videoElement) {
        attachedTrackRef.current.detach(videoElement);
      }
    };
  }, [connect, isConfigurationRestored, token]);

  function disconnect() {
    roomRef.current?.disconnect();
    roomRef.current = null;
    clearVideo();
    setSelectedIdentity(null);
    setParticipants([]);
    setStatus("offline");
    setStatusMessage("已断开导播连接");
  }

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }

  async function pasteToken() {
    try {
      const clipboardToken = await navigator.clipboard.readText();
      if (!clipboardToken.trim()) {
        toast.error("剪贴板中没有 Token");
        return;
      }
      setToken(clipboardToken);
      toast.success("Token 已粘贴");
    } catch {
      toast.error("无法读取剪贴板，请手动粘贴 Token");
    }
  }

  const selectedParticipant = participants.find(
    (participant) => participant.identity === currentIdentity,
  );
  const isConnected = status === "online";
  const isSideways = videoRotation % 180 !== 0;

  return (
    <TooltipProvider>
      <main className="monitor-page fixed inset-0 overflow-hidden bg-black text-white">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute left-1/2 top-1/2 bg-black object-contain transition-transform duration-200 ${
            isSideways ? "h-[100vw] w-[100dvh]" : "h-full w-full"
          }`}
          style={{ transform: `translate(-50%, -50%) rotate(${videoRotation}deg)` }}
        />

        {!selectedParticipant && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black text-center">
            <div className="flex flex-col items-center gap-3 text-white/35">
              <VideoOff className="size-8" />
              <p className="text-sm">
                {isConnected ? "等待接收选手画面" : "点击右上角打开导播控制"}
              </p>
            </div>
          </div>
        )}

        {selectedParticipant && (
          <div className="pointer-events-none absolute bottom-6 left-6 z-10 flex items-center gap-3.5 rounded-md bg-black/60 px-5 py-3.5 backdrop-blur-sm">
            <span className="size-3 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,0.9)]" />
            <span className="max-w-[60vw] truncate text-7xl font-bold leading-none">
              {selectedParticipant.name}
            </span>
          </div>
        )}

        {isSidebarOpen && (
          <button
            type="button"
            className="fixed inset-0 z-30 cursor-default bg-transparent"
            onClick={closeSidebar}
            aria-label="收起导播控制"
          />
        )}

        <aside
          className={`fixed right-0 top-0 z-40 flex h-full w-[min(88vw,360px)] flex-col border-l border-white/10 bg-[#0c1115]/95 shadow-2xl shadow-black/60 backdrop-blur-2xl transition-transform duration-300 ease-out ${
            isSidebarOpen ? "" : "pointer-events-none"
          }`}
          style={{ transform: isSidebarOpen ? "translateX(0)" : "translateX(100%)" }}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cyan-300/65">
                Director monitor
              </p>
              <h1 className="mt-1 text-sm font-semibold">导播控制</h1>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={closeSidebar}
              className="text-white/45 hover:text-white"
              aria-label="隐藏侧栏"
            >
              <X />
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5">
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.035] px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`size-2 rounded-full ${
                    status === "connecting"
                      ? "animate-pulse bg-amber-300"
                      : isConnected
                        ? "bg-emerald-300"
                        : "bg-white/25"
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium">
                    {status === "connecting"
                      ? "连接中"
                      : isConnected
                        ? "房间在线"
                        : "未连接"}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-white/35">
                    {statusMessage}
                  </p>
                </div>
              </div>
              <Badge
                variant="outline"
                className="border-white/10 bg-black/20 font-mono text-[10px] text-white/45"
              >
                {participants.length} 人
              </Badge>
            </div>

            <div className="mt-7">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-white/70">
                  <Users className="size-3.5 text-cyan-300" />
                  接收画面
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => roomRef.current && syncParticipants(roomRef.current)}
                  className="text-white/35 hover:text-white"
                  aria-label="刷新选手列表"
                >
                  <RefreshCw />
                </Button>
              </div>
              <div className="flex flex-col gap-1.5">
                {participants.map((participant) => {
                  const selected = participant.identity === currentIdentity;
                  return (
                    <button
                      key={participant.identity}
                      type="button"
                      onClick={() => selectParticipant(participant.identity)}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        selected
                          ? "border-cyan-300/60 bg-cyan-300/10"
                          : "border-transparent bg-white/[0.035] hover:border-white/15 hover:bg-white/[0.07]"
                      }`}
                    >
                      <span
                        className={`flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                          selected
                            ? "bg-cyan-300 text-[#071014]"
                            : "bg-white/10 text-white/45"
                        }`}
                      >
                        {participant.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-white/80">
                          {participant.name}
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-white/35">
                          {participant.hasVideo ? (
                            <Video className="size-2.5 text-emerald-300" />
                          ) : (
                            <VideoOff className="size-2.5" />
                          )}
                          {participant.hasVideo ? "LIVE" : "WAITING"}
                        </span>
                      </span>
                      {participant.isSpeaking && (
                        <span className="size-1.5 animate-pulse rounded-full bg-amber-300" />
                      )}
                      {selected && <Check className="size-4 text-cyan-300" />}
                    </button>
                  );
                })}
                {participants.length === 0 && (
                  <p className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-center text-xs text-white/30">
                    暂无可接收画面
                  </p>
                )}
              </div>
            </div>

            <div className="mt-7 border-t border-white/10 pt-5">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-white/70">
                <Radio className="size-3.5 text-cyan-300" />
                LiveKit 服务器
              </div>
              <Select value={serverUrl} onValueChange={setServerUrl}>
                <SelectTrigger className="border-white/10 bg-black/25 text-sm text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {serverUrls.map((server) => (
                    <SelectItem key={server.value} value={server.value}>
                      {server.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-2 truncate font-mono text-[10px] text-white/35">
                {serverUrl}
              </p>
            </div>

            <div className="mt-7 border-t border-white/10 pt-5">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-white/70">
                <Video className="size-3.5 text-cyan-300" />
                画面方向
              </div>
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        setVideoRotation((rotation) => (rotation + 270) % 360)
                      }
                      className="border-white/10 bg-black/25 text-white/65 hover:bg-white/10 hover:text-white"
                      aria-label="逆时针旋转画面"
                    >
                      <RotateCcw />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>逆时针旋转 90 度</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() =>
                        setVideoRotation((rotation) => (rotation + 90) % 360)
                      }
                      className="border-white/10 bg-black/25 text-white/65 hover:bg-white/10 hover:text-white"
                      aria-label="顺时针旋转画面"
                    >
                      <RotateCw />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>顺时针旋转 90 度</TooltipContent>
                </Tooltip>
                <span className="ml-1 font-mono text-[10px] text-white/35">
                  {videoRotation}°
                </span>
              </div>
            </div>

            <div className="mt-7 border-t border-white/10 pt-5">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-white/70">
                <KeyRound className="size-3.5 text-cyan-300" />
                房间 Token
              </div>
              <div className="relative">
                <Input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void connect(token);
                  }}
                  type={tokenVisible ? "text" : "password"}
                  placeholder="粘贴 LiveKit Token"
                  className="border-white/10 bg-black/25 pr-10 text-sm text-white placeholder:text-white/25"
                  aria-label="LiveKit Token"
                />
                <button
                  type="button"
                  onClick={() => setTokenVisible((visible) => !visible)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/35 hover:text-white"
                  aria-label={tokenVisible ? "隐藏 Token" : "显示 Token"}
                >
                  {tokenVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  type="button"
                  onClick={() => void connect(token)}
                  disabled={status === "connecting"}
                  className="flex-1 bg-cyan-300 text-[#071014] hover:bg-cyan-200"
                >
                  {status === "connecting" ? (
                    <RefreshCw className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Radio data-icon="inline-start" />
                  )}
                  {status === "connecting" ? "连接中" : "连接房间"}
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => void pasteToken()}
                      className="border-white/10 bg-black/25 text-white/65 hover:bg-white/10 hover:text-white"
                      aria-label="粘贴 Token"
                    >
                      <ClipboardPaste />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>粘贴 Token</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/10 px-5 py-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={disconnect}
              disabled={!isConnected}
              className="text-red-300/80 hover:bg-red-400/10 hover:text-red-200"
            >
              <CircleStop data-icon="inline-start" />
              断开连接
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void toggleFullscreen()}
                  className="text-white/45 hover:text-white"
                  aria-label={isFullscreen ? "退出全屏" : "进入全屏"}
                >
                  <Expand />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isFullscreen ? "退出全屏" : "进入全屏"}</TooltipContent>
            </Tooltip>
          </div>
        </aside>

        {!isSidebarOpen && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={openSidebar}
                className="fixed right-5 top-5 z-50 text-white/35 opacity-60 transition-opacity hover:bg-white/10 hover:text-white hover:opacity-100 focus-visible:opacity-100"
                aria-label="打开导播控制"
              >
                <PanelRightOpen />
              </Button>
            </TooltipTrigger>
            <TooltipContent>打开导播控制</TooltipContent>
          </Tooltip>
        )}
      </main>
    </TooltipProvider>
  );
}