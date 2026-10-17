"""Offline comparison on identical frames. Without weights, measures scheduling only."""
import argparse
import json
import time
from pathlib import Path
import cv2
import numpy as np
from hajimi.models import CameraConfig
from hajimi.motion import MotionDetector, Scheduler
from hajimi.nvr import YoloAdapter

def synthetic(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*'MJPG'), 10, (640,360))
    if not writer.isOpened(): raise RuntimeError('Cannot create test fixture')
    for i in range(600):
        image = np.full((360,640,3), 28, np.uint8)
        # Long static sections and two motion bursts; never a fake pet video.
        if 150 <= i < 250 or 400 <= i < 500:
            x = (i * 7) % 460
            cv2.rectangle(image,(x,100),(x+150,250),(100,220,200),-1)
        cv2.putText(image,'SYNTHETIC MOTION TEST - NOT PET / NOT YOLO',(12,30),cv2.FONT_HERSHEY_SIMPLEX,.5,(255,255,255),1)
        writer.write(image)
    writer.release()

def run(path, weights='', device='cuda:0'):
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened(): raise ValueError('Cannot read video')
    fps = capture.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0: raise ValueError('Video FPS required for comparison')
    config=CameraConfig()
    motion=MotionDetector(config); schedule=Scheduler(config)
    adapter=YoloAdapter(weights,.4,device=device) if weights else None
    index=analyzed=fixed=dynamic=0
    durations=[]; states={}; fixed_latency=[]; dynamic_latency=[]
    fixed_positives=[]; dynamic_positives=[]
    while True:
        ok,frame=capture.read()
        if not ok: break
        media=index/fps; index+=1
        if media+1e-6<analyzed/config.analysis_fps: continue
        analyzed+=1
        began=time.perf_counter(); ratio,changed=motion.measure(frame)
        due=schedule.update(ratio,media,changed)
        durations.append((time.perf_counter()-began)*1000)
        states[schedule.state]=states.get(schedule.state,0)+1
        if media < config.warmup_sec: continue
        fixed+=1
        if adapter:
            began=time.perf_counter(); boxes=adapter.infer(frame); fixed_latency.append((time.perf_counter()-began)*1000)
            if boxes: fixed_positives.append(round(media,3))
        if due:
            dynamic+=1
            if adapter:
                began=time.perf_counter(); boxes=adapter.infer(frame); dynamic_latency.append((time.perf_counter()-began)*1000)
                if boxes: dynamic_positives.append(round(media,3))
    capture.release()
    return {'video':str(path.resolve()),'mode':'real-yolo' if adapter else 'motion-scheduling-only', 'device':device if adapter else None,
            'synthetic': 'motion-test' in path.name,'duration_sec':round(index/fps,3),'analyzed_frames':analyzed,
            'fixed_5fps_scheduled':fixed,'dynamic_scheduled':dynamic,
            'scheduled_reduction':round(1-dynamic/max(fixed,1),4),
            'motion_latency_ms_p50':round(float(np.median(durations)),3),
            'motion_latency_ms_p95':round(float(np.percentile(durations,95)),3),'states':states,
            'fixed_inference_latency_ms_p50':float(np.median(fixed_latency)) if fixed_latency else None,
            'dynamic_inference_latency_ms_p50':float(np.median(dynamic_latency)) if dynamic_latency else None,
            'fixed_positive_timestamps':fixed_positives,'dynamic_positive_timestamps':dynamic_positives,
            'limitations':['No ground-truth annotations: positive timestamp differences are not recall.',
                            'Scheduling counts are not GPU speedup, power reduction, or model accuracy.',
                            'Synthetic fixture validates motion mechanics only.']}

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--video',type=Path)
    parser.add_argument('--weights',default='')
    parser.add_argument('--device',default='cuda:0')
    parser.add_argument('--output',type=Path,default=Path('.runtime/benchmark.json'))
    parser.add_argument('--create-fixture',action='store_true')
    args=parser.parse_args()
    path=args.video or Path('.runtime/fixtures/motion-test.avi')
    if args.create_fixture: synthetic(path)
    result=run(path,args.weights,args.device)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
    print(json.dumps(result,indent=2,ensure_ascii=False))
