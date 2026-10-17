[Docs](README.md) · [简体中文](../zh/api.md)

# API and protocol

Interactive docs: http://127.0.0.1:8001/docs . Published [OpenAPI](../openapi.json). Product 2.0.1 retains detection protocol 1.0 and /api/v1.

| Method/path, omitting /api/v1 | Purpose |
|---|---|
| POST /detections/batch | Up to 200 frames, including empty inference |
| POST /edge/heartbeat | Device/stream/inference/scheduling status |
| GET /cameras/{id}/config | Revisioned settings |
| GET /review/timeline | Review and coverage for day/camera_id/source |
| PUT /review/{id}/status | reviewed boolean and revision; stale versions return 409 |
| GET /clips | Optional day includes crossing recordings |
| POST /agent/reports | question/date/camera_id/source; 202 and job_id |
| GET /agent/jobs/{id} | queued/running/completed/failed and result |
| GET /agent/reports | camera_id/source/date/before_id/limit |
| GET /agent/reports/{id} | Full report |
| POST /memory/consolidate | Consolidate an ended date |

Report limit defaults to 20, range 1–100. before_id uses the previous page’s last ID. Responses contain reports and next_cursor; metadata includes camera, source, date, mode, summary and creation time.

Frames carry version, device/camera/session/frame identity, UTC time, dimensions, model identity and normalized xyxy boxes. Classes are eating/playing/rest/sitting/stretching/yawning, mapped by name; track_id is optional. observation_sec describes an explicitly valid zero-to-five-second interval, not the spacing between sparse samples.

Report empty boxes too. Identity deduplication supports ordering changes and retries without overlapping duration inflation. Legacy input establishes no duration. See the [JSONL example](../detection-example.jsonl).
