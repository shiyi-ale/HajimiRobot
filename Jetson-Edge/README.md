<div align="right">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

# Jetson-Edge

This directory contains Jetson-side edge services, runtime notes, and systemd-related documentation.

## Included

- `jetson_services_bundle/`
- `systemd-services-overview.md`

## Main Responsibilities

- expose dual MJPEG camera services
- expose the Jetson Bridge API
- forward gimbal control
- forward car control
- provide health and bridge status

## Quick Checks

```bash
systemctl --user status hajimi-bridge.service
curl http://127.0.0.1:8000/healthz
curl http://127.0.0.1:8000/api/status
```

