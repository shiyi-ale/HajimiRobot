# Hajimi 当前 systemd 服务整理

本文整理当前 `/home/zhj/Hajimi` 目录下实际用于运行的 3 个 `systemd` 服务，分别是：

- `hajimi-bridge.service`
- `hajimi-camera.service`
- `hajimi-camera-2.service`

它们共同组成了当前 Jetson 设备侧的最小可用运行架构：

- 两路本地摄像头服务负责采集和输出视频流
- 一个桥接服务负责把底盘控制、云台控制、健康状态和视频入口统一暴露成 HTTP API

## 1. 当前服务清单

仓库中的服务单元文件位于：

- `deploy/systemd/hajimi-bridge.service`
- `deploy/systemd/hajimi-camera.service`
- `deploy/systemd/hajimi-camera-2.service`

当前机器上已启用的用户级服务也是这 3 个，没有额外的第 4 个 Hajimi 相关服务。

## 2. 整体架构关系

当前运行关系可以概括为：

```text
hajimi-camera.service
  -> camera_http_stream.py
  -> USB 摄像头 1
  -> HTTP MJPEG 视频流
  -> 端口 5000

hajimi-camera-2.service
  -> camera_http_stream.py
  -> USB 摄像头 2
  -> HTTP MJPEG 视频流
  -> 端口 5001

hajimi-bridge.service
  -> jetson_bridge.py
  -> FastAPI + Uvicorn
  -> 小车控制 / 云台控制 / 状态接口 / 视频代理入口
  -> 端口 8000
  -> 默认依赖 camera.service
```

其中：

- 第一摄像头服务是当前桥接服务默认接入的视频源
- 第二摄像头服务目前是独立的视频端点，没有被 `jetson_bridge.py` 默认代理
- `hajimi-bridge.service` 通过环境变量 `CAMERA_BASE_URL=http://127.0.0.1:5000` 指向第一路相机

## 3. 各服务的职责与功能

## 3.1 hajimi-bridge.service

### 作用

`hajimi-bridge.service` 是 Jetson 侧的统一控制桥。它把设备控制能力和视频访问入口封装成一个对前端或上层系统更友好的 HTTP API。

### 启动方式

服务通过下面的命令启动：

```bash
/usr/bin/python3 -m uvicorn jetson_bridge:app --host 0.0.0.0 --port 8000
```

也就是说，它本质上是一个基于 `FastAPI` 的 Web 服务，由 `Uvicorn` 作为 ASGI 服务器运行。

### 主要功能

1. 统一暴露设备健康状态

- `GET /healthz`
- `GET /api/status`

2. 提供底盘控制接口

- `POST /api/car/{action}`
- 支持 `forward`、`backward`、`left`、`right`、`stop`
- 还包含 `feed` 能力，用于触发投喂动作

3. 提供小车重连接口

- `POST /api/car/reconnect`

4. 提供云台控制接口

- `POST /api/gimbal/{action}`
- `POST /api/gimbal/move`

支持上、下、左、右、归中，以及全幅转动等动作。

5. 提供视频访问入口

- `GET /video`
- `GET /api/video/live`
- `GET /api/video/config`
- `GET /api/video/healthz`

这里的视频并不是桥接服务自己采集和编码，而是把相机服务作为下游视频源来使用。

6. 提供设备关机接口

- `POST /api/system/shutdown?confirm=true`

它会先调度停止相关用户态服务，再执行系统关机。

### 技术选型

这个服务主要用了下面几类技术：

- `FastAPI`
- `Uvicorn`
- `Pydantic`
- `CORSMiddleware`
- Python 标准库 `urllib`
- `systemd-run`
- 本地硬件驱动模块 `car_driver.py`、`gimbal_driver.py`

### 当初为什么这样做

1. 需要一个“统一出口”

如果前端分别直连小车控制、云台控制、摄像头地址和本地脚本，系统会变得分散且难维护。桥接服务把这些能力统一成一个 HTTP API，更适合作为设备侧接入层。

2. 需要快速集成，而不是先做重型后端

