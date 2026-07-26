"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Camera,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Eye,
  EyeOff,
  FlipHorizontal,
  Info,
  MonitorUp,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Settings2,
  Signal,
  Square,
} from "lucide-react";
import {
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  createLocalVideoTrack,
  createLocalScreenTracks,
} from "livekit-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const TOKEN_KEY = "livekit-contest-token";
const GUIDE_KEY = "livekit-contest-guide-seen";
const CUSTOM_SERVER_VALUE = "custom";
const serverUrls = [
  { value: "wss://live.07210700.xyz", label: "主服务器" },
  { value: "wss://live.yee.autos:7880", label: "备用服务器" },
  { value: "wss://live2.07210700.xyz", label: "备用 2 服务器" },
];
const captureModes = [
  { value: "camera", label: "摄像头" },
  { value: "screen", label: "共享屏幕" },
];
const resolutions = [
  { value: "720p", label: "720P", width: 1280, height: 720 },
  { value: "1080p", label: "1080P", width: 1920, height: 1080 },
  { value: "4k", label: "4K", width: 3840, height: 2160 },
];
const frameRates = [30, 60, 120];
const bitrates = [4, 6, 8, 12, 20];
type ScreenWakeLock = { release: () => Promise<void> };
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<ScreenWakeLock> };
};

function detectMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return (
    /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}
