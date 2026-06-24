<div align="right">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

# HajimiRobot YOLO26 Cat Behavior Lightweight Experiment

This directory summarizes the YOLO26 lightweight cat behavior detection experiments used to support HajimiRobot behavior recognition and history reporting.

## Deployment Target

```text
trained .pt -> ONNX -> TensorRT FP16 / INT8 -> Jetson Nano
```

## Dataset

Classes:

```text
eating, playing, rest, sitting, stretching, yawning
```

## Recorded Environment

```text
Python: 3.11.15
Ultralytics: 8.4.56
Torch: 2.12.0+cu130
CUDA: 13.0
GPU: RTX 4090, 49140 MiB
```

## Key Result

The best deployable student model is `wfd_yolo26n_from_x_best.pt`.

```text
Test mAP50-95: 0.843
Inference structure: normal YOLO26n
```

## Notes

- KD and WFD modules are training-only
- the final deployed model is still a normal YOLO26n model
- large files, weights, datasets, ONNX, and TensorRT engines are intentionally excluded from this GitHub package

