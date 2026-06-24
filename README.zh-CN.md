<div align="right">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

<div align="center">
  <img src="./assets/logo.png" alt="HajimiRobot logo" width="820" />
</div>

# HajimiRobot

HajimiRobot 是一个围绕宠物机器人场景构建的完整工程目录，包含网页控制台、本地后端、Jetson 边缘服务、YOLO26 行为识别模型说明，以及底层硬件控制工程。

## 项目概览

- `Web-Console`：React 前端与本地 Express 后端
- `Jetson-Edge`：Jetson 摄像头服务、Bridge 与 systemd 说明
- `YOLO26`：猫行为识别模型与实验说明
- `Hardware`：底层小车控制工程文件

## 仓库结构

```text
HajimiRobot/
├── assets/
├── Hardware/
├── Jetson-Edge/
├── Web-Console/
├── YOLO26/
└── README.md
```

## 系统链路

```text
Web Frontend
    ->
Local Express Backend
    ->
Jetson Camera Services (:5000 / :5001)
Jetson Bridge (:8000)
    ->
Car / Gimbal / Feed / YOLO Events
```

## 模块说明

### Web-Console

用于本地联调的网页控制台，包含双路监控、小车与云台控制、录像、喂食、YOLO 报告和中英界面切换。

- [Web-Console/README.zh-CN.md](./Web-Console/README.zh-CN.md)

### Jetson-Edge

Jetson 设备侧服务与桥接逻辑，负责摄像头输出、云台控制、小车控制、Bridge API 与 systemd 运行方式。

- [Jetson-Edge/README.zh-CN.md](./Jetson-Edge/README.zh-CN.md)

### YOLO26

整理 YOLO26 猫行为识别轻量模型实验和部署背景，供报告页和行为识别链路参考。

- [YOLO26/README.zh-CN.md](./YOLO26/README.zh-CN.md)

### Hardware

底层硬件控制相关工程文件，目前主要是小车控制工程。

- [Hardware/README.zh-CN.md](./Hardware/README.zh-CN.md)

## 当前 Jetson 对接说明

网页控制台通常对接以下服务：

- Camera 1: `http://<jetson-ip>:5000`
- Camera 2: `http://<jetson-ip>:5001`
- Jetson Bridge: `http://<jetson-ip>:8000`

## 备注

- `Web-Console` 已去掉 `node_modules`、`dist`、本地录像等不适合上传的产物
- 更完整的联调总结在 `Web-Console/docs/` 中