当前项目阶段更强调“先让 Jetson 侧稳定可控”。`FastAPI` 在 Python 环境里开发速度快、接口清晰，适合快速把硬件控制和状态信息暴露出来。

3. 需要与视频服务解耦

桥接服务本身不负责视频采集和编码，这样视频链路出问题时，不会直接把控制服务一起拖垮。控制链路和视频链路拆开，是当前阶段一个很务实的工程决策。

4. 需要兼顾浏览器和局域网访问

服务中配置了：

- `CAMERA_BASE_URL=http://127.0.0.1:5000`
- `CAMERA_PUBLIC_BASE_URL=http://192.168.31.209:5000`

这说明设计上已经考虑了“Jetson 本地访问地址”和“局域网对外访问地址”分离的问题，便于前端或其他设备接入。

## 3.2 hajimi-camera.service

### 作用

`hajimi-camera.service` 是第一路摄像头的视频输出服务。它负责从固定的 USB 摄像头设备路径采集画面，并通过 HTTP 方式输出 MJPEG 实时流。

### 启动方式

服务执行：

```bash
/usr/bin/python3 /home/zhj/Hajimi/camera_http_stream.py
```

并通过环境变量指定采集参数：

```text
CAMERA_PORT=5000
CAMERA_DEVICE=/dev/v4l/by-id/usb-HD_Camera_Manufacturer_USB_2.0_Camera-video-index0
CAMERA_WIDTH=640
CAMERA_HEIGHT=480
CAMERA_FPS=25
CAMERA_JPEG_QUALITY=30
```

### 主要功能

1. 打开固定的 UVC 摄像头设备

服务没有使用不稳定的 `/dev/video0`，而是使用 `/dev/v4l/by-id/...`。这样做可以避免设备枚举顺序变化后，程序连错摄像头。

2. 输出实时 MJPEG 视频流

主要接口是：

- `GET /`
- `GET /video`
- `GET /video/config`
- `GET /healthz`

其中：

- `/video` 返回 `multipart/x-mixed-replace` 格式的 MJPEG 流
- `/healthz` 返回相机状态、是否打开、最后错误、活跃连接数等信息
- `/video/config` 返回分辨率、帧率、质量和设备信息

3. 维护一个“最新帧”模型

代码中不是为每个客户端单独采集一条视频链路，而是后台有一个采集线程持续读取摄像头、编码 JPEG，然后把“最新一帧”分发给多个客户端。

4. 自动恢复

它包含：

- 读帧失败重试
- 连续失败阈值判断
- 摄像头重新打开
- 浏览器断开连接后的优雅处理

这些能力是当前版本稳定性的关键。

### 技术选型

这个服务主要用了：

- `OpenCV`
- `V4L2` 摄像头采集
- Python 标准库 `http.server`
- `ThreadingMixIn`
- `multipart/x-mixed-replace` MJPEG 输出
- 环境变量配置

### 当初为什么这样做

1. 先追求稳定输出，再追求低延迟和高级协议

仓库中的 `jetson-mjpeg-video-output-design.md` 已经明确记录：当前 Jetson 环境下，`WebRTC` 和更复杂的媒体链路在依赖、兼容性和调试成本上风险太高，因此当前阶段优先采用 `MJPEG + HTTP`。

2. MJPEG 调试简单

MJPEG 可以直接被浏览器访问，也能很容易被上层服务代理和排查。对于嵌入式 bring-up 阶段，这比复杂的音视频栈更适合快速定位问题。

3. OpenCV 在当前 Jetson 环境中更现实

相较于直接引入完整的 GStreamer/WebRTC 栈，`OpenCV + VideoCapture + JPEG 编码` 的实现路径更短，也更容易在现有 Python 环境中跑通。

4. 使用固定设备路径是为了抗环境漂移

USB 摄像头在嵌入式设备上很容易因为插拔顺序变化而导致 `/dev/video0`、`/dev/video1` 对应关系变化，所以这里选择了 `/dev/v4l/by-id/...` 这种稳定路径。

## 3.3 hajimi-camera-2.service

### 作用

