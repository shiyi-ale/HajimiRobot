[Docs](README.md) · [English](../en/quickstart.md)

# 快速开始

Windows 10/11、Python 3.12、Node.js 22。首次安装需要网络；GPU模式需要兼容的NVIDIA驱动。启动脚本目前只验证Windows，无需Jetson。

```powershell
git clone https://github.com/shiyi-ale/HajimiRobot.git
cd HajimiRobot
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
powershell -ExecutionPolicy Bypass -File scripts/start.ps1
```

打开 http://127.0.0.1:3000 。`scripts/health.ps1` 检查健康，`scripts/stop.ps1` 停止托管进程。Vite/Express/FastAPI分别监听本机3000/3001/8001，FFmpeg由imageio-ffmpeg提供。

无显卡用 `setup.ps1 -CpuOnly`；仅界面、协议和运动录像可用 `setup.ps1 -SkipYolo`，不安装PyTorch。GPU模式不自动回退CPU。

1. 活动页→摄像头设置，提供自己的视频、六类权重，保存并开始观察。仓库不分发这些素材。
2. 选择处理日期、本地视频来源，点击活动回看。硬件离线时控制禁用。
3. 报告页选择同日期/摄像头/来源并生成。无Key提供统计报告；可在分析设置保存自己的DeepSeek Key。
4. 本地中文Embedding首次使用下载模型，缓存后可设置 `LOCAL_EMBEDDING_OFFLINE=1` 并重启。Qdrant不需要Docker。

案例导入：`.venv/Scripts/python.exe services/intelligence/seed_cases.py --end-date 2026-10-17 --ingest`。选择合成案例来源与该日期。8天数据可幂等重放，不生成伪造录像，不代表真实识别。建议在隔离数据目录实验。
