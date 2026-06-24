# HajimiRobot YOLO26 轻量化实验对比概要

生成时间：2026-06-23  
项目目录：`/ssd3/adv_patch/cat-detect`

## 1. 实验目标

本轮实验围绕 HajimiRobot 猫行为检测模型轻量化展开，部署目标链路为：

```text
trained .pt -> ONNX -> TensorRT FP16 / INT8 -> Jetson Nano
```

核心目标是训练并比较 YOLO26n 学生模型、YOLO26s/YOLO26x 教师模型、普通特征蒸馏 KD，以及小波特征蒸馏 WFD。

最终结论：**当前最好的可部署学生模型是 `outputs/weights/wfd_yolo26n_from_x_best.pt`**。

## 2. 数据集与环境

数据集：

```text
dataset root: /ssd3/adv_patch/cat-detect/dataset
classes: eating, playing, rest, sitting, stretching, yawning
train: 5516 images / 5516 labels
valid: 226 images / 226 labels
test: 113 images / 113 labels
```

环境：

```text
Python: 3.11.15
Ultralytics: 8.4.56
Torch: 2.12.0+cu130
CUDA: 13.0
GPU: RTX 4090, 49140 MiB
```

前置检查：

```text
dataset/data.yaml 已改为绝对路径
dataset_check 通过
1 epoch YOLO26n 训练检查通过
```

## 3. 实验路线

已完成实验：

| 阶段 | 内容 | 状态 |
|---|---|---|
| E0 | YOLO26n baseline | 完成 |
| E1 | YOLO26s teacher | 完成 |
| E1+ | YOLO26x teacher | 完成 |
| E2 | YOLO26s -> YOLO26n feature KD | 完成 |
| E2+ | YOLO26x -> YOLO26n feature KD | 完成，但效果不好 |
| E3 | YOLO26x -> YOLO26n WFD | 完成，当前最佳学生模型 |

关键实现说明：

```text
E2/E3 都基于当前 YOLO26 / Ultralytics DetectionTrainer 实现
没有直接套 YOLOv8-KD 仓库
蒸馏层使用 [16, 19, 22]，对应 P3/P4/P5 neck features
通道不一致时使用训练期 1x1 Conv adapter
adapter / wavelet 模块不进入最终推理模型
最终 .pt 仍是普通 YOLO26n 结构
```

## 4. 验证集结果对比

| 方法 | Teacher | Student | Run | Best Epoch | Precision | Recall | mAP50 | mAP50-95 |
|---|---|---|---|---:|---:|---:|---:|---:|
| Baseline YOLO26n | - | YOLO26n | `baseline_yolo26n_batch_auto` | 57 | 0.732 | 0.768 | 0.783 | 0.718 |
| Teacher YOLO26s | - | YOLO26s | `teacher_yolo26s_batch_auto` | 31 | 0.756 | 0.745 | 0.787 | 0.724 |
| KD YOLO26n | YOLO26s | YOLO26n | `kd_yolo26n` | 60 | 0.857 | 0.771 | 0.768 | 0.723 |
| Teacher YOLO26x | - | YOLO26x | `teacher_yolo26x` | 29 | 0.743 | 0.759 | 0.796 | 0.741 |
| KD YOLO26n from X | YOLO26x | YOLO26n | `kd_yolo26n_from_x_nohup_b512` | 22 | 0.778 | 0.678 | 0.807 | 0.714 |
| WFD YOLO26n from X | YOLO26x | YOLO26n | `wfd_yolo26n_from_x_b128_gpu5` | 36 | 0.736 | 0.703 | 0.767 | 0.705 |

验证集观察：

```text
YOLO26x teacher 明显强于 YOLO26s teacher。
YOLO26s -> YOLO26n KD 在验证集上略高于 baseline。
YOLO26x -> YOLO26n 普通 KD 反而下降，说明强 teacher 不等于普通 feature MSE KD 一定更好。
WFD 验证集 mAP50-95 不高，但测试集表现明显更好。
```

## 5. 测试集结果对比

