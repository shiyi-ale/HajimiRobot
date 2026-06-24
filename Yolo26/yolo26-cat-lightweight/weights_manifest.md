# Weights Manifest

Large model files are not included in this GitHub package. They were generated locally under:

```text
/ssd3/adv_patch/cat-detect/outputs/weights
```

| Weight | Role | Inference Structure | Size | Test mAP50-95 |
|---|---|---|---:|---:|
| `baseline_yolo26n_best.pt` | E0 baseline | YOLO26n | 5.2M | 0.827 |
| `teacher_yolo26s_best.pt` | E1 teacher | YOLO26s | 20M | 0.828 |
| `teacher_yolo26x_best.pt` | E1+ teacher | YOLO26x | 113M | 0.859 |
| `kd_yolo26n_best.pt` | E2 KD from YOLO26s | YOLO26n | 5.2M | 0.829 |
| `kd_yolo26n_from_x_best.pt` | E2+ KD from YOLO26x | YOLO26n | 5.2M | 0.811 |
| `wfd_yolo26n_from_x_best.pt` | E3 WFD from YOLO26x | YOLO26n | 5.2M | 0.843 |

Recommended deployment weight:

```text
outputs/weights/wfd_yolo26n_from_x_best.pt
```

Fallback weight:

```text
outputs/weights/baseline_yolo26n_best.pt
```

The KD/WFD weights are normal YOLO26n inference models. Training-only adapters and wavelet operations are not part of the exported model.
