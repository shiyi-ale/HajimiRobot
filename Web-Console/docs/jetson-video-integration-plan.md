# 哈基米 Robot 软件对接与视频流集成方案

## 1. 文档目的

本方案基于 [哈基米 Robot.pdf](/Users/luxferre/Downloads/hajime-robot%20%281%29/%E5%93%88%E5%9F%BA%E7%B1%B3%20Robot.pdf) 的整体框架，对当前前端项目与 Jetson Nano 设备侧的真实视频流、行为事件、控制命令、状态数据做一版更贴合项目计划书的落地设计。

这份文档的目标不是单独讨论“视频怎么接”，而是把它放回你们 PDF 已经定义好的三层软件架构里：

1. 嵌入式软件端
2. 服务器后端
3. 用户应用前端

同时结合当前仓库现状：

- 当前仓库是 `React + Vite` 前端原型，不是 PDF 里写的 Vue 实现
- 页面结构已经基本对应 PDF 中的首页、监控、控制、报告、设置
- `Monitor` 页面已有视频区和 `canvas` 叠框结构，适合接真实流和检测框

因此本方案保持 PDF 的系统分层思路不变，但把前端实现落到当前 React 项目上。

## 2. 与 PDF 对齐后的总体架构

根据 PDF 第六章，软件系统应该遵循三层架构：

1. 用户应用前端：负责展示、交互、远程控制、报告查看、告警通知
2. 服务器后端：负责决策中枢、设备接入、数据持久化、API、视频转发
3. 嵌入式软件端：负责感知、理解、执行，并通过标准协议上报能力

结合当前项目阶段，推荐的实际部署如下：

```text
React Frontend
  -> HTTP API / WebSocket
  -> Backend Gateway + MCP Server
  -> WebSocket / MCP
  -> Jetson Nano Edge Client
  -> STM32 / Camera / Sensors / Feeder / Motion
```

对应职责如下：

### 2.1 用户应用前端

部署位置：

- Mac 浏览器
- 手机浏览器
- 未来可扩展为移动端 WebView

核心职责：

- 展示首页状态大屏
- 播放实时监控视频
- 叠加检测框、追踪状态、行为状态
- 发起远程控制命令
- 配置喂食计划、告警阈值、区域标定
- 查看历史报告与告警

### 2.2 服务器后端

部署位置：

- 本地局域网服务器
- 或云端轻量服务器

核心职责：

- 作为 Jetson 设备的统一接入层
- 提供前端 HTTP API
- 提供前端 WebSocket 推送
- 作为 MCP 服务端管理边缘设备
- 聚合行为事件、喂食记录、状态历史
- 生成日报、告警、摘要
- 统一视频出口，避免前端直接耦合 Jetson IP

### 2.3 嵌入式软件端

部署位置：

- Jetson Nano 4G

核心职责：

- 摄像头采集与编码
- 猫目标检测与跟踪
- 行为事件判定
- 音频事件识别
- 机器人运动控制
- 投喂执行
- 与 STM32 通信
- 通过 MCP 客户端上报资源、事件和控制能力

## 3. 设计原则

结合 PDF 的目标与当前工程现实，本方案采用以下原则：

- 视频流和控制链路分离
- 高频实时任务尽量在 Jetson 本地闭环
- 前端不直接依赖 Jetson 私有实现细节
- 后端是“统一出口”，不是纯转发脚本
- 结构化行为事件优先于自由文本输出
- 当前阶段先跑通，后续再升级 WebRTC

## 4. 当前阶段推荐技术路线

PDF 对实时监控页的描述是：

- 视频播放器支持 `HLS` 与 `WebRTC` 自适应降级
- 右侧信息面板显示当前行为状态、最近五条事件、电量粮量快捷状态
- 支持截图、短视频录制、全屏

但结合你现在的实际环境，我建议分阶段实现：

### 第一阶段