| 方法 | Weight | Precision | Recall | mAP50 | mAP50-95 |
|---|---|---:|---:|---:|---:|
| Baseline YOLO26n | `outputs/weights/baseline_yolo26n_best.pt` | n/a | n/a | 0.902 | 0.827 |
| Teacher YOLO26s | `outputs/weights/teacher_yolo26s_best.pt` | n/a | n/a | 0.885 | 0.828 |
| KD YOLO26n | `outputs/weights/kd_yolo26n_best.pt` | 0.821 | 0.891 | 0.895 | 0.829 |
| Teacher YOLO26x | `outputs/weights/teacher_yolo26x_best.pt` | 0.839 | 0.873 | 0.900 | 0.859 |
| KD YOLO26n from X | `outputs/weights/kd_yolo26n_from_x_best.pt` | 0.771 | 0.753 | 0.899 | 0.811 |
| WFD YOLO26n from X | `outputs/weights/wfd_yolo26n_from_x_best.pt` | 0.895 | 0.857 | 0.915 | 0.843 |

测试集排序：

| 排名 | 模型 | 类型 | test mAP50-95 |
|---:|---|---|---:|
| 1 | YOLO26x teacher | 大模型 teacher | 0.859 |
| 2 | WFD YOLO26n from X | 轻量学生，可部署 | 0.843 |
| 3 | KD YOLO26n from S | 轻量学生，可部署 | 0.829 |
| 4 | Teacher YOLO26s | 中小 teacher | 0.828 |
| 5 | Baseline YOLO26n | 轻量学生，可部署 | 0.827 |
| 6 | KD YOLO26n from X | 轻量学生，可部署 | 0.811 |

## 6. 模型大小、参数量与延迟

说明：

```text
KD / WFD 最终保存的都是普通 YOLO26n 推理结构。
因此 baseline_yolo26n、kd_yolo26n、kd_yolo26n_from_x、wfd_yolo26n_from_x 的参数量、模型大小、部署延迟都按 YOLO26n 计算。
Teacher YOLO26s / YOLO26x 只用于训练或离线评估，不建议作为 Jetson Nano 主部署模型。
```

本地 `.pt` 文件大小：

| 权重 | 推理结构 | `.pt` 大小 |
|---|---|---:|
| `baseline_yolo26n_best.pt` | YOLO26n | 5.2M |
| `kd_yolo26n_best.pt` | YOLO26n | 5.2M |
| `kd_yolo26n_from_x_best.pt` | YOLO26n | 5.2M |
| `wfd_yolo26n_from_x_best.pt` | YOLO26n | 5.2M |
| `teacher_yolo26s_best.pt` | YOLO26s | 20M |
| `teacher_yolo26x_best.pt` | YOLO26x | 113M |

官方 YOLO26 复杂度与延迟参考，输入 640：

| Model | Params | FLOPs | CPU ONNX | T4 TensorRT10 |
|---|---:|---:|---:|---:|
| YOLO26n | 2.4M | 5.4B | 38.9 ± 0.7 ms | 1.7 ± 0.0 ms |
| YOLO26s | 9.5M | 20.7B | 87.2 ± 0.9 ms | 2.5 ± 0.0 ms |
| YOLO26x | 55.7M | 193.9B | 525.8 ± 4.0 ms | 11.8 ± 0.2 ms |

本项目视频推理实测，输入 320，RTX 4090 忙卡环境：

| 权重 | 视频 | 平均推理 |
|---|---|---:|
| `wfd_yolo26n_from_x_best.pt` | `19757151-hd_1080_1920_30fps.mp4` | 约 10.7 ms/frame |

注意：

```text
上面的 10.7 ms/frame 是服务器 RTX 4090 上 PyTorch 推理，不是 Jetson Nano TensorRT 延迟。
Jetson Nano 实际延迟需要用导出的 ONNX/TensorRT engine 在 Nano 上实测。
由于 WFD 模块不进入推理模型，WFD 版本导出后的推理复杂度应与普通 YOLO26n 一致。
```

## 7. Batch 与显存使用

| 实验 | Batch | GPU | 显存情况 |
|---|---:|---|---|
| Baseline YOLO26n | AutoBatch 286 | GPU 6 | AutoBatch |
| Teacher YOLO26s | AutoBatch 145 | GPU 6 | AutoBatch |
| KD YOLO26n from S | 896 | GPU 6 | 约 40.5G |
| Teacher YOLO26x | 160 | GPU 6 | 约 39G |
| KD YOLO26n from X | 512 | GPU 6 | 约 35.3G |
| WFD YOLO26n from X | 128 | GPU 5 | 约 9.08G |

聊天中形成的经验：

