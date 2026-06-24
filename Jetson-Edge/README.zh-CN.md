<div align="right">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

# Jetson-Edge

这个目录保存 Jetson 设备侧的边缘服务、运行说明和 systemd 相关文档。

## 包含内容

- `jetson_services_bundle/`
- `systemd-services-overview.md`

## 主要职责

- 暴露双路摄像头 MJPEG 服务
- 暴露 Jetson Bridge API
- 转发云台控制
- 转发小车控制
- 提供设备健康状态与桥接状态

## 快速检查

```bash
systemctl --user status hajimi-bridge.service
curl http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/status
```

