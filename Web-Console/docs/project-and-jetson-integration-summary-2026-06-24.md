# Hajime Robot 项目整理与 Jetson 对接总结

更新时间：2026-06-24  
适用目录：`/Users/luxferre/Downloads/hajime-robot (1)`

## 1. 文档目的

这份文档用于整理本轮开发和联调过程中涉及的内容，覆盖：

- 项目前端与后端的整体结构
- 与 Jetson 摄像头服务、Jetson Bridge 的对接方式
- 已完成的功能改造
- 关键接口与环境变量
- 开发过程中的问题与结论
- 当前项目状态与后续可继续推进的方向

这不是逐字聊天记录，而是对本次完整对话和实际改动的工程化整理。

---

## 2. 项目整体定位

这个项目本质上是一个本地运行的机器人监控与控制台，链路如下：

`React 前端 -> Mac 本地 Express 后端 -> Jetson 摄像头服务 / Jetson Bridge -> 小车 / 云台 / YOLO 行为识别数据`

其中：

- 前端负责展示监控视频、控制面板、报告与设置
- 本地后端负责代理视频流、转发控制命令、聚合状态、录制视频、输出报告
- Jetson 摄像头服务负责 MJPEG 视频输出
- Jetson Bridge 负责云台、小车、系统控制等硬件能力暴露

---

## 3. 技术栈

### 3.1 前端

- `React 19`
- `TypeScript`
- `Vite 6`
- `Tailwind CSS 4`
- `lucide-react`
- `motion`
- `recharts`

主要页面：

- `Dashboard`
- `Monitor`
- `Control`
- `Reports`
- `Settings`

主要文件：

- [src/App.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/App.tsx:1)
- [src/main.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/main.tsx:1)
- [src/components/Monitor.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/Monitor.tsx:1)
- [src/components/Control.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/Control.tsx:1)
- [src/components/Dashboard.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/Dashboard.tsx:1)
- [src/components/Reports.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/Reports.tsx:1)
- [src/components/Settings.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/Settings.tsx:1)

### 3.2 后端

- `Node.js`
- `Express`
- `TypeScript`
- `tsx`
- `WebSocketServer`

主要文件：

- [server/index.ts](/Users/luxferre/Downloads/hajime-robot%20(1)/server/index.ts:1)

后端承担的工作：

- 代理 Jetson 视频流
- 转发云台 / 小车控制指令
- 提供 Jetson 状态聚合接口
- 提供本地视频录制与回放列表
- 提供 YOLO 行为历史报告接口
- 向前端推送状态与检测结果

### 3.3 关键源码入口

前端主要入口与数据层：

- [src/main.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/main.tsx:1)
- [src/lib/api.ts](/Users/luxferre/Downloads/hajime-robot%20(1)/src/lib/api.ts:1)
- [src/lib/socket.ts](/Users/luxferre/Downloads/hajime-robot%20(1)/src/lib/socket.ts:1)
- [src/lib/i18n.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/lib/i18n.tsx:1)

后端主要入口与实现点：

- [server/index.ts](/Users/luxferre/Downloads/hajime-robot%20(1)/server/index.ts:1)
- [scripts/convert_mjpeg_to_mp4.py](/Users/luxferre/Downloads/hajime-robot%20(1)/scripts/convert_mjpeg_to_mp4.py:1)
- [data/behavior-history.json](/Users/luxferre/Downloads/hajime-robot%20(1)/data/behavior-history.json:1)

---

## 3.4 系统架构与数据流

### 3.4.1 页面与后端的调用关系

`Dashboard`

- 拉取 `GET /api/device/status`
- 拉取 `GET /api/dashboard/summary`
- 订阅 `/ws/frontend`

`Monitor`

- 拉取 `GET /api/device/status`
- 拉取 `GET /api/monitor/sidebar`
- 拉取 `GET /api/video/config`
- 拉取 `GET /api/video/secondary-status`
- 加载 `/api/video/live`
- 加载 `/api/video/live-secondary`
- 调用 `/api/recording/*`
- 调用 `/api/control/feed`
- 订阅 `/ws/frontend`

