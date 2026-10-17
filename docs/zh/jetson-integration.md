[Docs](README.md) · [English](../en/jetson-integration.md)

# Jetson与模型接入

本机使用CUDA PyTorch YOLO，需自行提供六类权重与视频。模型names须匹配类别。models/catalog.json只有实验清单与摘要，不包含可下载权重。

Jetson通过检测批次、心跳、配置接口接入，逐帧调度在边缘本地完成。device_id固定，每次重启更换session_id，会话内frame_id递增。摄像头ID跨设备需唯一规划，UTC时钟须同步。

可复用services/intelligence/edge_sender.py的SQLite outbox，先落盘再批量重试；保留原始采集时间，重放依赖服务端幂等。令牌留在本地配置。

本机GPU适配器不等于Nano TensorRT已验收。TensorRT需转为相同boxes格式并验证维度、归一化坐标、类名、精度和空检测。多宠物身份及跨镜头去重尚未实现，报表选定单摄像头。Nano的内存、功耗、FPS和加速倍数待实机验证，不能用本次UI改版背书。
