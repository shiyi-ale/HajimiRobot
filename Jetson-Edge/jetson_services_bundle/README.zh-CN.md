<div align="right">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

# Jetson Services Bundle

这个目录整理了 Hajimi Jetson 端当前服务相关的核心代码和部署文件。

## 包含内容

- `jetson_bridge.py`
- `camera_http_stream.py`
- `car_driver.py`
- `gimbal_driver.py`

## 服务映射

- `hajimi-bridge.service` -> `jetson_bridge.py`
- `hajimi-camera.service` -> `camera_http_stream.py`
- `hajimi-camera-2.service` -> `camera_http_stream.py`

## 运行说明

- Bridge 通常以 `systemctl --user` 方式运行
- Camera 服务通常监听 `5000` 与 `5001`
- Bridge 通常监听 `8000`

