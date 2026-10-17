import { config as loadEnv } from 'dotenv';
import express, { type Request, type Response } from 'express';
import { createWriteStream, mkdirSync, readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { WebSocketServer } from 'ws';
import { mountIntelligence } from './intelligence';

loadEnv({ path: path.resolve(process.cwd(), '.env.local') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

type DeviceStatusPayload = {
  deviceId: string;
  online: boolean;
  battery: number;
  foodLevel: number;
  trackingEnabled: boolean;
  streamConnected: boolean;
  cameraDevice: string;
  lastSeenAt: string;
  currentBehavior: {
    label: string;
    displayName: string;
    durationSec: number;
  };
};

type MonitorSidebarPayload = {
  currentBehavior: DeviceStatusPayload['currentBehavior'];
  deviceQuickStatus: {
    battery: number;
    foodLevel: number;
    online: boolean;
  };
  recentEvents: Array<Omit<BehaviorEventPayload, 'iso'>>;
};

type BehaviorEventPayload = {
  time: string;
  event: string;
  type: 'activity' | 'feeding' | 'rest' | 'alert';
  iso: string;
};

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

const port = Number(process.env.PORT || 3001);
const jetsonCameraBaseUrl = (process.env.JETSON_CAMERA_BASE_URL || 'http://192.168.31.209:5000').replace(/\/$/, '');
const jetsonCamera2BaseUrl = (
  process.env.JETSON_CAMERA_2_BASE_URL ||
  jetsonCameraBaseUrl.replace(/:\d+$/, ':5001')
).replace(/\/$/, '');
const jetsonBridgeBaseUrl = process.env.JETSON_BRIDGE_BASE_URL?.replace(/\/$/, '');
const recordingsDir = path.resolve(process.cwd(), 'recordings');
const localPythonPath = process.env.PYTHON_EXE || path.resolve(process.cwd(), process.platform === 'win32' ? '../.venv/Scripts/python.exe' : '../.venv/bin/python');
const conversionScriptPath = path.resolve(process.cwd(), 'scripts/convert_mjpeg_to_mp4.py');

app.use(express.json({ limit: '2mb' }));
mountIntelligence(app);
app.use('/recordings', express.static(recordingsDir));

type RecordingState = {
  isRecording: boolean;
  startedAt: string | null;
  filePath: string | null;
  source: 'primary' | null;
  stopRequested: boolean;
  abortController: AbortController | null;
};

const recordingState: RecordingState = {
  isRecording: false,
  startedAt: null,
  filePath: null,
  source: null,
  stopRequested: false,
  abortController: null,
};

const recentBehaviorEvents: BehaviorEventPayload[] = [];
const maxBehaviorEvents = 24;
let lastPrimaryStreamConnected: boolean | null = null;
let lastJetsonOnline: boolean | null = null;

mkdirSync(recordingsDir, { recursive: true });


function nowIso() {
  return new Date().toISOString();
}

function formatClock(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function pushBehaviorEvent(event: string, type: BehaviorEventPayload['type'], iso = nowIso()) {
  const existing = recentBehaviorEvents[0];
  if (existing && existing.event === event && existing.type === type && existing.iso === iso) {
    return;
  }

  recentBehaviorEvents.unshift({
    time: formatClock(iso),
    event,
    type,
    iso,
  });

  if (recentBehaviorEvents.length > maxBehaviorEvents) {
    recentBehaviorEvents.length = maxBehaviorEvents;
  }
}

async function safeJsonFetch<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(1500) });
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function getJetsonHealth() {
  return safeJsonFetch<Record<string, unknown>>(`${jetsonCameraBaseUrl}/healthz`);
}

async function getJetsonVideoConfig() {
  return safeJsonFetch<Record<string, unknown>>(`${jetsonCameraBaseUrl}/video/config`);
}

async function getJetson2Health() {
  return safeJsonFetch<Record<string, unknown>>(`${jetsonCamera2BaseUrl}/healthz`);
}

function createRecordingFilename(source: 'primary') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `monitor-${source}-${stamp}.mjpeg`;
}

function getRecordingStatus() {
  return {
    ok: true,
    isRecording: recordingState.isRecording,
    startedAt: recordingState.startedAt,
    filePath: recordingState.filePath,
    source: recordingState.source,
  };
}

function convertRecordingToMp4(inputPath: string) {
  return new Promise<string>((resolve, reject) => {
    const outputPath = inputPath.replace(/\.mjpeg$/i, '.mp4');
    const converter = spawn(localPythonPath, [
      conversionScriptPath,
      inputPath,
      outputPath,
    ]);

    let stderr = '';
    converter.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    converter.on('error', (error) => {
      reject(new Error(`python converter not available: ${error.message}`));
    });
    converter.on('close', (code) => {
      if (code === 0) {
        resolve(outputPath);
        return;
      }

      reject(new Error(`python converter exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

function listRecordings() {
  return readdirSync(recordingsDir)
    .filter((name) => name.endsWith('.mjpeg') || name.endsWith('.mp4'))
    .map((name) => {
      const filePath = path.join(recordingsDir, name);
      const stats = statSync(filePath);
      return {
        name,
        url: `/recordings/${encodeURIComponent(name)}`,
        createdAt: stats.birthtime.toISOString(),
        sizeBytes: stats.size,
        format: name.endsWith('.mp4') ? 'mp4' as const : 'mjpeg' as const,
      };
    })
    .sort((a, b) => {
      const timeDiff = b.createdAt.localeCompare(a.createdAt);
      if (timeDiff !== 0) {
        return timeDiff;
      }

      if (a.format === b.format) {
        return 0;
      }

      return a.format === 'mp4' ? -1 : 1;
    });
}

async function startLocalRecording(source: 'primary') {
  if (recordingState.isRecording) {
    throw new Error('Recording is already in progress.');
  }

  const filename = createRecordingFilename(source);
  const filePath = path.join(recordingsDir, filename);
  const upstreamVideoUrl = `${jetsonCameraBaseUrl}/video`;
  const abortController = new AbortController();

  const upstream = await fetch(upstreamVideoUrl, {
    signal: abortController.signal,
  });

  if (!upstream.ok || !upstream.body) {
    throw new Error(`Jetson video endpoint returned ${upstream.status}`);
  }

  const fileStream = createWriteStream(filePath, { flags: 'w' });
  const mjpegStream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream);

  recordingState.isRecording = true;
  recordingState.startedAt = nowIso();
  recordingState.filePath = filePath;
  recordingState.source = source;
  recordingState.stopRequested = false;
  recordingState.abortController = abortController;
  pushBehaviorEvent('开始录制主路视频到 Mac', 'activity', recordingState.startedAt);

  const finalize = () => {
    recordingState.isRecording = false;
    recordingState.startedAt = null;
    recordingState.source = null;
    recordingState.stopRequested = false;
    recordingState.abortController = null;
  };

  mjpegStream.on('error', (error) => {
    if (!recordingState.stopRequested) {
      console.error('Recording stream error:', error);
    }
    fileStream.end();
    finalize();
  });

  fileStream.on('error', (error) => {
    console.error('Recording file error:', error);
    recordingState.stopRequested = true;
    abortController.abort();
    finalize();
  });

  fileStream.on('close', () => {
    const shouldConvert = recordingState.stopRequested;
    const completedPath = recordingState.filePath;
    finalize();

    if (shouldConvert && completedPath) {
      pushBehaviorEvent('主路录像已停止，开始转 MP4', 'activity');
      void convertRecordingToMp4(completedPath).catch((error) => {
        console.error('Recording conversion error:', error);
        pushBehaviorEvent('录像转 MP4 失败', 'alert');
      }).then((outputPath) => {
        if (outputPath) {
          pushBehaviorEvent(`录像已转成 ${path.basename(outputPath)}`, 'activity');
        }
      });
    }
  });

  mjpegStream.pipe(fileStream);

  return {
    ok: true,
    startedAt: recordingState.startedAt,
    filePath,
    source,
  };
}

function stopLocalRecording() {
  if (!recordingState.isRecording || !recordingState.abortController) {
    return {
      ok: true,
      stopped: false,
      filePath: recordingState.filePath,
    };
  }

  recordingState.stopRequested = true;
  const currentPath = recordingState.filePath;
  recordingState.abortController.abort();
  pushBehaviorEvent('停止录制主路视频', 'activity');

  return {
    ok: true,
    stopped: true,
    filePath: currentPath,
  };
}

async function proxyVideoStream(req: Request, res: Response, upstreamVideoUrl: string) {
  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  try {
    const upstream = await fetch(upstreamVideoUrl, {
      signal: abortController.signal,
    });

    if (!upstream.ok || !upstream.body) {
      res.status(502).json({
        ok: false,
        message: `Jetson video endpoint returned ${upstream.status}`,
        upstreamVideoUrl,
      });
      return;
    }

    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) {
      res.setHeader('content-type', contentType);
    }
    res.setHeader('cache-control', 'no-cache, no-store, must-revalidate');

    const stream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(502).end();
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(502).json({
        ok: false,
        message: 'Failed to proxy Jetson MJPEG stream.',
        upstreamVideoUrl,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

function buildDeviceStatus(
  health: Record<string, unknown> | null,
  config: Record<string, unknown> | null,
): DeviceStatusPayload {
  const timestamp =
    (typeof health?.timestamp === 'string' && health.timestamp) ||
    (typeof health?.last_seen_at === 'string' && health.last_seen_at) ||
    (typeof health?.last_frame_ts === 'number' && new Date(health.last_frame_ts * 1000).toISOString()) ||
    nowIso();
  const online =
    health?.status === 'ok' ||
    typeof health?.camera_open === 'boolean' ||
    Boolean(health);
  const streamConnected =
    typeof health?.stream_connected === 'boolean'
      ? health.stream_connected
      : typeof health?.camera_open === 'boolean'
        ? health.camera_open
        : typeof health?.pipeline_state === 'string'
          ? health.pipeline_state === 'streaming_ready'
      : online;

  return {
    deviceId: 'hajime-01',
    online,
    battery: typeof health?.battery === 'number' ? health.battery : 0,
    foodLevel: typeof health?.food_level === 'number' ? health.food_level : 0,
    trackingEnabled: typeof health?.tracking_enabled === 'boolean' ? health.tracking_enabled : streamConnected,
    streamConnected,
    cameraDevice:
      (typeof config?.camera_device === 'string' && config.camera_device) ||
      (typeof config?.device === 'string' && config.device) ||
      (typeof health?.device === 'string' && health.device) ||
      (typeof health?.camera_device === 'string' && health.camera_device) ||
      'unknown',
    lastSeenAt: timestamp,
    currentBehavior: {
      label: streamConnected ? 'tracking' : 'offline',
      displayName: streamConnected ? '实时监控在线' : '视频流未连接',
      durationSec: 0,
    },
  };
}

function buildMonitorSidebar(status: DeviceStatusPayload): MonitorSidebarPayload {
  return {
    currentBehavior: status.currentBehavior,
    deviceQuickStatus: {
      battery: status.battery,
      foodLevel: status.foodLevel,
      online: status.online,
    },
    recentEvents:
      recentBehaviorEvents.length > 0
        ? recentBehaviorEvents.map(({ iso: _iso, ...event }) => event)
        : [{ time: formatClock(status.lastSeenAt), event: '等待行为事件接入', type: 'rest' }],
  };
}

async function loadMonitorState() {
  const [health, config] = await Promise.all([getJetsonHealth(), getJetsonVideoConfig()]);
  const status = buildDeviceStatus(health, config);

  if (lastPrimaryStreamConnected !== status.streamConnected) {
    pushBehaviorEvent(status.streamConnected ? '视频流连接正常' : '视频流离线', status.streamConnected ? 'activity' : 'alert');
    lastPrimaryStreamConnected = status.streamConnected;
  }

  if (lastJetsonOnline !== status.online) {
    pushBehaviorEvent(status.online ? 'Jetson 健康检查通过' : 'Jetson 健康检查失败', status.online ? 'activity' : 'alert');
    lastJetsonOnline = status.online;
  }

  return {
    status,
    config: {
      baseUrl: jetsonCameraBaseUrl,
      videoUrl: `${jetsonCameraBaseUrl}/video`,
      healthUrl: `${jetsonCameraBaseUrl}/healthz`,
      configUrl: `${jetsonCameraBaseUrl}/video/config`,
      device: status.cameraDevice,
      width:
        typeof config?.width === 'number'
          ? config.width
          : typeof config?.resolution === 'object' &&
              config.resolution !== null &&
              typeof (config.resolution as Record<string, unknown>).width === 'number'
            ? ((config.resolution as Record<string, unknown>).width as number)
            : undefined,
      height:
        typeof config?.height === 'number'
          ? config.height
          : typeof config?.resolution === 'object' &&
              config.resolution !== null &&
              typeof (config.resolution as Record<string, unknown>).height === 'number'
            ? ((config.resolution as Record<string, unknown>).height as number)
            : undefined,
      fps: typeof config?.fps === 'number' ? config.fps : undefined,
      quality:
        typeof config?.jpeg_quality === 'number'
          ? config.jpeg_quality
          : typeof config?.quality === 'number'
            ? config.quality
            : undefined,
    },
    sidebar: buildMonitorSidebar(status),
  };
}

function buildBridgeUrl(targetPath: string, query?: Request['query']) {
  if (!jetsonBridgeBaseUrl) {
    return null;
  }

  const url = new URL(`${jetsonBridgeBaseUrl}${targetPath}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

async function fetchBridgeJson(targetPath: string, init?: RequestInit, query?: Request['query']) {
  const url = buildBridgeUrl(targetPath, query);

  if (!url) {
    throw new Error('JETSON_BRIDGE_BASE_URL is not configured yet.');
  }

  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(3000) });
  const text = await response.text();

  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Jetson bridge error ${response.status}: ${text}`);
  }

  return data;
}

async function proxyJsonPost(req: Request, res: Response, targetPath: string) {
  if (!jetsonBridgeBaseUrl) {
    res.status(501).json({
      ok: false,
      message: 'JETSON_BRIDGE_BASE_URL is not configured yet.',
      requestedPath: targetPath,
    });
    return;
  }

  try {
    const response = await fetch(`${jetsonBridgeBaseUrl}${targetPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(req.body),
    });
    const text = await response.text();
    res.status(response.status);
    res.type(response.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (error) {
    res.status(502).json({
      ok: false,
      message: 'Failed to reach Jetson bridge service.',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

async function handleBridgeAction(
  req: Request,
  res: Response,
  target: 'car' | 'gimbal',
  action: string,
  targetPath: string,
) {
  try {
    const data = await fetchBridgeJson(
      targetPath,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(req.body ?? {}),
      },
      req.query,
    );

    if (action === 'feed') {
      await fetch(`${process.env.INTELLIGENCE_ORIGIN || 'http://127.0.0.1:8001'}/api/v1/commands/feed`, {
        method: 'POST',
        headers: process.env.HAJIMI_API_TOKEN ? { authorization: `Bearer ${process.env.HAJIMI_API_TOKEN}` } : {},
        signal: AbortSignal.timeout(2000),
      }).catch(() => undefined);
    }
    if (target === 'gimbal') {
      await fetch(`${process.env.INTELLIGENCE_ORIGIN || 'http://127.0.0.1:8001'}/api/v1/cameras/primary/motion-reset`, {
        method: 'POST',
        headers: process.env.HAJIMI_API_TOKEN ? { authorization: `Bearer ${process.env.HAJIMI_API_TOKEN}` } : {},
        signal: AbortSignal.timeout(2000),
      }).catch(() => undefined);
    }

    res.json({
      ok: true,
      target,
      action,
      ...(target === 'gimbal' && req.query.step != null ? { step: Number(req.query.step) || req.query.step } : {}),
      data,
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      target,
      action,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

app.get('/api/health', async (_req, res) => {
  const state = await loadMonitorState();
  res.json({
    ok: true,
    ts: nowIso(),
    jetsonCameraBaseUrl,
    streamConnected: state.status.streamConnected,
  });
});

app.get('/api/video/live', async (req, res) => {
  await proxyVideoStream(req, res, `${jetsonCameraBaseUrl}/video`);
});

app.get('/api/video/live-secondary', async (req, res) => {
  await proxyVideoStream(req, res, `${jetsonCamera2BaseUrl}/video`);
});

app.get('/api/video/config', async (_req, res) => {
  const state = await loadMonitorState();
  res.json(state.config);
});

app.get('/api/video/secondary-status', async (_req, res) => {
  const health = await getJetson2Health();
  const cameraOpen = typeof health?.camera_open === 'boolean' ? health.camera_open : Boolean(health);
  const pipelineState = typeof health?.pipeline_state === 'string' ? health.pipeline_state : undefined;
  const lastError = typeof health?.last_error === 'string' ? health.last_error : null;
  const online =
    health?.status === 'ok' ||
    cameraOpen ||
    pipelineState === 'streaming_ready';

  res.json({
    ok: true,
    baseUrl: jetsonCamera2BaseUrl,
    videoUrl: `${jetsonCamera2BaseUrl}/video`,
    healthUrl: `${jetsonCamera2BaseUrl}/healthz`,
    status: online ? 'online' : 'offline',
    cameraOpen,
    pipelineState,
    lastError,
  });
});

app.get('/api/recording/status', (_req, res) => {
  res.json(getRecordingStatus());
});

app.get('/api/recordings', (_req, res) => {
  res.json({
    ok: true,
    recordings: listRecordings(),
  });
});

app.post('/api/recording/start', async (_req, res) => {
  try {
    const result = await startLocalRecording('primary');
    res.json(result);
  } catch (error) {
    res.status(409).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to start recording',
    });
  }
});

app.post('/api/recording/stop', (_req, res) => {
  res.json(stopLocalRecording());
});

app.get('/api/device/status', async (_req, res) => {
  const state = await loadMonitorState();
  res.json({
    deviceId: state.status.deviceId,
    battery: state.status.battery,
    foodLevel: state.status.foodLevel,
    isOnline: state.status.online,
    lastCommunication: state.status.lastSeenAt,
    streamConnected: state.status.streamConnected,
    cameraDevice: state.status.cameraDevice,
    trackingEnabled: state.status.trackingEnabled,
  });
});

app.get('/api/monitor/sidebar', async (_req, res) => {
  const state = await loadMonitorState();
  res.json(state.sidebar);
});

app.get('/api/dashboard/summary', async (_req, res) => {
  const state = await loadMonitorState();
  res.json({
    device: {
      deviceId: state.status.deviceId,
      online: state.status.online,
      battery: state.status.battery,
      foodLevel: state.status.foodLevel,
      lastCommunication: state.status.lastSeenAt,
    },
    todaySummary: {
      activityDuration: state.status.streamConnected ? '在线监控中' : '0h',
      feedingCount: 0,
      totalFood: 0,
      waterCount: 0,
    },
    latestReport: {
      date: new Date().toISOString().slice(0, 10),
      summary: state.status.streamConnected ? '视频流在线，等待行为统计接入。' : '视频流离线，请检查 Jetson 服务。',
    },
    timeline: state.sidebar.recentEvents,
  });
});

app.post('/api/control/move', (req, res) => proxyJsonPost(req, res, '/api/control/move'));
app.post('/api/control/feed', (req, res) => {
  pushBehaviorEvent('发送喂食指令', 'feeding');
  void handleBridgeAction(req, res, 'car', 'feed', '/api/car/feed');
});
app.post('/api/control/tracking', (req, res) => proxyJsonPost(req, res, '/api/control/tracking'));
app.post('/api/control/audio/play', (req, res) => proxyJsonPost(req, res, '/api/control/audio/play'));
app.post('/api/control/car/:action', (req, res) => {
  void handleBridgeAction(req, res, 'car', req.params.action, `/api/car/${req.params.action}`);
});
app.post('/api/control/gimbal/:action', (req, res) => {
  void handleBridgeAction(req, res, 'gimbal', req.params.action, `/api/gimbal/${req.params.action}`);
});
app.post('/api/system/shutdown', async (req, res) => {
  try {
    pushBehaviorEvent('发送 Jetson 关机指令', 'alert');
    const data = await fetchBridgeJson(
      '/api/system/shutdown',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(req.body ?? {}),
      },
      req.query,
    );

    res.json({
      ok: true,
      target: 'system',
      action: 'shutdown',
      data,
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      target: 'system',
      action: 'shutdown',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

pushBehaviorEvent('监控日志系统已启动', 'rest');
app.get('/api/jetson/status', async (_req, res) => {
  try {
    const data = await fetchBridgeJson(
      '/api/status',
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
      },
    );

    res.json({
      ok: true,
      bridge: data,
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/ws/frontend') {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', async (ws) => {
  let closed = false;
  const sendSnapshot = async () => {
    if (closed || ws.readyState !== ws.OPEN) {
      return;
    }

    const state = await loadMonitorState();
    ws.send(
      JSON.stringify({
        type: 'status',
        ts: nowIso(),
        data: {
          deviceId: state.status.deviceId,
          battery: state.status.battery,
          foodLevel: state.status.foodLevel,
          isOnline: state.status.online,
          lastCommunication: state.status.lastSeenAt,
          streamConnected: state.status.streamConnected,
          cameraDevice: state.status.cameraDevice,
          trackingEnabled: state.status.trackingEnabled,
        },
      }),
    );
    ws.send(
      JSON.stringify({
        type: 'monitor.sidebar',
        ts: nowIso(),
        data: state.sidebar,
      }),
    );
  };

  await sendSnapshot();
  const timer = setInterval(sendSnapshot, 3000);

  ws.on('close', () => {
    closed = true;
    clearInterval(timer);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Hajimi local backend started',
      port,
      jetsonCameraBaseUrl,
      jetsonBridgeBaseUrl: jetsonBridgeBaseUrl || null,
    }),
  );
});
