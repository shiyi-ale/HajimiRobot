# YOLO / Jetson → NVR 接口协议 v1.0

OpenAPI 运行时地址：<http://127.0.0.1:8001/docs>。仓库内 `docs/openapi.json` 为本次接口快照，Pydantic 模型是权威约束。统一外部路径前缀 `/api/v1`，本机前端通过 Express 3001 转发到 Python 8001。

## 传输职责

视频与结构化检测分开：摄像头服务继续提供 MJPEG/RTSP；YOLO 只上报 JSON 元数据，不在检测 JSON 中塞图片或视频。录像服务需要访问同一摄像头流，并使用同一摄像头 ID 和采集时钟关联录像。仅上报检测不会凭空生成录像，远端边缘录像亦未包含在此次交付。

边缘进程运行 `MotionDetector + Scheduler`，调度本地 TensorRT 适配器。每次实际完成推理后，发送包含全部目标的检测帧（无目标也发送 `boxes: []`）；定期发送健康心跳。客户端定时读取配置，比较 revision，停止/重建管线后应用新配置；不能逐帧等待网络返回推理指令。

## 检测帧批量上报

`POST /api/v1/detections/batch`，Content-Type `application/json`，一次 1–200 帧，HTTP body 上限 2 MB。

```json
{
  "frames": [
    {
      "protocol_version": "1.0",
      "device_id": "jetson-nano-01",
      "camera_id": "primary",
      "session_id": "bfa9bd29-4ef8-435f-b8c5-f1077e825183",
      "frame_id": 120,
      "captured_at": "2026-03-01T04:00:00.200Z",
      "width": 1280,
      "height": 720,
      "model_id": "wfd-yolo26n-fp16:sha256-your-model-hash",
      "source": "camera",
      "observation_sec": 0.2,
      "boxes": [
        {"label": "eating", "confidence": 0.91, "xyxy": [0.12, 0.20, 0.46, 0.81], "track_id": "pet-1"}
      ]
    }
  ]
}
```

- `captured_at`：带时区的帧采集时间，服务端统一转换 UTC，不能使用推理完成时间代替。设备需要同步时钟；离线积压仍保留原采集时间。
- `frame_id`：同会话递增非负整数，设备重启创建新 session UUID；相同帧重试保持所有 ID 不变。
- 幂等键：`device_id + camera_id + session_id + frame_id`。重复帧第一次写入为准；支持批次乱序与迟到到达。
- `xyxy`：相对原始图像归一化坐标 `[x1,y1,x2,y2]`，范围 `[0,1]`，左上必须小于右下。若推理使用 letterbox，要先还原到原图坐标再归一化。
- 行为类别固定 `eating, playing, rest, sitting, stretching, yawning`。按模型名称映射，不假设模型数字 class ID 永远不变。
- `observation_sec`：`0..5` 秒，缺省 0；只允许声明真实可信观测区间。没有连续观测证据时填 0，不用“距离上次推理 5 秒”冒充连续检测了 5 秒。
- `source`：真实设备用 camera，本地视频用 local-video，合成检测只用 test，旧记录用 legacy。

成功 `200`：`{"accepted":1,"duplicates":0}`。整批校验失败返回 `422`，不会部分写入。未知协议/类别、非法框、无时区时间均拒绝。重试时 `accepted + duplicates` 等于提交数量才可删除本地队列。`5xx/网络错误/429` 指数退避；`401/422` 保留队列并人工修正，不能无限高速重试。

`hajimi.outbox.Outbox` 提供 SQLite 持久队列：

```python
from hajimi.models import Detection
from hajimi.outbox import Outbox

sender = Outbox('edge-outbox.sqlite3', 'http://your-private-ingress:8001', token='configured-token')
sender.enqueue(Detection.model_validate(frame_payload))
# 独立发送线程定期 flush；失败保留记录，不能阻塞视频推理线程。
sender.flush()
```

SQLite Outbox 实例由同一个发送线程持有；生产者通过线程安全队列向发送线程传递 Detection。示例 CLI 可从 JSONL 导入并重试：