```text
batch=-1 / batch=0.9 在该环境下经常低估真实可用显存。
val 阶段不能用 batch=-1，必须用正整数 batch。
为了提高显存利用率，多次改用固定 batch。
E3 启动时 GPU 6 被其他任务占用约 38G，因此改在 GPU 5 以 batch=128 跑完。
nohup + setsid 启动方式比普通后台启动稳定。
```

## 8. 教师模型结论

最初 YOLO26s teacher 只比 baseline YOLO26n 略强：

```text
Baseline valid mAP50-95: 0.718
YOLO26s valid mAP50-95: 0.724
Baseline test mAP50-95: 0.827
YOLO26s test mAP50-95: 0.828
```

因此普通 KD 提升有限。随后加入 YOLO26x：

```text
YOLO26x valid mAP50-95: 0.741
YOLO26x test mAP50-95: 0.859
```

结论：

```text
YOLO26x 是更合适的 teacher。
但直接 YOLO26x -> YOLO26n feature MSE KD 效果不好。
WFD 能更好利用 YOLO26x teacher 的高低频特征信息。
```

## 9. E2 与 E3 实现摘要

E2 普通 KD：

```text
script: scripts/train_yolo26_kd.py
loss: L_total = L_det + 0.3 * L_feature_kd
feature loss: MSE
layers: [16, 19, 22]
teacher frozen: yes
adapter exported: no
```

E3 WFD：

```text
script: scripts/train_yolo26_wfd.py
loss: L_total = L_det + 0.3 * L_feature_kd + lambda_wfd * L_wavelet
lambda_wfd: 0 -> 0.2 over first 10 epochs
wavelet: Haar DWT
alpha: 1.5
layers: [16, 19, 22]
teacher frozen: yes
wavelet exported: no
adapter exported: no
```

E3 输出仍是普通 YOLO26n `.pt`，可继续走：

```text
wfd_yolo26n_from_x_best.pt -> ONNX -> TensorRT FP16 / INT8 -> Jetson Nano
```

## 10. 最终推荐

部署优先级：

| 优先级 | 权重 | 说明 |
|---:|---|---|
| 1 | `outputs/weights/wfd_yolo26n_from_x_best.pt` | 当前最佳轻量学生，test mAP50-95 0.843 |
| 2 | `outputs/weights/kd_yolo26n_best.pt` | 稳定 KD 版本，test mAP50-95 0.829 |
| 3 | `outputs/weights/baseline_yolo26n_best.pt` | 简单可靠 baseline，test mAP50-95 0.827 |
| 参考 | `outputs/weights/teacher_yolo26x_best.pt` | 最强 teacher，不适合 Jetson Nano 轻量部署 |

最终建议：

```text
主推 wfd_yolo26n_from_x_best.pt 做 ONNX / TensorRT 导出。
保留 baseline_yolo26n_best.pt 作为稳定 fallback。
teacher_yolo26x_best.pt 作为后续蒸馏、伪标签或离线评估 teacher。
```

## 11. 文件索引

核心脚本：

```text
scripts/check_dataset.py
scripts/train_yolo26_kd.py
scripts/train_yolo26_wfd.py
scripts/run_wfd_yolo26n_from_x_nohup_b512.sh
```

核心输出：

```text
outputs/weights/baseline_yolo26n_best.pt
outputs/weights/teacher_yolo26s_best.pt
outputs/weights/teacher_yolo26x_best.pt
outputs/weights/kd_yolo26n_best.pt
outputs/weights/kd_yolo26n_from_x_best.pt
outputs/weights/wfd_yolo26n_from_x_best.pt
```

评估目录：

```text
outputs/eval/baseline_yolo26n_test
outputs/eval/teacher_yolo26s_test
outputs/eval/teacher_yolo26x_test
outputs/eval/kd_yolo26n_test
outputs/eval/kd_yolo26n_from_x_test
outputs/eval/wfd_yolo26n_from_x_test
```

日志：

```text
logs/kd_yolo26n_from_x_nohup_b512.log
logs/wfd_yolo26n_from_x_b128_gpu5.log
```

## 12. 注意事项

```text
没有修改原始图片或标签。
WFD 训练中使用的 Haar wavelet 和 adapter 只存在于训练过程。
最终保存的 WFD 权重是正常 YOLO26n 模型。
test 集较小，valid/test 指标存在波动；最终部署前建议再做 Jetson Nano 端 TensorRT 验证。
```