function detectScreenShareSupport() {
  return Boolean(
    typeof navigator !== "undefined" && navigator.mediaDevices?.getDisplayMedia,
  );
}
function isScreenShareUnsupportedError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "NotSupportedError") ||
    (error instanceof Error && /not supported|unsupported/i.test(error.message))
  );
}
const subscribeToDeviceChanges = () => () => undefined;

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const startPreviewRef = useRef<() => void>(() => undefined);
  const cameraSettingsRef = useRef({ cameraId: "", resolution: "720p", frameRate: "60", captureMode: "camera" });
  const trackRef = useRef<LocalVideoTrack | null>(null);
  const roomRef = useRef<Room | null>(null);
  const wakeLockRef = useRef<ScreenWakeLock | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [captureMode, setCaptureMode] = useState("camera");
  const isMobileDevice = useSyncExternalStore(
    subscribeToDeviceChanges,
    detectMobileDevice,
    () => false,
  );
  const isScreenShareSupported = useSyncExternalStore(
    subscribeToDeviceChanges,
    detectScreenShareSupport,
    () => false,
  );
  const [screenShareDisabled, setScreenShareDisabled] = useState(false);
  const [resolution, setResolution] = useState("720p");
  const [frameRate, setFrameRate] = useState("60");
  const [bitrate, setBitrate] = useState("6");
  const [serverUrl, setServerUrl] = useState(() => {
    if (typeof window === "undefined") return serverUrls[0].value;
    const serverIndex = window.location.search
      ? new URLSearchParams(window.location.search).get("server")
      : null;
    return serverUrls[serverIndex === "1" ? 1 : serverIndex === "2" ? 2 : 0]
      .value;
  });
  const [token, setToken] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.search).get("token") ||
        window.localStorage.getItem(TOKEN_KEY) ||
        ""),
  );
  const [showToken, setShowToken] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const [uploadBitrate, setUploadBitrate] = useState("--");
  const [orientationOpen, setOrientationOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(
    () =>
      typeof window === "undefined" ||
      window.localStorage.getItem(GUIDE_KEY) !== "true",
  );
  const [guideSecondsRemaining, setGuideSecondsRemaining] = useState(8);
  const [isGuideAcknowledgementReady, setIsGuideAcknowledgementReady] =
    useState(false);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([
    "等待操作。浏览器摄像头权限尚未请求",
  ]);
  const selectedResolution =
    resolutions.find((item) => item.value === resolution) ?? resolutions[0];
  const isCustomServer = !serverUrls.some(
    (server) => server.value === serverUrl,
  );
  const addLog = (message: string) =>
    setLogs((current) =>
      [`${new Date().toLocaleTimeString()}  ${message}`, ...current].slice(
        0,
        8,
      ),
    );

  useEffect(() => {
    if (token.trim()) window.localStorage.setItem(TOKEN_KEY, token.trim());
    else window.localStorage.removeItem(TOKEN_KEY);
  }, [token]);

  useEffect(() => {
    if (!guideOpen || isGuideAcknowledgementReady) return;

    const countdown = window.setInterval(() => {
      setGuideSecondsRemaining((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    const unlockGuide = window.setTimeout(() => {
      window.clearInterval(countdown);
      setGuideSecondsRemaining(0);
      setIsGuideAcknowledgementReady(true);
    }, 8000);

    return () => {
      window.clearInterval(countdown);
      window.clearTimeout(unlockGuide);
    };
  }, [guideOpen, isGuideAcknowledgementReady]);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  const refreshCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const available = devices.filter(
        (device) => device.kind === "videoinput",
      );
      const preferredCameraId =
        cameraId ||
        available.find((device) => /back|rear|后置/i.test(device.label))
          ?.deviceId ||
        available[0]?.deviceId ||
        "";
      setCameras(available);
      setCameraId((current) => current || preferredCameraId);
      addLog(`检测到 ${available.length} 个摄像头`);
      return { available, preferredCameraId };
    } catch (cameraError) {
      setError(
        cameraError instanceof Error
          ? cameraError.message
          : "无法读取摄像头列表",
      );
      return { available: [], preferredCameraId: "" };
    }
  }, [cameraId]);

  useEffect(() => {
    return () => {
      trackRef.current?.stop();
      roomRef.current?.disconnect();
      wakeLockRef.current?.release();
    };
  }, []);

  function releaseVideoTrack() {
    if (videoRef.current) {
      trackRef.current?.detach(videoRef.current);
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    trackRef.current?.stop();
    trackRef.current = null;
    setIsPreviewing(false);
  }

  async function createCameraTrack(selectedCameraId = cameraId) {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "当前浏览器不支持摄像头访问，请使用最新版 Chrome、Safari 或 Edge。",
      );
    const deviceId = selectedCameraId ? { exact: selectedCameraId } : undefined;
    try {
      return await createLocalVideoTrack({
        deviceId,
        frameRate: Number(frameRate),
        resolution: {
          width: selectedResolution.width,
          height: selectedResolution.height,
        },
      });
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "OverconstrainedError")
        throw error;
      addLog(
        `${selectedResolution.label}/${frameRate}FPS 不可用，尝试兼容模式`,
      );
      return createLocalVideoTrack({
        deviceId,
        frameRate: 30,
        resolution: { width: 640, height: 480 },
      });
    }
  }

  async function createScreenTrack() {
    try {
      const [track] = await createLocalScreenTracks({
        audio: false,
        selfBrowserSurface: "include",
      });
      if (!(track instanceof LocalVideoTrack)) {
        track?.stop();
        throw new Error("屏幕共享没有返回视频轨道");
      }
      track.mediaStreamTrack.addEventListener("ended", () => {
        if (trackRef.current === track) {
          if (roomRef.current) void stopStreaming();
          else releaseVideoTrack();
          addLog("屏幕共享已结束");
        }
      });
      return track;
    } catch (screenError) {
      if (
        screenError instanceof DOMException &&
        screenError.name === "NotAllowedError"
      ) {
        throw new Error("你取消了屏幕共享，或浏览器未允许屏幕捕获。");
      }
      throw screenError;
    }
  }

  async function startPreview() {
    setError("");
    releaseVideoTrack();
    try {
      let track: LocalVideoTrack | null = null;
      if (captureMode === "screen") {
        track = await createScreenTrack();
      } else {
        const { available, preferredCameraId } = await refreshCameras();
        const candidateCameraIds = [
          cameraId || preferredCameraId,
          ...available.map((camera) => camera.deviceId),
        ].filter((deviceId, index, devices) => deviceId && devices.indexOf(deviceId) === index);
        let activeCameraId = "";
        let lastCameraError: unknown;
        for (const candidateCameraId of candidateCameraIds.length
          ? candidateCameraIds
          : [""]) {
          try {
            track = await createCameraTrack(candidateCameraId);
            activeCameraId = candidateCameraId;
            break;
          } catch (cameraError) {
            lastCameraError = cameraError;
            const canTryNext =
              cameraError instanceof DOMException &&
              ["NotFoundError", "NotReadableError", "OverconstrainedError"].includes(
                cameraError.name,
              );
            if (!canTryNext) throw cameraError;
            addLog(`摄像头不可用，尝试下一个设备：${cameraError.name}`);
          }
        }
        if (!track) throw lastCameraError ?? new Error("没有可用摄像头");
        if (activeCameraId) setCameraId(activeCameraId);
      }
      if (!track) throw new Error("没有可用的视频来源");
      trackRef.current = track;
      if (videoRef.current) track.attach(videoRef.current);
      setIsPreviewing(true);
      if (captureMode === "camera") await refreshCameras();
      addLog(
        captureMode === "screen"
          ? "屏幕共享预览已启动"
          : `预览已启动：${selectedResolution.label} / ${frameRate} FPS`,
      );
    } catch (previewError) {
      if (captureMode === "screen" && isScreenShareUnsupportedError(previewError)) {
        setScreenShareDisabled(true);
        setCaptureMode("camera");
      }
      const message =
        previewError instanceof DOMException &&
        previewError.name === "NotAllowedError"
          ? "浏览器拒绝了摄像头权限，请点击地址栏左侧的摄像头图标并选择允许，然后重新点击开始预览。"
          : previewError instanceof DOMException &&
              previewError.name === "NotFoundError"
            ? "没有检测到可用摄像头，请检查摄像头连接或关闭占用摄像头的其他程序。"
            : previewError instanceof DOMException &&
                previewError.name === "NotReadableError"
              ? "摄像头已授权但无法读取，通常是被微信、会议软件、OBS 或其他浏览器标签占用。请关闭这些程序后点击刷新，再重新预览。"
              : previewError instanceof Error
                ? previewError.message
                : "启动摄像头失败，请检查浏览器权限";
      setError(message);
      addLog(
        `摄像头启动失败：${previewError instanceof Error ? previewError.name : "unknown"}`,
      );
    }
  }

  useEffect(() => {
    startPreviewRef.current = () => void startPreview();
  });

  useEffect(() => {
    const previousSettings = cameraSettingsRef.current;
    const settingsChanged =
      previousSettings.cameraId !== cameraId ||
      previousSettings.resolution !== resolution ||
      previousSettings.frameRate !== frameRate ||
      previousSettings.captureMode !== captureMode;
    cameraSettingsRef.current = { cameraId, resolution, frameRate, captureMode };
    if (settingsChanged && isPreviewing && !isStreaming) startPreviewRef.current();
  }, [cameraId, captureMode, frameRate, isPreviewing, isStreaming, resolution]);

  async function keepScreenAwake() {
    const wakeLockNavigator = navigator as NavigatorWithWakeLock;
    if (!wakeLockNavigator.wakeLock || wakeLockRef.current) return;
    try {
      wakeLockRef.current = await wakeLockNavigator.wakeLock.request("screen");
      setWakeLockActive(true);
      addLog("已开启保持屏幕常亮");
    } catch (wakeLockError) {
      const message =
        wakeLockError instanceof Error
          ? wakeLockError.message
          : "保持屏幕常亮权限未开启";
      addLog(`保持屏幕常亮未开启：${message}`);
      toast.warning("保持屏幕常亮权限未开启，推流仍会继续", {
        description: "请保持页面前台，避免设备自动锁屏。",
      });
    }
  }

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        isStreaming &&
        !wakeLockRef.current
      ) {
        const wakeLockNavigator = navigator as NavigatorWithWakeLock;
        if (wakeLockNavigator.wakeLock)
          void wakeLockNavigator.wakeLock
            .request("screen")
            .then((wakeLock) => {
              wakeLockRef.current = wakeLock;
              setWakeLockActive(true);
            })
            .catch((wakeLockError) => {
              const message =
                wakeLockError instanceof Error
                  ? wakeLockError.message
                  : "保持屏幕常亮权限未开启";
              addLog(`保持屏幕常亮未开启：${message}`);
              toast.warning("保持屏幕常亮权限未开启，推流仍会继续", {
                description: "请保持页面前台，避免设备自动锁屏。",
              });
            });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isStreaming]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const handleDocumentClick = (event: MouseEvent) => {
      if (selectOpen) return;
      const target = event.target as Element | null;
      if (
        target?.closest('[data-slot="select-content"], [data-slot="dialog-content"]')
      ) return;
      if (sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        setSidebarOpen(false);
      }
    };
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, [selectOpen, sidebarOpen]);

  useEffect(() => {
    if (!isStreaming) return;
    let previous: { bytes: number; timestamp: number } | null = null;
    const sampleUploadBitrate = async () => {
      const report = await trackRef.current?.getRTCStatsReport();
      if (!report) return;
      let bytesSent = 0;
      let timestamp = 0;
      report.forEach((stat) => {
        if (stat.type === "outbound-rtp" && stat.kind === "video") {
          bytesSent += stat.bytesSent ?? 0;
          timestamp = Math.max(timestamp, stat.timestamp);
        }
      });
      if (
        previous &&
        bytesSent >= previous.bytes &&
        timestamp > previous.timestamp
      ) {
        const megabitsPerSecond =
          ((bytesSent - previous.bytes) * 8) /
          ((timestamp - previous.timestamp) * 1000);
        setUploadBitrate(`${megabitsPerSecond.toFixed(1)} Mbps`);
      }
      previous = { bytes: bytesSent, timestamp };
    };
    void sampleUploadBitrate();
    const timer = window.setInterval(() => void sampleUploadBitrate(), 1500);
    return () => window.clearInterval(timer);
  }, [isStreaming]);

  async function startStreaming() {
    if (!token.trim()) {
      setError("请先填写 LiveKit Token");
      return;
    }
    if (!serverUrl.trim()) {
      setError("请先填写自定义 LiveKit 服务器地址");
      return;
    }
    if (!trackRef.current) {
      setError("请先点击“开始预览”，确认画面后再开始推流。");
      return;
    }
    setError("");
    try {
      const room = new Room();
      room.on(RoomEvent.Disconnected, () => {
        setIsStreaming(false);
        addLog("已断开 LiveKit 房间");
      });
      await room.connect(serverUrl, token.trim());
      const track = trackRef.current;
      if (!track) throw new Error("摄像头轨道未准备好");
      await room.localParticipant.publishTrack(track, {
        source:
          captureMode === "screen"
            ? Track.Source.ScreenShare
            : Track.Source.Camera,
        simulcast: false,
        videoEncoding: {
          maxBitrate: Number(bitrate) * 1_000_000,
          maxFramerate: Number(frameRate),
        },
      });
      roomRef.current = room;
      setIsStreaming(true);
      await keepScreenAwake();
      addLog(`推流已连接：${serverUrl}`);
    } catch (streamError) {
      roomRef.current?.disconnect();
      setError(
        streamError instanceof Error
          ? streamError.message
          : "连接或发布失败，请检查 Token",
      );
      addLog("推流启动失败");
    }
  }

  async function stopStreaming() {
    roomRef.current?.disconnect();
    roomRef.current = null;
    releaseVideoTrack();
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
    setWakeLockActive(false);
    setIsStreaming(false);
    setIsPreviewing(false);
    setUploadBitrate("--");
    addLog("推流已停止，摄像头已释放");
  }

  function closeOrientation() {
    window.localStorage.setItem(GUIDE_KEY, "true");
    setOrientationOpen(false);
  }

  return (
    <main className="relative h-dvh overflow-hidden bg-slate-950 text-slate-950">
      <div className="relative size-full">
        <header className="pointer-events-none absolute left-4 right-4 top-4 z-30 flex items-center justify-end sm:left-6 sm:right-6 sm:top-6">
          <div
            className={`pointer-events-auto flex items-center gap-1.5 ${
              sidebarOpen
                ? "rounded-xl border border-transparent bg-transparent p-1 shadow-none"
                : "rounded-xl border border-slate-200/70 bg-[#f4f7f5]/90 p-1 shadow-lg shadow-slate-950/10 backdrop-blur-md"
            }`}
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setGuideOpen(true)}
              aria-label="查看使用指引"
            >
              <CircleHelp />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-slate-700 hover:bg-white/70 hover:text-slate-950"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label={sidebarOpen ? "收起设置面板" : "打开设置面板"}
            >
              {sidebarOpen ? <PanelRightClose /> : <PanelRightOpen />}
            </Button>
          </div>
        </header>
        <section className="relative size-full">
          <div className="relative size-full">
            <div className="absolute inset-0 overflow-hidden bg-slate-950">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="size-full object-contain"
              />
              {!isPreviewing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400">
                  <div className="flex size-16 items-center justify-center rounded-full border border-slate-700 bg-slate-900">
                    <Camera />
                  </div>
                  <p className="text-sm">点击右上角设置按钮，开始预览</p>
                </div>
              )}
              <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-slate-950/70 px-3 py-1.5 text-xs text-white backdrop-blur">
                <span
                  className={`size-2 rounded-full ${isStreaming ? "bg-red-400" : isPreviewing ? "bg-amber-400" : "bg-slate-500"}`}
                />
                {isStreaming ? "LIVE" : isPreviewing ? "PREVIEW" : "OFFLINE"}
              </div>
              {isStreaming && (
                <div className="absolute left-4 top-4 rounded-lg bg-slate-950/70 px-3 py-2 text-xs text-white backdrop-blur sm:left-6 sm:top-6">
                  <Signal className="mr-1 inline size-3" />
                  {selectedResolution.label} · {frameRate} FPS · {uploadBitrate}
                </div>
              )}
            </div>
          </div>
          <div ref={sidebarRef} className={`absolute right-0 top-0 z-20 h-full w-full max-w-md overflow-y-auto rounded-l-2xl border-l border-white/10 bg-[#f4f7f5]/95 p-4 shadow-2xl backdrop-blur-xl transition-transform duration-300 sm:p-6 ${sidebarOpen ? "translate-x-0" : "translate-x-full"}`}>
            <div className="flex flex-col gap-4 pt-14 sm:pt-12">
            <div className="flex flex-col gap-5 border-b border-slate-300/70 pb-5">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-xl font-medium">
                    <Settings2 className="text-emerald-600" />
                    推流设置
                  </h2>
                  <Badge variant="outline">可随时调整</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  选择一个视频来源，先预览确认画面，再填写 Token 开始推流。
                </p>
              <div className="flex flex-col gap-5">
                <Setting label="视频来源">
                  <Select value={captureMode} onValueChange={setCaptureMode} onOpenChange={setSelectOpen}>
                    <SelectTrigger className="w-full border-slate-300 bg-white/85 shadow-sm hover:bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {captureModes.map((mode) => (
                          <SelectItem
                            key={mode.value}
                            value={mode.value}
                            disabled={
                              mode.value === "screen" &&
                              (!isScreenShareSupported || screenShareDisabled)
                            }
                          >
                            {mode.value === "screen" &&
                            (!isScreenShareSupported || screenShareDisabled)
                              ? "共享屏幕（当前浏览器不支持）"
                              : mode.value === "screen" && isMobileDevice
                                ? "共享屏幕（实验性）"
                                : mode.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Setting>
                {captureMode === "camera" ? (
                  <Setting
                    label="摄像头"
                    hint="默认优先选择带 back / 后置 的设备"
                  >
                    <div className="flex gap-2">
                      <Select value={cameraId} onValueChange={setCameraId} onOpenChange={setSelectOpen}>
                        <SelectTrigger className="w-full border-slate-300 bg-white/85 shadow-sm hover:bg-white">
                          <SelectValue placeholder="选择摄像头" />
                        </SelectTrigger>
                        <SelectContent>
                          {cameras.map((camera, index) => (
                            <SelectItem
                              key={camera.deviceId}
                              value={camera.deviceId}
                            >
                              {camera.label || `摄像头 ${index + 1}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="icon"
                        className="border-slate-300 bg-white/85 shadow-sm hover:bg-white"
                        onClick={() => void refreshCameras()}
                        aria-label="刷新摄像头列表"
                      >
                        <RefreshCw />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="border-slate-300 bg-white/85 shadow-sm hover:bg-white"
                        onClick={() =>
                          setCameraId(
                            cameras[
                              (cameras.findIndex(
                                (camera) => camera.deviceId === cameraId,
                              ) +
                                1) %
                                cameras.length
                            ]?.deviceId ?? "",
                          )
                        }
                        disabled={cameras.length < 2}
                        aria-label="切换摄像头"
                      >
                        <FlipHorizontal />
                      </Button>
                    </div>
                  </Setting>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-white/65 px-3 py-2.5 text-sm text-slate-600">
                    点击“开始预览”后，在浏览器弹窗中选择要共享的屏幕或窗口。
                    {isMobileDevice && (
                      <span className="mt-1.5 flex items-center gap-1.5 text-amber-700">
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                          实验性功能
                        </Badge>
                        兼容性取决于设备浏览器与系统版本。
                      </span>
                    )}
                  </div>
                )}
                <Setting
                  label="LiveKit Token"
                  hint="输入后自动保存在你的浏览器中"
                >
                  <div className="relative">
                    <Input
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      type={showToken ? "text" : "password"}
                      placeholder="粘贴选手 Token"
                      className="h-11 border-slate-300 bg-white/85 pr-10 shadow-sm placeholder:text-slate-400 focus-visible:bg-white"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="absolute right-1 top-0.5"
                      onClick={() => setShowToken((visible) => !visible)}
                      aria-label={showToken ? "隐藏 Token" : "显示 Token"}
                    >
                      {showToken ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                </Setting>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                    className={`h-12 w-full text-base shadow-lg ${
                      isStreaming
                        ? "bg-red-600 shadow-red-200 hover:bg-red-700"
                        : "bg-emerald-600 shadow-emerald-200 hover:bg-emerald-700"
                    }`}
                  onClick={() =>
                    void (isStreaming ? stopStreaming() : startStreaming())
                  }
                >
                  {isStreaming ? (
                    <>
                      <Square />
                      停止推流
                    </>
                  ) : (
                    <>
                      <MonitorUp />
                      开始推流
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => void startPreview()}
                  disabled={isStreaming}
                >
                  {isPreviewing
                    ? captureMode === "screen"
                      ? "重新选择共享内容"
                      : "重新应用摄像头设置"
                    : captureMode === "screen"
                      ? "开始屏幕共享"
                      : "开始预览"}
                </Button>
              </div>
              <div className="border-t border-slate-300/70 pt-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between py-1 text-left text-sm font-medium text-slate-700 hover:text-slate-950"
                  onClick={() => setAdvancedOpen((open) => !open)}
                  aria-expanded={advancedOpen}
                >
                  <span className="flex items-center gap-2">
                    <Settings2 className="size-4 text-slate-500" />
                    高级设置
                  </span>
                  <ChevronDown
                    className={`size-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {advancedOpen && (
                  <div className="mt-4 flex flex-col gap-5">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Setting label="清晰度">
                        <Select value={resolution} onValueChange={setResolution} onOpenChange={setSelectOpen}>
                          <SelectTrigger className="w-full border-slate-300 bg-white/85 shadow-sm hover:bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {resolutions.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Setting>
                      <Setting label="帧率">
                        <Select value={frameRate} onValueChange={setFrameRate} onOpenChange={setSelectOpen}>
                          <SelectTrigger className="w-full border-slate-300 bg-white/85 shadow-sm hover:bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {frameRates.map((item) => (
                              <SelectItem key={item} value={`${item}`}>
                                {item === 120 ? "120 FPS（实验性）" : `${item} FPS`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Setting>
                      <Setting label="码率">
                        <Select value={bitrate} onValueChange={setBitrate} onOpenChange={setSelectOpen}>
                          <SelectTrigger className="w-full border-slate-300 bg-white/85 shadow-sm hover:bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {bitrates.map((item) => (
                              <SelectItem key={item} value={`${item}`}>
                                {item} Mbps
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Setting>
                    </div>
                    <Setting label="服务器">
                      <Select
                        value={isCustomServer ? CUSTOM_SERVER_VALUE : serverUrl}
                        onValueChange={(value) =>
                          setServerUrl(
                            value === CUSTOM_SERVER_VALUE ? "" : value,
                          )
                        }
                        onOpenChange={setSelectOpen}
                      >
                        <SelectTrigger className="w-full border-slate-300 bg-white/85 shadow-sm hover:bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {serverUrls.map((server) => (
                            <SelectItem key={server.value} value={server.value}>
                              {server.label}
                            </SelectItem>
                          ))}
                          <SelectItem value={CUSTOM_SERVER_VALUE}>
                            自定义服务器地址
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {isCustomServer ? (
                        <Input
                          value={serverUrl}
                          onChange={(event) => setServerUrl(event.target.value)}
                          placeholder="wss://live.example.com"
                          className="border-slate-300 bg-white/85 font-mono text-xs shadow-sm placeholder:font-sans"
                        />
                      ) : (
                        <button
                          onClick={() => void navigator.clipboard.writeText(serverUrl)}
                          className="flex items-center gap-1 self-end font-mono text-xs font-normal text-slate-700 hover:text-emerald-700"
                          title="复制服务器地址"
                        >
                          {serverUrl}
                          <Copy className="size-3" />
                        </button>
                      )}
                    </Setting>
                  </div>
                )}
              </div>
            </div>
            {advancedOpen && <section className="mx-1 rounded-lg border border-slate-300/80 bg-slate-100/55 px-3 py-4 text-slate-600">
              <h2 className="flex items-center gap-2 px-1 text-base font-semibold text-slate-900">
                  <Info className="size-4 text-emerald-400" />
                  开发调试信息
              </h2>
              <div className="mt-4 px-1 text-xs text-slate-700">
                <div className="grid grid-cols-3 divide-x divide-slate-300/80 rounded-md border border-slate-300/70 bg-white/45 py-2">
                  <DebugValue label="房间" value={isStreaming ? "已连接" : "未连接"} active={isStreaming} />
                  <DebugValue label="摄像头" value={`${cameras.length} 个`} />
                  <DebugValue label="常亮" value={wakeLockActive ? "已开启" : "未开启"} active={wakeLockActive} />
                </div>
                <div className="mt-3 border-t border-slate-300/80 pt-3 text-slate-600">
                  {logs.map((log, index) => (
                    <p key={`${log}-${index}`} className="break-words font-mono text-[11px] leading-5">{log}</p>
                  ))}
                </div>
              </div>
            </section>}
            </div>
          </div>
        </section>
      </div>
      <Dialog open={orientationOpen} onOpenChange={setOrientationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <MonitorUp className="text-emerald-600" />
              横屏效果更好
            </DialogTitle>
            <DialogDescription className="pt-2 leading-6">
              建议选手使用横屏设备并将摄像头固定好。开始推流后页面会尽量保持屏幕常亮，避免比赛过程中画面中断。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-medium">快速开始</p>
            <p className="mt-1 text-emerald-800">
              1. 允许摄像头权限　2. 检查画面　3. 填 Token 后开始推流
            </p>
          </div>
          <DialogFooter>
            <Button onClick={closeOrientation}>知道了，开始准备</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={guideOpen}
        onOpenChange={(open) => {
          if (!open && !isGuideAcknowledgementReady) return;
          setGuideOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>三步完成推流</DialogTitle>
            <DialogDescription>
              给第一次使用的选手的简短指引。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            {[
              [
                "01",
                "打开摄像头",
                "选择后置摄像头或点击切换按钮，先开始预览。",
              ],
              [
                "02",
                "确认画面参数",
                "默认 720P / 60FPS / 8Mbps；4K 需要设备和网络支持。",
              ],
              [
                "03",
                "填写 Token 并推流",
                "粘贴比赛方提供的 Token，点击开始推流即可。",
              ],
            ].map(([number, title, description]) => (
              <div key={number} className="flex gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                  {number}
                </div>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {description}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              disabled={!isGuideAcknowledgementReady}
              onClick={() => {
                setGuideOpen(false);
                void startPreview();
              }}
            >
              {isGuideAcknowledgementReady ? (
                <>
                  <Check />
                  明白了
                </>
              ) : (
                `请等待 ${guideSecondsRemaining} 秒`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Setting({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      <span>
        {label}
        {hint && (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}
function DebugValue({
  label,
  value,
  active = false,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 px-2 text-center">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={`truncate font-mono text-[11px] font-semibold ${active ? "text-emerald-600" : "text-slate-700"}`}>
        {value}
      </span>
    </div>
  );
}
