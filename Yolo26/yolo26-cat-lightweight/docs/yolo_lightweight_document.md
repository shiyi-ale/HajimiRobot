# HajimiRobot YOLO26 轻量化实验文档

## 1. 项目目标

本项目目标是为 HajimiRobot 的猫行为识别任务训练和轻量化 YOLO26 检测模型。

服务器只负责训练和生成 `.pt` 权重，最终部署链路为：

```text
trained .pt
  -> ONNX export
  -> TensorRT FP16 / INT8 engine
  -> Jetson Nano deployment
```

当前任务是 6 类猫行为检测：

```text
eating, playing, rest, sitting, stretching, yawning
```

原始目标权重：

```text
baseline_yolo26n.pt
teacher_yolo26s.pt
kd_yolo26n.pt
wfd_yolo26n.pt optional
```

后续新增更强 teacher：

```text
teacher_yolo26x.pt
kd_yolo26n_from_x.pt planned
```

## 2. 数据集

数据集路径：

```text
/ssd3/adv_patch/cat-detect/dataset
```

数据结构：

```text
dataset/
├── train/
│   ├── images/
│   └── labels/
├── valid/
│   ├── images/
│   └── labels/
└── test/
    ├── images/
    └── labels/
```

`dataset/data.yaml` 已更新为绝对路径：

```yaml
path: /ssd3/adv_patch/cat-detect/dataset

train: train/images
val: valid/images
test: test/images

nc: 6
names:
  - eating
  - playing
  - rest
  - sitting
  - stretching
  - yawning
```

数据集统计：

| Split | Images | Labels |
|---|---:|---:|
| train | 5516 | 5516 |
| valid | 226 | 226 |
| test | 113 | 113 |

数据集 sanity check 已通过。

## 3. 环境

当前工作目录：

```text
/ssd3/adv_patch/cat-detect
```

使用本地环境：

```text
/ssd3/adv_patch/cat-detect/bin/python
/ssd3/adv_patch/cat-detect/bin/yolo
```

环境信息：

| Item | Value |
|---|---|
| Python | 3.11.15 |
| Ultralytics | 8.4.56 |
| Torch | 2.12.0+cu130 |
| CUDA | 13.0 |
| GPU used | RTX 4090, device 6 |
| VRAM | 49140 MiB |

说明：系统 Python 没有可用的 ultralytics/yolo，因此训练全部使用项目本地环境。

## 4. YOLO26 模型选择

用户提供的 YOLO26 官方模型对比：

| Model | Size | mAP50-95 | Params | FLOPs |
|---|---:|---:|---:|---:|
| YOLO26n | 640 | 40.9 | 2.4M | 5.4B |
| YOLO26s | 640 | 48.6 | 9.5M | 20.7B |
| YOLO26m | 640 | 53.1 | 20.4M | 68.2B |
| YOLO26l | 640 | 55.0 | 24.8M | 86.4B |
| YOLO26x | 640 | 57.5 | 55.7M | 193.9B |

初始 teacher 使用 YOLO26s，后来发现 teacher 和 student 差距太小，KD 收益有限。因此新增 YOLO26x 作为更强 teacher。

本地已确认存在：

```text
/ssd3/adv_patch/cat-detect/yolo26x.pt
```

并已复制到：

```text
weights/yolo26x.pt
```

## 5. 已完成实验

### 5.1 E0 Baseline YOLO26n

训练命令核心参数：

```text
model=weights/yolo26n.pt
imgsz=320
epochs=100
batch=-1 AutoBatch
cache=ram
device=6
```

实际 AutoBatch：

```text
batch=286
```

结果：

| Metric | Value |
|---|---:|
| Best val epoch | 57 |
| Val mAP50 | 0.78345 |
| Val mAP50-95 | 0.71750 |
| Test mAP50 | 0.902 |
| Test mAP50-95 | 0.827 |

输出：