`Control`

- 调用 `/api/control/feed`
- 调用 `/api/control/tracking`
- 调用 `/api/control/car/:action`
- 调用 `/api/control/gimbal/:action`

`Reports`

- 拉取 `GET /api/reports/dates`
- 拉取 `GET /api/reports/:date`

`Settings`

- 调用 `POST /api/system/shutdown`
- 切换本地语言设置

### 3.4.2 本地后端和 Jetson 的调用关系

本地后端实际同时与 Jetson 两类服务通信：

1. 摄像头服务

- `JETSON_CAMERA_BASE_URL`
- `JETSON_CAMERA_2_BASE_URL`

2. Bridge 服务

- `JETSON_BRIDGE_BASE_URL`

职责分工：

- 视频流、视频健康状态、视频配置优先走摄像头服务
- 小车、云台、关机、Bridge 状态走 Jetson Bridge

### 3.4.3 WebSocket 数据流

后端创建了一个 `WebSocketServer`，前端通过 `/ws/frontend` 建立连接。

前端当前消费的消息类型包括：

- `status`
- `monitor.sidebar`
- `detection`
- `alert`
- `command_ack`

其中：

- `status` 用于首页和监控页在线状态更新
- `monitor.sidebar` 用于监控页当前行为、近期事件等侧栏信息
- `detection` 用于监控页检测框叠加

---

---

## 4. 启动方式

在项目根目录执行。

安装依赖：

```bash
npm install
```

启动前端：

```bash
npm run dev
```

默认地址：

```text
http://localhost:3000
```

启动后端：

```bash
npm run dev:server
```

默认地址：

```text
http://127.0.0.1:3001
```

类型检查：

```bash
npm run lint
```

---

## 5. 环境变量与地址

当前关键环境变量在 [.env.local](/Users/luxferre/Downloads/hajime-robot%20(1)/.env.local:1)。

当前整理后的地址为：

```env
VITE_BACKEND_ORIGIN="http://127.0.0.1:3001"

JETSON_CAMERA_BASE_URL="http://10.184.20.30:5000"
JETSON_BRIDGE_BASE_URL="http://10.184.20.30:8000"
JETSON_CAMERA_2_BASE_URL="http://10.184.20.30:5001"

GEMINI_API_KEY=""
```

说明：

- `5000`：第一路摄像头服务
- `5001`：第二路摄像头服务
- `8000`：Jetson Bridge

后端默认回退地址也已同步改为 `10.184.20.30`，避免环境变量缺失时退回旧地址。

### 5.1 `.env` 加载机制

后端启动时会显式加载：

1. `.env.local`
2. `.env`

如果 `.env.local` 中未配置对应变量，后端会使用 `server/index.ts` 中的默认回退值。

这个行为很重要，因为之前曾出现：

```json
"jetsonBridgeBaseUrl": null
```

根因就是后端当时没有正确加载 `.env.local`。

---

## 6. 前端改造内容

### 6.1 控制页改造

控制页已从原始展示态改造成实际联控页面。

已完成：

- 接入小车控制
- 接入云台控制
- 接入立即喂食
- 接入自动追踪切换
- 移除“语音呼唤”
- 移除“自动回充”
- 新增可编辑的喂食计划 UI

相关文件：

- [src/components/Control.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/Control.tsx:1)
- [src/components/DriveControls.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/DriveControls.tsx:1)

小车控制最终交互逻辑：

- 方向键点一次发送一次指令
- 不再持续长按发送
- 中间 `STOP` 为急停

云台控制逻辑：

- 长按持续微调
- 中间 `MID` / `CENTER` 回中

### 6.2 监控页改造

监控页已完成：

- 主路摄像头显示
- 第二路摄像头显示
- 单路放大，占满整行，另一条挤到下一行
- 联控面板接入
- 监控页直接喂食按钮
- 本地录像开关
- 录像列表展示
- 内嵌视频播放
- 当前行为状态
- 近期行为事件
- 流配置展示

