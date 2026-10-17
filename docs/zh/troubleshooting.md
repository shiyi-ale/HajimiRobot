[Docs](README.md) · [English](../en/troubleshooting.md)

# 故障排查

| 现象 | 操作 |
|---|---|
| 端口被占或processes.json残留 | 先stop再start，不杀其他应用 |
| API不可用 | health.ps1；查看.runtime下intelligence.err.log与backend.err.log |
| CUDA不可用 | 检查驱动和CUDA版PyTorch；手动改CPU |
| 模型类别不兼容 | 使用六类权重，不用COCO猫检测替代行为识别 |
| 某日无活动 | 检查时区、处理日期、来源和摄像头 |
| 有检测无录像 | 检查文件状态、保留期、FFmpeg错误 |
| 只有统计报告 | 检查模型设置、连接测试与服务提示；校验失败也会回退 |
| 语义降级 | 检查模型缓存、离线设置或嵌入API；本地Qdrant目录只能一个进程占用 |
| 证据不足 | 需要当天50%覆盖和至少3个有效历史日 |
| 已查看失效 | 新证据改变版本，属预期行为 |

分享日志前移除Key、认证头、流URL凭据、用户名和个人路径。不把完整数据库附到issue。
