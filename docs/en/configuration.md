[Docs](README.md) · [简体中文](../zh/configuration.md)

# Configuration

Root .env.local configures FastAPI; Web-Console/.env.local configures Express/Vite. Commit blank templates only. Saved DeepSeek settings take precedence, then compatible LLM environment variables, then DeepSeek variables. UI saves apply immediately; environment changes need restart.

| Variable | Default / purpose |
|---|---|
| REPORT_TIMEZONE | Asia/Shanghai |
| DEEPSEEK_API_KEY / DEEPSEEK_MODEL | Empty / deepseek-flash; test actual model availability |
| EMBEDDING_BACKEND | local or api |
| LOCAL_EMBEDDING_MODEL | BAAI/bge-small-zh-v1.5 |
| LOCAL_EMBEDDING_THREADS | 2 CPU threads |
| LOCAL_EMBEDDING_OFFLINE | 0 initially, optionally 1 once cached |
| MEMORY_MIN_COVERAGE | 0.5 |
| QDRANT_URL | Empty for embedded persistence; URL for a server |
| HAJIMI_DATA_DIR | .runtime/intelligence under the project |
| HAJIMI_API_TOKEN | Optional; match across services |

Remote embeddings need EMBEDDING_BASE_URL, EMBEDDING_MODEL and EMBEDDING_API_KEY with POST /embeddings. Compatible chat uses LLM_BASE_URL, LLM_MODEL and LLM_API_KEY.

Camera source_kind distinguishes camera/local-video. Defaults are cuda:0, 320-pixel input and supported FP16; CPU is explicit. ROI is normalized. review_gap_sec defaults to ten seconds and review_max_sec to 3600. OpenAPI lists fields; revision synchronizes edge settings.

Windows key storage uses DPAPI. Other systems use file permissions only. Never use VITE_ secrets. DeepSeek remains a cloud call; local vector storage does not mean offline report generation.