相关文件：

- [src/components/Monitor.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/Monitor.tsx:1)

### 6.3 首页 Dashboard

已展示：

- 设备在线状态
- 电量
- 剩余粮量
- 今日活动概览
- 行为时间轴
- 建议摘要

相关文件：

- [src/components/Dashboard.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/Dashboard.tsx:1)

### 6.4 报告页

报告页已经与 YOLO 行为历史数据对接。

当前方向：

- 报告页已改为 YOLO class 驱动的数据展示
- 顶部展示 `YOLO26 Format`、`6 Behavior Classes`
- 展示同类行为每隔 1 小时记录一次的规则
- 时间轴事件目前已改为英文 class 风格

相关文件：

- [src/components/Reports.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/Reports.tsx:1)

### 6.5 设置页

设置页已将“语音设置”替换为“语言设置”，并接通整站中英切换。

已完成：

- 设置页语言切换开关
- 导航栏文案切换
- 首页 / 控制 / 监控 / 报告 / 设置文案切换
- 本地保存语言到 `localStorage`

相关文件：

- [src/lib/i18n.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/lib/i18n.tsx:1)
- [src/components/Settings.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/Settings.tsx:1)

注意：

- 某些来自后端的动态文本如果后端直接返回中文，前端切英文后仍会显示中文
- 已开始把报告页这类动态内容改成英文输出

### 6.6 国际化实现方式

当前中英切换并没有引入完整 i18n 框架，而是使用轻量自定义实现：

- `LanguageProvider` 提供全局上下文
- 语言值类型为 `zh | en`
- 本地持久化到 `localStorage`
- 同时更新 `document.documentElement.lang`

优点：

- 接入轻量
- 不引入额外依赖
- 适合当前项目体量

限制：

- 对后端返回的动态文案没有天然覆盖能力
- 需要后端也支持 `lang` 参数，才能做到动态内容完整双语

---

## 6.7 前端组件实现细节

### `DriveControls`

当前控制组件被复用到：

- 控制页
- 监控页

交互实现细节：

- 小车方向键：点按一次，发送一次方向指令
- 急停按钮：调用 `stop`
- 云台方向键：`pointerdown` 后开始高频发送
- 云台释放：通过 `pointerup` / `pointercancel` / `blur` 停止循环

这保证了：

- 小车不会因为长按导致失控
- 云台可以实现细腻微调

### `Monitor`

监控页的主要技术点：

- `img` 直接拉 MJPEG 流
- `canvas` 叠加 YOLO 检测框
- 双路视频布局支持切换单路放大
- 录制卡片、喂食卡片、近期行为、流配置全部集中在同一页面

### `Reports`

报告页当前不是静态假数据页面，而是：

- 先请求可选日期
- 再按日期请求单日报告
- 根据后端返回的 `headline`、`timeline`、`suggestions` 直接渲染

这意味着报告页最终语种与内容是否统一，很大程度取决于后端 `buildDailyReport()` 的输出。

---

## 7. 后端改造内容

### 7.1 Jetson Bridge 控制转发

新增或完善了以下控制接口：

- `POST /api/control/car/:action`
- `POST /api/control/gimbal/:action`
- `POST /api/control/feed`
- `POST /api/control/tracking`
- `GET /api/jetson/status`
- `POST /api/system/shutdown`

关键转发关系：

- `/api/control/car/forward -> /api/car/forward`
- `/api/control/car/stop -> /api/car/stop`
- `/api/control/car/feed -> /api/car/feed`
- `/api/control/gimbal/up -> /api/gimbal/up`
- `/api/control/gimbal/center -> /api/gimbal/center`
- `/api/system/shutdown -> /api/system/shutdown?confirm=true`

### 7.2 视频代理

已支持：

- `GET /api/video/live` 代理主路视频
- `GET /api/video/live-secondary` 代理第二路视频
- `GET /api/video/config`
- `GET /api/video/secondary-status`

技术实现细节：

