<div align="right">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

# HajimiRobot Web Console

HajimiRobot Web Console 是一个用于宠物机器人本地联调的网页控制台，包含 React 前端页面、本地 Node/Express 后端，以及与 Jetson 摄像头服务、Jetson Bridge 的对接逻辑。

## 功能概览

- 双路摄像头监控
- 小车与云台网页控制
- 立即喂食、自动追踪开关
- 本地录像到 Mac，并自动转为 MP4
- YOLO 猫行为识别历史报告
- 中英文界面切换
- Jetson 关机入口

## 技术栈

前端：

- React 19
- TypeScript
- Vite 6
- Tailwind CSS 4
- lucide-react
- motion
- recharts

后端：

- Node.js
- Express
- TypeScript
- tsx
- ws

## 目录结构

```text
.
├── src/
├── server/
├── scripts/
├── data/
├── docs/
├── .env.example
├── package.json
└── vite.config.ts
```

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
npm run dev:server
npm run lint
```

## 环境变量

```env
VITE_BACKEND_ORIGIN="http://127.0.0.1:3001"

JETSON_CAMERA_BASE_URL="http://192.168.31.209:5000"
JETSON_CAMERA_2_BASE_URL="http://192.168.31.209:5001"
JETSON_BRIDGE_BASE_URL="http://192.168.31.209:8000"

GEMINI_API_KEY=""
```

## 系统链路

```text
React Frontend
    ->
Mac Local Express Backend
    ->
Jetson Camera Service (:5000 / :5001)
Jetson Bridge (:8000)
    ->
Car / Gimbal / Feed / YOLO Events
```

## 主要后端接口

- `GET /api/device/status`
- `GET /api/monitor/sidebar`
- `GET /api/dashboard/summary`
- `GET /api/jetson/status`
- `GET /api/video/live`
- `GET /api/video/live-secondary`
- `POST /api/control/feed`
- `POST /api/control/car/:action`
- `POST /api/control/gimbal/:action`
- `POST /api/behavior/detection`
- `GET /api/reports/dates`
- `GET /api/reports/:date`

## YOLO 行为类别

1. `eating`
2. `playing`
3. `rest`
4. `sitting`
5. `stretching`
6. `yawning`

同一 `class` 默认 1 小时内只记录一次，避免重复刷日志。

## 备注

- 这个目录已去掉 `.env.local`、`node_modules`、`dist`、录像文件等本地产物
- 更完整的联调总结见 `docs/project-and-jetson-integration-summary-2026-06-24.md`