```text
runs/exp/baseline_yolo26n_batch_auto/
outputs/weights/baseline_yolo26n_best.pt
outputs/baseline_yolo26n_results.csv
outputs/eval/baseline_yolo26n_test/
```

### 5.2 E1 Teacher YOLO26s

训练命令核心参数：

```text
model=weights/yolo26s.pt
imgsz=320
epochs=100
batch=-1 AutoBatch
cache=ram
device=6
```

实际 AutoBatch：

```text
batch=145
```

结果：

| Metric | Value |
|---|---:|
| Best val epoch | 31 |
| Val mAP50 | 0.78710 |
| Val mAP50-95 | 0.72380 |
| Test mAP50 | 0.885 |
| Test mAP50-95 | 0.828 |

输出：

```text
runs/exp/teacher_yolo26s_batch_auto/
outputs/weights/teacher_yolo26s_best.pt
outputs/teacher_yolo26s_results.csv
outputs/eval/teacher_yolo26s_test/
```

结论：YOLO26s teacher 只比 baseline YOLO26n 略强，差距很小：

```text
Val mAP50-95: 0.72380 vs 0.71750
Test mAP50-95: 0.828 vs 0.827
```

这说明 YOLO26s 作为 teacher 不够强，限制了 KD 的上限。

### 5.3 E2 Normal KD with YOLO26s Teacher

E2 不能直接套 YOLOv8-KD 仓库，必须基于当前 YOLO26 / Ultralytics 环境实现。

实现脚本：

```text
scripts/train_yolo26_kd.py
```

实现方式：

- 继承当前 Ultralytics `DetectionTrainer`
- 加载 YOLO26s teacher `.pt`
- 加载 YOLO26n student `.pt`
- teacher 冻结并保持 eval mode
- student 正常训练检测 loss
- 通过 forward hooks 抽取中间 feature
- 使用 feature MSE 做蒸馏
- 使用训练期 1x1 Conv adapter 对齐通道
- adapter 不进入最终 student 推理模型

KD loss：

```text
L_total = L_det + lambda_kd * L_feature_kd
lambda_kd = 0.3
```

蒸馏层：

```text
[16, 19, 22]
```

对应 YOLO26 neck 的 P3/P4/P5 特征。

通道对齐：

```text
student -> teacher
64  -> 128
128 -> 256
256 -> 512
```

训练参数：

```text
model=weights/yolo26n.pt
teacher=outputs/weights/teacher_yolo26s_best.pt
imgsz=320
epochs=100
batch=896 fixed
lambda_kd=0.3
device=6
cache=ram
```

显存策略：

- 先尝试 `batch=0.9`
- AutoBatch 选择 `batch=430`
- 但实际训练显存只有约 `20.7G`
- 后来改为固定 `batch=896`
- 训练日志峰值约 `40.5G`

E2 结果：

| Model | Val mAP50 | Val mAP50-95 | Test mAP50 | Test mAP50-95 |
|---|---:|---:|---:|---:|
| Baseline YOLO26n | 0.783 | 0.718 | 0.902 | 0.827 |
| Teacher YOLO26s | 0.787 | 0.724 | 0.885 | 0.828 |
| KD YOLO26n | 0.769 | 0.722 | 0.895 | 0.829 |

KD test 详细结果：

| Metric | Value |
|---|---:|
| Precision | 0.821 |
| Recall | 0.891 |
| mAP50 | 0.895 |
| mAP50-95 | 0.829 |

输出：

```text
runs/exp/kd_yolo26n/
outputs/weights/kd_yolo26n_best.pt
outputs/kd_yolo26n_results.csv
outputs/eval/kd_yolo26n_test/
outputs/e2_kd_summary.md
```

E2 结论：

- KD 成功跑通。
- 最终 `.pt` 仍然是普通 YOLO26n，可继续导出 ONNX/TensorRT。
- KD test mAP50-95 略高于 baseline 和 teacher。
- KD recall 较高，说明漏检减少。
- 但提升幅度很小，主要原因是 YOLO26s teacher 本身不够强。

