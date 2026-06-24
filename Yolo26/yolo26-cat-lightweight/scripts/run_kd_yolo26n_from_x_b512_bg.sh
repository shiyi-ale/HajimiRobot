#!/usr/bin/env bash
set -euo pipefail

cd /ssd3/adv_patch/cat-detect
mkdir -p logs

exec ./bin/python scripts/train_yolo26_kd.py \
  --student weights/yolo26n.pt \
  --teacher outputs/weights/teacher_yolo26x_best.pt \
  --data dataset/data.yaml \
  --imgsz 320 \
  --epochs 100 \
  --batch 512 \
  --device 6 \
  --workers 16 \
  --lambda-kd 0.3 \
  --project /ssd3/adv_patch/cat-detect/runs/exp \
  --name kd_yolo26n_from_x_b512_bg \
  --cache ram \
  --exist-ok
