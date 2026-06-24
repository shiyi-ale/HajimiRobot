<div align="right">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

<div align="center">
  <img src="./assets/logo.png" alt="HajimiRobot logo" width="820" />
</div>

# HajimiRobot

HajimiRobot is a complete project workspace for a pet robot system, including the web console, local backend, Jetson edge services, YOLO26 behavior recognition resources, and low-level hardware control files.

## Overview

- `Web-Console`: React frontend and local Express backend
- `Jetson-Edge`: Jetson camera services, Bridge, and systemd notes
- `YOLO26`: cat behavior recognition model and experiment notes
- `Hardware`: low-level car control project files

## Repository Layout

```text
HajimiRobot/
├── assets/
├── Hardware/
├── Jetson-Edge/
├── Web-Console/
├── YOLO26/
└── README.md
```

## System Flow

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

## Modules

### Web-Console

The local web console includes dual-camera monitoring, car and gimbal control, recording, feeding, YOLO reports, and bilingual UI support.

- [Web-Console/README.md](./Web-Console/README.md)

### Jetson-Edge

Jetson-side services and bridge logic for camera streaming, gimbal control, car control, Bridge APIs, and systemd deployment.

- [Jetson-Edge/README.md](./Jetson-Edge/README.md)

### YOLO26

Contains the YOLO26 lightweight cat behavior recognition experiment summary and deployment context used by the reporting pipeline.

- [YOLO26/README.md](./YOLO26/README.md)

### Hardware

Low-level hardware project files, currently focused on car control.

- [Hardware/README.md](./Hardware/README.md)

## Current Jetson Notes

The web console usually connects to the following Jetson services:

- Camera 1: `http://<jetson-ip>:5000`
- Camera 2: `http://<jetson-ip>:5001`
- Jetson Bridge: `http://<jetson-ip>:8000`

## Notes

- `Web-Console` has been cleaned of `node_modules`, `dist`, local recordings, and other machine-specific artifacts
- More detailed integration notes are available under `Web-Console/docs/`

