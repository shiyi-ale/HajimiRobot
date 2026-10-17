[Docs](README.md) · [English](../en/configuration.md)

# 配置参考

根目录.env.local属于FastAPI，Web-Console/.env.local属于Express/Vite。只有空模板可提交。页面保存的DeepSeek配置优先，其次兼容LLM环境变量，再其次DEEPSEEK环境变量。页面保存即时生效，环境改动需重启。

| 变量 | 默认 / 用途 |
|---|---|
| REPORT_TIMEZONE | Asia/Shanghai |
| DEEPSEEK_API_KEY / DEEPSEEK_MODEL | 空 / deepseek-flash；实际模型以连接测试为准 |
| EMBEDDING_BACKEND | local；可选api |
| LOCAL_EMBEDDING_MODEL | BAAI/bge-small-zh-v1.5 |
| LOCAL_EMBEDDING_THREADS | 2，CPU线程 |
| LOCAL_EMBEDDING_OFFLINE | 首次0；缓存后可1 |
| MEMORY_MIN_COVERAGE | 0.5 |
| QDRANT_URL | 空为嵌入式持久化；URL为独立服务 |
| HAJIMI_DATA_DIR | 项目下.runtime/intelligence |
| HAJIMI_API_TOKEN | 可选，两个服务须一致 |

远程Embedding需EMBEDDING_BASE_URL、EMBEDDING_MODEL、EMBEDDING_API_KEY，支持POST /embeddings。兼容聊天服务使用LLM_BASE_URL、LLM_MODEL、LLM_API_KEY。

摄像头source_kind区分camera/local-video；默认cuda:0、输入320、支持时FP16，CPU手选。ROI为归一化多边形。review_gap_sec默认10秒，review_max_sec默认3600秒；完整字段见OpenAPI。配置revision用于边缘同步。

Windows保存Key使用DPAPI，其他系统仅文件权限保护。禁止VITE_密钥。DeepSeek仍需云端网络，本地向量数据库不等于全离线生成。