```powershell
.venv/Scripts/python.exe services/intelligence/edge_sender.py --input docs/detection-example.jsonl --outbox .runtime/edge-outbox.sqlite3
```

## 心跳与配置

`POST /api/v1/edge/heartbeat`：

```json
{
  "protocol_version": "1.0",
  "device_id": "jetson-nano-01",
  "camera_id": "primary",
  "session_id": "bfa9bd29-4ef8-435f-b8c5-f1077e825183",
  "captured_at": "2026-03-01T04:00:05Z",
  "stream_ok": true,
  "inference_ok": true,
  "scheduler_state": "idle",
  "observed_sec": 0.2,
  "error": null
}
```

建议每 2 秒发送。`observed_sec` 是客户端自上次心跳以来有效观测累计，仅作遥测；服务端不会据此给某种行为增加时长。心跳收到时间与采集时间分别保存，消费者应将超过 10 秒未收到心跳视为陈旧。更旧的远端心跳不覆盖较新采集状态。

`GET /api/v1/cameras/{camera_id}/config` 返回 revision、归一化 ROI、分析/推理频率、运动比例阈值、预热、录像等参数。`PUT` 更新会自增 revision，运行中的本机管线需先停止；ROI 必须 3–32 个点且有面积。默认值与本地操作说明一致。`source/weights` 是运行主机的本地配置，Jetson 端不能照搬 Windows 路径，应映射自己的源和模型文件；边缘只同步调度/ROI 参数。

`POST /api/v1/cameras/{camera_id}/motion-reset` 在云台移动、摄像头位姿变化后清空背景并重新预热。机器人自主移动时应由边缘本地直接调用 `MotionDetector.reset()` 和 `Scheduler.reset(monotonic_now)`，不依赖网络往返。

## 查询与报告

| 接口 | 用途 |
|---|---|
| `GET /nvr/status` | 本地管线指标、远端心跳 |
| `POST /cameras/{id}/start`, `/stop` | 启停本地分析 |
| `GET /cameras/{id}/preview.jpg` | 当前预览图 |
| `GET /stats/{YYYY-MM-DD}?camera_id=primary&source=camera` | 当日确定性统计及证据 |
| `GET /events?day=YYYY-MM-DD&camera_id=primary&source=camera&label=eating` | 事件筛选 |
| `GET /clips?camera_id=primary&source=camera` | 最近 200 条录像索引 |
| `GET /clips/{id}/video` | ready 录像，支持 HTTP Range；未就绪/过期返回 404 |
| `POST /agent/reports` | 提交分析，返回 202 和 job_id |
| `GET /agent/jobs/{id}` | queued/running/completed/failed 及结果 |
| `GET /agent/reports`, `/{id}` | 已保存报告 |
| `POST /memory/consolidate` | 手动归并已结束日期，需要嵌入配置 |

表内路径均加 `/api/v1`。报告请求：

```json
{"date":"2026-03-01","camera_id":"primary","source":"camera","question":"当天活动情况与此前七天相比有什么变化？"}
```

日期和摄像头以显式字段为准；自然语言不会覆盖这些筛选。当前历史问答支持该日、此前七日统计及相同来源摄像头的语义记忆，不执行任意 LLM 生成 SQL。报告返回 stats/baseline/memories/trend/answer/mode/warnings/report_id/prompt_version。findings 的 evidence_ids 可以追溯到统计或事件；导出的 JSON 包含完整证据快照。

## Nano 实机待验证

适配器接口为 `infer(BGR ndarray) -> list[Box]` 及 `model_id`，本机实现 `YoloCPU`；未来 TensorRT 实现同接口。Nano 的 JetPack/Python/TensorRT 版本需要单独适配，不应将 Windows Python 3.12 requirements 原样装到 Nano。WFD 是训练期逻辑，部署推理模型不需要运行小波蒸馏模块。实机必须单独测推理延迟、调度检出差异、CPU/GPU/内存、掉线恢复及视频时钟对齐。