- Jetson 输出 `MJPEG/HTTP`
- 后端代理成前端统一接口
- 检测框和状态走 `WebSocket`
- 控制命令走 `HTTP POST`

### 第二阶段

- 后端把视频升级到 `HLS`
- 前端监控页支持 `video` 播放器
- 补录制、截图和回看

### 第三阶段

- 视频进一步升级到 `WebRTC`
- 用于低延迟远程控制和实时交互

所以这里要特别说明：

- PDF 的最终目标是 `HLS / WebRTC`
- 当前最可落地的实现起点是 `MJPEG + WebSocket + HTTP API`
- 接口层必须先设计成可兼容未来 `HLS / WebRTC`

## 5. 三层系统模块设计

## 5.1 嵌入式软件端设计

Jetson 端建议拆成下面 6 个核心模块，这也更贴合 PDF 第 6.2 节的描述。

### A. Camera Stream Module

职责：

- 打开 UVC 摄像头
- 读取 `/dev/v4l/by-id/...` 稳定设备路径
- 输出视频帧
- 提供截图接口

推荐当前阶段输出：

- `MJPEG`

未来可升级输出：

- `H.264`
- `HLS`
- `WebRTC`

推荐 Jetson 配置：

```env
CAMERA_DEVICE=/dev/v4l/by-id/usb-HD_Camera_Manufacturer_USB_2.0_Camera-video-index0
CAMERA_HOST=0.0.0.0
CAMERA_PORT=5000
CAMERA_WIDTH=640
CAMERA_HEIGHT=480
CAMERA_FPS=20
JPEG_QUALITY=80
```

### B. Vision Tracking Module

职责：

- 猫目标检测
- 猫目标跟踪
- 输出边界框和置信度
- 需要时驱动云台或电子裁剪保持目标在画面中

输出结果不直接面向前端，而是输出结构化检测结果给行为模块和 MCP 客户端。

建议输出格式：

```json
{
  "frameSize": { "width": 640, "height": 480 },
  "boxes": [
    {
      "id": "cat-1",
      "label": "cat",
      "score": 0.98,
      "x": 150,
      "y": 100,
      "width": 120,
      "height": 150
    }
  ]
}
```

### C. Behavior Event Module

职责：

- 结合区域信息、检测结果、音频结果、设备动作标记
- 输出结构化行为事件

这部分应当遵循 PDF 第 7 章的轻量化思路，不做逐帧自由文本生成，而是输出事件 JSON。

推荐字段：

```json
{
  "eventId": "evt_001",
  "type": "feeding",
  "displayName": "猫咪正在进食",
  "startAt": "2026-04-15T08:30:00+08:00",
  "durationSec": 135,
  "zone": "food_area",
  "relatedFeeding": true,
  "confidence": 0.93
}
```

### D. Audio Event Module

职责：

- 猫叫、连续叫声、异常叫声分类
- 作为异常判断增强信号

这个模块当前可以先只预留接口，不必第一阶段全部做完。

### E. Hardware Control Module

职责：

- 底盘运动控制
- 投喂电机控制
- 语音播放控制
- 急停、回充、灯光提示
- 通过串口 / 蓝牙 / 自定义协议与 STM32 通信

### F. MCP Client Module

职责：

- 向后端注册设备
- 暴露设备资源与工具能力
- 上报事件、状态与告警
- 接收后端转发的控制命令

这里建议按照 PDF 的思路，把 Jetson 看成一个 MCP Client。

## 5.2 服务器后端设计

这层是现在最值得尽快设计的部分，因为它能把 PDF 的“系统中枢”落地出来。

后端建议拆成 4 个模块。

### A. MCP Server Module

职责：

- 管理 Jetson 设备连接
- 维护设备连接池
- 心跳检测
- 设备影子缓存
- 转发 Agent / 前端触发的控制指令

这个模块主要对接 Jetson，不直接给前端用。

### B. Pet Care Agent Module

职责：

- 基于设备状态、行为事件、历史记录、用户配置做规则决策
- 触发喂食、告警、报告生成、音频播放等动作