## 6. 当前正在进行的实验：YOLO26x Teacher

为解决 YOLO26s teacher 不够强的问题，已开始训练 YOLO26x teacher。

权重来源：

```text
/ssd3/adv_patch/cat-detect/yolo26x.pt
```

复制后路径：

```text
weights/yolo26x.pt
```

训练 run：

```text
runs/exp/teacher_yolo26x/
```

当前后台训练命令：

```bash
./bin/yolo detect train \
  model=weights/yolo26x.pt \
  data=dataset/data.yaml \
  imgsz=320 \
  epochs=100 \
  batch=160 \
  device=6 \
  workers=16 \
  project=/ssd3/adv_patch/cat-detect/runs/exp \
  name=teacher_yolo26x \
  exist_ok=True \
  cache=ram
```

进程状态：

```text
YOLO26x teacher training is running in background
Main PID observed: 987536
```

显存策略：

- 先尝试 `batch=0.9`
- AutoBatch 选择 `batch=56`
- 但实际训练显存只有约 `14.9G`
- 因此停止并改为固定 `batch=160`
- 当前训练日志显存约 `39-39.5G`

当前监控命令：

```bash
pgrep -af "yolo detect train model=weights/yolo26x.pt"
tail -n 5 runs/exp/teacher_yolo26x/results.csv
nvidia-smi
```

训练完成后需要复制：

```bash
mkdir -p outputs/weights
cp runs/exp/teacher_yolo26x/weights/best.pt outputs/weights/teacher_yolo26x_best.pt
cp runs/exp/teacher_yolo26x/results.csv outputs/teacher_yolo26x_results.csv
```

然后 test 评估：

```bash
./bin/yolo detect val \
  model=outputs/weights/teacher_yolo26x_best.pt \
  data=dataset/data.yaml \
  split=test \
  imgsz=320 \
  batch=16 \
  device=6 \
  project=/ssd3/adv_patch/cat-detect/runs/eval \
  name=teacher_yolo26x_test \
  exist_ok=True
```

## 7. 后续计划：用 YOLO26x 重新做 KD

YOLO26x teacher 训练完成后，推荐重新做 E2：

```text
Teacher: outputs/weights/teacher_yolo26x_best.pt
Student: weights/yolo26n.pt
Output: outputs/weights/kd_yolo26n_from_x_best.pt
```

推荐命令：

```bash
./bin/python scripts/train_yolo26_kd.py \
  --student weights/yolo26n.pt \
  --teacher outputs/weights/teacher_yolo26x_best.pt \
  --data dataset/data.yaml \
  --imgsz 320 \
  --epochs 100 \
  --batch 896 \
  --device 6 \
  --workers 16 \
  --lambda-kd 0.3 \
  --project /ssd3/adv_patch/cat-detect/runs/exp \
  --name kd_yolo26n_from_x \
  --cache ram \
  --exist-ok
```

注意：YOLO26x teacher 的 feature channel 是：

```text
P3/P4/P5: 384, 768, 768
```

YOLO26n student 是：

```text
P3/P4/P5: 64, 128, 256
```

因此 KD 脚本会自动创建更大的 1x1 adapter：

```text
64  -> 384
128 -> 768
256 -> 768
```

因为 teacher 更强，理论上 YOLO26x -> YOLO26n 的 KD 应该比 YOLO26s -> YOLO26n 更有价值。

## 8. E3 WFD-YOLO26 计划

E3 是 Wavelet Feature Distillation，小波特征蒸馏。

方法名：

```text
WFD-YOLO26
Wavelet Feature Distillation for YOLO26 Edge Deployment
```

建议在 YOLO26x teacher 跑通后再做。

目标：

```text
Teacher: YOLO26x or YOLO26s
Student: YOLO26n
Wavelet: Haar Wavelet
Layers: P3 + P4 + P5
```

Loss：

```text
L_total = L_det + lambda_kd * L_feature_kd + lambda_wavelet * L_wavelet
```

