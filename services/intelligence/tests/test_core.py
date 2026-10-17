import json
from datetime import datetime, timezone, timedelta
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from hajimi.models import CameraConfig, Detection, Question
from hajimi.motion import MotionDetector, Scheduler
from hajimi.store import Store
from hajimi.agent import Agent
from hajimi.app import create_app

def frame(i=0, **kwargs):
    values = dict(device_id='test-edge', camera_id='primary', session_id='session', frame_id=i,
                  captured_at=datetime(2026, 3, 1, 4, tzinfo=timezone.utc) + timedelta(seconds=i),
                  width=640, height=360, model_id='test-six-class', source='test', observation_sec=1,
                  boxes=[dict(label='playing', confidence=.9, xyxy=[.1, .1, .4, .5])])
    values.update(kwargs)
    return Detection(**values)

def test_ingest_idempotent_late_empty_and_restart(tmp_path):
    s = Store(tmp_path)
    assert s.ingest([frame(2), frame(0), frame(1)])['accepted'] == 3
    before = s.stats('2026-03-01', source='test')
    assert before['duration_sec']['playing'] == 3
    assert len(before['events']) == 1
    assert s.ingest([frame(0)]) == {'accepted': 0, 'duplicates': 1}
    s.ingest([frame(3, boxes=[]), frame(4)])
    result = s.stats('2026-03-01', source='test')
    assert result['observed_sec'] == 5
    assert result['empty_detection_frames'] == 1
    assert result['no_target_observed_sec'] == 1
    assert result['unobserved_sec'] == 86395
    assert result['duration_sec']['playing'] == 4
    assert len(result['events']) == 2
    s.db.close()
    reopened = Store(tmp_path)
    assert reopened.stats('2026-03-01', source='test') == result
    assert before['events'][0]['id'] == result['events'][0]['id']

def test_gap_camera_source_and_midnight(tmp_path):
    s = Store(tmp_path)
    s.ingest([frame(0), frame(10), frame(1, camera_id='secondary'), frame(2, source='camera')])
    stats = s.stats('2026-03-01', source='test')
    assert stats['observed_sec'] == 2
    assert len(stats['events']) == 2
    assert s.stats('2026-03-01', 'secondary', 'test')['sample_count'] == 1
    s.ingest([frame(20, captured_at='2026-03-01T16:00:00.500Z')])
    assert s.stats('2026-03-02', source='test')['duration_sec']['playing'] == .5
    assert s.stats('2026-03-01', source='test')['duration_sec']['playing'] == 2.5
    assert s.stats('2026-03-01', source='test')['feeding_commands'] == 0

def test_conflicting_overlapping_observations_do_not_inflate_time(tmp_path):
    s = Store(tmp_path)
    s.ingest([frame(1,observation_sec=2), frame(2,observation_sec=2,boxes=[dict(label='rest',confidence=.9,xyxy=[0,0,1,1])])])
    stats=s.stats('2026-03-01',source='test')
    assert stats['observed_sec']==3
    assert sum(stats['duration_sec'].values())==3
    assert stats['duration_sec']['rest']==2

def test_legacy_never_invents_duration(tmp_path):
    history = tmp_path / 'history.json'
    history.write_text(json.dumps([{'iso': '2026-03-01T04:00:00Z', 'label': 'eating'}]))
    s = Store(tmp_path / 'data')
    s.import_legacy(history); s.import_legacy(history)
    report = s.stats('2026-03-01', source='legacy')
    assert report['sample_count'] == 1
    assert report['duration_sec']['eating'] == 0
    assert report['observed_sec'] == 0

def test_scheduler_hysteresis_idle_probe_and_reset():
    c = CameraConfig(warmup_sec=0)
    s = Scheduler(c)
    assert s.update(0, 0)
    assert s.state == 'idle'
    assert not s.update(0, 1)
    assert s.update(0, 5)
    s.update(.1, 6); assert s.state == 'candidate'
    s.update(.1, 6.6); assert s.state == 'active'
    s.update(0, 7); assert s.state == 'active'
    s.update(0, 10.1); assert s.state == 'idle'
    s.c.warmup_sec = 3
    assert not s.update(.9, 11, global_change=True)
    assert s.state == 'warming'
    s.reset(15); assert not s.update(.1, 16)

