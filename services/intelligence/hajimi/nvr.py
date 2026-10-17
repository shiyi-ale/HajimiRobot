import collections
import json
import os
import queue
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
import cv2
import numpy as np
from .models import LABELS, Detection, utcnow
from .motion import MotionDetector, Scheduler

class YoloAdapter:
    def __init__(self, weights, confidence, device='cuda:0', imgsz=320, half=True):
        if not weights or not Path(weights).is_file():
            raise RuntimeError('缺少专用六类行为权重；可先运行真实运动检测和录像')
        import hashlib
        import torch
        if device.startswith('cuda:'):
            if not torch.cuda.is_available() or int(device.split(':')[1]) >= torch.cuda.device_count():
                raise RuntimeError('请求 GPU 推理，但 CUDA 不可用。请安装 CUDA 版 PyTorch 或明确选择 CPU。')
        from ultralytics import YOLO
        self.model = YOLO(weights)
        if set(self.model.names.values()) != set(LABELS):
            raise ValueError('模型类别不兼容，要求六类行为名称完全匹配')
        self.confidence = confidence
        self.device, self.imgsz = device, imgsz
        self.half = half and device != 'cpu'
        self.gpu_name = torch.cuda.get_device_name(int(device.split(':')[1])) if device != 'cpu' else None
        self.model_id = Path(weights).parents[1].name + ':' + hashlib.sha256(Path(weights).read_bytes()).hexdigest()[:16]
        self.model.to(device)
        # Warm up before declaring the adapter ready; cold startup is not steady-state latency.
        self.infer(np.zeros((imgsz,imgsz,3), np.uint8))

    def infer(self, frame):
        result = self.model.predict(frame, device=self.device, imgsz=self.imgsz, quantize=16 if self.half else 32,
                                    conf=self.confidence, verbose=False)[0]
        boxes = []
        for box in result.boxes:
            xyxy = np.clip(box.xyxyn[0].cpu().numpy(), 0, 1).tolist()
            if xyxy[0] < xyxy[2] and xyxy[1] < xyxy[3]:
                boxes.append({'label': self.model.names[int(box.cls.item())],
                              'confidence': float(box.conf.item()), 'xyxy': xyxy})
        return boxes

class YoloCPU(YoloAdapter):
    """Explicit CPU adapter retained for reproducible baseline comparisons."""
    def __init__(self, weights, confidence):
        super().__init__(weights, confidence, device='cpu', half=False)