Wavelet loss：

```text
L_wavelet =
MSE(LLs, LLt)
+ alpha * [L1(LHs, LHt) + L1(HLs, HLt) + L1(HHs, HHt)]
```

推荐参数：

```text
lambda_kd = 0.3
lambda_wavelet = 0.2
alpha = 1.5
```

训练策略：

```text
epoch 0-10: linearly warm up lambda_wavelet from 0 to 0.2
epoch 10-100: keep lambda_wavelet = 0.2
```

重要约束：

- Haar wavelet 只用于训练 loss。
- 不插入最终 YOLO26n 推理结构。
- 最终 `.pt` 仍然必须是普通 YOLO26n。
- Jetson Nano 部署链路不变。

## 9. 当前结论

### 9.1 YOLO26s teacher 的问题

YOLO26s teacher 只比 YOLO26n baseline 略强：

```text
Val mAP50-95: 0.724 vs 0.718
Test mAP50-95: 0.828 vs 0.827
```

这种 teacher-student gap 太小，KD 学不到太多额外信息。

因此 YOLO26s KD 的提升很有限：

```text
KD test mAP50-95: 0.829
Baseline test mAP50-95: 0.827
Teacher test mAP50-95: 0.828
```

这是有效但很小的提升。

### 9.2 YOLO26x teacher 的必要性

YOLO26x 官方 mAP 明显高于 YOLO26s：

```text
YOLO26s: 48.6
YOLO26x: 57.5
```

理论上更适合做 teacher。

如果 YOLO26x 在当前 6 类数据集上也明显超过 YOLO26n，那么后续 KD 才更可能有明显收益。

### 9.3 显存利用经验

在当前 Ultralytics 8.4.56 + YOLO26 环境中：

- `batch=0.9` AutoBatch 会按 90% 估算。
- 但实际训练显存可能远低于估算。
- YOLO26n KD 中，AutoBatch 选 `430`，实际约 `20.7G`。
- 改固定 `batch=896` 后约 `40.5G`。
- YOLO26x teacher 中，AutoBatch 选 `56`，实际约 `14.9G`。
- 改固定 `batch=160` 后约 `39-39.5G`。

因此当前策略是：

```text
先试 batch=0.9
观察真实 GPU_mem / nvidia-smi
如果明显偏低，改固定大 batch
避免 OOM 边缘
```

## 10. 当前交付物

已生成：

```text
outputs/weights/baseline_yolo26n_best.pt
outputs/weights/teacher_yolo26s_best.pt
outputs/weights/kd_yolo26n_best.pt
outputs/baseline_yolo26n_results.csv
outputs/teacher_yolo26s_results.csv
outputs/kd_yolo26n_results.csv
outputs/eval/baseline_yolo26n_test/
outputs/eval/teacher_yolo26s_test/
outputs/eval/kd_yolo26n_test/
outputs/e2_kd_summary.md
outputs/experiment_summary.md
hajimi_yolo26_server_training_outputs.tar.gz
```

正在生成：

```text
runs/exp/teacher_yolo26x/
```

待生成：

```text
outputs/weights/teacher_yolo26x_best.pt
outputs/teacher_yolo26x_results.csv
outputs/eval/teacher_yolo26x_test/
outputs/weights/kd_yolo26n_from_x_best.pt
outputs/eval/kd_yolo26n_from_x_test/
```

## 11. 推荐下一步

1. 等 YOLO26x teacher 训练完成。
2. 复制 `teacher_yolo26x_best.pt` 到 `outputs/weights/`。
3. 评估 YOLO26x teacher test set。
4. 如果 YOLO26x 明显强于 YOLO26n baseline，重新跑 KD：YOLO26x -> YOLO26n。
5. 比较：

```text
baseline_yolo26n
teacher_yolo26s
kd_yolo26n from YOLO26s
teacher_yolo26x
kd_yolo26n from YOLO26x
```

6. 如果 YOLO26x KD 有提升，再继续做 E3 WFD。
