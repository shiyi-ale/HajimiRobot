# E2 YOLO26 Feature KD Summary

## Environment
- Ultralytics: 8.4.56
- Python: 3.11.15 (`/ssd3/adv_patch/cat-detect/bin/python`)
- Torch/CUDA: torch 2.12.0+cu130, CUDA 13.0
- GPU: NVIDIA GeForce RTX 4090, device 6

## Setup
- Teacher: `outputs/weights/teacher_yolo26s_best.pt`
- Student init: `weights/yolo26n.pt`
- Output run: `runs/exp/kd_yolo26n`
- Output weight: `outputs/weights/kd_yolo26n_best.pt`
- Dataset: `dataset/data.yaml`
- Input size: 320
- Epochs: 100
- Final batch: 896 fixed batch
- GPU memory: training log peak about 40.5G; `batch=0.9` AutoBatch selected 430 but only used about 20.7G in real training, so it was stopped and restarted with fixed batch 896.

## KD Implementation
- Script: `scripts/train_yolo26_kd.py`
- Trainer: subclass of current Ultralytics `DetectionTrainer`, no YOLOv8-KD repo code copied.
- KD type: feature MSE distillation + standard YOLO26 detection loss.
- Loss: `L_total = L_det + 0.3 * L_feature_kd`
- Feature layers: `[16, 19, 22]`, corresponding to YOLO26 neck P3/P4/P5 features before Detect.
- Channel alignment: training-only 1x1 Conv adapters.
- Channel pairs: student/teacher `(64,128)`, `(128,256)`, `(256,512)`.
- Teacher is frozen and eval-only. Adapters are not part of the exported/saved student inference model.

## Validation Results
| Method | Precision | Recall | mAP50 | mAP50-95 | Best Weight |
|---|---:|---:|---:|---:|---|
| Baseline YOLO26n | n/a | n/a | 0.783 | 0.718 | `outputs/weights/baseline_yolo26n_best.pt` |
| Teacher YOLO26s | n/a | n/a | 0.787 | 0.724 | `outputs/weights/teacher_yolo26s_best.pt` |
| KD-YOLO26n CSV best epoch 60 | 0.857 | 0.771 | 0.768 | 0.723 | `outputs/weights/kd_yolo26n_best.pt` |
| KD-YOLO26n best.pt final val | 0.876 | 0.757 | 0.769 | 0.722 | `outputs/weights/kd_yolo26n_best.pt` |

## Test Results
| Method | Precision | Recall | mAP50 | mAP50-95 | Best Weight |
|---|---:|---:|---:|---:|---|
| Baseline YOLO26n | n/a | n/a | 0.902 | 0.827 | `outputs/weights/baseline_yolo26n_best.pt` |
| Teacher YOLO26s | n/a | n/a | 0.885 | 0.828 | `outputs/weights/teacher_yolo26s_best.pt` |
| KD-YOLO26n | 0.821 | 0.891 | 0.895 | 0.829 | `outputs/weights/kd_yolo26n_best.pt` |

## Comparison
- KD validation mAP50-95 is slightly above baseline CSV best (0.723 vs 0.718) and close to teacher (0.724).
- KD test mAP50-95 is slightly above both baseline and teacher (0.829 vs 0.827/0.828).
- KD test mAP50 is below baseline but above teacher (0.895 vs 0.902/0.885).
- Recall on KD test is high: 0.891.

## Files
- `scripts/train_yolo26_kd.py`
- `runs/exp/kd_yolo26n/weights/best.pt`
- `outputs/weights/kd_yolo26n_best.pt`
- `outputs/kd_yolo26n_results.csv`
- `runs/eval/kd_yolo26n_test`
- `outputs/eval/kd_yolo26n_test`

## Notes
- Normal YOLO26 one-epoch training check passed before KD implementation.
- E2 used YOLO26/Ultralytics internals directly; YOLOv8-KD code was not installed or substituted.
- `batch=0.9` was tried first for 90% AutoBatch, but actual KD training memory was much lower than expected. Fixed `batch=896` was used to increase training memory utilization while avoiding OOM.
- WFD/E3 has not been run.
