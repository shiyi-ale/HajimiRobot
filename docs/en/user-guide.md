[Docs](README.md) · [简体中文](../zh/user-guide.md)

# User guide

## Activity
Choose camera, date and source. Start/stop, player, activities and timeline stay visible. Source/model/ROI settings live in a drawer; diagnostics are collapsed.

Cards seek linked video. Colored lanes retain raw evidence while cards represent review groups. Defaults are a ten-second merge gap and one-hour maximum span. Confirmed outages and device-session changes split groups. Span is not behavior duration. Minute zoom reveals short detections; arrow keys move ten seconds. Playback or manual marking persists reviewed status; new evidence invalidates it.

The video lane represents playable files. Observation coverage distinguishes targets, empty inference, skipped inference, errors, confirmed outages, unknown gaps and future time. Missing video does not establish pet absence.

## Reports
Choose context, then request a summary, seven-day comparison or custom question. Only actual queued/running states are shown; navigation and refresh in the same tab can restore jobs. Read summaries and findings before limitations and evidence.

Green bars show daily observed shares; sand bars show average shares across eligible historical days. Eating episodes differ from feeding commands. The evidence drawer links source IDs, events and video to Activity. Export Markdown or JSON.

History is paginated by camera/source; opening a report restores its real context. Interface language does not automatically translate stored model prose.

Statistical mode means no model was called or validation triggered fallback. Semantic degradation still permits SQLite evidence. Insufficient coverage does not produce fabricated trends. Synthetic cases are not real-pet findings; reports are not medical diagnoses.