- 主路和第二路视频都采用 MJPEG 透传代理
- 代理方法在后端统一处理上游响应头与字节流
- 当前没有转码成 HLS 或 WebRTC，而是保持最简单的浏览器 `img` 兼容方案
- 这样实现成本低，但带来的代价是带宽和浏览器资源占用相对较高

### 7.3 录像能力

已实现本地录制到 Mac：

- `GET /api/recording/status`
- `POST /api/recording/start`
- `POST /api/recording/stop`
- `GET /api/recordings`

保存路径：

```text
/Users/luxferre/Downloads/hajime-robot (1)/recordings/
```

录像流程：

1. 后端拉取主路 MJPEG 流
2. 先保存为 `.mjpeg`
3. 停止录制后调用 Python 脚本转成 `.mp4`
4. 前端优先展示可播放的 `mp4`

实现细节：

- 录像保存目录启动时会自动创建
- 录制时后端直接对上游 MJPEG 响应体做字节写入
- 录制停止后，后端调用项目内 Python 环境执行转码脚本
- Python 解释器路径固定为：
  `.codex-temp-venv/bin/python`

当前后端关键变量包括：

- `recordingsDir`
- `localPythonPath`
- `conversionScriptPath`

这意味着：

- 录像功能依赖项目目录结构
- 如果未来迁移部署环境，需要同步迁移 Python 环境或改写转码方式

转换脚本：

- [scripts/convert_mjpeg_to_mp4.py](/Users/luxferre/Downloads/hajime-robot%20(1)/scripts/convert_mjpeg_to_mp4.py:1)

### 7.4 YOLO 行为记录与报告

已实现：

- `POST /api/behavior/detection`
- `GET /api/reports/dates`
- `GET /api/reports/:date`

数据存储：

- [data/behavior-history.json](/Users/luxferre/Downloads/hajime-robot%20(1)/data/behavior-history.json:1)

已知 YOLO 类别：

1. `eating`
2. `playing`
3. `rest`
4. `sitting`
5. `stretching`
6. `yawning`

行为记录规则：

- 相同 `class` 默认 1 小时内只记录一次
- 用于减少重复行为日志

实现细节：

- 冷却时间在后端通过 `behaviorLogCooldownMs = 60 * 60 * 1000` 控制
- 后端以 `iso` 时间戳为准做同类行为节流
- 如果 1 小时内再次上报同一类行为，后端会返回：
  - `recorded: false`
  - `reason: cooldown`
  - `nextAllowedAt`

这意味着：

- 模型可以高频持续推送检测结果
- 后端负责把时间轴收敛成较易读的历史记录

### 7.5 近期行为事件

后端已接入最近事件日志，用于监控页的“近期行为事件”。

当前能记录的事件包括：

- 视频流在线 / 离线
- Jetson 健康检查通过 / 失败
- 发送喂食命令
- 开始录制 / 停止录制
- MP4 转码
- 关机命令

技术上，这套“近期行为事件”和 YOLO 历史报告是两条独立数据链路：

1. 近期行为事件

- 偏系统状态和操作日志
- 用于监控页最近动态

2. YOLO 历史报告

- 偏模型识别结果归档
- 用于报告页长期行为回顾

---

## 7.6 后端核心路由清单

当前后端主要路由如下。

状态与摘要：

- `GET /api/health`
- `GET /api/device/status`
- `GET /api/monitor/sidebar`
- `GET /api/dashboard/summary`
- `GET /api/jetson/status`

视频：

- `GET /api/video/live`
- `GET /api/video/live-secondary`
- `GET /api/video/config`
- `GET /api/video/secondary-status`

录像：

- `GET /api/recording/status`
- `POST /api/recording/start`
- `POST /api/recording/stop`
- `GET /api/recordings`
- `GET /recordings/*` 静态文件访问

行为与报告：

- `POST /api/behavior/detection`
- `GET /api/reports/dates`
- `GET /api/reports/:date`

控制：

