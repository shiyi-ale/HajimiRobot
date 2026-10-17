# Frigate NVR 源码研究与 Hajimi 落地

## 研究范围与可复查版本

本次下载官方仓库到 `.runtime/references/frigate`，没有启动完整 Frigate，也没有把它的容器和依赖装入机器人服务。

- 上游：https://github.com/blakeblackshear/frigate
- 分支：dev，浅克隆；固定提交 `add310d63d6386b820edb5ee89cfaf4e00ef4777`。
- 这是该提交的源码观察，不保证与所有稳定版本一致。
- 本次采用架构思想并独立实现，没有复制上游实现代码。参考仓库保留原有 LICENSE；不使用 Frigate 品牌标识。

## 1. 重复检测、目标事件与回看片段是三个层次

上游 `frigate/models.py` 分别定义 Event、Timeline、Recordings、ReviewSegment、UserReviewStatus。Event 对应跟踪目标生命周期；ReviewSegment 包含 detections ID、对象类别、区域等，允许同一活动片段里包含多个目标。

源码：[models.py](https://github.com/blakeblackshear/frigate/blob/add310d63d6386b820edb5ee89cfaf4e00ef4777/frigate/models.py#L16)、[review/maintainer.py](https://github.com/blakeblackshear/frigate/blob/add310d63d6386b820edb5ee89cfaf4e00ef4777/frigate/review/maintainer.py#L48)。

这解决了“每次检测都生成一张事件卡”的问题：目标继续存在时更新现有对象状态；相近的活动继续更新当前回看片段。多次检测命中不等于多次行为发生。

Hajimi 采用的层次：

| 层次 | 表 | 含义 |
|---|---|---|
| 传输原始证据 | frames | 幂等检测帧，包括空检测、明确观测区间 |
| 连续行为证据 | events | 同类别、连续有效观测的片段；不跨空洞增加时长 |
| 用户回看组 | review_groups | 时间上相近的多个行为片段，允许多类别，引用原始事件 |
| 录像 | clips | 文件的实际时间范围及状态，与检测是否存在分开 |

原始 events 不做破坏性合并，Agent 的时长、进食片段数仍使用原始证据，不使用回看卡片数。

## 2. 用“最后活动 + 结束等待”减少事件碎片

上游 PendingReviewSegment 保存 last_alert_time、last_detection_time；等待超过对应 cutoff 后关闭。最终 end_time 使用最后活动时间，而不是把整个等待期都算成活动。

在当前研究提交中，AlertsConfig.cutoff_time 默认40秒，DetectionsConfig.cutoff_time 默认30秒；这是告警回看策略，不是宠物行为持续时长的真值。

源码：[结束判定](https://github.com/blakeblackshear/frigate/blob/add310d63d6386b820edb5ee89cfaf4e00ef4777/frigate/review/maintainer.py#L693)、[配置](https://github.com/blakeblackshear/frigate/blob/add310d63d6386b820edb5ee89cfaf4e00ef4777/frigate/config/camera/review.py#L78)。

Hajimi 默认策略：

- 同摄像头、同来源、同设备会话，事件间隔不超过10秒时归入同一个回看组。
- 多类别片段可属于同组，卡片列出全部类别，时间轴仍显示原始精确片段。
- 确认断流、会话切换、超过合并间隔会分组。
- 默认最长1小时；很长的休息事件可拆成多个回看组，但不会拆改原始统计事件。
- 配置字段 `review_gap_sec`、`review_max_sec`，页面“调度与录像参数”中可调整。
- 只做单宠物场景的活动归组，没有冒充 Frigate 的 Norfair 多目标追踪和稳定宠物身份识别。

实际已有录像：4条坐姿短片段合成1组。组跨度4.4042秒，其中有效行为0.8秒、已观测空检测0.2秒、未观测3.4042秒。不能把4.4042秒全部当作坐姿。

## 3. 空白不是统一的“无目标”

上游 `util/recording_coverage.py` 将主/子码流已有录像的边界合并成覆盖区间；两路都没有录像的区间直接跳过。缺口由录像区间补集得到，不生成一条假装观测过的“无对象事件”。

源码：[resolve_coverage](https://github.com/blakeblackshear/frigate/blob/add310d63d6386b820edb5ee89cfaf4e00ef4777/frigate/util/recording_coverage.py#L91)。

这只能证明“没有对应录像”，不能证明摄像头离线、推理没工作或宠物不在画面里。Hajimi 为行为统计额外物化 coverage_spans：

| state | reason示例 | 解释 |
|---|---|---|
| observed_target | detection | 明确观测到目标 |
| observed_empty | completed_inference_no_target | 推理完成且没有目标 |
| unobserved | scheduled_skip | 运动调度器没有送这一帧推理 |
| unobserved | inference_pending | 已送推理但没有成功结果，不等同空检测 |
| unobserved | inference_unavailable / inference_error | 推理未就绪或失败 |
| unobserved | stream_offline | 通过本地断流检测或有界一致心跳确认 |
| unobserved | unknown | 没有足够证据解释缺口，包括旧历史记录 |
| not_elapsed | future | 当天尚未发生的时间，不能标为离线 |

实际检测区间优先于运行遥测：有效目标 > 有效空检测 > 已知运行状态 > 未知。比如异步推理结果稍晚到达，成功观测会覆盖此前 pending，而不会同时计入两种状态。

没有录像和没有观测是两条独立轨道：可以有录像但未推理，也可以有检测但录像失败。

## 4. 空白具体如何写 SQLite

采用“原始事实保留 + 查询时派生 + 持久化快照”的方式，不给每个空白秒写一行 NULL。

- `operational_intervals`：从本地管线采集已知运行区间，相邻同会话同状态且实际连续的区间合并。不会把没有心跳无限外推为断流。
- `coverage_spans`：按摄像头、来源、日期保存分段后的覆盖状态，相邻同状态同原因合并；日期内起点唯一。
- `timeline_snapshots`：保存完整时间线派生结果、计算时间。
- `timeline_signatures`：保存原始帧数量、运行区间、录像状态、已查看状态、策略版本等输入指纹。

示意SQL，数值仅用于解释：

```sql
-- start/end 是 UTC Unix 时间戳，下面用秒偏移表示结构。
-- 0—1秒有目标；1—2秒完成推理但无目标；2—5秒未观测。
-- 不会把2—5秒填成rest，也不会创建3条假空检测帧。
SELECT start,end,state,reason
FROM coverage_spans
WHERE camera='primary' AND source='local-video' AND day='2026-10-18'
ORDER BY start;
```

物化边界：请求 `GET /api/v1/review/timeline` 时创建或更新该日快照。尚未打开的日期仍保留原始证据，可首次访问时重建；这不是逐日后台预生成整库。迟到数据会改变输入指纹并重建该日，重复请求不会重复插入覆盖区间。

历史数据未变化时直接读取快照；当前日若只有时间推进，空白/未来边界最多缓存15秒。当前 Agent 的全天覆盖率口径保持原有统计定义，时间线额外区分“已经过去的未观测”和“尚未发生”。

## 5. 状态变化才值得产生时间线条目

上游 events/maintainer.py 的 should_update_db、should_update_state 将“需要更新数据库”和“需要发布状态变化”分开。timeline.py 只在出现、离开、进区、静止/活动状态转换、属性变化等条件下写 Timeline。

源码：[事件写入判定](https://github.com/blakeblackshear/frigate/blob/add310d63d6386b820edb5ee89cfaf4e00ef4777/frigate/events/maintainer.py#L19)、[Timeline变化](https://github.com/blakeblackshear/frigate/blob/add310d63d6386b820edb5ee89cfaf4e00ef4777/frigate/timeline.py#L133)。

Hajimi 借鉴其减少重复派生写入的策略：不变的历史快照复用、相邻运行状态合并。没有删除审计用 frames，也没有在没有边缘持久化确认协议时擅自丢弃空检测证据。

原始帧和运行日志尚未增加长期压缩/清理任务；现有录像保留策略不等于这些表也有同样保留期。长期连续运行需要后续按证据保留要求做分层归档。

## 6. 已查看状态不能吞掉新增证据

上游 UserReviewStatus 将用户审阅状态与 ReviewSegment 分开。

Hajimi 当前为单用户本机场景，在 review_status 中保存回看组ID、证据版本、查看时间。点击播放或手动标记可设为已查看；刷新后仍保留。片段新增证据、扩展边界或关联录像状态变化时版本更新，旧标记不再覆盖新版本。旧页面提交旧版本返回409，要求刷新。

接口：`PUT /api/v1/review/{id}/status`，body为 `{"revision":"当前版本","reviewed":true}`。

## 7. 不直接照搬的部分

- Frigate 面向安防，ActiveObjects 会忽略部分静止目标以减少活动告警。宠物休息本身是重要行为，不能在数据库中直接丢弃。我们保留低频探测和rest证据。
- 不把30/40秒安防告警等待时间套成宠物行为时长；合并窗口只影响浏览。
- 不把轨迹位置变化解释成行为类别切换。六类行为仍来自实际模型，当前不增加未经验证的分类平滑规则。
- 不为了看起来连续而填补录像缺口，不伪造空检测，不用心跳观测累计值反推整个空白都是休息。
- 尚未移植多目标追踪、主/子码流自动补洞、HLS跨文件无缝播放、缩略预览管线和多用户权限。

## 8. 验证与回滚依据

新增测试覆盖：稀疏事件合并不增长时长、空检测/未知/未来分离、迟到数据修复、重复上报、会话切换、确认断流、状态连续合并、实际观测覆盖遥测、已查看版本冲突与重启恢复、长事件拆分、跨日裁剪、摄像头/来源隔离和历史快照缓存。

升级前通过SQLite在线backup生成 `.runtime/intelligence/pre-review-strategy.sqlite3`。新增表为增量建表；原始frames/events/reports不删除、不改写其统计口径。研究与本机验证产物位于 `.runtime/case-data/frigate-strategy-validation.json`。

本机验证结果：

- 全部40项Python测试通过，TypeScript检查与前端构建通过。
- 本地视频2026-10-18：4条原始行为片段归成1个回看组。
- 合成案例2026-10-17：63条原始行为片段归成21组；合成案例不代表真实识别效果。
- 升级前后原始帧均为89118条，按摄像头、来源、行为类别分组的事件数量与时长合计完全一致。
- 案例日首次时间线请求约0.177秒，缓存请求约0.024秒；为单次本机观测，不作通用性能保证。
- 浏览器实测确认组内跨度4.4秒与检测0.8秒分别显示，关联录像可定位，已查看标记保存成功。
- 新增1分钟和15分钟缩放，用于看清短暂检测和中间缺口；原有1/6/24小时保留。
