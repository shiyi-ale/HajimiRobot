import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  ChevronLeft,
  ChevronRight,
  Video, 
  Maximize2, 
  Circle, 
  ExternalLink,
  List, 
  Info,
  Battery,
  Utensils,
  Target,
  Scan,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { useLanguage } from '@/src/lib/i18n';
import { getDeviceStatus, getMonitorSidebar, getRecordings, getSecondaryStreamStatus, getStreamConfig } from '@/src/lib/api';
import { connectFrontendSocket } from '@/src/lib/socket';
import type { DeviceStatus, MonitorSidebarData, StreamConfig, DetectionPayload, FrontendSocketMessage, SecondaryStreamStatus, RecordingFile } from '@/src/types';
import DriveControls from './DriveControls';

async function postJson(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data: unknown;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(typeof data === 'object' && data !== null && 'error' in data ? String(data.error) : `Request failed: ${response.status}`);
  }

  return data;
}

async function fetchJson(path: string) {
  const response = await fetch(path, {
    headers: {
      accept: 'application/json',
    },
  });

  const text = await response.text();
  let data: unknown;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(typeof data === 'object' && data !== null && 'error' in data ? String(data.error) : `Request failed: ${response.status}`);
  }

  return data;
}

export default function Monitor() {
  const { dict, language } = useLanguage();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingPath, setRecordingPath] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<RecordingFile[]>([]);
  const [recordingsPage, setRecordingsPage] = useState(1);
  const [isFeeding, setIsFeeding] = useState(false);
  const [expandedCamera, setExpandedCamera] = useState<'primary' | 'secondary' | null>(null);
  const [status, setStatus] = useState(dict.monitor.connecting);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [sidebar, setSidebar] = useState<MonitorSidebarData | null>(null);
  const [streamConfig, setStreamConfig] = useState<StreamConfig | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [secondaryStreamError, setSecondaryStreamError] = useState<string | null>(null);
  const [secondaryStatus, setSecondaryStatus] = useState<SecondaryStreamStatus | null>(null);
  const [catDetected, setCatDetected] = useState(false);
  const [detection, setDetection] = useState<DetectionPayload | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const frameWidth = streamConfig?.width || detection?.frameSize.width || 640;
  const frameHeight = streamConfig?.height || detection?.frameSize.height || 480;
  const frameAspectRatio = `${frameWidth} / ${frameHeight}`;
  const toggleExpandedCamera = (camera: 'primary' | 'secondary') => {
    setExpandedCamera((current) => (current === camera ? null : camera));
  };
  const formatRecordingTime = (iso: string) =>
    new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const recordingsPerPage = 4;
  const playableRecordings = recordings.filter((recording) => recording.format === 'mp4');
  const totalRecordingPages = Math.max(1, Math.ceil(playableRecordings.length / recordingsPerPage));
  const visibleRecordings = playableRecordings.slice(
    (recordingsPage - 1) * recordingsPerPage,
    recordingsPage * recordingsPerPage,
  );

  const handleFeed = async () => {
    setIsFeeding(true);
    try {
      await postJson('/api/control/feed', { amount: 10 });
      setStreamError(null);
      setStatus(dict.monitor.feedSent);
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : dict.monitor.feedError);
      setStatus(dict.monitor.feedFailed);
    } finally {
      setIsFeeding(false);
    }
  };

  const syncRecordingStatus = async () => {
    try {
      const data = await fetchJson('/api/recording/status');
      const nextRecording = Boolean(
        typeof data === 'object' &&
          data !== null &&
          'isRecording' in data &&
          data.isRecording,
      );
      const nextPath =
        typeof data === 'object' &&
        data !== null &&
        'filePath' in data &&
        typeof data.filePath === 'string'
          ? data.filePath
          : null;

      setIsRecording(nextRecording);
      setRecordingPath(nextPath);
    } catch {
      // Ignore status sync failure and keep current UI state.
    }
  };

  const loadRecordings = async () => {
    try {
      const data = await getRecordings();
      setRecordings(data.recordings);
      setRecordingsPage((current) => {
        const nextTotalPages = Math.max(1, Math.ceil(data.recordings.filter((recording) => recording.format === 'mp4').length / recordingsPerPage));
        return Math.min(current, nextTotalPages);
      });
    } catch {
      // Ignore list load failures for now.
    }
  };

  const handleRecordingToggle = async () => {
    setRecordingBusy(true);
    try {
      if (isRecording) {
        const data = await postJson('/api/recording/stop');
        const nextPath =
          typeof data === 'object' &&
          data !== null &&
          'filePath' in data &&
          typeof data.filePath === 'string'
            ? data.filePath
            : recordingPath;

        setIsRecording(false);
        setRecordingPath(nextPath ?? null);
        setStatus(dict.monitor.recordingStopped);
        setStreamError(null);
        await loadRecordings();
      } else {
        const data = await postJson('/api/recording/start');
        const nextPath =
          typeof data === 'object' &&
          data !== null &&
          'filePath' in data &&
          typeof data.filePath === 'string'
            ? data.filePath
            : null;

        setIsRecording(true);
        setRecordingPath(nextPath);
        setStatus(dict.monitor.recordingToMac);
        setStreamError(null);
        await loadRecordings();
      }
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : dict.monitor.recordingError);
      setStatus(dict.monitor.recordingAbnormal);
    } finally {
      setRecordingBusy(false);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!detection?.boxes.length) {
        return;
      }

      const scaleX = canvas.width / detection.frameSize.width;
      const scaleY = canvas.height / detection.frameSize.height;

      detection.boxes.forEach((box) => {
        const x = box.x * scaleX;
        const y = box.y * scaleY;
        const w = box.width * scaleX;
        const h = box.height * scaleY;

        ctx.strokeStyle = '#0ea5e9';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(x, y, w, h);

        ctx.setLineDash([]);
        ctx.lineWidth = 4;
        const cornerLen = 15;

        ctx.beginPath();
        ctx.moveTo(x, y + cornerLen); ctx.lineTo(x, y); ctx.lineTo(x + cornerLen, y);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x + w - cornerLen, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerLen);
        ctx.stroke();

        ctx.fillStyle = '#0ea5e9';
        ctx.fillRect(x, y - 25, 88, 20);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px Inter';
        ctx.fillText(`${box.label.toUpperCase()} ${Math.round(box.score * 100)}%`, x + 5, y - 11);
      });
    };

    draw();
  }, [catDetected, detection]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [nextStatus, nextSidebar, nextConfig, nextSecondaryStatus] = await Promise.all([
          getDeviceStatus(),
          getMonitorSidebar(),
          getStreamConfig(),
          getSecondaryStreamStatus(),
        ]);

        if (cancelled) {
          return;
        }

        setDeviceStatus(nextStatus);
        setSidebar(nextSidebar);
        setStreamConfig(nextConfig);
        setSecondaryStatus(nextSecondaryStatus);
        setCatDetected(Boolean(nextStatus.streamConnected));
        setStatus(nextStatus.streamConnected ? dict.monitor.videoOnline : dict.monitor.waitingRecovery);
        setStreamError(null);
        setSecondaryStreamError(nextSecondaryStatus.status === 'online' ? null : nextSecondaryStatus.lastError || dict.monitor.secondaryOffline);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setStatus(dict.monitor.connectionFailed);
        setStreamError(error instanceof Error ? error.message : dict.monitor.backendUnavailable);
      }
    };

    void load();
    void syncRecordingStatus();
    void loadRecordings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const socket = connectFrontendSocket((message: FrontendSocketMessage) => {
      if (message.type === 'status') {
        const nextStatus = message.data as DeviceStatus;
        setDeviceStatus(nextStatus);
        setCatDetected(Boolean(nextStatus.streamConnected));
        setStatus(nextStatus.streamConnected ? dict.monitor.videoOnline : dict.monitor.waitingRecovery);
      }

      if (message.type === 'monitor.sidebar') {
        setSidebar(message.data as MonitorSidebarData);
      }

      if (message.type === 'detection') {
        const payload = message.data as DetectionPayload;
        setDetection(payload);
        setCatDetected(payload.boxes.length > 0);
      }
    });

    socket.addEventListener('open', () => setStreamError(null));
    socket.addEventListener('close', () => {
      setStreamError((current) => current ?? dict.monitor.streamDisconnected);
    });

    return () => socket.close();
  }, []);

  return (
    <div className="space-y-6 pb-24">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{dict.monitor.title}</h1>
        <p className="text-slate-500 text-sm">{deviceStatus?.deviceId || 'Hajime-01'} {dict.monitor.subtitleSuffix}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div
          className={cn(
            'relative w-full max-w-full bg-slate-900 rounded-3xl overflow-hidden shadow-2xl group mx-auto',
            expandedCamera === 'primary' && 'md:col-span-2',
            expandedCamera === 'secondary' && 'md:order-2',
          )}
          style={{ aspectRatio: frameAspectRatio }}
        >
          <img
            ref={imageRef}
            src="/api/video/live"
            alt={dict.monitor.camPrimaryAlt}
            className={cn(
              "w-full h-full object-contain bg-slate-950",
              deviceStatus?.streamConnected ? "opacity-100" : "opacity-40"
            )}
            onError={() => {
              setStreamError(dict.monitor.primaryError);
              setStatus(dict.monitor.primaryAbnormal);
            }}
          />

          {!deviceStatus?.streamConnected && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 px-6 text-center">
              <div>
                <p className="text-sm font-semibold text-white">{dict.monitor.primaryWaiting}</p>
                <p className="mt-2 text-xs text-slate-300">
                  {streamError || dict.monitor.primaryHint}
                </p>
              </div>
            </div>
          )}

          <canvas
            ref={canvasRef}
            width={frameWidth}
            height={frameHeight}
            className="absolute inset-0 w-full h-full pointer-events-none"
          />

          <div className="absolute top-4 left-4 flex gap-2">
            <div className="px-2 py-1 bg-black/50 backdrop-blur-md rounded-lg flex items-center gap-1.5 border border-white/10">
              <div className={cn("w-2 h-2 rounded-full", catDetected ? "bg-emerald-500" : "bg-red-500")} />
              <span className="text-[10px] font-bold text-white uppercase tracking-wider">{dict.monitor.primaryCamera}</span>
            </div>
            <div className="px-2 py-1 bg-black/50 backdrop-blur-md rounded-lg flex items-center gap-1.5 border border-white/10">
              <Target className="w-3 h-3 text-blue-400" />
              <span className="text-[10px] font-bold text-white uppercase tracking-wider">{status}</span>
            </div>
          </div>

          <AnimatePresence>
            {isRecording && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute top-4 right-4 flex items-center gap-2 px-2 py-1 bg-red-500/80 backdrop-blur-md rounded-lg border border-red-400/50"
              >
                <Circle className="w-2 h-2 fill-white animate-pulse" />
                <span className="text-[10px] font-bold text-white uppercase tracking-wider">REC</span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="absolute bottom-4 inset-x-4 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="flex gap-2">
              <a
                href="/api/video/live"
                target="_blank"
                rel="noreferrer"
                className="p-2 bg-white/20 backdrop-blur-md hover:bg-white/30 rounded-full text-white transition-colors"
              >
                <Camera className="w-5 h-5" />
              </a>
              <button
                onClick={() => void handleRecordingToggle()}
                className={cn(
                  "p-2 backdrop-blur-md rounded-full text-white transition-colors",
                  isRecording ? "bg-red-500" : "bg-white/20 hover:bg-white/30",
                  recordingBusy && 'opacity-60'
                )}
                disabled={recordingBusy}
              >
                <Video className="w-5 h-5" />
              </button>
            </div>
            <button
              onClick={() => toggleExpandedCamera('primary')}
              className={cn(
                'p-2 backdrop-blur-md rounded-full text-white transition-colors',
                expandedCamera === 'primary' ? 'bg-white/30' : 'bg-white/20 hover:bg-white/30',
              )}
            >
              <Maximize2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div
          className={cn(
            'relative w-full max-w-full bg-slate-900 rounded-3xl overflow-hidden shadow-2xl group mx-auto',
            expandedCamera === 'secondary' && 'md:col-span-2',
            expandedCamera === 'secondary' && 'md:order-1',
          )}
          style={{ aspectRatio: frameAspectRatio }}
        >
          <img
            src="/api/video/live-secondary"
            alt={dict.monitor.camSecondaryAlt}
            className="w-full h-full object-contain bg-slate-950"
            onError={() => setSecondaryStreamError(dict.monitor.secondaryError)}
            onLoad={() => setSecondaryStreamError(null)}
          />

          {secondaryStreamError && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 px-6 text-center">
              <div>
                <p className="text-sm font-semibold text-white">{dict.monitor.secondaryUnavailable}</p>
                <p className="mt-2 text-xs text-slate-300">
                  {secondaryStreamError}
                  {secondaryStatus?.pipelineState ? ` · ${secondaryStatus.pipelineState}` : ''}
                </p>
              </div>
            </div>
          )}

          <div className="absolute top-4 left-4 flex gap-2">
            <div className="px-2 py-1 bg-black/50 backdrop-blur-md rounded-lg flex items-center gap-1.5 border border-white/10">
              <div className={cn("w-2 h-2 rounded-full", secondaryStatus?.status === 'online' && !secondaryStreamError ? "bg-emerald-500" : "bg-red-500")} />
              <span className="text-[10px] font-bold text-white uppercase tracking-wider">{dict.monitor.secondaryCamera}</span>
            </div>
            <div className="px-2 py-1 bg-black/50 backdrop-blur-md rounded-lg flex items-center gap-1.5 border border-white/10">
              <Target className="w-3 h-3 text-blue-400" />
              <span className="text-[10px] font-bold text-white uppercase tracking-wider">
                {secondaryStatus?.status === 'online'
                  ? secondaryStreamError ? dict.monitor.secondaryLoadAbnormal : dict.monitor.secondaryOnline
                  : dict.monitor.secondaryOffline}
              </span>
            </div>
          </div>

          <div className="absolute bottom-4 inset-x-4 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
            <a
              href="/api/video/live-secondary"
              target="_blank"
              rel="noreferrer"
              className="p-2 bg-white/20 backdrop-blur-md hover:bg-white/30 rounded-full text-white transition-colors"
            >
              <Camera className="w-5 h-5" />
            </a>
            <button
              onClick={() => toggleExpandedCamera('secondary')}
              className={cn(
                'p-2 backdrop-blur-md rounded-full text-white transition-colors',
                expandedCamera === 'secondary' ? 'bg-white/30' : 'bg-white/20 hover:bg-white/30',
              )}
            >
              <Maximize2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <DriveControls />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="bg-white p-5 rounded-3xl card-shadow border border-slate-100"
      >
        <button
          onClick={() => void handleFeed()}
          disabled={isFeeding}
          className="w-full flex items-center justify-between gap-4 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-4 text-left transition-colors hover:bg-orange-100 disabled:opacity-60"
        >
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-white shadow-sm">
              {isFeeding ? (
                <Circle className="w-5 h-5 text-orange-600 animate-pulse fill-orange-600" />
              ) : (
                <Utensils className="w-5 h-5 text-orange-600" />
              )}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">{dict.monitor.feedNow}</p>
              <p className="text-xs text-slate-500">{dict.monitor.quickFeed}</p>
            </div>
          </div>
          <span className="rounded-full bg-orange-500 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
            {isFeeding ? dict.monitor.sendLabel : dict.monitor.feedLabel}
          </span>
        </button>
      </motion.div>

      {recordingPath && (
        <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 text-xs text-slate-500 card-shadow">
          {dict.monitor.recordingPath}：{recordingPath}
        </div>
      )}

      <div className="bg-white p-6 rounded-3xl card-shadow border border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-slate-800">{dict.monitor.recordings}</h3>
            <p className="text-xs text-slate-500 mt-1">{dict.monitor.recordingsHint}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRecordingsPage((current) => Math.max(1, current - 1))}
              disabled={recordingsPage === 1}
              className="rounded-full bg-slate-100 p-2 text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
              {recordingsPage} / {totalRecordingPages}
            </span>
            <button
              onClick={() => setRecordingsPage((current) => Math.min(totalRecordingPages, current + 1))}
              disabled={recordingsPage === totalRecordingPages}
              className="rounded-full bg-slate-100 p-2 text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => void loadRecordings()}
              className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600 hover:bg-slate-200 transition-colors"
            >
              {dict.common.refresh}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {playableRecordings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 md:col-span-2">
              {dict.monitor.noPlayableVideos}
            </div>
          ) : (
            visibleRecordings.map((recording) => (
              <div
                key={recording.name}
                className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">{recording.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {dict.monitor.timestamp}：{formatRecordingTime(recording.createdAt)} · {dict.monitor.size}：{formatBytes(recording.sizeBytes)}
                    </p>
                  </div>
                  <a
                    href={recording.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-full bg-white p-2 text-slate-400 transition-colors hover:text-slate-600"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>

                <video
                  className="mt-4 w-full rounded-2xl bg-slate-900"
                  src={recording.url}
                  controls
                  preload="metadata"
                />
              </div>
            ))
          )}
        </div>
      </div>

      {/* Info Panel */}
      <div className="grid grid-cols-1 gap-4">
        <div className="bg-white p-6 rounded-3xl card-shadow border border-slate-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-brand-50 rounded-xl">
              <Scan className="w-5 h-5 text-brand-600" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800">{dict.monitor.currentBehavior}</h3>
              <p className="text-xs text-slate-500">{dict.monitor.aiAnalyzing}</p>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
            <span className="text-sm font-medium text-slate-700">
              {sidebar?.currentBehavior.displayName || dict.monitor.waitingBehavior}
            </span>
            <span className="text-xs font-mono text-slate-400">
              {sidebar ? `${dict.monitor.durationPrefix} ${sidebar.currentBehavior.durationSec}s` : '--'}
            </span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl card-shadow border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-800">{dict.monitor.recentEvents}</h3>
            <List className="w-4 h-4 text-slate-400" />
          </div>
          <div className="space-y-3">
            {(sidebar?.recentEvents || [
              { time: '--:--', event: dict.monitor.waitingEventStream, type: 'rest' as const },
            ]).map((item, i) => {
              const icon = item.type === 'feeding' ? Utensils : item.type === 'alert' ? Info : Target;
              const color = item.type === 'feeding' ? 'text-orange-500' : item.type === 'alert' ? 'text-red-500' : 'text-blue-500';

              return (
              <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-3">
                  {React.createElement(icon, { className: cn("w-4 h-4", color) })}
                  <span className="text-sm text-slate-700">{item.event}</span>
                </div>
                <span className="text-xs font-mono text-slate-400">{item.time}</span>
              </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl card-shadow border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-800">{dict.monitor.streamConfig}</h3>
            <Battery className="w-4 h-4 text-slate-400" />
          </div>
          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex items-center justify-between">
              <span>{dict.monitor.cameraDevice}</span>
              <span className="max-w-[55%] truncate text-right font-mono text-xs text-slate-400">
                {deviceStatus?.cameraDevice || streamConfig?.device || dict.common.unknown}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>{dict.monitor.batteryFood}</span>
              <span className="font-mono text-xs text-slate-400">
                {deviceStatus?.battery ?? '--'}% / {deviceStatus?.foodLevel ?? '--'}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>{dict.monitor.videoSpec}</span>
              <span className="font-mono text-xs text-slate-400">
                {streamConfig?.width ?? '--'}x{streamConfig?.height ?? '--'} @ {streamConfig?.fps ?? '--'}fps
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
