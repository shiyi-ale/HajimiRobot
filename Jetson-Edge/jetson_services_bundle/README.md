<div align="right">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

# Jetson Services Bundle

This directory contains the core code and deployment files for the Jetson-side services used by Hajimi.

## Contents

- `jetson_bridge.py`
- `camera_http_stream.py`
- `car_driver.py`
- `gimbal_driver.py`

## Service Mapping

- `hajimi-bridge.service` -> `jetson_bridge.py`
- `hajimi-camera.service` -> `camera_http_stream.py`
- `hajimi-camera-2.service` -> `camera_http_stream.py`

## Runtime Notes

- The Bridge usually runs as a `systemctl --user` service
- Camera services usually listen on `5000` and `5001`
- The Bridge usually listens on `8000`

