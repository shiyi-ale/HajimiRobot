import hashlib
import json
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from .models import LABELS, Detection, utcnow

def stamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()

def iso(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()

def union(intervals):
    merged = []
    for start, end in sorted(intervals):
        if end <= start:
            continue
        if merged and start <= merged[-1][1] + 1e-6:
            merged[-1][1] = max(end, merged[-1][1])
        else:
            merged.append([start, end])
    return merged

class Store:
    def __init__(self, root, report_timezone='Asia/Shanghai'):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.zone = ZoneInfo(report_timezone)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.root / 'events.sqlite3', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS frames (
                id TEXT PRIMARY KEY, camera TEXT, source TEXT, captured REAL,
                observation REAL, payload TEXT);
            CREATE INDEX IF NOT EXISTS frame_lookup ON frames(camera,source,captured);
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY, camera TEXT, source TEXT, label TEXT,
                start REAL, end REAL, frames INTEGER, confidence REAL);
            CREATE INDEX IF NOT EXISTS event_lookup ON events(camera,source,start);
            CREATE TABLE IF NOT EXISTS configs (camera TEXT PRIMARY KEY, payload TEXT);
            CREATE TABLE IF NOT EXISTS heartbeats (device TEXT,camera TEXT,session TEXT,payload TEXT,
                received TEXT, PRIMARY KEY(device,camera));
            CREATE TABLE IF NOT EXISTS clips (id TEXT PRIMARY KEY,camera TEXT,source TEXT,
                start REAL,end REAL,path TEXT,status TEXT,error TEXT);
            CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY,date TEXT,camera TEXT,
                source TEXT,payload TEXT,dirty INTEGER DEFAULT 1);
            CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY,created TEXT,payload TEXT);
            CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,status TEXT,payload TEXT);
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT);
            CREATE TABLE IF NOT EXISTS commands (id INTEGER PRIMARY KEY,captured REAL,action TEXT);
            CREATE TABLE IF NOT EXISTS operational_intervals (
                id INTEGER PRIMARY KEY,camera TEXT,source TEXT,session TEXT,start REAL,end REAL,state TEXT);
            CREATE INDEX IF NOT EXISTS operational_lookup ON operational_intervals(camera,source,start,end);
            CREATE TABLE IF NOT EXISTS review_groups (
                id TEXT PRIMARY KEY,camera TEXT,source TEXT,day TEXT,start REAL,end REAL,revision TEXT,payload TEXT);
            CREATE INDEX IF NOT EXISTS review_lookup ON review_groups(camera,source,day,start);
            CREATE TABLE IF NOT EXISTS review_status (id TEXT PRIMARY KEY,revision TEXT,reviewed_at TEXT);
            CREATE TABLE IF NOT EXISTS coverage_spans (
                camera TEXT,source TEXT,day TEXT,start REAL,end REAL,state TEXT,reason TEXT,
                PRIMARY KEY(camera,source,day,start));
            CREATE TABLE IF NOT EXISTS timeline_snapshots (
                camera TEXT,source TEXT,day TEXT,computed_at REAL,payload TEXT,
                PRIMARY KEY(camera,source,day));
            CREATE TABLE IF NOT EXISTS timeline_signatures (
                camera TEXT,source TEXT,day TEXT,signature TEXT,
                PRIMARY KEY(camera,source,day));
        ''')
        self.db.commit()

    def rows(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def execute(self, sql, args=()):
        with self.lock, self.db:
            return self.db.execute(sql, args).rowcount

    def record_operation(self, camera, source, session, start, end, state):
        """Only record measured intervals. Absence of telemetry never means offline."""
        if end <= start:
            return
        with self.lock, self.db:
            last = self.db.execute('SELECT * FROM operational_intervals WHERE camera=? AND source=? ORDER BY end DESC,id DESC LIMIT 1',
                                   (camera, source)).fetchone()
            if last and last['session'] == session and last['state'] == state and abs(last['end'] - start) < .001:
                self.db.execute('UPDATE operational_intervals SET end=? WHERE id=?', (end, last['id']))
            else:
                self.db.execute('INSERT INTO operational_intervals(camera,source,session,start,end,state) VALUES(?,?,?,?,?,?)',
                                (camera, source, session, start, end, state))

    def ingest(self, frames):
        inserted = 0
        affected = set()
        with self.lock, self.db:
            for f in frames:
                key = hashlib.sha256(f'{f.device_id}|{f.camera_id}|{f.session_id}|{f.frame_id}'.encode()).hexdigest()
                t = f.captured_at.timestamp()
                previous = self.db.execute('SELECT max(captured) FROM frames WHERE camera=? AND source=?', (f.camera_id, f.source)).fetchone()[0]
                count = self.db.execute('INSERT OR IGNORE INTO frames VALUES (?,?,?,?,?,?)',
                    (key, f.camera_id, f.source, t, f.observation_sec, f.model_dump_json())).rowcount
                if count:
                    inserted += 1
                    if previous is None or t - f.observation_sec >= previous - 1e-6:
                        self._append(f, key)
                    else:
                        affected.add((f.camera_id, f.source))
                    # An interval ending just after midnight also changes the previous day.
                    dates = {(f.captured_at - timedelta(seconds=f.observation_sec)).astimezone(self.zone).date().isoformat(),
                             f.captured_at.astimezone(self.zone).date().isoformat()}
                    for day in dates:
                        mid = self.memory_id(day, f.camera_id, f.source)
                        self.db.execute('INSERT INTO memories(id,date,camera,source,payload,dirty) VALUES(?,?,?,?,?,1) '
                                        'ON CONFLICT(id) DO UPDATE SET dirty=1',
                                        (mid, day, f.camera_id, f.source, '{}'))
            for camera, source in affected:
                self._rebuild(camera, source)
        return {'accepted': inserted, 'duplicates': len(frames) - inserted}

    def _append(self, f, fid):
        if not f.boxes:
            return
        box = max(f.boxes, key=lambda b: b.confidence)
        end = f.captured_at.timestamp()
        start = end - f.observation_sec
        last = self.db.execute('SELECT * FROM events WHERE camera=? AND source=? ORDER BY end DESC LIMIT 1', (f.camera_id, f.source)).fetchone()
        if last and last['label'] == box.label and abs(last['end'] - start) < 1e-6:
            self.db.execute('UPDATE events SET end=?,frames=frames+1,confidence=max(confidence,?) WHERE id=?', (end, box.confidence, last['id']))
        else:
            eid = hashlib.sha256(f'{f.camera_id}|{f.source}|{box.label}|{fid}'.encode()).hexdigest()[:24]
            self.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)', (eid, f.camera_id, f.source, box.label, start, end, 1, box.confidence))

    def _rebuild(self, camera, source):
        # Rebuild partition in timestamp order: deterministic under retry and late arrival.
        rows = self.db.execute('SELECT * FROM frames WHERE camera=? AND source=? ORDER BY captured,id', (camera, source)).fetchall()
        # Sweep overlapping observation windows. Latest frame wins, including empty
        # detections; conflicting labels can never inflate time beyond coverage.
        import heapq
        changes = {}
        points = []
        for row in rows:
            f = json.loads(row['payload'])
            box = max(f['boxes'], key=lambda x: x['confidence']) if f['boxes'] else None
            start, end = row['captured'] - row['observation'], row['captured']
            if end == start:
                if box:
                    points.append((start, end, row['id'], box))
                continue
            changes.setdefault(start, []).append((row['id'], end, box))
            changes.setdefault(end, [])
        intervals = {label: [] for label in LABELS}
        heap = []
        times = sorted(changes)
        for i, start in enumerate(times[:-1]):
            for fid, end, box in changes[start]:
                heapq.heappush(heap, (-end, -(box['confidence'] if box else 1), fid, end, box))
            while heap and heap[0][3] <= start:
                heapq.heappop(heap)
            if heap and heap[0][4]:
                _, _, fid, _, box = heap[0]
                intervals[box['label']].append((start, times[i+1], fid, box['confidence']))
        for start, end, fid, box in points:
            intervals[box['label']].append((start, end, fid, box['confidence']))
        self.db.execute('DELETE FROM events WHERE camera=? AND source=?', (camera, source))
        for label, parts in intervals.items():
            groups = []
            for start, end, fid, score in sorted(parts):
                if groups and start <= groups[-1][1] + 1e-6:
                    groups[-1][1] = max(groups[-1][1], end)
                    groups[-1][2].add(fid)
                    groups[-1][3] = max(groups[-1][3], score)
                else:
                    groups.append([start, end, {fid}, score, fid])
            for start, end, frame_ids, score, fid in groups:
                eid = hashlib.sha256(f'{camera}|{source}|{label}|{fid}'.encode()).hexdigest()[:24]
                self.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)', (eid, camera, source, label, start, end, len(frame_ids), score))

    @staticmethod
    def memory_id(day, camera, source):
        import uuid
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f'hajimi:{day}:{camera}:{source}'))

    def bounds(self, day):
        local = datetime.fromisoformat(day).replace(tzinfo=self.zone)
        return local.timestamp(), (local + timedelta(days=1)).timestamp()

    def stats(self, day, camera='primary', source='local-video'):
        start, end = self.bounds(day)
        frames = self.rows('SELECT * FROM frames WHERE camera=? AND source=? AND captured>=? AND captured<? ORDER BY captured',
                           (camera, source, start, end + 5))
        observations = union([(max(start, r['captured'] - r['observation']), min(end, r['captured'])) for r in frames])
        covered = sum(b - a for a, b in observations)
        empty_frames = sum(start <= r['captured'] < end and not json.loads(r['payload'])['boxes'] for r in frames)
        events = self.rows('SELECT * FROM events WHERE camera=? AND source=? AND (end>? OR (start=end AND start>=?)) AND start<? ORDER BY start',
                           (camera, source, start, start, end))
        durations = {label: 0. for label in LABELS}
        for event in events:
            event['duration_sec'] = max(0, min(end, event['end']) - max(start, event['start']))
            durations[event['label']] += event['duration_sec']
            event['started_at'], event['ended_at'] = iso(event['start']), iso(event['end'])
            event['clips'] = self.rows("SELECT id,status FROM clips WHERE camera=? AND source=? AND end>=? AND start<=?",
                                       (camera, source, event['start'], event['end']))
        commands = self.rows("SELECT count(*) n FROM commands WHERE action='feed' AND captured>=? AND captured<?", (start, end))[0]['n']
        hourly = []
        local_start = datetime.fromtimestamp(start, self.zone)
        for hour in range(24):
            a = (local_start + timedelta(hours=hour)).timestamp()
            b = (local_start + timedelta(hours=hour+1)).timestamp()
            if b <= a:
                continue
            coverage_sec = sum(max(0, min(b, y) - max(a, x)) for x, y in observations)
            if coverage_sec <= 0:
                continue
            by_label = {label: sum(max(0, min(b, e['end']) - max(a, e['start'])) for e in events if e['label'] == label)
                        for label in LABELS}
            dominant = max(by_label, key=by_label.get)
            hourly.append({'hour': hour, 'observed_sec': round(coverage_sec, 3), 'coverage': coverage_sec / (b-a),
                           'no_target_observed_sec': round(max(0, coverage_sec-sum(by_label.values())),3),
                           'dominant_label': dominant if by_label[dominant] > 0 else None,
                           'dominant_share': by_label[dominant] / coverage_sec})
        return {'date': day, 'camera_id': camera, 'source': source, 'timezone': str(self.zone),
                'sample_count': sum(start <= r['captured'] < end for r in frames),
                'observed_sec': round(covered, 3), 'coverage': covered / (end - start),
                'empty_detection_frames': empty_frames,
                'no_target_observed_sec': round(max(0,covered-sum(durations.values())),3),
                'unobserved_sec': round(end-start-covered,3),
                'duration_sec': {k: round(v, 3) for k, v in durations.items()},
                'eating_episodes': sum(e['label'] == 'eating' for e in events),
                'feeding_commands': commands, 'events': events, 'hourly': hourly,
                'evidence_id': f'stats:{day}:{camera}:{source}',
                'limitations': ['时长仅覆盖明确观测区间；低频采样可能漏检短暂行为。',
                                '旧版记录没有时长；检测进食片段不等于实际进食次数。']}

    def import_legacy(self, path):
        key = 'legacy-import-v1'
        if self.rows('SELECT * FROM meta WHERE key=?', (key,)) or not Path(path).exists():
            return
        data = json.loads(Path(path).read_text(encoding='utf-8'))
        frames = [Detection(device_id='legacy', camera_id='primary', session_id='legacy-import', frame_id=i,
                            captured_at=r['iso'], width=1, height=1, model_id='legacy-unknown', source='legacy',
                            boxes=[{'label': r['label'], 'confidence': r.get('score', 1), 'xyxy': [0, 0, 1, 1]}])
                  for i, r in enumerate(data)]
        self.ingest(frames)
        self.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', (key, utcnow()))