当前阶段可以先实现为“规则引擎”，不必一开始就引入复杂 Agent 调度。

### C. Web API + WebSocket Module

职责：

- 给前端提供统一接口
- 统一转发视频流
- 推送实时状态、行为事件、告警消息

这层是当前 React 项目真正要对接的接口层。

### D. Data Persistence Module

职责：

- 保存用户信息
- 保存设备信息
- 保存喂食计划和喂食记录
- 保存行为事件
- 保存日报
- 保存状态快照

第一阶段为了简化，可以先用 SQLite。

## 5.3 用户应用前端设计

你们 PDF 里前端是：

- 数据大屏页面
- 实时监控页面
- 远程控制页面
- 历史报告页面
- 设置页面

当前 React 项目正好已经有对应页面：

- `Dashboard`
- `Monitor`
- `Control`
- `Reports`
- `Settings`

所以前端不需要推翻重来，关键是把假数据逐步替换成真实接口。

## 6. 面向当前 React 项目的页面映射

## 6.1 Dashboard 页面

对应文件：

- [src/components/Dashboard.tsx](/Users/luxferre/Downloads/hajime-robot%20%281%29/src/components/Dashboard.tsx:1)

需要承载的真实数据：

- 电量
- 粮量
- 在线状态
- 最后通信时间
- 今日活动时长
- 今日进食次数
- 今日饮水次数
- 行为时间轴
- 今日报告摘要

推荐数据来源：

- 首屏：`GET /api/dashboard/summary`
- 实时变更：`WS /ws/frontend`

## 6.2 Monitor 页面

对应文件：

- [src/components/Monitor.tsx](/Users/luxferre/Downloads/hajime-robot%20%281%29/src/components/Monitor.tsx:1)

这是视频集成的核心页面。

需要承载的真实能力：

- 实时视频播放
- 猫检测框叠加
- 当前行为状态
- 最近五条行为事件
- 当前设备电量与粮量快捷状态
- 截图
- 短视频录制
- 全屏

建议第一阶段实现：

- 视频区使用 `<img src="/api/video/live" />`
- 检测框通过 `WS /ws/frontend` 推送
- 右侧信息区先吃状态接口和事件列表接口

建议后续升级：

- 由 `MJPEG` 迁移到 `HLS`
- 再迁移到 `WebRTC`

## 6.3 Control 页面

对应文件：

- [src/components/Control.tsx](/Users/luxferre/Downloads/hajime-robot%20%281%29/src/components/Control.tsx:1)

需要承载的真实能力：

- 手动移动控制
- 手动喂食
- 追踪开关
- 回充指令
- 音频播放
- 喂食计划新增、编辑、删除

推荐数据流：

- 操作发起：HTTP `POST`
- 执行结果：`WS /ws/frontend` 异步回传

## 6.4 Reports 页面

对应文件：

- [src/components/Reports.tsx](/Users/luxferre/Downloads/hajime-robot%20%281%29/src/components/Reports.tsx:1)

需要承载的真实能力：

- 日期列表
- 每日报告详情
- 活动摘要
- 行为时间轴
- Agent 养护建议
- PDF 导出

推荐数据来源：

- `GET /api/reports/dates`
- `GET /api/reports/{date}`

## 6.5 Settings 页面

对应文件：

- [src/components/Settings.tsx](/Users/luxferre/Downloads/hajime-robot%20%281%29/src/components/Settings.tsx:1)

需要承载的真实能力：

- 设备命名
- 区域标定
- 告警阈值
- 默认喂食份量
- 音频配置

推荐数据来源：

- `GET /api/settings`
- `PUT /api/settings`

## 7. 推荐接口设计

这里分成两层：

1. Jetson -> 后端
2. 前端 -> 后端

这样更符合 PDF 里“边缘端 + 服务器后端 + 前端”的关系。

## 7.1 Jetson 到后端接口

