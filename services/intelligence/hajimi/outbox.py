"""Persistent retrying edge sender; successful acknowledgements alone delete records."""
import json
import sqlite3
import httpx

class Outbox:
    def __init__(self, path, origin, token=''):
        self.db = sqlite3.connect(path)
        self.db.execute('CREATE TABLE IF NOT EXISTS pending(id INTEGER PRIMARY KEY,payload TEXT)')
        self.origin, self.token = origin.rstrip('/'), token

    def enqueue(self, detection):
        with self.db:
            self.db.execute('INSERT INTO pending(payload) VALUES(?)', (detection.model_dump_json(),))

    def flush(self):
        rows = self.db.execute('SELECT id,payload FROM pending ORDER BY id LIMIT 100').fetchall()
        if not rows:
            return 0
        response = httpx.post(self.origin + '/api/v1/detections/batch',
                              json={'frames': [json.loads(r[1]) for r in rows]},
                              headers={'Authorization': f'Bearer {self.token}'} if self.token else {}, timeout=15)
        response.raise_for_status()
        ack = response.json()
        if ack.get('accepted', 0) + ack.get('duplicates', 0) != len(rows):
            raise ValueError('Incomplete acknowledgement; keep outbox for retry')
        with self.db:
            self.db.executemany('DELETE FROM pending WHERE id=?', [(r[0],) for r in rows])
        return len(rows)
