import asyncio
import json
import os
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.responses import FileResponse, StreamingResponse
from .agent import Agent
from .models import Batch, CameraConfig, Detection, Heartbeat, Question, utcnow
from .nvr import Pipeline, Recorder
from .store import Store
from .settings import Settings, DeepSeekConfig
from .timeline import build_timeline, mark_reviewed

ROOT = Path(__file__).resolve().parents[3]
VERSION = (ROOT / 'VERSION').read_text(encoding='utf-8').strip()
load_dotenv(ROOT / '.env.local')

def create_app(root=None):
    store = Store(root or os.getenv('HAJIMI_DATA_DIR', str(ROOT / '.runtime/intelligence')),
                  os.getenv('REPORT_TIMEZONE', 'Asia/Shanghai'))
    settings = Settings(store.root)
    agent = Agent(store, settings)
    pipelines = {}
    pipeline_lock = threading.RLock()
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='report')
    stopping = threading.Event()

    def config(camera):
        rows = store.rows('SELECT payload FROM configs WHERE camera=?', (camera,))
        return CameraConfig.model_validate_json(rows[0]['payload']) if rows else CameraConfig()

    def maintenance():
        while not stopping.wait(30):
            for row in store.rows('SELECT camera,payload FROM configs'):
                try:
                    Recorder(store, row['camera'], CameraConfig.model_validate_json(row['payload'])).cleanup()
                except Exception:
                    pass
            if not agent.embeddings.configured:
                continue
            today = datetime.now(store.zone).date().isoformat()
            for row in store.rows('SELECT * FROM memories WHERE dirty=1 AND date<? ORDER BY date LIMIT 7', (today,)):
                if stopping.is_set():
                    return
                try:
                    agent.consolidate(row['date'], row['camera'], row['source'])
                    store.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', ('consolidation_status', 'ok:' + utcnow()))
                except Exception as e:
                    store.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', ('consolidation_status', type(e).__name__))
                    break

    @asynccontextmanager
    async def lifespan(app):
        store.import_legacy(ROOT / 'Web-Console/data/behavior-history.json')
        store.execute("UPDATE clips SET status='failed',error='进程中断，录像未正常完成' WHERE status='recording'")
        store.execute("UPDATE jobs SET status='failed',payload=? WHERE status IN ('queued','running')", (json.dumps({'error': '服务重启，请重新生成报告'}),))
        worker = threading.Thread(target=maintenance, daemon=True)
        worker.start()
        yield
        stopping.set()
        for pipeline in pipelines.values():
            pipeline.stop()
        worker.join(timeout=35)
        executor.shutdown(wait=True)
        if agent.qdrant:
            agent.qdrant.close()
        store.db.close()

    app = FastAPI(title='Hajimi NVR & Memory Agent', version=VERSION, lifespan=lifespan)
    app.state.store, app.state.agent = store, agent

    @app.middleware('http')
    async def access(request: Request, call_next):
        token = os.getenv('HAJIMI_API_TOKEN', '')
        # Default loopback deployment; set token on both services before exposing edge ingress.
        if token and request.url.path.startswith('/api/') and request.headers.get('authorization') != 'Bearer ' + token:
            from fastapi.responses import JSONResponse
            return JSONResponse({'detail': 'Unauthorized'}, status_code=401)
        if request.headers.get('content-length', '').isdigit() and int(request.headers['content-length']) > 2_000_000:
            from fastapi.responses import JSONResponse
            return JSONResponse({'detail': 'Payload too large'}, status_code=413)
        return await call_next(request)

    @app.get('/api/v1/health')
    def health():
        return {'ok': True, 'version': VERSION, 'time': utcnow(), 'timezone': str(store.zone),
                'llm_configured': settings.public()['configured'],
                'embedding_configured': agent.embeddings.configured,
                'embedding_backend': agent.embeddings.backend,
                'embedding_model': agent.embeddings.model_name,
                'embedding_loaded': agent.embeddings.model is not None,
                'consolidation': store.rows("SELECT value FROM meta WHERE key='consolidation_status'")}

    @app.get('/api/v1/agent/config')
    def agent_config():
        return settings.public()

    @app.put('/api/v1/agent/config')
    def save_agent_config(data: DeepSeekConfig):
        try:
            return settings.update(data)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e

    @app.post('/api/v1/agent/config/test')
    def test_agent_config():
        import httpx
        try:
            return settings.test()
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        except httpx.HTTPStatusError as e:
            raise HTTPException(502, f'DeepSeek 返回 HTTP {e.response.status_code}，请检查密钥权限与模型配置') from e
        except httpx.TransportError as e:
            raise HTTPException(502, '无法连接 DeepSeek，请检查网络') from e

    @app.post('/api/v1/detections/batch')
    def detections(batch: Batch):
        # Ingestion and semantic consolidation share a lock: a late insert cannot be
        # accidentally marked clean by a simultaneous older consolidation snapshot.
        with agent.lock:
            return store.ingest(batch.frames)

    @app.post('/api/v1/edge/heartbeat')
    def heartbeat(data: Heartbeat):
        existing = store.rows('SELECT payload FROM heartbeats WHERE device=? AND camera=?', (data.device_id, data.camera_id))
        if existing:
            previous = json.loads(existing[0]['payload'])
            if previous.get('captured_at') and datetime.fromisoformat(previous['captured_at']) > data.captured_at:
                return {'ok': True, 'ignored': 'older-heartbeat'}
            if previous.get('captured_at') and previous.get('session_id') == data.session_id:
                begin = datetime.fromisoformat(previous['captured_at']).timestamp()
                finish = data.captured_at.timestamp()
                # Only bounded, agreeing heartbeats can establish a historical state.
                if 0 < finish - begin <= 10:
                    state = ('stream_offline' if not previous.get('stream_ok') and not data.stream_ok else
                             'inference_unavailable' if previous.get('stream_ok') and data.stream_ok
                             and not previous.get('inference_ok') and not data.inference_ok else None)
                    if state:
                        store.record_operation(data.camera_id, 'camera', data.session_id, begin, finish, state)
        store.execute('INSERT OR REPLACE INTO heartbeats VALUES(?,?,?,?,?)',
                      (data.device_id, data.camera_id, data.session_id, data.model_dump_json(), utcnow()))
        return {'ok': True, 'config_revision': config(data.camera_id).revision}

    @app.get('/api/v1/cameras/{camera}/config')
    def get_config(camera: str):
        return config(camera)

    @app.put('/api/v1/cameras/{camera}/config')
    def put_config(camera: str, data: CameraConfig):
        with pipeline_lock:
            if camera in pipelines and pipelines[camera].status['running']:
                raise HTTPException(409, '请先停止视频分析再修改配置')
            data.revision = config(camera).revision + 1
            store.execute('INSERT OR REPLACE INTO configs VALUES(?,?)', (camera, data.model_dump_json()))
        return data

    @app.get('/api/v1/nvr/status')
    def nvr_status():
        with pipeline_lock:
            heartbeats = store.rows('SELECT * FROM heartbeats')
            for heartbeat in heartbeats:
                payload = json.loads(heartbeat['payload'])
                age = max(0, time.time() - datetime.fromisoformat(heartbeat['received']).timestamp())
                heartbeat['age_sec'] = round(age, 1)
                heartbeat['online'] = age <= 10 and bool(payload.get('stream_ok'))
            return {'pipelines': {k: dict(v.status) for k, v in pipelines.items()},
                    'heartbeats': heartbeats,
                    'cameras': [r['camera'] for r in store.rows('SELECT camera FROM configs')]}

    @app.get('/api/v1/nvr/hardware')
    def hardware():
        try:
            import torch
        except ImportError:
            return {'torch_version': None, 'cuda_available': False, 'cuda_version': None, 'gpus': [], 'reason':'PyTorch 未安装'}
        return {'torch_version': torch.__version__, 'cuda_available': torch.cuda.is_available(),
                'cuda_version': torch.version.cuda,
                'gpus': [{'device': f'cuda:{i}', 'name': torch.cuda.get_device_name(i),
                          'memory_bytes': torch.cuda.get_device_properties(i).total_memory} for i in range(torch.cuda.device_count())]}

    @app.get('/api/v1/nvr/assets')
    def assets():
        path = ROOT / 'models/catalog.json'
        if not path.exists():
            return {'models': [], 'videos': []}
        data = json.loads(path.read_text(encoding='utf-8'))
        return {'models': [{'id': e['id'], 'role': e['role'], 'recommended':e['recommended'],
                            'path':str(ROOT / w['path']), 'size_bytes':w['size_bytes']}
                           for e in data['experiments'] for w in e['weights'] if w['name']=='best.pt' and (ROOT/w['path']).is_file()],
                'videos': [dict(v,path=str(ROOT/v['path'])) for v in data['videos'] if (ROOT/v['path']).is_file()]}

    @app.post('/api/v1/cameras/{camera}/start')
    def start(camera: str):
        with pipeline_lock:
            if camera in pipelines:
                if pipelines[camera].status['running']:
                    raise HTTPException(409, '视频分析已经运行')
                pipelines[camera].stop()
            pipeline = Pipeline(store, camera, config(camera))
            try:
                pipeline.start()
            except ValueError as e:
                raise HTTPException(400, str(e)) from e
            pipelines[camera] = pipeline
            return pipeline.status

    @app.post('/api/v1/cameras/{camera}/stop')
    def stop(camera: str):
        with pipeline_lock:
            if camera in pipelines:
                pipelines[camera].stop()
        return {'ok': True}

    @app.post('/api/v1/cameras/{camera}/motion-reset')
    def reset(camera: str):
        if camera in pipelines:
            pipelines[camera].reset_event.set()
        return {'ok': True}

    @app.get('/api/v1/cameras/{camera}/preview.jpg')
    def preview(camera: str):
        from fastapi.responses import Response
        pipeline = pipelines.get(camera)
        if not pipeline or pipeline.jpeg is None:
            raise HTTPException(404, '暂无视频帧，请先启动视频分析')
        return Response(pipeline.jpeg, media_type='image/jpeg', headers={'Cache-Control': 'no-store'})

    @app.get('/api/v1/stats/{day}')
    def stats(day: str, camera_id: str = 'primary', source: str = 'local-video'):
        try:
            return store.stats(day, camera_id, source)
        except ValueError as e:
            raise HTTPException(422, '日期格式应为 YYYY-MM-DD') from e

    @app.get('/api/v1/events')
    def events(day: str, camera_id: str = 'primary', source: str = 'local-video', label: str = ''):
        result = stats(day, camera_id, source)
        return {'events': [e for e in result['events'] if not label or e['label'] == label]}

    @app.get('/api/v1/review/timeline')
    def review_timeline(day: str, camera_id: str = 'primary', source: str = 'local-video'):
        try:
            camera_config = config(camera_id)
            return build_timeline(store, day, camera_id, source, camera_config.review_gap_sec, camera_config.review_max_sec)
        except ValueError:
            raise HTTPException(422, '日期格式应为 YYYY-MM-DD')

    @app.put('/api/v1/review/{review_id}/status')
    def review_status(review_id: str, data: dict):
        if not isinstance(data.get('reviewed'), bool) or not isinstance(data.get('revision'), str):
            raise HTTPException(422, '需要 reviewed 布尔值和 revision 字符串')
        try:
            mark_reviewed(store, review_id, data['revision'], data['reviewed'])
        except KeyError:
            raise HTTPException(404, '回看片段不存在，请刷新')
        except ValueError as e:
            raise HTTPException(409, str(e))
        return {'ok': True}

    @app.get('/api/v1/clips')
    def clips(camera_id: str = 'primary', source: str = 'local-video', day: str | None = None):
        if day is not None:
            try:
                start, end = store.bounds(day)
            except ValueError:
                raise HTTPException(422, '日期格式应为 YYYY-MM-DD')
            return {'clips': store.rows('SELECT * FROM clips WHERE camera=? AND source=? AND start<? AND end>? ORDER BY start DESC',
                                        (camera_id, source, end, start))}
        return {'clips': store.rows('SELECT * FROM clips WHERE camera=? AND source=? ORDER BY start DESC LIMIT 200', (camera_id, source))}

    @app.get('/api/v1/clips/{clip_id}/video')
    def clip_video(clip_id: str):
        rows = store.rows("SELECT * FROM clips WHERE id=? AND status='ready'", (clip_id,))
        if not rows:
            raise HTTPException(404, '录像未就绪或已过期')
        path = store.root / 'clips' / rows[0]['path']
        if not path.is_file():
            raise HTTPException(404, '录像文件不存在')
        return FileResponse(path, media_type='video/mp4')

    def report_job(job_id, data):
        store.execute('UPDATE jobs SET status=? WHERE id=?', ('running', job_id))
        try:
            result = agent.run(data)
            store.execute('UPDATE jobs SET status=?,payload=? WHERE id=?', ('completed', json.dumps(result, ensure_ascii=False), job_id))
        except Exception as e:
            store.execute('UPDATE jobs SET status=?,payload=? WHERE id=?', ('failed', json.dumps({'error': str(e)}), job_id))

    @app.post('/api/v1/agent/reports', status_code=202)
    def report(data: Question):
        # Keep background work bounded even when provider requests are slow.
        if store.rows("SELECT count(*) n FROM jobs WHERE status IN ('queued','running')")[0]['n'] >= 4:
            raise HTTPException(429, '报告队列已满，请稍后重试')
        job_id = str(uuid.uuid4())
        store.execute('INSERT INTO jobs VALUES(?,?,?)', (job_id, 'queued', '{}'))
        executor.submit(report_job, job_id, data)
        return {'job_id': job_id}

    @app.get('/api/v1/agent/jobs/{job_id}')
    def job(job_id: str):
        rows = store.rows('SELECT * FROM jobs WHERE id=?', (job_id,))
        if not rows:
            raise HTTPException(404)
        return {'id': job_id, 'status': rows[0]['status'], 'result': json.loads(rows[0]['payload'])}

    @app.get('/api/v1/agent/reports')
    def list_reports(camera_id: str | None = None, source: str | None = None, date: str | None = None,
                     before_id: int | None = Query(default=None, ge=1), limit: int = Query(default=20, ge=1, le=100)):
        conditions, args = [], []
        for field, value in [('camera_id', camera_id), ('source', source), ('date', date)]:
            if value is not None:
                conditions.append(f"json_extract(payload, '$.{field}')=?")
                args.append(value)
        if before_id is not None:
            conditions.append('id<?')
            args.append(before_id)
        where = ' WHERE ' + ' AND '.join(conditions) if conditions else ''
        columns = "id,created,json_extract(payload,'$.date') date,json_extract(payload,'$.camera_id') camera_id,json_extract(payload,'$.source') source,json_extract(payload,'$.mode') mode,substr(json_extract(payload,'$.answer.summary'),1,180) summary"
        rows = store.rows('SELECT ' + columns + ' FROM reports' + where + ' ORDER BY id DESC LIMIT ?', (*args, limit+1))
        return {'reports': rows[:limit], 'next_cursor': rows[limit-1]['id'] if len(rows)>limit else None}

    @app.get('/api/v1/agent/reports/{report_id}')
    def get_report(report_id: int):
        rows = store.rows('SELECT * FROM reports WHERE id=?', (report_id,))
        if not rows:
            raise HTTPException(404)
        return dict(json.loads(rows[0]['payload']), report_id=report_id)

    @app.post('/api/v1/memory/consolidate')
    def consolidate(data: Question):
        if data.date >= datetime.now(store.zone).date().isoformat():
            raise HTTPException(400, '仅归并已结束的日期')
        try:
            return agent.consolidate(data.date, data.camera_id, data.source)
        except Exception as e:
            raise HTTPException(503, f'归并失败：{type(e).__name__}，检查嵌入服务配置') from e

    @app.post('/api/v1/compat/behavior')
    def legacy(data: dict):
        try:
            timestamp = data.get('iso', utcnow())
            frame = Detection(device_id='legacy-http', camera_id='primary', session_id='legacy-http',
                frame_id=int(uuid.uuid4().int % (2**52)), captured_at=timestamp,
                width=1, height=1, model_id='legacy-unknown', source='legacy', observation_sec=0,
                boxes=[{'label': data['label'], 'confidence': data.get('score', 1), 'xyxy': [0, 0, 1, 1]}])
        except (ValueError, KeyError) as e:
            raise HTTPException(422, str(e)) from e
        return store.ingest([frame])

    @app.post('/api/v1/commands/feed')
    def feeding():
        store.execute('INSERT INTO commands(captured,action) VALUES(?,?)', (time.time(), 'feed'))
        return {'ok': True}

    @app.get('/api/v1/compat/reports/dates')
    def dates():
        rows = store.rows('SELECT captured FROM frames ORDER BY captured DESC')
        days = sorted({datetime.fromtimestamp(r['captured'], store.zone).date().isoformat() for r in rows}, reverse=True)
        return {'ok': True, 'dates': [{'date': d, 'label': d} for d in days]}

    @app.get('/api/v1/compat/reports/{day}')
    def compat_report(day: str):
        data = stats(day)
        return {'date': day, 'weather': '观测统计', 'temperature': f"覆盖率 {data['coverage']:.2%}",
                'headline': '基于明确观测区间的行为报告', 'detectedClasses': [k for k, v in data['duration_sec'].items() if v],
                'summary': {'activityDuration': f"{sum(data['duration_sec'][k] for k in ['playing','stretching']) / 3600:.3f}h",
                            'feedingCount': data['eating_episodes'], 'anomalies': 0},
                'timeline': [{'time': e['started_at'], 'event': e['label'], 'type': 'activity',
                              'desc': f"观测时长 {e['duration_sec']:.1f} 秒"} for e in data['events']],
                'suggestions': data['limitations']}

    return app

app = create_app()
