import type { DailyReport, DeviceStatus, MonitorSidebarData, RecordingFile, SecondaryStreamStatus, StreamConfig } from '@/src/types';

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      accept: 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export function getDeviceStatus() {
  return fetchJson<DeviceStatus>('/api/device/status');
}

export function getMonitorSidebar() {
  return fetchJson<MonitorSidebarData>('/api/monitor/sidebar');
}

export function getStreamConfig() {
  return fetchJson<StreamConfig>('/api/video/config');
}

export function getSecondaryStreamStatus() {
  return fetchJson<SecondaryStreamStatus>('/api/video/secondary-status');
}

export function getRecordings() {
  return fetchJson<{ ok: boolean; recordings: RecordingFile[] }>('/api/recordings');
}

export function getDashboardSummary() {
  return fetchJson<{
    device: {
      deviceId: string;
      online: boolean;
      battery: number;
      foodLevel: number;
      lastCommunication: string;
    };
    todaySummary: {
      activityDuration: string;
      feedingCount: number;
      totalFood: number;
      waterCount: number;
    };
    latestReport: {
      date: string;
      summary: string;
    };
    timeline: Array<{
      time: string;
      event: string;
      type: 'activity' | 'feeding' | 'rest' | 'alert';
    }>;
  }>('/api/dashboard/summary');
}

export function getReportDates() {
  return fetchJson<{ ok: boolean; dates: Array<{ date: string; label: string }> }>('/api/reports/dates');
}

export function getDailyReport(date: string) {
  return fetchJson<DailyReport>(`/api/reports/${date}`);
}