def recording_frame(frame):
    """Letterbox portrait footage into browser-compatible 640x360 recordings."""
    h,w = frame.shape[:2]
    scale=min(640/w,360/h)
    resized=cv2.resize(frame,(max(1,round(w*scale)),max(1,round(h*scale))))
    rh,rw=resized.shape[:2]
    return cv2.copyMakeBorder(resized,(360-rh)//2,360-rh-(360-rh)//2,
                             (640-rw)//2,640-rw-(640-rw)//2,cv2.BORDER_CONSTANT,value=(0,0,0))

class Recorder:
    def __init__(self, store, camera, config):
        self.store, self.camera, self.c = store, camera, config
        self.root = store.root / 'clips'
        self.root.mkdir(exist_ok=True)
        self.buffer = collections.deque(maxlen=max(1, int(config.pre_sec * config.analysis_fps) + 1))
        self.process = None
        self.deadline = 0
        self.last_error = None
        self.clip = None
        self.next_attempt = 0

    def cleanup(self, now=None):
        now = time.time() if now is None else now
        rows = self.store.rows("SELECT * FROM clips WHERE camera=? AND status IN ('ready','failed') ORDER BY start", (self.camera,))
        sizes = {r['id']: (self.root / r['path']).stat().st_size if (self.root / r['path']).exists() else 0 for r in rows}
        total = sum(sizes.values())
        for row in rows:
            if row['start'] < now - self.c.retention_days * 86400 or total > self.c.max_storage_bytes:
                (self.root / row['path']).unlink(missing_ok=True)
                (self.root / (row['id'] + '.log')).unlink(missing_ok=True)
                total -= sizes[row['id']]
                self.store.execute("UPDATE clips SET status='expired' WHERE id=?", (row['id'],))

    def push(self, frame, captured, trigger):
        _, jpeg = cv2.imencode('.jpg', recording_frame(frame))
        entry = (captured, jpeg.tobytes())
        if trigger:
            self.deadline = captured + self.c.post_sec
            if self.process is None and captured >= self.next_attempt:
                self.start([*self.buffer, entry])
                self.buffer.append(entry)
                return
        if self.process is not None:
            try:
                self.write_frame(recording_frame(frame), captured)
                self.store.execute('UPDATE clips SET end=? WHERE id=?', (captured, self.clip))
                if captured >= self.deadline or captured - self.clip_start >= 60:
                    self.close()
            except (BrokenPipeError, OSError) as e:
                self.close(str(e))
        self.buffer.append(entry)

    def start(self, entries):
        import imageio_ffmpeg
        self.cleanup()
        self.clip = str(uuid.uuid4())
        name = self.clip + '.mp4'
        self.clip_start = entries[0][0]
        self.written = 0
        self.store.execute('INSERT INTO clips VALUES(?,?,?,?,?,?,?,?)',
                           (self.clip, self.camera, self.c.source_kind, entries[0][0], entries[-1][0], name, 'recording', None))
        try:
            ffmpeg = os.getenv('FFMPEG_EXE') or imageio_ffmpeg.get_ffmpeg_exe()
            self.log = open(self.root / (self.clip + '.log'), 'wb')
            self.process = subprocess.Popen([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
                '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', '640x360', '-r', str(self.c.analysis_fps),
                '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart', str(self.root / name)], stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL, stderr=self.log,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            for captured, data in entries:
                frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
                self.write_frame(frame, captured)
        except Exception as e:
            self.close(str(e))

    def write_frame(self, frame, captured):
        # Preserve elapsed playback time when analysis drops frames or input FPS is low.
        target = round((captured - self.clip_start) * self.c.analysis_fps) + 1
        raw = frame.tobytes()
        while self.written < target:
            self.process.stdin.write(raw)
            self.written += 1

    def close(self, error=None):
        if self.process is not None:
            try:
                self.process.stdin.close()
                code = self.process.wait(timeout=15)
                if code:
                    error = error or f'FFmpeg exit {code}'
            except Exception as e:
                self.process.kill()
                self.process.wait()
                error = error or str(e)
            self.process = None
        if hasattr(self, 'log'):
            self.log.close()
        if self.clip:
            self.store.execute('UPDATE clips SET status=?,error=? WHERE id=?',
                               ('failed' if error else 'ready', error, self.clip))
            if error:
                self.last_error = error
                self.next_attempt = time.time() + 5
            self.clip = None
        self.cleanup()

class Pipeline:
    def __init__(self, store, camera, config, adapter_factory=None):
        self.store, self.camera, self.c = store, camera, config
        self.adapter_factory = adapter_factory
        self.session = str(uuid.uuid4())
        self.stop_event = threading.Event()
        self.reset_event = threading.Event()
        self.pending = queue.Queue(maxsize=1)
        self.adapter_ready = False
        self.jpeg = None
        self.capture_thread = None
        self.infer_thread = None
        self.status = {'running': False, 'source_kind': config.source_kind, 'stream_ok': False,
                       'inference_ok': False, 'state': 'stopped', 'motion_ratio': 0,
                       'analyzed_frames': 0, 'inference_count': 0, 'skipped_frames': 0,
                       'replaced_frames': 0, 'latency_ms': 0, 'error': None, 'inference_error': None,
                       'recording_error': None, 'session_id': self.session}

    def start(self):
        if not self.c.source:
            raise ValueError('请先配置本地视频或摄像头流地址')
        if self.c.source_kind == 'local-video' and not Path(self.c.source).is_file():
            raise ValueError('本地视频文件不存在')
        self.status['running'] = True
        self.infer_thread = threading.Thread(target=self.infer_loop, daemon=True)
        self.capture_thread = threading.Thread(target=self.capture_loop, daemon=True)
        self.infer_thread.start()
        self.capture_thread.start()

    def stop(self):
        self.stop_event.set()
        for thread in (self.capture_thread, self.infer_thread):
            if thread:
                thread.join(timeout=20)
        if any(t and t.is_alive() for t in (self.capture_thread, self.infer_thread)):
            raise RuntimeError('视频服务仍在停止，请稍后重试')
        self.status['running'] = False

    def infer_loop(self):
        try:
            adapter = (self.adapter_factory(self.c.weights, self.c.confidence) if self.adapter_factory else
                       YoloAdapter(self.c.weights, self.c.confidence, self.c.inference_device, self.c.imgsz, self.c.half))
            self.status.update(compute_device=getattr(adapter,'device','test'), gpu_name=getattr(adapter,'gpu_name',None),
                               model_id=adapter.model_id, precision='FP16' if getattr(adapter,'half',False) else 'FP32')
            self.adapter_ready = True
            self.status['inference_ok'] = True
        except Exception as e:
            self.status['inference_error'] = str(e)
            return
        while not self.stop_event.is_set():
            try:
                frame_id, captured, frame = self.pending.get(timeout=.5)
            except queue.Empty:
                if self.capture_thread and not self.capture_thread.is_alive():
                    break
                continue
            started = time.perf_counter()
            try:
                boxes = adapter.infer(frame)
                h, w = frame.shape[:2]
                self.store.ingest([Detection(device_id='local-yolo', camera_id=self.camera,
                    session_id=self.session, frame_id=frame_id,
                    captured_at=datetime.fromtimestamp(captured, timezone.utc), width=w, height=h,
                    model_id=adapter.model_id, source=self.c.source_kind,
                    observation_sec=1 / self.c.analysis_fps, boxes=boxes)])
                self.status.update(inference_count=self.status['inference_count'] + 1,
                                   latency_ms=round((time.perf_counter() - started) * 1000, 2),
                                   inference_ok=True, inference_error=None, boxes=boxes,
                                   detection_captured_at=captured)
            except Exception as e:
                self.status.update(inference_ok=False, inference_error=str(e))
                self.store.record_operation(self.camera, self.c.source_kind, self.session,
                                            captured - 1/self.c.analysis_fps, captured, 'inference_error')

    def capture_loop(self):
        motion = MotionDetector(self.c)
        scheduler = Scheduler(self.c)
        recorder = Recorder(self.store, self.camera, self.c)
        capture = None
        offline_since = None
        try:
            capture = self.open_capture()
            if not capture.isOpened():
                raise RuntimeError('无法打开视频源')
            source_fps = capture.get(cv2.CAP_PROP_FPS)
            if not np.isfinite(source_fps) or source_fps <= 0:
                source_fps = 25.
            source_index, analyzed, last_heartbeat = 0, 0, 0
            began, epoch = time.monotonic(), time.time()
            offline_since = None
            scheduler.reset(began)
            while not self.stop_event.is_set():
                ok, frame = capture.read()
                if not ok:
                    if self.c.source_kind == 'camera':
                        offline_since = offline_since or time.time()
                        self.status.update(stream_ok=False, state='reconnecting', error='断流，正在重连')
                        recorder.close()
                        recorder.buffer.clear()
                        capture.release()
                        if self.stop_event.wait(2):
                            break
                        self.store.record_operation(self.camera, self.c.source_kind, self.session,
                                                    offline_since, time.time(), 'stream_offline')
                        offline_since = time.time()
                        capture = self.open_capture()
                        motion.reset()
                        scheduler.reset(time.monotonic())
                        continue
                    self.status['state'] = 'ended'
                    break
                source_index += 1
                if offline_since is not None:
                    self.store.record_operation(self.camera, self.c.source_kind, self.session, offline_since, time.time(), 'stream_offline')
                    offline_since = None
                if self.c.source_kind == 'local-video':
                    # Consume every decoded frame but sample on media time; playback is realtime.
                    media_time = (source_index - 1) / source_fps
                    if media_time + 1e-6 < analyzed / self.c.analysis_fps:
                        continue
                    if self.stop_event.wait(max(0, began + media_time - time.monotonic())):
                        break
                    captured = epoch + media_time
                else:
                    captured = time.time()
                    if self.stop_event.wait(max(0, 1 / self.c.analysis_fps - (time.monotonic() - began))):
                        break
                    began = time.monotonic()
                now = time.monotonic()
                if self.reset_event.is_set():
                    motion.reset()
                    scheduler.reset(now)
                    self.reset_event.clear()
                ratio, changed = motion.measure(frame)
                due = scheduler.update(ratio, now, changed)
                analyzed += 1
                self.status.update(stream_ok=True, state=scheduler.state, motion_ratio=ratio,
                                   analyzed_frames=analyzed, error=None,
                                   frame_width=frame.shape[1],frame_height=frame.shape[0])
                h,w=frame.shape[:2]
                scale=min(1,640/max(h,w))
                _, jpeg = cv2.imencode('.jpg', cv2.resize(frame, (round(w*scale),round(h*scale))))
                self.jpeg = jpeg.tobytes()
                recent_detection = bool(self.status.get('boxes')) and 0 <= captured - self.status.get('detection_captured_at', 0) <= 2
                recorder.push(frame, captured, scheduler.state == 'active' or recent_detection)
                self.status['recording_error'] = recorder.last_error
                operation = 'inference_unavailable' if not self.adapter_ready else ('inference_pending' if due else 'scheduled_skip')
                self.store.record_operation(self.camera, self.c.source_kind, self.session,
                                            captured - 1/self.c.analysis_fps, captured, operation)
                if due and self.adapter_ready:
                    if self.pending.full():
                        try:
                            self.pending.get_nowait()
                            self.status['replaced_frames'] += 1
                        except queue.Empty:
                            pass
                    self.pending.put_nowait((source_index, captured, frame.copy()))
                else:
                    self.status['skipped_frames'] += 1
                if now - last_heartbeat >= 2:
                    last_heartbeat = now
                    self.store.execute('INSERT OR REPLACE INTO heartbeats VALUES(?,?,?,?,?)',
                        ('local-yolo', self.camera, self.session, json.dumps(self.status), utcnow()))
        except Exception as e:
            self.status.update(state='error', error=str(e))
        finally:
            if offline_since is not None:
                self.store.record_operation(self.camera, self.c.source_kind, self.session, offline_since, time.time(), 'stream_offline')
            if capture:
                capture.release()
            recorder.close()
            self.status.update(running=False, stream_ok=False, recording_error=recorder.last_error)
            self.store.execute('INSERT OR REPLACE INTO heartbeats VALUES(?,?,?,?,?)',
                ('local-yolo', self.camera, self.session, json.dumps(self.status), utcnow()))

    def open_capture(self):
        if self.c.source_kind == 'camera':
            return cv2.VideoCapture(self.c.source, cv2.CAP_FFMPEG,
                [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 3000])
        return cv2.VideoCapture(self.c.source)
