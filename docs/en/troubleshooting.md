[Docs](README.md) · [简体中文](../zh/troubleshooting.md)

# Troubleshooting

| Symptom | Action |
|---|---|
| Occupied port / stale manifest | Stop then start; do not kill unrelated applications |
| API unavailable | Run health.ps1; inspect intelligence.err.log and backend.err.log under .runtime |
| CUDA unavailable | Check driver and CUDA PyTorch; explicitly choose CPU |
| Incompatible classes | Use six-class weights, not a generic COCO cat detector |
| No activity on a day | Check timezone, processing date, source and camera |
| Detection without video | Check file status, retention and FFmpeg errors |
| Statistical mode only | Check model settings and service notes; validation can also trigger fallback |
| Semantic degradation | Check cache/offline settings or remote embeddings; one process owns local Qdrant |
| Insufficient evidence | Need 50% current coverage and three eligible historical days |
| Reviewed status reset | New evidence changed the revision; expected behavior |

Remove keys, authorization headers, stream credentials, usernames and personal paths before sharing logs. Never attach entire databases to issues.
