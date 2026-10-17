import json

import pytest

from hajimi.models import Detection
from hajimi.store import Store
from hajimi.timeline import build_timeline, mark_reviewed


def detection(second, label='sitting', session='one', observation=1):
    from datetime import datetime, timezone, timedelta
    return Detection(device_id='edge', camera_id='primary', session_id=session, frame_id=second,
                     captured_at=datetime(2026, 10, 17, tzinfo=timezone.utc) + timedelta(seconds=second),
                     width=640, height=360, model_id='six-class-test', source='test', observation_sec=observation,
                     boxes=[] if label is None else [dict(label=label, confidence=.9, xyxy=[0,0,1,1])])


def timeline(store, **kwargs):
    return build_timeline(store, '2026-10-17', 'primary', 'test', now=store.bounds('2026-10-17')[1], **kwargs)


def test_reviews_merge_sparse_events_without_inventing_duration(tmp_path):
    store = Store(tmp_path)
    store.ingest([detection(1), detection(3), detection(5, 'playing')])
    before = store.stats('2026-10-17', source='test')
    first = timeline(store)
    assert first['raw_event_count'] == 3
    assert len(first['reviews']) == 1
    review = first['reviews'][0]
    assert review['event_count'] == 3
    assert review['span_sec'] == 5
    assert review['detected_sec'] == review['observed_sec'] == 3
    assert review['unobserved_sec'] == 2
    assert review['labels'] == ['playing', 'sitting']
    assert timeline(store) == first
    assert store.stats('2026-10-17', source='test') == before
    store.db.close()


def test_coverage_empty_unknown_future_and_recording_are_independent(tmp_path):
    store = Store(tmp_path)
    store.ingest([detection(1), detection(2, None), detection(4)])
    day_start, _ = store.bounds('2026-10-17')
    a = detection(1).captured_at.timestamp() - 1
    result = build_timeline(store, '2026-10-17', 'primary', 'test', now=a+5)
    totals = result['coverage_totals']
    assert totals['observed_target'] == 2
    assert totals['observed_empty'] == 1
    assert totals['not_elapsed'] > 0
    assert totals['unobserved'] == a + 5 - day_start - 3
    assert sum(totals.values()) == 86400
    assert result['recording_coverage'] == []
    assert store.rows("SELECT count(*) n FROM coverage_spans WHERE state='observed_empty'")[0]['n'] == 1
    store.db.close()


def test_late_empty_frame_replaces_unknown_without_duplication(tmp_path):
    store = Store(tmp_path)
    store.ingest([detection(1), detection(3)])
    first = timeline(store)
    assert first['reviews'][0]['unobserved_sec'] == 1
    assert store.ingest([detection(2, None), detection(2, None)]) == {'accepted': 1, 'duplicates': 1}
    second = timeline(store)
    assert second['reviews'][0]['unobserved_sec'] == 0
    assert second['reviews'][0]['no_target_sec'] == 1
    assert second['reviews'][0]['detected_sec'] == 2
    assert second['coverage_totals']['observed_empty'] == 1
    store.db.close()


def test_new_session_and_confirmed_outage_split_reviews(tmp_path):
    store = Store(tmp_path)
    store.ingest([detection(1), detection(2, session='two'), detection(5, session='two')])
    a = detection(1).captured_at.timestamp()
    store.record_operation('primary', 'test', 'two', a+1, a+3, 'stream_offline')
    result = timeline(store)
    assert len(result['reviews']) == 3
    assert any(r['reason'] == 'stream_offline' for r in result['coverage'])
    store.db.close()


def test_operation_does_not_override_completed_inference(tmp_path):
    store = Store(tmp_path)
    store.ingest([detection(1), detection(2, None)])
    a = detection(1).captured_at.timestamp()-1
    store.record_operation('primary', 'test', 'one', a, a+3, 'scheduled_skip')
    store.record_operation('primary', 'test', 'one', a+3, a+4, 'scheduled_skip')
    assert len(store.rows('SELECT * FROM operational_intervals')) == 1
    result = timeline(store)
    assert result['coverage_totals']['observed_target'] == 1
    assert result['coverage_totals']['observed_empty'] == 1
    assert sum(r['end']-r['start'] for r in result['coverage'] if r['reason']=='scheduled_skip') == 2
    store.db.close()


