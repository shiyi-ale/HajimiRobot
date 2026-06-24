export type Page = 'dashboard' | 'monitor' | 'control' | 'reports' | 'settings';

export interface DeviceStatus {
  deviceId?: string;
  battery: number;
  foodLevel: number;
  isOnline: boolean;
  lastCommunication: string;
  streamConnected?: boolean;
  cameraDevice?: string;
  trackingEnabled?: boolean;
}

export interface StreamConfig {
  baseUrl: string;
  videoUrl: string;
  healthUrl: string;
  configUrl: string;
  device?: string;
  width?: number;
  height?: number;
  fps?: number;
  quality?: number;
}

export interface SecondaryStreamStatus {
  ok: boolean;
  baseUrl: string;
  videoUrl: string;
  healthUrl: string;
  status: 'online' | 'offline';
  cameraOpen: boolean;
  pipelineState?: string;
  lastError?: string | null;
}

export interface RecordingFile {
  name: string;
  url: string;
  createdAt: string;
  sizeBytes: number;
  format: 'mp4' | 'mjpeg';
}

export interface MonitorSidebarData {
  currentBehavior: {
    label: string;
    displayName: string;
    durationSec: number;
  };
  deviceQuickStatus: {
    battery: number;
    foodLevel: number;
    online: boolean;
  };
  recentEvents: BehaviorEvent[];
}

export interface DetectionBox {
  id: string;
  label: string;
  score: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectionPayload {
  frameSize: {
    width: number;
    height: number;
  };
  boxes: DetectionBox[];
}

export interface FrontendSocketMessage {
  type: 'status' | 'monitor.sidebar' | 'detection' | 'alert' | 'command_ack';
  ts: string;
  data: unknown;
}

export interface ActivitySummary {
  activityDuration: string;
  feedingCount: number;
  totalFood: number;
  waterCount: number;
}

export interface BehaviorEvent {
  time: string;
  event: string;
  type: 'activity' | 'feeding' | 'rest' | 'alert';
}

export interface FeedingPlan {
  id: string;
  time: string;
  portions: number;
}

export interface DailyReport {
  date: string;
  weather: string;
  temperature: string;
  headline: string;
  detectedClasses?: string[];
  summary: {
    activityDuration: string;
    feedingCount: number;
    anomalies: number;
  };
  timeline: Array<BehaviorEvent & { desc: string }>;
  suggestions: string[];
}

export interface Report {
  id: string;
  date: string;
  weather: string;
  summary: {
    activityDuration: string;
    feedingCount: number;
    anomalies: number;
  };
  timeline: BehaviorEvent[];
  suggestions: string[];
}
