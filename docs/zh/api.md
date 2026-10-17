[Docs](README.md) · [English](../en/api.md)

# API与协议

交互文档 http://127.0.0.1:8001/docs ，公开快照 [OpenAPI](../openapi.json)。产品2.0.1，检测协议仍1.0，端点仍/api/v1。

| 方法与路径（省略/api/v1） | 用途 |
|---|---|
| POST /detections/batch | 最多200帧，含空检测 |
| POST /edge/heartbeat | 设备、取流、推理和调度状态 |
| GET /cameras/{id}/config | 版本化配置 |
| GET /review/timeline | day/camera_id/source的回看与覆盖 |
| PUT /review/{id}/status | reviewed布尔值和revision；旧版本409 |
| GET /clips | 可选day，包含跨日相交录像 |
| POST /agent/reports | question/date/camera_id/source；202与job_id |
| GET /agent/jobs/{id} | queued/running/completed/failed与结果 |
| GET /agent/reports | camera_id/source/date/before_id/limit |
| GET /agent/reports/{id} | 完整报告 |
| POST /memory/consolidate | 归并已结束日期 |

报告列表limit默认20，范围1—100；before_id使用上一页最后ID。返回reports、next_cursor，摘要含摄像头、来源、日期、模式、摘要和创建时间。

检测包含版本、设备/摄像头/会话/帧ID、UTC时间、图像尺寸、模型ID和归一化xyxy。类别固定eating/playing/rest/sitting/stretching/yawning，按名称映射，track_id可选。observation_sec仅描述明确有效的0—5秒区间，不能用采样间隔冒充连续观测。

空框也上报。按设备/摄像头/会话/帧去重，允许乱序与重试，重叠区间不重复累计；旧接口不推导时长。[JSONL示例](../detection-example.jsonl)。
