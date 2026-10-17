[Docs](README.md) · [简体中文](../zh/security.md)

# Keys and data protection

Services bind to loopback, without public-deployment security guarantees. Keys are saved server-side through the local API. Windows uses DPAPI; public configuration returns presence only. Other platforms use file permissions. Closing settings discards unsaved input. Task restoration stores IDs/context, never keys.

Reports send selected questions, statistics, bounded events and memories to the configured cloud model, not raw video or weights. Embeddings default to local CPU; api mode sends text to its provider. Local Qdrant does not make the whole pipeline offline.

Ignore real .env.local, agent-settings.json, SQLite/Qdrant, caches, logs, reports, weights and video. Scan staged blobs and outgoing commits for credentials, private keys, authorization values, exact local keys and personal paths. Findings never echo values. Screenshots must not expose sensitive configuration.

Revoke and replace exposed keys before evaluating history cleanup. Do not publish credentials, databases or vulnerability details in issues. No dedicated security email is configured; use GitHub private reporting if available or contact the maintainer privately.
