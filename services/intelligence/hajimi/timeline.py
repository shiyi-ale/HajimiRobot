"""Derived review groups and explicit evidence coverage; raw behavior stays intact.

Inspired by Frigate's separation of Event, ReviewSegment, Timeline and Recordings.
Independent implementation for sparse single-pet behavior observations.
"""
import bisect
import hashlib
import json
import time
from datetime import date

from .store import union, utcnow


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()[:24]


def partition_coverage(start, end, observed, targets, operations, as_of):
    """Sweep intervals, giving successful observations precedence over telemetry."""
    boundaries = {start, end, max(start, min(end, as_of))}
    changes = {}
    # Priority: actual target > actual empty > known pipeline state > unknown.
    intervals = [(a, b, 100, 'observed_target', 'detection') for a, b in targets]
    intervals += [(a, b, 90, 'observed_empty', 'completed_inference_no_target') for a, b in observed]
    priorities = {'stream_offline': 70, 'inference_error': 60, 'inference_unavailable': 50,
                  'scheduled_skip': 40, 'inference_pending': 30}
    intervals += [(r['start'], r['end'], priorities[r['state']], 'unobserved', r['state'])
                  for r in operations if r['state'] in priorities]
    for i, (a, b, priority, state, reason) in enumerate(intervals):
        a, b = max(start, a), min(end, b)
        if b <= a:
            continue
        boundaries.update((a, b))
        changes.setdefault(a, []).append((True, i, priority, state, reason))
        changes.setdefault(b, []).append((False, i, priority, state, reason))
    import heapq
    active, heap, spans = set(), [], []
    times = sorted(boundaries)
    for i, a in enumerate(times[:-1]):
        b = times[i + 1]
        for adding, key, priority, state, reason in changes.get(a, []):
            if adding:
                active.add(key)
                heapq.heappush(heap, (-priority, key, state, reason))
            else:
                active.discard(key)
        while heap and heap[0][1] not in active:
            heapq.heappop(heap)
        state, reason = ('unobserved', 'unknown') if a < as_of else ('not_elapsed', 'future')
        if heap:
            state, reason = heap[0][2:]
        if spans and spans[-1]['state'] == state and spans[-1]['reason'] == reason:
            spans[-1]['end'] = b
        else:
            spans.append(dict(start=a, end=b, state=state, reason=reason))
    return spans