- `POST /api/control/move`
- `POST /api/control/feed`
- `POST /api/control/tracking`
- `POST /api/control/audio/play`
- `POST /api/control/car/:action`
- `POST /api/control/gimbal/:action`
- `POST /api/system/shutdown`

说明：

- 一部分旧接口如 `/api/control/move` 仍保留，是为了兼容早期结构
- 当前真实控制主路径已转向 `/api/control/car/*` 与 `/api/control/gimbal/*`

---

## 8. Jetson 对接部分

### 8.1 Jetson 摄像头服务

当前已确认双路摄像头服务都可运行：

- 第一路：`http://<jetson-ip>:5000/video`
- 第二路：`http://<jetson-ip>:5001/video`

第二路服务参数已对齐第一路：

- `640x480`
- `25fps`
- `quality=30`

### 8.2 Jetson Bridge

Jetson Bridge 当前通过用户级 systemd 运行。

已确认服务名：

```text
hajimi-bridge.service
```

查看命令：

```bash
systemctl --user status hajimi-bridge.service
systemctl --user cat hajimi-bridge.service
journalctl --user -u hajimi-bridge.service -n 100 --no-pager
```

进一步查看运行参数：

```bash
systemctl --user show hajimi-bridge.service -p ExecStart -p WorkingDirectory -p Environment
```

如果要定位 bridge 配置来源，还需要查看：

- `~/Hajimi/jetson_bridge.py`
- `~/.config/systemd/user/hajimi-bridge.service`

这两个文件共同决定：

- Bridge 暴露哪些路由
- Bridge 启动时绑定哪个目录和参数
- Bridge 如何连接小车与云台

### 8.3 已确认的 Bridge 能力

已打通或确认存在：

- `/healthz`
- `/api/status`
- `/api/gimbal/center`
- `/api/gimbal/up?step=30`
- `/api/car/feed`
- `/api/system/shutdown?confirm=true`

其中已经确认的行为包括：

- `gimbal` 路由请求到达后，云台的 `pan_us` / `tilt_us` 会变化
- `car/feed` 可以直接下发喂食字符
- Bridge 返回的 `/healthz` 与 `/api/status` 能反映：
  - `car_connected`
  - `gimbal_ready`
  - `last_error`
  - `car_command_mode`

### 8.4 当前 Jetson 网络情况

Jetson IP 曾经历变更：

- 早期：`192.168.31.209`
- 后续更新为：`10.184.20.30`

项目内相关配置已同步为 `10.184.20.30`。

### 8.5 Mac 作为 Jetson 代理

曾处理 Jetson 走 Mac 代理的问题。

Mac 当前局域网地址在当时检查为：

```text
10.184.20.117
```

代理软件配置截图确认：

- HTTP 端口：`7890`
- Socks 端口：`7891`
- 已开启“允许局域网”

Jetson 上正确的使用方式：

HTTP 代理：

```bash
export http_proxy="http://10.184.20.117:7890"
export https_proxy="http://10.184.20.117:7890"
```

SOCKS5 代理：

```bash
export all_proxy="socks5://10.184.20.117:7891"
```

注意：

- `7890` 是 HTTP 代理端口
- `7891` 是 SOCKS 端口
- 不能把 `7891` 当 HTTP 代理使用，否则会出现 `Proxy CONNECT aborted`

补充说明：

- Mac 代理软件虽然开启了“允许局域网”，但 Jetson 是否真正能用，还取决于：
  - Mac 防火墙
  - 代理软件监听地址
  - Jetson 与 Mac 是否处于同一网段并可直接互通

因此排查时建议同时测试：

```bash
curl -x http://10.184.20.117:7890 https://www.google.com
curl --socks5 10.184.20.117:7891 https://www.google.com
```

---

## 9. 开发过程中出现的重要问题与结论

### 9.1 Mac 访问 Jetson 要绕过代理

曾发现：

```bash
curl http://192.168.31.209:8000/healthz
```

无响应，但：

```bash
curl --noproxy '*' http://192.168.31.209:8000/healthz
```

正常。

结论：

