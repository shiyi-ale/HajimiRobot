# Changelog / 更新记录

## 2.0.1

### Added / 新增

- Motion-aware ROI/MOG2 scheduling, explicit GPU inference and bounded latest-frame work.
- Review groups, observation gaps, versioned reviewed status and linked MP4 playback.
- SQLite episodic evidence, persistent local Qdrant, CPU Chinese embeddings and LangGraph/DeepSeek reporting.
- Warm responsive Activity/Reports interfaces, Chinese/English copy, evidence navigation, task restoration, Markdown/JSON exports and filtered report history.
- Paired Chinese/English architecture, operation, configuration, API and troubleshooting documentation.
- Staged-blob privacy checks and synchronized version metadata.

### Compatibility / 兼容性

- Detection protocol 1.0 and /api/v1 remain compatible.
- Database additions are additive; back up runtime data before upgrading.
- Weights, video, credentials and runtime stores are not included.

### Limitations / 边界

- Jetson TensorRT performance and power require hardware validation.
- Multi-pet identity, seamless cross-file playback and public-deployment guarantees are not provided.
- Synthetic examples and statistical trends are not accuracy evaluations or medical diagnoses.
