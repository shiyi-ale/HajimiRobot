from fastapi.testclient import TestClient

from hajimi.app import create_app


def test_review_clip_date_overlap_and_source_isolation(tmp_path, monkeypatch):
    monkeypatch.delenv('HAJIMI_API_TOKEN', raising=False)
    app = create_app(tmp_path)
    store = app.state.store
    start, end = store.bounds('2026-10-17')
    for clip_id, camera, source, a, b in [
        ('cross-midnight', 'primary', 'test', start - 5, start + 10),
        ('end-boundary', 'primary', 'test', end, end + 10),
        ('before-day', 'primary', 'test', start - 10, start),
        ('other-camera', 'secondary', 'test', start + 10, start + 20),
        ('other-source', 'primary', 'camera', start + 10, start + 20),
    ]:
        store.execute('INSERT INTO clips VALUES(?,?,?,?,?,?,?,?)',
                      (clip_id, camera, source, a, b, clip_id + '.mp4', 'ready', None))
    with TestClient(app) as client:
        response = client.get('/api/v1/clips', params={'source': 'test', 'day': '2026-10-17'})
        assert response.status_code == 200
        assert [c['id'] for c in response.json()['clips']] == ['cross-midnight']
        assert client.get('/api/v1/clips?day=invalid').status_code == 422