- Mac 的代理设置会干扰局域网 Jetson 访问
- 测试 Jetson 地址时应优先用 `--noproxy '*'`

### 9.2 `JETSON_BRIDGE_BASE_URL: null`

曾出现后端日志中：

```json
"jetsonBridgeBaseUrl": null
```

原因：

- 后端一开始未加载 `.env.local`

已修复：

- [server/index.ts](/Users/luxferre/Downloads/hajime-robot%20(1)/server/index.ts:1) 已接入 `dotenv`

### 9.3 喂食 404

“立即喂食”曾出现 `Request failed: 404`。

原因：

- 前端调用 `/api/control/feed`
- 后端原先未正确转发到可用的 bridge 路由

已修复：

- 改为转发到 Jetson Bridge 的 `/api/car/feed`

### 9.4 MJPEG 无法直接网页播放

录像初期保存的是 `.mjpeg` 原始流文件，浏览器不适合作为成品录像直接播放。

已处理：

- 停止录制后自动转成 `.mp4`
- 监控页仅展示可播放视频

### 9.5 `ffmpeg` 缺失

最初尝试使用系统 `ffmpeg` 转码，但本机未安装。

后续调整为：

- 使用 Python 脚本转码
- 不依赖全局 `ffmpeg` 安装

### 9.6 Jetson Bridge 500 错误

出现过：

```json
{"detail":"[Errno 112] Host is down"}
```

以及：

```json
{"detail":"[Errno 107] Transport endpoint is not connected"}
```

结论：

- 这些并不一定代表 Mac 到 Jetson 不通
- 更可能是 `Jetson Bridge -> 小车` 这条设备链路断开
- 常见表现是：
  - `car_connected: false`
  - `gimbal_ready: true`

也就是说：

- `Mac -> Jetson Bridge` 可能是正常的
- `Jetson Bridge -> 小车控制端` 可能断线

典型区分方法：

1. 如果 `curl http://10.184.20.30:8000/healthz` 可访问

- 说明 `Mac -> Jetson Bridge` 是通的

2. 如果返回：

```json
"car_connected": false
```

同时：

```json
"gimbal_ready": true
```

- 说明大概率是小车链路断开，而不是 Bridge 服务整体不可用

3. 如果 `last_error` 为：

- `[Errno 112] Host is down`
- `[Errno 107] Transport endpoint is not connected`

则优先排查：

- Jetson 到小车的蓝牙 / 串口连接
- 小车控制进程或底层设备状态
- Bridge 代码内部连接对象是否已断开

### 9.7 Codex CLI 在 Jetson 终端卡住

用户在 Jetson 上直接运行：

```bash
codex
```

出现看起来“卡住”的现象。

可能原因：

- 进入交互式 TUI，但当前终端不兼容
- 交互界面未正常渲染

建议改用：

```bash
codex --version
codex --help
codex --no-alt-screen
codex exec "hello"
```

---

## 10. 当前 API / 页面联动关系

### 10.1 控制相关

- 控制页喂食：`POST /api/control/feed`
- 控制页追踪：`POST /api/control/tracking`
- 小车：`POST /api/control/car/:action`
- 云台：`POST /api/control/gimbal/:action`

### 10.2 监控相关

- 主路视频：`GET /api/video/live`
- 第二路视频：`GET /api/video/live-secondary`
- 第二路状态：`GET /api/video/secondary-status`
- 录像开始：`POST /api/recording/start`
- 录像停止：`POST /api/recording/stop`
- 录像列表：`GET /api/recordings`

### 10.3 报告相关

- 行为上报：`POST /api/behavior/detection`
- 报告日期：`GET /api/reports/dates`
- 单日报告：`GET /api/reports/:date`

### 10.4 设置相关

- Jetson 关机：`POST /api/system/shutdown?confirm=true`

---

## 10.5 关键数据模型

### `DeviceStatus`

前端消费的设备状态大致包含：

- `battery`
- `foodLevel`
- `isOnline`
- `lastCommunication`
- `streamConnected`
- `cameraDevice`
- `trackingEnabled`

