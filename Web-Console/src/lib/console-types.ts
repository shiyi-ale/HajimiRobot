export type DataSource = 'camera' | 'local-video' | 'test' | 'legacy';
export interface ReviewLocation { date: string; camera: string; source: DataSource; timestamp?: number; eventId?: string; }
export interface ClipReference { id: string; status: string; }
export interface BehaviorEvent { id: string; label: string; start: number; end: number; started_at: string; duration_sec: number; clips: ClipReference[]; }
export interface DailyStats {
  date: string; camera_id: string; source: DataSource; observed_sec: number; coverage: number; sample_count: number;
  duration_sec: Record<string, number>; eating_episodes: number; feeding_commands: number; events: BehaviorEvent[];
}
export interface TrendValue { observed_share: number; baseline_share: number; delta_percentage_points: number; }
export interface Report {
  report_id: number; date: string; camera_id: string; source: DataSource; mode: string; prompt_version: string;
  stats: DailyStats; baseline: DailyStats[]; memories: Record<string, unknown>[]; warnings: string[];
  answer: {summary: string; findings: {text: string; evidence_ids: string[]}[]; limitations: string[]};
  trend: {sufficient: boolean; note: string; values: Record<string, TrendValue>};
}
export interface ReportSummary { id: number; date: string; camera_id: string; source: DataSource; mode: string; summary: string; created: string; }