建议 Jetson 不直接暴露给前端，而是统一对接后端。

### 7.1.1 Jetson 注册与心跳

#### `WS /mcp/connect`

用途：

- Jetson 建立长连接
- 注册设备能力
- 保持心跳

Jetson 注册消息示例：

```json
{
  "type": "device.register",
  "deviceId": "hajime-01",
  "deviceType": "jetson-nano",
  "protocol": "mcp",
  "capabilities": {
    "video": true,
    "tracking": true,
    "feeding": true,
    "motion": true,
    "audioPlayback": true,
    "battery": true,
    "foodLevel": true
  }
}
```

#### `type = "device.heartbeat"`

消息示例：

```json
{
  "type": "device.heartbeat",
  "deviceId": "hajime-01",
  "ts": "2026-04-15T09:00:00+08:00"
}
```

### 7.1.2 Jetson 上报状态

#### `type = "device.status"`

```json
{
  "type": "device.status",
  "deviceId": "hajime-01",
  "data": {
    "online": true,
    "battery": 82,
    "foodLevel": 38,
    "trackingEnabled": true,
    "lastSeenAt": "2026-04-15T09:00:01+08:00"
  }
}
```

### 7.1.3 Jetson 上报检测结果

#### `type = "vision.detection"`

```json
{
  "type": "vision.detection",
  "deviceId": "hajime-01",
  "data": {
    "frameSize": { "width": 640, "height": 480 },
    "boxes": [
      {
        "id": "cat-1",
        "label": "cat",
        "score": 0.98,
        "x": 150,
        "y": 100,
        "width": 120,
        "height": 150
      }
    ]
  }
}
```

### 7.1.4 Jetson 上报行为事件

#### `type = "behavior.event"`

```json
{
  "type": "behavior.event",
  "deviceId": "hajime-01",
  "data": {
    "eventId": "evt_001",
    "eventType": "feeding",
    "displayName": "猫咪正在进食",
    "zone": "food_area",
    "startAt": "2026-04-15T08:58:00+08:00",
    "durationSec": 135,
    "confidence": 0.93
  }
}
```

### 7.1.5 Jetson 上报告警

#### `type = "device.alert"`

```json
{
  "type": "device.alert",
  "deviceId": "hajime-01",
  "data": {
    "level": "warning",
    "code": "LOW_FOOD",
    "message": "粮仓余量低于阈值"
  }
}
```

## 7.2 前端到后端接口

前端全部只连后端，不直接访问 Jetson。

### 7.2.1 首页与状态接口

#### `GET /api/dashboard/summary`

返回示例：

```json
{
  "device": {
    "deviceId": "hajime-01",
    "online": true,
    "battery": 82,
    "foodLevel": 38,
    "lastCommunication": "2026-04-15T09:00:00+08:00"
  },
  "todaySummary": {
    "activityDuration": "4.2h",
    "feedingCount": 4,
    "totalFood": 65,
    "waterCount": 6
  },
  "latestReport": {
    "date": "2026-04-15",
    "summary": "今日活动量正常，进食规律，饮水量充足。"
  },
  "timeline": [
    {
      "time": "08:58",
      "event": "猫咪开始进食",
      "type": "feeding"
    }
  ]
}
```

### 7.2.2 实时监控接口

#### `GET /api/video/live`

当前阶段：

- 后端代理 Jetson 的 `MJPEG` 流

返回类型：

- `multipart/x-mixed-replace`

前端接入方式：

```tsx
<img src="/api/video/live" alt="Live stream" />
```

#### `GET /api/video/snapshot`

用途：

- 返回一张当前截图

#### `GET /api/monitor/sidebar`

用途：

- 获取监控页右侧信息

返回示例：

