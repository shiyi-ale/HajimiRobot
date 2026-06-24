<div align="right">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

# HajimiRobot YOLO26 Cat Behavior Lightweight Experiment

这个目录整理了 YOLO26 轻量猫行为识别实验的核心结果，用于支持 HajimiRobot 的行为识别和历史报告能力。

## 部署目标

```text
trained .pt -> ONNX -> TensorRT FP16 / INT8 -> Jetson Nano
```

## 数据集

类别：

```text
eating, playing, rest, sitting, stretching, yawning
```

## 记录环境

```text
Python: 3.11.15
Ultralytics: 8.4.56
Torch: 2.12.0+cu130
CUDA: 13.0
GPU: RTX 4090, 49140 MiB
```

## 关键结果

最佳可部署学生模型为 `wfd_yolo26n_from_x_best.pt`。

```text
Test mAP50-95: 0.843
Inference structure: normal YOLO26n
```

## 备注

- KD 与 WFD 模块仅用于训练阶段
- 最终部署模型仍然是标准 YOLO26n 结构
- 大文件、权重、数据集、ONNX、TensorRT engine 未包含在 GitHub 包中

