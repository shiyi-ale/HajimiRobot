"""Durable JSONL detection sender for Jetson integration, no torch dependency."""
import argparse
import json
import os
import time
from pathlib import Path
import httpx
from hajimi.models import Detection
from hajimi.outbox import Outbox

if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--input',type=Path,required=True,help='Detection JSONL, one frame per line')
    p.add_argument('--origin',default='http://127.0.0.1:3001')
    p.add_argument('--outbox',default='edge-outbox.sqlite3')
    args=p.parse_args()
    sender=Outbox(args.outbox,args.origin,os.getenv('HAJIMI_API_TOKEN',''))
    for line in args.input.read_text(encoding='utf-8').splitlines():
        if line.strip(): sender.enqueue(Detection.model_validate_json(line))
    delay=1
    while sender.db.execute('SELECT count(*) FROM pending').fetchone()[0]:
        try:
            print('Acknowledged:',sender.flush()); delay=1
        except httpx.HTTPStatusError as e:
            if 400 <= e.response.status_code < 500 and e.response.status_code != 429:
                raise SystemExit(f'Permanent HTTP {e.response.status_code}; records retained in outbox. Fix input/auth before retry.')
            time.sleep(delay); delay=min(delay*2,30)
        except (httpx.TransportError,ValueError) as e:
            print(type(e).__name__,'retry in',delay,'seconds')
            time.sleep(delay); delay=min(delay*2,30)