def test_motion_roi_and_light_change():
    c = CameraConfig(roi=[(0,0),(.4,0),(.4,1),(0,1)])
    m = MotionDetector(c)
    blank = np.zeros((180,320,3), np.uint8)
    for _ in range(50): m.measure(blank)
    outside = blank.copy(); outside[50:130,200:280] = 255
    ratio, changed = m.measure(outside)
    assert ratio == 0 and not changed
    inside = blank.copy(); inside[50:130,10:80] = 255
    ratio, _ = m.measure(inside)
    assert ratio > .02
    m.measure(blank)
    _, changed = m.measure(np.full_like(blank,255))
    assert changed

@pytest.mark.parametrize('patch', [dict(boxes=[dict(label='cat', confidence=.9, xyxy=[0,0,1,1])]),
                                 dict(captured_at='2026-03-01T00:00:00'),
                                 dict(boxes=[dict(label='rest', confidence=2, xyxy=[0,0,1,1])]),
                                 dict(boxes=[dict(label='rest', confidence=.9, xyxy=[1,0,0,1])])])
def test_invalid_detection(patch):
    with pytest.raises(ValidationError): frame(**patch)

def test_api_jobs_protocol_and_heartbeat(tmp_path, monkeypatch):
    monkeypatch.delenv('HAJIMI_API_TOKEN', raising=False)
    monkeypatch.delenv('LLM_API_KEY', raising=False)
    monkeypatch.delenv('EMBEDDING_API_KEY', raising=False)
    with TestClient(create_app(tmp_path)) as c:
        payload = {'frames': [json.loads(frame().model_dump_json())]}
        assert c.post('/api/v1/detections/batch', json=payload).json()['accepted'] == 1
        assert c.post('/api/v1/detections/batch', json=payload).json()['duplicates'] == 1
        assert c.post('/api/v1/detections/batch', json={'frames': []}).status_code == 422
        assert c.put('/api/v1/cameras/primary/config', json={'roi': [[0,0],[1,0]]}).status_code == 422
        assert c.post('/api/v1/cameras/primary/start').status_code == 400
        hb = dict(device_id='edge',camera_id='primary',session_id='s',captured_at='2026-03-01T00:00:00Z',stream_ok=True,
                  inference_ok=False,scheduler_state='idle',observed_sec=0)
        assert c.post('/api/v1/edge/heartbeat',json=hb).status_code == 200
        question = dict(date='2026-03-01',camera_id='primary',source='test',question='总结')
        job = c.post('/api/v1/agent/reports',json=question).json()['job_id']
        import time
        for _ in range(100):
            result = c.get('/api/v1/agent/jobs/'+job).json()
            if result['status'] in ('completed','failed'): break
            time.sleep(.02)
        assert result['status'] == 'completed', result
        report = result['result']
        assert report['mode'] == 'statistics'
        assert not report['trend']['sufficient']
        assert report['answer']['findings'][0]['evidence_ids'] == ['stats:2026-03-01:primary:test']
        assert c.get('/api/v1/agent/reports').json()['reports']
        assert c.get('/api/v1/agent/reports/'+str(report['report_id'])).status_code == 200
        assert c.get('/api/v1/clips/missing/video').status_code == 404

def test_semantic_consolidation_is_idempotent_and_dirty(tmp_path, monkeypatch):
    s = Store(tmp_path)
    agent = Agent(s)
    # Deterministic test embeddings, never presented as semantic model validation.
    monkeypatch.setattr(agent, 'embedding', lambda _: [.1, .2, .3])
    s.ingest([frame()])
    first = agent.consolidate('2026-03-01','primary','test')
    assert agent.consolidate('2026-03-01','primary','test') == first
    client, collection = agent.vector_client(3)
    assert client.count(collection).count == 1
    s.ingest([frame(1)])
    assert s.rows('SELECT dirty FROM memories')[0]['dirty'] == 1
    updated = agent.consolidate('2026-03-01','primary','test')
    assert updated['sample_count'] == 2
    assert client.count(collection).count == 1
    result = agent.retrieve({'question':'行为','date':'2026-03-02','camera_id':'primary','source':'test','warnings':[]})
    assert result['memories'] == []  # Sparse observations cannot become long-term evidence.
    monkeypatch.setenv('MEMORY_MIN_COVERAGE', '0')
    result = agent.retrieve({'question':'行为','date':'2026-03-02','camera_id':'primary','source':'test','warnings':[]})
    assert result['memories'][0]['sample_count'] == 2
    client.close()

def test_invalid_llm_reference_falls_back(tmp_path):
    s = Store(tmp_path); s.ingest([frame()]); a = Agent(s)
    state = a.query({'date':'2026-03-01','camera_id':'primary','source':'test'})
    state.update(a.calculate(state))
    state.update(source='test',memories=[],warnings=[],mode='llm',answer={'summary':'不可信',
                 'findings':[{'text':'假结论','evidence_ids':['invented']}], 'limitations':[]})
    result = a.validate(state)
    assert result['mode'] == 'statistics'
    assert result['warnings']