def test_review_status_revision_conflict_and_expansion(tmp_path):
    store = Store(tmp_path)
    store.ingest([detection(1)])
    review = timeline(store)['reviews'][0]
    mark_reviewed(store, review['id'], review['revision'], True)
    assert timeline(store)['reviews'][0]['reviewed']
    store.ingest([detection(3)])
    expanded = timeline(store)['reviews'][0]
    assert expanded['id'] == review['id']
    assert not expanded['reviewed']
    with pytest.raises(ValueError):
        mark_reviewed(store, review['id'], review['revision'], True)
    mark_reviewed(store, expanded['id'], expanded['revision'], True)
    store.db.close()
    reopened = Store(tmp_path)
    assert timeline(reopened)['reviews'][0]['reviewed']
    reopened.db.close()


def test_long_event_is_split_for_review_not_statistics(tmp_path):
    store = Store(tmp_path)
    store.ingest([detection(i) for i in range(1, 66)])
    result = timeline(store, max_sec=30)
    assert len(result['reviews']) == 3
    assert sum(r['detected_sec'] for r in result['reviews']) == 65
    assert len(store.stats('2026-10-17', source='test')['events']) == 1
    store.db.close()


def test_camera_source_midnight_and_zero_duration_legacy(tmp_path):
    store = Store(tmp_path)
    store.ingest([detection(1, observation=0), detection(2, observation=0)])
    result = timeline(store)
    assert result['raw_event_count'] == 2
    assert result['reviews'][0]['detected_sec'] == 0
    assert result['coverage_totals']['unobserved'] == 86400
    assert build_timeline(store, '2026-10-17', 'secondary', 'test')['reviews'] == []
    assert build_timeline(store, '2026-10-17', 'primary', 'camera')['reviews'] == []
    with pytest.raises(ValueError):
        build_timeline(store, 'invalid', 'primary', 'test')
    store.db.close()


def test_daily_materialization_cache_and_midnight_clipping(tmp_path, monkeypatch):
    store = Store(tmp_path)
    frame = detection(1).model_copy(update={'captured_at': __import__('datetime').datetime.fromisoformat('2026-10-17T16:00:01+00:00'), 'observation_sec': 3})
    store.ingest([frame])
    first = timeline(store)
    assert first['coverage_totals']['observed_target'] == 2
    assert first['reviews'][0]['detected_sec'] == 2
    assert build_timeline(store, '2026-10-18', 'primary', 'test')['reviews'][0]['detected_sec'] == 1
    original = store.stats
    monkeypatch.setattr(store, 'stats', lambda *a, **k: pytest.fail('Unchanged history must use materialized snapshot'))
    assert timeline(store) == first
    monkeypatch.setattr(store, 'stats', original)
    store.ingest([detection(5)])
    assert timeline(store)['coverage_totals']['observed_target'] == 3
    store.db.close()


def test_review_api_status_and_invalid_dates(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from hajimi.app import create_app
    monkeypatch.delenv('HAJIMI_API_TOKEN', raising=False)
    app = create_app(tmp_path)
    app.state.store.ingest([detection(1), detection(3)])
    with TestClient(app) as client:
        url = '/api/v1/review/timeline?day=2026-10-17&source=test'
        result = client.get(url)
        assert result.status_code == 200
        review = result.json()['reviews'][0]
        status = '/api/v1/review/' + review['id'] + '/status'
        assert client.put(status, json={'reviewed':True,'revision':review['revision']}).status_code == 200
        assert client.get(url).json()['reviews'][0]['reviewed']
        assert client.put(status, json={'reviewed':True,'revision':'stale'}).status_code == 409
        assert client.put(status, json={'reviewed':'yes','revision':review['revision']}).status_code == 422
        assert client.get('/api/v1/review/timeline?day=2026-10-17T10:00').status_code == 422
