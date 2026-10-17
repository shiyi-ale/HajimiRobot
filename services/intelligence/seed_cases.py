"""Reproducible, explicitly synthetic eight-day Agent case study.

Never impersonates YOLO measurements or modifies camera/local-video records.
"""
import argparse
import json
import random
import time
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import httpx
from hajimi.models import Detection

LABELS = ('eating','playing','rest','sitting','stretching','yawning')

def behavior(minute, second, day_index):
    # Seven baseline days with small deterministic routine variation; final day
    # deliberately substitutes rest for most play and skips one eating episode.
    anomaly = day_index == 7
    for start, end in ((420,435),(660,680),(960,980),(1080,1100)):
        if start <= minute < end:
            return 'rest' if anomaly and start == 960 else 'eating'
    for start, end in ((480,540),(720,780),(1020,1080),(1140,1200)):
        if start <= minute < end:
            if anomaly:
                return 'playing' if start == 480 and minute < 510 else 'rest'
            return 'playing' if minute < end - (day_index % 3)*5 else 'sitting'
    if minute % 60 == 50 and second < 30:
        return 'stretching'
    if minute % 60 == 51 and second < 10:
        return 'yawning'
    if (435 <= minute < 480 or 680 <= minute < 720 or 980 <= minute < 1020 or 1100 <= minute < 1140):
        return 'sitting'
    return 'rest'

def day_frames(day, day_index):
    zone = ZoneInfo('Asia/Shanghai')
    start = datetime.combine(day,datetime.min.time(),zone)
    rng = random.Random(20261010+day_index)
    for offset in range(6*3600,22*3600,5):
        minute, second = offset//60, offset%60
        # No frame = genuine gap in this hypothetical scenario, not an empty detection.
        if 840 <= minute < 870 or day_index == 7 and 1100 <= minute < 1115:
            continue
        # Explicitly observed absence, distinct from the stream gap above.
        absent = 610 <= minute < 620 or 1120 <= minute < 1130
        label = behavior(minute,second,day_index)
        yield Detection(device_id='synthetic-case-generator-v1',camera_id='primary',
            session_id='synthetic-petcase-v1:'+day.isoformat(),frame_id=offset//5,
            captured_at=(start+timedelta(seconds=offset+5)).astimezone(timezone.utc),
            width=720,height=1280,model_id='SYNTHETIC-CASE-V1-NOT-YOLO',source='test',observation_sec=5,
            boxes=[] if absent else [{'label':label,'confidence':round(rng.uniform(.83,.97),4),'xyxy':[.18,.15,.78,.85]}])

def run(end_day, output, ingest=False, origin='http://127.0.0.1:3001'):
    output.mkdir(parents=True,exist_ok=True)
    manifest={'dataset':'synthetic-petcase-v1','classification':'SYNTHETIC / NOT REAL PET OBSERVATIONS',
              'camera_id':'primary','source':'test','timezone':'Asia/Shanghai',
              'baseline_start':(end_day-timedelta(days=7)).isoformat(),
              'baseline_end':(end_day-timedelta(days=1)).isoformat(),'case_date':end_day.isoformat(),
              'observation_interval_sec':5,'days':[],
              'description':'七天正常基线 + 一天活动减少/休息增加；包括已观测空检测与显式断流空洞；不生成虚假录像或投喂指令。'}
    accepted=duplicates=0
    with httpx.Client(base_url=origin.rstrip('/')+'/api/v1',timeout=30) as client, (output/'frames.jsonl').open('w',encoding='utf-8') as file:
        batch=[]
        def flush():
            nonlocal accepted, duplicates
            if not batch or not ingest:
                batch.clear(); return
            response=client.post('/detections/batch',json={'frames':batch})
            response.raise_for_status()
            ack=response.json()
            assert ack['accepted']+ack['duplicates']==len(batch)
            accepted+=ack['accepted'];duplicates+=ack['duplicates'];batch.clear()
        for day_index in range(8):
            day=end_day-timedelta(days=7-day_index)
            count=absent=0; durations=Counter()
            for frame in day_frames(day,day_index):
                file.write(frame.model_dump_json()+'\n')
                batch.append(frame.model_dump(mode='json')); count+=1
                if frame.boxes: durations[frame.boxes[0].label]+=5
                else: absent+=1
                if len(batch)==200: flush()
            flush()
            expected={'date':day.isoformat(),'scenario':'reduced-activity' if day_index==7 else 'baseline',
                      'sample_count':count,'observed_sec':count*5,'coverage':count*5/86400,
                      'empty_detection_frames':absent,'duration_sec':{label:durations[label] for label in LABELS}}
            if ingest:
                actual=client.get('/stats/'+day.isoformat(),params={'source':'test','camera_id':'primary'})
                actual.raise_for_status(); actual=actual.json()
                assert actual['sample_count']==count,(day,actual['sample_count'],count)
                assert abs(actual['observed_sec']-count*5)<.01
                assert actual['duration_sec']==expected['duration_sec']
                assert actual['empty_detection_frames']==absent
                assert actual['no_target_observed_sec']==absent*5
                expected['evidence_id']=actual['evidence_id']
                expected['event_count']=len(actual['events'])
                expected['eating_episodes']=actual['eating_episodes']
            manifest['days'].append(expected)
            print(day,expected['scenario'],'frames',count,'coverage',round(expected['coverage']*100,2),'%',flush=True)
    manifest.update(accepted=accepted,duplicates=duplicates,total_frames=sum(d['sample_count'] for d in manifest['days']))
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    return manifest

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--end-date',type=date.fromisoformat,required=True)
    parser.add_argument('--output',type=Path,default=Path('.runtime/case-data'))
    parser.add_argument('--origin',default='http://127.0.0.1:3001')
    parser.add_argument('--ingest',action='store_true')
    args=parser.parse_args()
    result=run(args.end_date,args.output,args.ingest,args.origin)
    print('Verified synthetic frames:',result['total_frames'],'accepted:',result['accepted'],'duplicates:',result['duplicates'])