`hajimi-camera-2.service` 是第二路摄像头服务。它和第一路相机使用同一份 `camera_http_stream.py` 代码，但通过不同的环境变量实例化为另一条独立视频流。

### 启动参数差异

第二路相机当前的关键配置是：

```text
CAMERA_PORT=5001
CAMERA_DEVICE=/dev/v4l/by-id/usb-058f_HBVCAM_CAMERA-video-index0
CAMERA_WIDTH=640
CAMERA_HEIGHT=480
CAMERA_FPS=25
CAMERA_JPEG_QUALITY=30
```

因此它和第一路相机的主要区别是：

- 监听端口不同
- 绑定的物理摄像头设备不同

### 当前角色判断

从当前代码关系来看，第二路相机并没有被 `jetson_bridge.py` 默认代理。也就是说：

- 第一相机是当前系统主视频入口
- 第二相机更像是额外视角、调试视角或后续扩展预留

如果后续需要，可以继续在桥接服务中增加：

- 第二路视频代理接口
- 相机切换接口
- 双路预览能力

### 为什么用“同一程序 + 两个 service”

这是一个很合理的嵌入式部署方式：

1. 复用同一套代码，减少维护成本
2. 通过环境变量实例化不同设备，部署简单
3. 每路相机独立进程运行，互不影响
4. 某一路故障时，不会直接拖垮另一条视频链路

## 4. 当前技术路线总结

从这 3 个服务可以看出，当前 Jetson 侧采用的是一条非常明确的工程路线：

### 4.1 控制与视频分离

- `hajimi-bridge.service` 负责控制和 API 聚合
- 两个 `hajimi-camera*.service` 负责视频采集和输出

这样做的优点是职责清晰、故障隔离更好，也方便后续分别升级。

### 4.2 视频采用 MJPEG over HTTP

当前没有直接上 `WebRTC` 或 `HLS`，原因不是这些技术不好，而是当前项目阶段更需要：

- 易部署
- 易调试
- 易恢复
- 在 Jetson 现有环境里稳定工作

这属于典型的“先可用，再优化”的技术决策。

### 4.3 服务进程由 systemd 托管

3 个服务都使用了：

- `Restart=always`
- `RestartSec=3`

这说明设计目标很明确：即使运行过程中因为摄像头异常、设备连接问题或临时错误退出，也希望服务自动拉起，减少人工干预。

### 4.4 通过环境变量做部署配置

端口、分辨率、帧率、质量、设备路径都通过环境变量传入，而不是写死在脚本里。这样后续迁移设备、调整参数或增加实例都更容易。

## 5. 对项目技术文档可直接使用的描述

如果要把这部分写进你们项目文档，可以直接采用下面这段概述：

> 当前 Hajimi Jetson 设备侧采用 `systemd + Python 服务化` 的运行方式。系统包含 1 个桥接控制服务和 2 个摄像头视频服务。桥接服务基于 `FastAPI + Uvicorn` 实现，负责统一暴露底盘控制、云台控制、设备状态和视频访问入口；摄像头服务基于 `OpenCV + V4L2 + HTTP MJPEG` 实现，分别负责两路 USB 摄像头的视频采集、JPEG 编码和局域网实时输出。该方案优先保证 Jetson 环境下的稳定性、可调试性和快速集成能力，避免在项目早期引入 `WebRTC` 等更复杂但维护成本更高的媒体栈。

## 6. 后续文档建议

如果你们接下来要把这部分扩写成正式技术文档，建议继续补下面几项：

1. 每个 API 的请求和响应示例
2. 两路摄像头的物理安装位置和用途说明
3. 小车驱动和云台驱动对应的硬件连接方式
4. systemd 的安装、启停和开机自启命令
5. Jetson 开机后的完整服务启动顺序图

## 7. 常用运维命令

启动：

```bash
systemctl --user start hajimi-bridge.service hajimi-camera.service hajimi-camera-2.service
```

停止：

```bash
systemctl --user stop hajimi-bridge.service hajimi-camera.service hajimi-camera-2.service
```

查看状态：

```bash
systemctl --user status hajimi-bridge.service hajimi-camera.service hajimi-camera-2.service
```
