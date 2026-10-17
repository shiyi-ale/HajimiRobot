export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api/v1' + path, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : data.error || JSON.stringify(data.detail) || `HTTP ${response.status}`);
  return data;
}
export function localDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export const labels: Record<string, string> = { eating: '进食', playing: '玩耍', rest: '休息', sitting: '坐姿', stretching: '伸展', yawning: '打哈欠' };
export const panel = 'care-card space-y-4';
export const button = 'care-button';
export const input = 'care-field';
