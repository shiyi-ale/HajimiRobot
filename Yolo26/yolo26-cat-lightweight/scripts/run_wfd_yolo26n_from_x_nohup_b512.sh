#!/usr/bin/env bash
set -euo pipefail

cd /ssd3/adv_patch/cat-detect
mkdir -p logs

exec ./bin/python scripts/train_yolo26_wfd.py \
  --student weights/yolo26n.pt \
  --teacher outputs/weights/teacher_yolo26x_best.pt \
  --data dataset/data.yaml \
  --imgsz 320 \
  --epochs 100 \
  --batch 512 \
  --device 6 \
  --workers 16 \
  --lambda-kd 0.3 \
  --lambda-wfd 0.2 \
  --wfd-alpha 1.5 \
  --wfd-warmup-epochs 10 \
  --project /ssd3/adv_patch/cat-detect/runs/exp \
  --name wfd_yolo26n_from_x \
  --cache ram \
  --exist-ok
