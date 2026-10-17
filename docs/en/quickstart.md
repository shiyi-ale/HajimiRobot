[Docs](README.md) · [简体中文](../zh/quickstart.md)

# Quick start

Use Windows 10/11, Python 3.12 and Node.js 22. Initial installation needs internet; GPU mode needs a compatible NVIDIA driver. Startup scripts are validated on Windows only. Jetson is optional.

```powershell
git clone https://github.com/shiyi-ale/HajimiRobot.git
cd HajimiRobot
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
powershell -ExecutionPolicy Bypass -File scripts/start.ps1
```

Open http://127.0.0.1:3000 . Run `scripts/health.ps1` for health and `scripts/stop.ps1` to stop managed processes. Vite/Express/FastAPI bind to loopback ports 3000/3001/8001. FFmpeg comes from imageio-ffmpeg.

Use `setup.ps1 -CpuOnly` without an accelerator, or `setup.ps1 -SkipYolo` for UI, protocol and motion recording without PyTorch. GPU mode never silently falls back to CPU.

1. Activity → Camera settings: supply your own video and six-class weights, save, and observe. These assets are not shipped.
2. Choose the processing date and local-video source; select an activity to play it. Hardware controls remain disabled while disconnected.
3. Reports: choose the same context and generate. Without a key, statistical mode works. Save your own DeepSeek key in Analysis settings if desired.
4. Local embeddings download a Chinese model on first use. Once cached, set `LOCAL_EMBEDDING_OFFLINE=1` and restart. Qdrant needs no Docker.

Import examples with `.venv/Scripts/python.exe services/intelligence/seed_cases.py --end-date 2026-10-17 --ingest`. Choose Synthetic cases and that date. Eight simulated days support idempotent replay but create no fake video and prove no accuracy. Prefer an isolated data directory.
