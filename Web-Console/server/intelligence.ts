import type { Express, Request, Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';

export function mountIntelligence(app: Express) {
  const origin = (process.env.INTELLIGENCE_ORIGIN || 'http://127.0.0.1:8001').replace(/\/$/, '');
  const proxy = async (req: Request, res: Response, target: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 65000);
    res.on('close', () => controller.abort());
    try {
      const upstream = await fetch(origin + target, {
        method: req.method,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(process.env.HAJIMI_API_TOKEN ? { authorization: `Bearer ${process.env.HAJIMI_API_TOKEN}` } : {}),
          ...(req.headers.range ? { range: req.headers.range } : {}),
        },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
      });
      res.status(upstream.status);
      for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
        const value = upstream.headers.get(key);
        if (value) res.setHeader(key, value);
      }
      if (upstream.body) {
        const stream = Readable.fromWeb(upstream.body as ReadableStream<Uint8Array>);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
        await new Promise<void>((resolve) => { res.on('finish', resolve); res.on('close', resolve); });
      } else res.end();
    } catch {
      if (!res.headersSent) res.status(503).json({ error: 'NVR / Agent 服务不可用，请检查 8001 端口和服务日志。' });
    } finally {
      clearTimeout(timeout);
    }
  };
  app.use('/api/v1', (req, res) => { void proxy(req, res, req.originalUrl); });
  app.get('/api/reports/dates', (req, res) => { void proxy(req, res, '/api/v1/compat/reports/dates'); });
  app.get('/api/reports/:date', (req, res) => { void proxy(req, res, `/api/v1/compat/reports/${encodeURIComponent(req.params.date)}`); });
  app.post('/api/behavior/detection', (req, res) => { void proxy(req, res, '/api/v1/compat/behavior'); });
  // Prevent accidental hardware actions when disconnected, including calls outside the UI.
  app.use(['/api/control', '/api/system'], async (_req, res, next) => {
    if (!process.env.JETSON_BRIDGE_BASE_URL) {
      res.status(503).json({ error: 'Jetson 未连接，硬件操作已禁用。' });
      return;
    }
    try {
      const health = await fetch(process.env.JETSON_BRIDGE_BASE_URL + '/healthz', { signal: AbortSignal.timeout(1500) });
      if (!health.ok) throw new Error('offline');
      next();
    } catch {
      res.status(503).json({ error: 'Jetson 离线，硬件操作已禁用。' });
    }
  });
}