```json
{
  "currentBehavior": {
    "label": "feeding",
    "displayName": "猫咪正在进食",
    "durationSec": 135
  },
  "deviceQuickStatus": {
    "battery": 82,
    "foodLevel": 38,
    "online": true
  },
  "recentEvents": [
    { "time": "08:58", "event": "进入食盆区", "type": "feeding" },
    { "time": "08:57", "event": "从沙发区移动至食盆区", "type": "activity" }
  ]
}
```

### 7.2.3 控制接口

#### `POST /api/control/move`

```json
{
  "direction": "up",
  "speed": 0.5,
  "durationMs": 300
}
```

`direction` 可选值：

- `up`
- `down`
- `left`
- `right`
- `stop`
- `dock`

#### `POST /api/control/feed`

```json
{
  "amountGrams": 10
}
```

#### `POST /api/control/tracking`

```json
{
  "enabled": true
}
```

#### `POST /api/control/audio/play`

```json
{
  "clipId": "call-cat-01",
  "volume": 0.8
}
```

### 7.2.4 喂食计划接口

#### `GET /api/feed-plans`

#### `POST /api/feed-plans`

```json
{
  "time": "18:00",
  "amountGrams": 20,
  "enabled": true
}
```

#### `PUT /api/feed-plans/{id}`

#### `DELETE /api/feed-plans/{id}`

### 7.2.5 报告接口

#### `GET /api/reports/dates`

返回示例：

```json
{
  "dates": ["2026-04-15", "2026-04-14", "2026-04-13"]
}
```

#### `GET /api/reports/{date}`

返回示例：

```json
{
  "date": "2026-04-15",
  "weather": "晴 22°C / 适宜活动",
  "summary": {
    "activityDuration": "4.2h",
    "feedingCount": 4,
    "anomalies": 0
  },
  "timeline": [
    {
      "time": "08:58",
      "event": "猫咪开始进食",
      "desc": "停留在食盆区并完成进食。",
      "type": "feeding"
    }
  ],
  "suggestions": [
    "今日活动量正常，建议维持当前互动频率。"
  ]
}
```

### 7.2.6 设置接口

#### `GET /api/settings`

#### `PUT /api/settings`

请求体建议包含：

```json
{
  "deviceName": "Hajime-01",
  "defaultFeedAmount": 10,
  "zones": [
    { "id": "sofa_area", "name": "沙发区", "polygon": [[10, 10], [100, 10], [100, 80], [10, 80]] }
  ],
  "alertThresholds": {
    "batteryLow": 20,
    "foodLow": 15,
    "catCryEnabled": true
  }
}
```

### 7.2.7 前端实时推送接口

#### `WS /ws/frontend`

用途：

- 推送设备状态
- 推送检测框
- 推送行为事件
- 推送控制执行结果
- 推送告警

推荐消息类型：

- `status`
- `detection`
- `behavior`
- `alert`
- `command_ack`

示例：

```json
{
  "type": "command_ack",
  "ts": "2026-04-15T09:10:00+08:00",
  "data": {
    "commandId": "cmd_feed_001",
    "ok": true,
    "message": "投喂成功"
  }
}
```

## 8. Jetson 端具体怎么设置

这是当前最需要写清楚的部分，我按“最小可运行方案”写。

## 8.1 摄像头设备路径

你当前已经确认稳定路径为：

```bash
/dev/v4l/by-id/usb-HD_Camera_Manufacturer_USB_2.0_Camera-video-index0
```

Jetson 代码里统一使用这个路径，不再直接写 `/dev/video0`。

## 8.2 Jetson 服务目录建议

```text
/home/zhj/hajime-services/
  camera_stream_service.py
  edge_gateway.py
  robot_runtime/
  .env
```

## 8.3 Jetson 当前阶段服务职责

### `camera_stream_service.py`

职责：

- 读取 UVC 摄像头
- 输出 `/video` 和 `/snapshot`

建议监听：

```text
http://0.0.0.0:5000
```

建议接口：

- `GET /health`
- `GET /video`
- `GET /snapshot`

### `edge_gateway.py`

职责：

