[Docs](README.md) · [简体中文](../zh/validation.md)

# Validation and limitations

Run `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` for Python tests, TypeScript, frontend build and a synthetic motion benchmark. Tests cover deduplication, late/empty frames, overlap/day boundaries, review grouping/gaps, recording cleanup, memory upserts, evidence validation, provider failures and history filtering. Test adapters do not prove model accuracy.

The local chain has exercised dedicated CUDA weights, 512-dimensional CPU embeddings, persistent Qdrant retrieval and DeepSeek reporting. Eight synthetic days validate statistics, not real-pet findings. Browser checks cover both languages, narrow screens, playback, reporting and export.

The review update preserved 89,118 raw frames and underlying statistics. Four sitting fragments became one group; 63 synthetic fragments became 21. These snapshots are not universal performance guarantees.

## Pre-publication measurements (2026-10-18)

- Initialized a fresh directory from staged sources using a separate Python 3.12 environment, without copying existing keys, databases or weights.
- Passed 42 Python tests, two frontend state tests, TypeScript checks and the production build.
- Started all three services without a key and checked health through the unified entry point. Resending two frames yielded zero accepted / two duplicates. Statistical reporting completed and history source filtering worked.
- Browser checks covered both languages, a 390px viewport without page overflow, drawer dismissal, history, Markdown / JSON downloads and evidence-to-recording navigation.
- A 60-second synthetic motion fixture scheduled 285 fixed-frequency versus 132 dynamic inference requests (53.68% fewer). Motion processing latency: median 1.039ms, P95 1.833ms. These are synthetic scheduling measurements, not GPU speedup, recall or power results.
- The production build still warns that its main JavaScript bundle exceeds 500kB; route splitting remains a future optimization.

Pending: Jetson TensorRT hardware performance/power/accuracy and public-deployment security/load testing. Not implemented: multi-pet identity, cross-camera aggregation, seamless cross-file playback or raw-data archival. Trends are not medical diagnoses. Runtime outputs are not published.
