import json
import time
import cv2
import numpy as np
from hajimi.models import CameraConfig
from hajimi.nvr import Recorder, Pipeline
from hajimi.store import Store

def test_recording_buffer_merge_playback_retention(tmp_path):
    s = Store(tmp_path)
    cfg = CameraConfig(analysis_fps=5, pre_sec=1, post_sec=1)
    recorder = Recorder(s,'primary',cfg)
    frame = np.zeros((360,640,3),np.uint8)
    epoch = time.time()
    for i in range(20):
        # Two nearby triggers extend the same clip.
        recorder.push(frame,epoch+i/5,i in (5,8))
    recorder.close()
    clips = s.rows('SELECT * FROM clips')
    assert len(clips) == 1
    clip = clips[0]
    assert clip['status'] == 'ready', clip
    assert clip['start'] <= epoch+.2
    assert clip['end'] >= epoch+2.6
    cap = cv2.VideoCapture(str(tmp_path/'clips'/clip['path']))
    assert cap.isOpened() and cap.read()[0]
    cap.release()
    oversized=tmp_path/'clips'/'oversized.mp4'
    with oversized.open('wb') as f: f.truncate(2_000_000)
    s.execute('INSERT INTO clips VALUES(?,?,?,?,?,?,?,?)',('oversized','primary','local-video',epoch-1,epoch,'oversized.mp4','ready',None))
    cfg.max_storage_bytes=1_000_000
    recorder.cleanup(now=epoch+4)
    assert not oversized.exists()
    assert s.rows("SELECT status FROM clips WHERE id=?",(clip['id'],))[0]['status']=='ready'
    recorder.cleanup(now=epoch+8*86400)
    assert not (tmp_path/'clips'/clip['path']).exists()
    assert s.rows('SELECT status FROM clips WHERE id=?',(clip['id'],))[0]['status'] == 'expired'

def test_ffmpeg_failure_is_visible(tmp_path,monkeypatch):
    monkeypatch.setenv('FFMPEG_EXE',str(tmp_path/'missing-ffmpeg.exe'))
    s=Store(tmp_path); r=Recorder(s,'primary',CameraConfig())
    r.push(np.zeros((360,640,3),np.uint8),time.time(),True)
    assert r.last_error
    assert s.rows('SELECT status FROM clips')[0]['status']=='failed'

def test_real_video_pipeline_with_explicit_test_adapter(tmp_path):
    path=tmp_path/'fixture.avi'
    writer=cv2.VideoWriter(str(path),cv2.VideoWriter_fourcc(*'MJPG'),10,(320,180))
    assert writer.isOpened()
    for i in range(35):
        image=np.zeros((180,320,3),np.uint8)
        if i>10: cv2.rectangle(image,((i*7)%200,40),((i*7)%200+60,120),(255,255,255),-1)
        writer.write(image)
    writer.release()
    class TestAdapter:
        model_id='TEST-ADAPTER-NOT-YOLO'
        def __init__(self,*args): pass
        def infer(self, frame):
            # Explicit fabricated labels in an isolated test DB, never real YOLO output.
            return [{'label':'playing','confidence':.9,'xyxy':[.1,.1,.5,.8]}]
    s=Store(tmp_path/'data')
    cfg=CameraConfig(source=str(path),warmup_sec=.2,rise_sec=.2,pre_sec=.5,post_sec=.5)
    p=Pipeline(s,'primary',cfg,adapter_factory=TestAdapter)
    p.start()
    p.capture_thread.join(15); p.infer_thread.join(3)
    assert not p.capture_thread.is_alive()
    assert p.status['analyzed_frames'] >= 15
    assert p.status['inference_count'] > 0
    assert p.status['state']=='ended',p.status
    assert s.rows('SELECT count(*) n FROM frames')[0]['n'] > 0
    assert s.rows('SELECT * FROM clips')
    assert all(r['status']=='ready' for r in s.rows('SELECT * FROM clips'))
    from datetime import datetime
    from hajimi.agent import Agent
    from hajimi.models import Question
    day=datetime.now(s.zone).date().isoformat()
    report=Agent(s).run(Question(date=day,camera_id='primary',source='local-video',question='测试链路'))
    assert report['stats']['duration_sec']['playing']>0
    assert any(e['clips'] for e in report['stats']['events'])
    assert report['report_id']>0