- 与后端保持 WebSocket / MCP 长连接
- 周期性上报状态
- 上报检测框和行为事件
- 接收控制命令并调用本地运行时

建议配置：

```env
DEVICE_ID=hajime-01
BACKEND_WS_URL=ws://<backend-host>:8000/mcp/connect
CAMERA_BASE_URL=http://127.0.0.1:5000
```

## 8.4 Jetson 与后端的对接方式

推荐流程：

1. Jetson 启动 `camera_stream_service.py`
2. Jetson 启动 `edge_gateway.py`
3. `edge_gateway.py` 连接后端 `WS /mcp/connect`
4. Jetson 向后端注册设备能力
5. Jetson 周期性上报状态和事件
6. 后端向前端暴露统一接口
7. 前端只消费后端接口

## 9. 当前仓库需要增加什么

为了让当前 React 原型贴近 PDF 的软件架构，建议补以下文件：

```text
server/index.ts
server/routes/video.ts
server/routes/dashboard.ts
server/routes/control.ts
server/routes/reports.ts
server/routes/settings.ts
server/ws/frontend.ts
server/mcp/device-registry.ts
server/mcp/device-client.ts
src/lib/api.ts
src/lib/socket.ts
```

职责建议：

- `server/index.ts`: 后端入口
- `server/routes/video.ts`: 视频代理与截图接口
- `server/routes/dashboard.ts`: 首页聚合接口
- `server/routes/control.ts`: 控制接口
- `server/routes/reports.ts`: 报告接口
- `server/routes/settings.ts`: 设置接口
- `server/ws/frontend.ts`: 前端 WebSocket 推送
- `server/mcp/device-registry.ts`: Jetson 设备注册和设备影子
- `server/mcp/device-client.ts`: 与 Jetson/MCP 连接逻辑
- `src/lib/api.ts`: 前端请求封装
- `src/lib/socket.ts`: 前端实时连接封装

## 10. 是否现在就需要设计后端

需要，而且这件事在你们 PDF 框架里是合理且必要的。

原因不是“项目复杂”，而是：

- PDF 本身就把系统定义成三层，不是前端直连设备
- 前端页面已经不只是看视频，还包括状态、喂食、报告、设置、告警
- 视频协议未来要从 `MJPEG` 升级到 `HLS / WebRTC`
- 如果没有后端，前端会直接耦合 Jetson IP、协议、状态格式和设备实现

但这里的“后端”不等于一开始就要做很重的系统。

当前阶段的后端最小职责应该是：

- 统一前端接口
- 维护设备连接
- 转发控制命令
- 聚合状态和行为事件
- 代理视频流

第一阶段完全可以先不做：

- 用户系统
- 复杂数据库设计
- 多设备权限管理
- 重型 Agent 编排

## 11. 第一阶段最推荐的落地顺序

1. Jetson 上稳定运行摄像头流服务
2. Jetson 上稳定输出检测框和状态 JSON
3. 当前仓库新增轻量后端
4. `Monitor` 页接 `/api/video/live`
5. `Monitor` 页接 `/ws/frontend` 画检测框
6. `Dashboard` 页接真实状态
7. `Control` 页接真实命令
8. `Reports` 页先接假数据接口，后续再接真实数据库

## 12. 结论

如果严格按照 PDF 的项目框架来设计，这个项目不应该是“前端直接连 Jetson 摄像头”的单层结构，而应该是：

- Jetson 负责感知、理解、执行
- 后端负责设备接入、决策中枢、数据汇总与统一出口
- 前端负责展示与交互

视频流只是其中一个模块，必须和行为事件、设备状态、远程控制、报告能力一起设计。

因此当前最合适的实现路径是：

- 架构上遵循 PDF 的三层设计
- 工程上先用 `MJPEG + WebSocket + HTTP API`
- 接口层为未来 `HLS / WebRTC` 预留升级空间

这条路线既贴合你们项目计划书，也符合你现在这套 React 原型和 Jetson Nano 的实际情况。
