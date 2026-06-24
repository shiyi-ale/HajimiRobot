<div align="right">

[English](./README.md) | [中文](./README.zh-CN.md)

</div>

# HajimiRobot Web Console

HajimiRobot Web Console is a local web control console for the pet robot system, including the React frontend, local Node/Express backend, and integration with Jetson camera services and Jetson Bridge.

## Features

- Dual-camera monitoring
- Web control for car and gimbal
- Feed-now and auto-tracking controls
- Local recording to Mac with MP4 conversion
- YOLO cat behavior history reports
- Chinese and English UI switching
- Jetson shutdown action

## Tech Stack

Frontend:

- React 19
- TypeScript
- Vite 6
- Tailwind CSS 4
- lucide-react
- motion
- recharts

Backend:

- Node.js
- Express
- TypeScript
- tsx
- ws

## Directory Layout

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

## Run Locally

```bash
npm install
cp .env.example .env.local
npm run dev
npm run dev:server
npm run lint
```

## Environment Variables

```env
VITE_BACKEND_ORIGIN="http://127.0.0.1:3001"

JETSON_CAMERA_BASE_URL="http://192.168.31.209:5000"
JETSON_CAMERA_2_BASE_URL="http://192.168.31.209:5001"
JETSON_BRIDGE_BASE_URL="http://192.168.31.209:8000"

GEMINI_API_KEY=""
```

## System Flow

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

## Main Backend APIs

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

## YOLO Behavior Classes

1. `eating`
2. `playing`
3. `rest`
4. `sitting`
5. `stretching`
6. `yawning`

The same class is logged at most once per hour to avoid duplicate timeline entries.

## Notes

- This directory excludes `.env.local`, `node_modules`, `dist`, recordings, and other local machine artifacts
- See `docs/project-and-jetson-integration-summary-2026-06-24.md` for a more detailed integration summary