def build_timeline(store, day, camera, source, gap_sec=10, max_sec=3600, now=None):
    """Rebuild a day atomically; deterministic under retry and late arrival."""
    now = time.time() if now is None else now
    with store.lock, store.db:
        date.fromisoformat(day)
        start, end = store.bounds(day)
        operations = store.rows('SELECT * FROM operational_intervals WHERE camera=? AND source=? AND start<? AND end>? ORDER BY id', (camera, source, end, start))
        clips = store.rows('SELECT * FROM clips WHERE camera=? AND source=? AND start<? AND end>? ORDER BY start,id', (camera, source, end, start))
        count = store.rows('SELECT count(*) n FROM frames WHERE camera=? AND source=? AND captured>=? AND captured<=?', (camera, source, start, end+5))[0]['n']
        statuses = store.rows('SELECT s.* FROM review_status s JOIN review_groups r ON s.id=r.id WHERE r.camera=? AND r.source=? AND r.day=? ORDER BY s.id', (camera, source, day))
        signature = digest(json.dumps([2, count, operations, clips, statuses, gap_sec, max_sec]))
        cached = store.rows('SELECT t.payload,t.computed_at,s.signature FROM timeline_snapshots t JOIN timeline_signatures s USING(camera,source,day) WHERE t.camera=? AND t.source=? AND t.day=?', (camera, source, day))
        if cached and cached[0]['signature'] == signature and (now >= end or 0 <= now-cached[0]['computed_at'] < 15):
            return json.loads(cached[0]['payload'])
        stats = store.stats(day, camera, source)
        frames = store.rows('SELECT captured,observation,payload FROM frames WHERE camera=? AND source=? AND captured>=? AND captured<=? ORDER BY captured,id',
                            (camera, source, start, end + 5))
        observed = union([(max(start, f['captured'] - f['observation']), min(end, f['captured'])) for f in frames])
        targets = union([(max(start, e['start']), min(end, e['end'])) for e in stats['events']])
        coverage = partition_coverage(start, end, observed, targets, operations, now)
        recording = union([(max(start, c['start']), min(end, c['end'])) for c in clips if c['status'] == 'ready'])
        captured = [f['captured'] for f in frames]
        sessions = []
        for f in frames:
            payload = json.loads(f['payload'])
            sessions.append(payload['device_id'] + ':' + payload['session_id'])
        session_boundaries = [frames[i]['captured'] - frames[i]['observation'] for i in range(1, len(frames)) if sessions[i] != sessions[i-1]]
        parts = []
        for event in stats['events']:
            a, b = max(start, event['start']), min(end, event['end'])
            if a == b:
                position = min(bisect.bisect_left(captured, a), len(sessions) - 1)
                parts.append(dict(start=a, end=b, event=event, session=sessions[position] if sessions else 'unknown'))
                continue
            # Split a very long raw event for browsing, never change its evidence.
            while a < b:
                position = min(bisect.bisect_right(captured, a + 1e-6), len(sessions) - 1)
                session = sessions[position] if sessions else 'unknown'
                edge = min([b, a + max_sec] + [cut for cut in session_boundaries if a + 1e-6 < cut < b])
                parts.append(dict(start=a, end=edge, event=event, session=session))
                if edge == b:
                    break
                a = edge
        parts.sort(key=lambda p: (p['start'], p['end'], p['event']['id']))
        groups = []
        for part in parts:
            last = groups[-1] if groups else None
            outage = last and any(r['state'] == 'stream_offline' and r['start'] < part['start'] and r['end'] > last['end'] for r in operations)
            if (last and part['session'] == last['session'] and part['start'] - last['end'] <= gap_sec + 1e-6
                    and part['end'] - last['start'] <= max_sec + 1e-6 and not outage):
                last['parts'].append(part)
                last['end'] = max(last['end'], part['end'])
            else:
                groups.append(dict(start=part['start'], end=part['end'], session=part['session'], parts=[part]))
        reviews = []
        for group in groups:
            children = {p['event']['id']: p['event'] for p in group['parts']}
            ids = sorted(children)
            rid = digest(f'{day}|{camera}|{source}|{group["start"]}|{group["session"]}')
            revision = digest(json.dumps([ids, group['end'], [(p['start'], p['end']) for p in group['parts']]]))
            a, b = group['start'], group['end']
            behavior = {}
            for label in sorted({p['event']['label'] for p in group['parts']}):
                behavior[label] = round(sum(y - x for x, y in union([(p['start'], p['end']) for p in group['parts'] if p['event']['label'] == label])), 6)
            observed_sec = sum(max(0, min(b, y) - max(a, x)) for x, y in observed)
            actual = sum(behavior.values())
            revision = digest(json.dumps([revision, observed_sec, behavior,
                [(e['id'], e['frames'], e['confidence']) for e in children.values()],
                [(c['id'], c['status']) for c in clips if c['end'] > a and c['start'] < b]]))
            review = dict(id=rid, start=a, end=b, labels=list(behavior), event_ids=ids,
                          event_count=len(ids), span_sec=round(b-a, 6), behavior_sec=behavior,
                          detected_sec=round(actual, 6), observed_sec=round(observed_sec, 6),
                          no_target_sec=round(max(0, observed_sec-actual), 6),
                          unobserved_sec=round(max(0, b-a-observed_sec), 6),
                          confidence=max(e['confidence'] for e in children.values()),
                          clips=[c for c in clips if c['end'] > a and c['start'] < b], revision=revision)
            status = store.rows('SELECT revision FROM review_status WHERE id=?', (rid,))
            review['reviewed'] = bool(status and status[0]['revision'] == revision)
            reviews.append(review)
        totals = {}
        for row in coverage:
            totals[row['state']] = round(totals.get(row['state'], 0) + row['end'] - row['start'], 6)
        result = dict(date=day, camera_id=camera, source=source, timezone=str(store.zone), as_of=max(start, min(end, now)),
                      policy=dict(gap_sec=gap_sec, max_sec=max_sec), raw_event_count=len(stats['events']),
                      reviews=reviews, coverage=coverage, coverage_totals=totals,
                      recording_coverage=[dict(start=a, end=b) for a, b in recording])
        payload = json.dumps(result)
        previous = store.rows('SELECT payload FROM timeline_snapshots WHERE camera=? AND source=? AND day=?', (camera, source, day))
        if not previous or previous[0]['payload'] != payload:
            store.db.execute('DELETE FROM review_groups WHERE camera=? AND source=? AND day=?', (camera, source, day))
            store.db.executemany('INSERT INTO review_groups VALUES(?,?,?,?,?,?,?,?)',
                                [(r['id'], camera, source, day, r['start'], r['end'], r['revision'], json.dumps(r)) for r in reviews])
            store.db.execute('DELETE FROM coverage_spans WHERE camera=? AND source=? AND day=?', (camera, source, day))
            store.db.executemany('INSERT INTO coverage_spans VALUES(?,?,?,?,?,?,?)',
                                [(camera, source, day, r['start'], r['end'], r['state'], r['reason']) for r in coverage])
            store.db.execute('INSERT OR REPLACE INTO timeline_snapshots VALUES(?,?,?,?,?)', (camera, source, day, now, payload))
        store.db.execute('INSERT OR REPLACE INTO timeline_signatures VALUES(?,?,?,?)', (camera, source, day, signature))
        return result


def mark_reviewed(store, rid, revision, reviewed):
    with store.lock, store.db:
        row = store.rows('SELECT revision FROM review_groups WHERE id=?', (rid,))
        if not row:
            raise KeyError(rid)
        if row[0]['revision'] != revision:
            raise ValueError('事件已更新，请刷新后重试')
        if reviewed:
            store.db.execute('INSERT OR REPLACE INTO review_status VALUES(?,?,?)', (rid, revision, utcnow()))
        else:
            store.db.execute('DELETE FROM review_status WHERE id=?', (rid,))
