import json
from fastapi.testclient import TestClient
from hajimi.app import create_app


def test_report_filter_pagination_and_metadata(tmp_path, monkeypatch):
    monkeypatch.delenv('HAJIMI_API_TOKEN', raising=False)
    app=create_app(tmp_path)
    for camera,source,date in [('primary','test','2026-10-17'),('secondary','test','2026-10-17'),('primary','camera','2026-10-17'),('primary','test','2026-10-18')]:
        app.state.store.execute('INSERT INTO reports(created,payload) VALUES(?,?)', ('2026-10-18T00:00:00Z',json.dumps(dict(camera_id=camera,source=source,date=date,mode='statistics',answer={'summary':'Synthetic test report'}))))
    with TestClient(app) as client:
        first=client.get('/api/v1/agent/reports?camera_id=primary&source=test&limit=1').json()
        assert first['reports'][0]['date']=='2026-10-18'
        assert first['reports'][0]['summary']=='Synthetic test report'
        assert first['next_cursor'] is not None
        second=client.get('/api/v1/agent/reports',params={'camera_id':'primary','source':'test','limit':1,'before_id':first['next_cursor']}).json()
        assert second['reports'][0]['date']=='2026-10-17'
        assert second['next_cursor'] is None
        assert len(client.get('/api/v1/agent/reports?source=test&date=2026-10-17').json()['reports'])==2
        assert client.get('/api/v1/agent/reports?limit=0').status_code==422
        assert client.get('/api/v1/agent/reports?limit=101').status_code==422
        assert client.get('/api/v1/agent/reports?source=%27%20OR%201=1--').json()['reports']==[]
        assert client.get('/api/v1/health').json()['version']=='2.0.1'