### `MonitorSidebarData`

主要包含：

- `currentBehavior`
- `deviceQuickStatus`
- `recentEvents`

### `DailyReport`

主要包含：

- `date`
- `headline`
- `summary`
- `timeline`
- `suggestions`
- `detectedClasses`

### `DetectionPayload`

用于监控页叠框：

- `frameSize`
- `boxes[]`

每个框包含：

- `label`
- `score`
- `x`
- `y`
- `width`
- `height`

---

## 10.6 文件与目录职责

`src/`

- 前端页面与交互逻辑

`server/`

- 本地后端入口、接口与代理逻辑

`recordings/`

- 录像输出目录

`data/`

- 行为历史持久化数据

`scripts/`

- MJPEG 转 MP4 脚本

`.codex-temp-venv/`

- 转码脚本依赖的本地 Python 环境

---

## 11. 当前已知状态

截至本次整理时：

- 前后端本地开发链路已可运行
- 双路摄像头前端展示已接入
- 小车 / 云台控制前端按钮已接后端
- 喂食接口已改为走 bridge 可用路由
- 本地录像与 mp4 展示已接入
- 报告页已开始切到 YOLO class 驱动
- 中英双语切换已接通整站基础文案

但也有一些事项仍需注意：

- 某些后端动态内容仍可能与当前前端语言不完全一致
- 小车链路仍可能受 Jetson 蓝牙 / 串口连接状态影响
- Jetson IP 变更后需要同步检查服务侧监听与路由
- 监控页“近期行为事件”是否要完全统一成 class 英文日志，还有继续收口空间

---

## 12. 建议的后续工作

建议后续继续推进以下方向：

1. 让报告接口支持 `lang=zh|en`
2. 让监控页“近期行为事件”统一为 `class` 风格日志
3. 将喂食计划从前端临时状态接入后端持久化
4. 为 Jetson 小车连接状态补充更清晰的 UI 反馈
5. 为录像增加删除、下载、批量管理能力
6. 对第二路摄像头增加更明确的设备名和健康提示

---

## 13. 快速排查命令汇总

### 本地后端

```bash
cd "/Users/luxferre/Downloads/hajime-robot (1)"
npm run dev:server
```

### 前端

```bash
cd "/Users/luxferre/Downloads/hajime-robot (1)"
npm run dev
```

### Jetson Bridge 状态

```bash
curl --noproxy '*' http://10.184.20.30:8000/healthz
curl --noproxy '*' http://127.0.0.1:3001/api/jetson/status
```

### 用户级 bridge 服务

```bash
systemctl --user status hajimi-bridge.service
journalctl --user -u hajimi-bridge.service -n 100 --no-pager
```

### 摄像头服务

```bash
systemctl list-unit-files --type=service | grep -Ei "camera|cam|video|mjpeg|hajimi"
systemctl list-units --type=service --all | grep -Ei "camera|cam|video|mjpeg|hajimi"
```

### 录像目录

```bash
ls -la "/Users/luxferre/Downloads/hajime-robot (1)/recordings"
```

---

## 14. 本文档涉及的关键文件

- [server/index.ts](/Users/luxferre/Downloads/hajime-robot%20(1)/server/index.ts:1)
- [src/lib/i18n.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/lib/i18n.tsx:1)
- [src/components/DriveControls.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/DriveControls.tsx:1)
- [src/components/Control.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/Control.tsx:1)
- [src/components/Monitor.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/Monitor.tsx:1)
- [src/components/Dashboard.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/Dashboard.tsx:1)
- [src/components/Reports.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/Reports.tsx:1)
- [src/components/Settings.tsx](/Users/luxferre/Downloads/hajime-robot%20(1)/src/components/Settings.tsx:1)
- [data/behavior-history.json](/Users/luxferre/Downloads/hajime-robot%20(1)/data/behavior-history.json:1)
- [scripts/convert_mjpeg_to_mp4.py](/Users/luxferre/Downloads/hajime-robot%20(1)/scripts/convert_mjpeg_to_mp4.py:1)