def test_numeric_validation_accepts_rounded_ratios_and_negative_delta_magnitude(tmp_path):
    s=Store(tmp_path); a=Agent(s)
    state=dict(date='2026-03-01',camera_id='primary',source='test',memories=[],warnings=[],mode='llm')
    state.update(a.query(state)); state.update(a.calculate(state))
    state['trend']['values']={'playing':{'observed_share':.0327868852459,'baseline_share':.2396313364,'delta_percentage_points':-20.6844451}}
    state['answer']={'summary':'合成案例：玩耍占比0.0328，较基线0.2396下降20.68个百分点。',
                     'findings':[{'text':'变化-20.68个百分点','evidence_ids':[state['trend']['evidence_id']]}],
                     'limitations':['合成案例']}
    result=a.validate(state)
    assert result.get('mode','llm')=='llm'
    assert result['answer']['summary']==state['answer']['summary']
    state['answer']['summary']='玩耍987654321.123456秒'
    assert a.validate(state)['mode']=='statistics'

def test_outbox_failure_retry_and_restart(tmp_path, monkeypatch):
    from hajimi.outbox import Outbox
    import httpx
    p = tmp_path/'outbox.db'
    o = Outbox(p,'http://localhost'); o.enqueue(frame()); o.db.close()
    o = Outbox(p,'http://localhost')
    def fail(*args, **kwargs): raise httpx.ConnectError('offline')
    monkeypatch.setattr(httpx,'post',fail)
    with pytest.raises(httpx.ConnectError): o.flush()
    assert o.db.execute('SELECT count(*) FROM pending').fetchone()[0] == 1
    def success(*args, **kwargs):
        assert kwargs['headers']=={}
        return httpx.Response(200,json={'accepted':0,'duplicates':1},request=httpx.Request('POST','http://localhost'))
    monkeypatch.setattr(httpx,'post',success)
    assert o.flush() == 1
    assert o.flush() == 0

def test_trend_uses_observed_shares_and_requires_coverage(tmp_path):
    a=Agent(Store(tmp_path))
    def day(share,coverage=.6):
        return dict(observed_sec=50000,coverage=coverage,duration_sec={'playing':50000*share},evidence_id='stats:day')
    result=a.calculate({'stats':day(.6),'baseline':[day(.2) for _ in range(7)]})['trend']
    assert result['sufficient']
    assert result['values']['playing']['delta_percentage_points']==pytest.approx(40)
    assert len(result['anomalies'])==1
    assert not a.calculate({'stats':day(.6,.1),'baseline':[day(.2) for _ in range(7)]})['trend']['sufficient']

def test_routines_require_repeated_covered_hours(tmp_path):
    a=Agent(Store(tmp_path))
    today=dict(observed_sec=0,coverage=0,duration_sec={},evidence_id='today')
    days=[dict(observed_sec=2000,coverage=.02,duration_sec={},evidence_id=f'day:{i}',
               hourly=[dict(hour=8,coverage=.6,dominant_label='eating',dominant_share=.7)]) for i in range(3)]
    trend=a.calculate({'stats':today,'baseline':days})['trend']
    assert not trend['sufficient']
    assert trend['routines'][0]['support_days']==3
    days[0]['hourly'][0]['coverage']=.1
    assert not a.calculate({'stats':today,'baseline':days})['trend']['routines']

def test_llm_transport_failure_is_reported(tmp_path,monkeypatch):
    import httpx
    a=Agent(Store(tmp_path)); a.store.ingest([frame()])
    state=dict(date='2026-03-01',camera_id='primary',source='test',question='总结',warnings=[])
    state.update(a.query(state)); state.update(a.calculate(state)); state['memories']=[]
    monkeypatch.setenv('LLM_API_KEY','test-not-a-real-key'); monkeypatch.setenv('LLM_MODEL','test')
    def fail(*args,**kwargs): raise httpx.ConnectError('offline')
    monkeypatch.setattr(httpx,'post',fail)
    result=a.generate(state)
    assert result['mode']=='statistics'
    assert result['warnings']

def test_api_auth(tmp_path,monkeypatch):
    monkeypatch.setenv('HAJIMI_API_TOKEN','test-secret')
    with TestClient(create_app(tmp_path)) as c:
        assert c.get('/api/v1/health').status_code==401
        assert c.get('/api/v1/health',headers={'Authorization':'Bearer test-secret'}).status_code==200
