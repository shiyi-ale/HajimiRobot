# HajimiRobot YOLO26 Server Training Summary

## Server hardware
- GPU used for this experiment: NVIDIA GeForce RTX 4090, CUDA device 6, 49140 MiB VRAM
- Other GPUs were occupied during the run; GPU 6 was selected instead of device 0.
- CPU: AMD EPYC 7763 64-Core Processor
- RAM: 1511.65 GB

## Environment
- CUDA reported by nvidia-smi / torch: 13.0
- Python: 3.11.15 from /ssd3/adv_patch/cat-detect/bin/python
- Ultralytics: 8.4.56
- Torch: 2.12.0+cu130

## Dataset
- Path: /ssd3/adv_patch/cat-detect/dataset
- Classes: eating, playing, rest, sitting, stretching, yawning
- Train images / labels: 5516 / 5516
- Valid images / labels: 226 / 226
- Test images / labels: 113 / 113
- dataset_check: succeeded
- One-epoch train validation: succeeded, val mAP50=0.479, mAP50-95=0.406

## Baseline YOLO26n
- Run: runs/exp/baseline_yolo26n_batch_auto
- Training: 100 epochs, imgsz=320, batch=-1 AutoBatch selected batch=286, cache=ram, device=6
- Best validation epoch: 57
- Best validation mAP50: 0.78345
- Best validation mAP50-95: 0.71750
- Final validation from best.pt: mAP50=0.783, mAP50-95=0.718
- Test result: mAP50=0.902, mAP50-95=0.827
- Best weight: outputs/weights/baseline_yolo26n_best.pt

## Teacher YOLO26s
- yolo26s.pt was not initially present; Ultralytics auto-downloaded it to weights/yolo26s.pt.
- Run: runs/exp/teacher_yolo26s_batch_auto
- Training: 100 epochs, imgsz=320, batch=-1 AutoBatch selected batch=145, cache=ram, device=6
- Best validation epoch: 31
- Best validation mAP50: 0.78710
- Best validation mAP50-95: 0.72380
- Test result: mAP50=0.885, mAP50-95=0.828
- Best weight: outputs/weights/teacher_yolo26s_best.pt

## Teacher vs Student
- Teacher outperformed baseline on validation mAP50-95: 0.72380 vs 0.71750.
- Teacher was also slightly higher on test mAP50-95: 0.828 vs 0.827.
- Baseline had higher test mAP50: 0.902 vs teacher 0.885.

## Optional KD / WFD
- KD: implemented and trained in E2. Best validation mAP50=0.769, mAP50-95=0.722; test mAP50=0.895, mAP50-95=0.829. Best weight: outputs/weights/kd_yolo26n_best.pt.
- WFD: not implemented or trained in this run.

## Errors / Notes
- Initial default system Python had no ultralytics package and yolo was not on PATH; the local Conda environment at /ssd3/adv_patch/cat-detect was used instead.
- dataset/data.yaml was updated to use absolute dataset path. No image or label files were modified.
- A first baseline run with batch=16 was stopped at user request after epoch 18; partial outputs remain in runs/exp/baseline_yolo26n.
- yolo detect val with batch=-1 failed because val requires a positive integer batch_size; error saved to logs/baseline_yolo26n_test_batch_auto_error.log. Evaluation was rerun with integer batch.
- AutoBatch target was 60 percent VRAM for batch=-1 in E0/E1. For E2 KD, batch=0.9 selected batch=430 but actual training memory was about 20.7 GB, so E2 was restarted with fixed batch=896 and training log peak about 40.5 GB.

## Deliverables
- outputs/weights/baseline_yolo26n_best.pt
- outputs/weights/teacher_yolo26s_best.pt
- outputs/baseline_yolo26n_results.csv
- outputs/teacher_yolo26s_results.csv
- outputs/eval/baseline_yolo26n_test
- outputs/eval/teacher_yolo26s_test

## E2 KD YOLO26n
- Run: runs/exp/kd_yolo26n
- Training: 100 epochs, imgsz=320, fixed batch=896, device=6, feature KD lambda=0.3
- Selected feature layers: [16, 19, 22]
- Best validation: mAP50=0.769, mAP50-95=0.722
- Test result: precision=0.821, recall=0.891, mAP50=0.895, mAP50-95=0.829
- Best weight: outputs/weights/kd_yolo26n_best.pt
- Summary: outputs/e2_kd_summary.md
