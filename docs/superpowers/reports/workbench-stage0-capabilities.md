# Performance Workbench 能力证据表

- 基础代码 ref：`6ca3c5fc25233750a10ce92c1630781ccdc935ef`
- 复核人：TRAE
- 复核日期：2026-08-02
- 自动计分：85 / 100
- 发布验收：未接受
- 外部门禁：`real-sample-blocked`、`worker-peak-memory-unmeasured`
- Stage 6 第一轮：Batch 41 `implemented`/`automated-verified`/`real-sample-blocked`；Batch 42 `implemented`/`automated-verified`/`real-sample-blocked`；Batch 43 `implemented`/`automated-verified`/`real-sample-blocked`
- Stage 6 第二轮：Batch 44 `implemented`/`automated-verified`/`real-sample-blocked`；Batch 45 `implemented`/`automated-verified`/`real-sample-blocked`；Batch 46 `audited`/`automated-verified`/`real-sample-blocked`
- Stage 6 第三轮：Batch 47 `implemented`/`automated-verified`/`real-sample-blocked`；Batch 48 `implemented`/`automated-verified`/`real-sample-blocked`
- Stage 6 开关：`REACT_APP_ENABLE_TRACE_STAGE6=1`（仍依赖前五档 Workbench 开关）
- 浏览器验证：第一轮 `not-run`，第二轮 `not-run`，第三轮 `not-run`
- 状态计数：implemented-verified=31，implemented-unverified=12，designed=0，absent=1
- 计分规则：仅 `scoreEligible=true` 且状态为 `implemented-verified` 的 criteria 计分；能力得分不推导发布验收。

## 域汇总

| 能力域 | 已得分 | 可得分 | 未计分原因 |
|---|---:|---:|---|
| 时间轴与跨轨联动 | 18 | 20 | TL-02-BROWSER-ACCESSIBILITY: Stage 5 浏览器 artifact 被忽略，master 无可提交运行证据。<br>TL-04-LARGE-TRACE-BROWSER: master 不包含可提交的 Stage 5 100K/500K/1M 浏览器运行 artifact。 |
| 主线程与 CPU 分析 | 14 | 15 | CPU-02-REAL-PROFILE-SHAPES: 仓库外真实 CPU Profile 形状仍为 real-sample-blocked。 |
| 网络瀑布 | 7 | 10 | NET-01-REAL-REQUEST-SHAPES: 仓库外真实请求样本门禁未通过。<br>NET-02-CONNECTION-PHASES: 离线 Trace 尚未提供完整 DNS/TCP/TLS/代理阶段瀑布。 |
| 渲染、帧与交互 | 8 | 10 | RFI-01-REAL-RENDERING-SAMPLE: 真实渲染故障样本仍为 real-sample-blocked。<br>RFI-03-REAL-SCREENSHOT-TRACE: 仓库外真实截图 Trace 未验证。 |
| Call Tree、Bottom-up、Event Log | 8 | 10 | AGG-01-BROWSER-WORKFLOW: master 无可提交的 Stage 5 浏览器工作流 artifact。<br>AGG-01-REAL-PROFILE-WORKFLOW: 真实 CPU Profile 工作流仍为 real-sample-blocked。 |
| 导航、选区与查询 | 9 | 10 | NAV-04-BROWSER-SESSION: 缺少 master 内可提交的浏览器会话 artifact。 |
| 自动诊断与证据 | 7 | 10 | DIA-01-REAL-PRECISION: 真实故障样本精确率门禁未通过。<br>DIA-02-REAL-CROSS-SOURCE: 真实 Trace/HAR/NetLog 配对仍为 real-sample-blocked。 |
| 稳定性、隐私与离线能力 | 9 | 10 | SAFE-02-WORKER-PEAK-MEMORY: 页面 JavaScript 无法测量独立 Worker 峰值内存。 |
| 事件详情、搜索与过滤 | 5 | 5 | 无 |

## Criteria 明细

| Criteria ID | 能力域 | 分值 | 状态 | 代码证据 | 测试/样本证据 | 限制 |
|---|---|---:|---|---|---|---|
| TL-01-CORE-TRACKS | 时间轴与跨轨联动 | 6 | `implemented-verified` | `src/workbench/timelineTracks.ts`<br>`src/components/trace/workbench/TimelineCanvas.tsx` | `src/workbench/timelineTracks.test.ts`<br>`src/components/trace/workbench/TimelineCanvas.test.tsx`<br>`SYNTH-WB-CONTRACT` | 仅对已注册核心轨道计分。 |
| TL-01-EXTENSIBLE-REGISTRY | 时间轴与跨轨联动 | 2 | `implemented-verified` | `src/workbench/timelineTracks.ts` | `src/workbench/timelineTracks.test.ts`<br>`SYNTH-LAYOUT-SHIFT` | registry 已支持高级轨道；当前注册布局偏移、动画与 GPU/Raster 轨道。 |
| TL-02-INTERACTION | 时间轴与跨轨联动 | 5 | `implemented-verified` | `src/workbench/timelineInteractionStore.ts`<br>`src/workbench/timelineGeometry.ts` | `src/workbench/timelineInteractionStore.test.ts`<br>`src/workbench/timelineGeometry.test.ts`<br>`SYNTH-WB-CONTRACT` | 自动化测试证明状态与几何行为，不替代真实浏览器验收。 |
| TL-02-BROWSER-ACCESSIBILITY | 时间轴与跨轨联动 | 1 | `implemented-unverified` | `src/components/trace/workbench/TimelineCanvas.tsx` | `src/components/trace/workbench/TimelineCanvas.test.tsx` | Stage 5 浏览器 artifact 被忽略，master 无可提交运行证据。 |
| TL-04-VIEWPORT-QUERY | 时间轴与跨轨联动 | 5 | `implemented-verified` | `src/workbench/client.ts`<br>`src/workbench/sessionKernel.ts`<br>`src/workbench/timelineColumnarStore.ts` | `src/workbench/client.test.ts`<br>`src/workbench/sessionKernel.test.ts`<br>`src/workbench/timelineColumnarStore.test.ts`<br>`SYNTH-WB-CONTRACT` | 查询结果允许显式 LOD 和截断。 |
| TL-04-LARGE-TRACE-BROWSER | 时间轴与跨轨联动 | 1 | `implemented-unverified` | `src/benchmark/workbenchBrowserBenchmark.ts` | 无 | master 不包含可提交的 Stage 5 100K/500K/1M 浏览器运行 artifact。 |
| CPU-01-TASK-PROFILE-FACTS | 主线程与 CPU 分析 | 3 | `implemented-verified` | `src/parsers/trace/taskFacts.ts`<br>`src/parsers/trace/cpuProfileFacts.ts` | `src/parsers/trace/taskFacts.test.ts`<br>`src/parsers/trace/cpuProfileFacts.test.ts`<br>`TRACE-GOLDEN-CORPUS` | 仅计主线程任务与 CPU Profile 基础事实。 |
| CPU-01-GC-MEMORY-TREND | 主线程与 CPU 分析 | 2 | `implemented-verified` | `src/workbench/advancedAnalysisStore.ts`<br>`src/components/trace/workbench/MemoryTrendPanel.tsx`<br>`src/workbench/sessionKernel.ts` | `src/workbench/advancedAnalysisStore.test.ts`<br>`src/components/trace/workbench/MemoryTrendPanel.test.tsx`<br>`src/workbench/sessionKernel.test.ts`<br>`src/workbench/stage6Protocol.test.ts` | 仅接受明确 GC 名称、持续时间和 jsHeapSizeUsed 字节值；结果、交互/长任务上下文和证据引用均按整个响应 2000 项上限返回；无 Heap Snapshot，不输出对象保留链、对象级归因、确定内存泄漏或泄漏速度；真实样本仍阻塞。 |
| CPU-02-FLAME-CHART | 主线程与 CPU 分析 | 4 | `implemented-verified` | `src/workbench/cpuProfileStore.ts`<br>`src/components/trace/workbench/FlameChartCanvas.tsx` | `src/workbench/cpuProfileStore.test.ts`<br>`src/components/trace/workbench/FlameChartCanvas.test.tsx`<br>`SYNTH-CPU-PROFILE` | 仅由合成 CPU Profile 形状验证。 |
| CPU-02-REAL-PROFILE-SHAPES | 主线程与 CPU 分析 | 1 | `implemented-unverified` | `src/workbench/cpuProfileStore.ts` | 无 | 仓库外真实 CPU Profile 形状仍为 real-sample-blocked。 |
| CPU-03-SELECTION-AGGREGATES | 主线程与 CPU 分析 | 5 | `implemented-verified` | `src/workbench/cpuProfileStore.ts`<br>`src/components/trace/workbench/ExpertAnalysisDrawer.tsx` | `src/workbench/cpuProfileStore.test.ts`<br>`src/components/trace/workbench/ExpertAnalysisDrawer.test.tsx`<br>`SYNTH-CPU-PROFILE` | 采样命中不等同于真实函数调用次数。 |
| NET-01-REQUEST-LIFECYCLE | 网络瀑布 | 4 | `implemented-verified` | `src/parsers/trace/requestFacts.ts`<br>`src/workbench/traceEngineAdapter.ts` | `src/parsers/trace/requestFacts.test.ts`<br>`src/workbench/traceEngineAdapter.test.ts`<br>`TRACE-GOLDEN-CORPUS` | Trace 请求事实不推断 DNS、TCP、TLS、代理或服务端根因。 |
| NET-01-REAL-REQUEST-SHAPES | 网络瀑布 | 1 | `implemented-unverified` | `src/parsers/trace/requestFacts.ts` | 无 | 仓库外真实请求样本门禁未通过。 |
| NET-02-TIMELINE-SEARCH | 网络瀑布 | 3 | `implemented-verified` | `src/workbench/timelineColumnarStore.ts`<br>`src/components/trace/workbench/TraceTimelineWorkbench.tsx` | `src/workbench/timelineColumnarStore.test.ts`<br>`src/components/trace/workbench/TraceTimelineWorkbench.test.tsx`<br>`SYNTH-WB-CONTRACT` | 搜索只覆盖白名单投影字段。 |
| NET-02-CONNECTION-PHASES | 网络瀑布 | 2 | `absent` | 无 | 无 | 离线 Trace 尚未提供完整 DNS/TCP/TLS/代理阶段瀑布。 |
| RFI-01-RENDERING-FACTS | 渲染、帧与交互 | 2 | `implemented-verified` | `src/parsers/trace/traceFactCollectors.ts`<br>`src/workbench/traceEngineAdapter.ts` | `src/parsers/trace/minimalTraceAggregator.batch3.test.ts`<br>`src/workbench/traceEngineAdapter.test.ts`<br>`TRACE-GOLDEN-CORPUS` | 基础渲染事实不等于 CLS 或动画归因。 |
| RFI-01-CLS-CLUSTERS | 渲染、帧与交互 | 1 | `implemented-verified` | `src/workbench/advancedAnalysisStore.ts`<br>`src/components/trace/workbench/LayoutShiftPanel.tsx` | `src/workbench/advancedAnalysisStore.test.ts`<br>`src/components/trace/workbench/LayoutShiftPanel.test.tsx`<br>`src/workbench/sessionKernel.test.ts`<br>`SYNTH-LAYOUT-SHIFT` | 不映射原页面 DOM，不推断布局偏移根因；真实样本仍阻塞。 |
| RFI-01-ANIMATION-COMPOSITION | 渲染、帧与交互 | 1 | `implemented-verified` | `src/workbench/advancedAnalysisStore.ts`<br>`src/components/trace/workbench/AnimationCompositionPanel.tsx` | `src/workbench/advancedAnalysisStore.test.ts`<br>`src/components/trace/workbench/AnimationCompositionPanel.test.tsx`<br>`src/workbench/sessionKernel.test.ts`<br>`SYNTH-ANIMATION-COMPOSITION` | 时间重叠只作范围关联，不证明动画导致帧或渲染活动；真实样本仍阻塞。 |
| RFI-01-REAL-RENDERING-SAMPLE | 渲染、帧与交互 | 1 | `implemented-unverified` | `src/parsers/trace/traceFactCollectors.ts` | 无 | 真实渲染故障样本仍为 real-sample-blocked。 |
| RFI-02-FRAME-RANGES | 渲染、帧与交互 | 2 | `implemented-verified` | `src/parsers/trace/traceFactCollectors.ts`<br>`src/components/trace/workbench/TimelineCanvas.tsx` | `src/parsers/trace/minimalTraceAggregator.batch3.test.ts`<br>`src/components/trace/workbench/TimelineCanvas.test.tsx`<br>`SYNTH-FRAME` | 帧预算使用 60Hz 参考，不推断设备刷新率。 |
| RFI-02-GPU-RASTER | 渲染、帧与交互 | 1 | `implemented-verified` | `src/workbench/advancedAnalysisStore.ts`<br>`src/workbench/timelineTracks.ts`<br>`src/components/trace/workbench/GpuRasterPanel.tsx` | `src/workbench/advancedAnalysisStore.test.ts`<br>`src/workbench/timelineTracks.test.ts`<br>`src/components/trace/workbench/GpuRasterPanel.test.tsx`<br>`src/workbench/sessionKernel.test.ts`<br>`src/workbench/stage6Protocol.test.ts` | GPU 查询和轨道共用白名单且只统计含明确持续时间的活动；结果和证据引用均按整个响应 2000 项上限返回；不推断利用率、硬件瓶颈、显存压力或驱动根因；真实样本仍阻塞。 |
| RFI-03-SCREENSHOT-LIFECYCLE | 渲染、帧与交互 | 1 | `implemented-verified` | `src/workbench/rawEvidenceStore.ts`<br>`src/components/trace/workbench/ScreenshotFilmstrip.tsx` | `src/workbench/rawEvidenceStore.test.ts`<br>`src/components/trace/workbench/ScreenshotFilmstrip.test.tsx`<br>`SYNTH-WB-SCREENSHOT` | 截图不进入插件或默认导出。 |
| RFI-03-REAL-SCREENSHOT-TRACE | 渲染、帧与交互 | 1 | `implemented-unverified` | `src/workbench/rawEvidenceStore.ts` | 无 | 仓库外真实截图 Trace 未验证。 |
| AGG-01-BOUNDED-QUERIES | Call Tree、Bottom-up、Event Log | 8 | `implemented-verified` | `src/workbench/cpuProfileStore.ts`<br>`src/workbench/timelineColumnarStore.ts`<br>`src/components/trace/workbench/ExpertAnalysisDrawer.tsx` | `src/workbench/cpuProfileStore.test.ts`<br>`src/workbench/timelineColumnarStore.test.ts`<br>`src/components/trace/workbench/ExpertAnalysisDrawer.test.tsx`<br>`SYNTH-CPU-PROFILE` | 列表按上限和 continuation 有界返回。 |
| AGG-01-BROWSER-WORKFLOW | Call Tree、Bottom-up、Event Log | 1 | `implemented-unverified` | `src/components/trace/workbench/ExpertAnalysisDrawer.tsx` | `src/components/trace/workbench/ExpertAnalysisDrawer.test.tsx` | master 无可提交的 Stage 5 浏览器工作流 artifact。 |
| AGG-01-REAL-PROFILE-WORKFLOW | Call Tree、Bottom-up、Event Log | 1 | `implemented-unverified` | `src/workbench/cpuProfileStore.ts` | 无 | 真实 CPU Profile 工作流仍为 real-sample-blocked。 |
| NAV-01-REPORT-EVIDENCE | 导航、选区与查询 | 2 | `implemented-verified` | `src/components/trace/useTraceTargetNavigation.ts`<br>`src/components/trace/TraceResultPage.tsx` | `src/components/trace/useTraceTargetNavigation.test.tsx`<br>`src/components/trace/TraceResultPage.test.tsx`<br>`TRACE-GOLDEN-CORPUS` | 仅定位白名单证据 ID。 |
| NAV-04-SESSION-LIFECYCLE | 导航、选区与查询 | 4 | `implemented-verified` | `src/workbench/client.ts`<br>`src/workbench/sessionKernel.ts`<br>`src/workers/traceWorkerTask.ts` | `src/workbench/client.test.ts`<br>`src/workbench/sessionKernel.test.ts`<br>`src/workers/traceWorkerClient.test.ts`<br>`SYNTH-WB-CONTRACT` | 能力仍位于内部 feature flag 后。 |
| NAV-04-BROWSER-SESSION | 导航、选区与查询 | 1 | `implemented-unverified` | `src/components/trace/workbench/TraceTimelineWorkbench.tsx` | `src/components/trace/workbench/TraceTimelineWorkbench.test.tsx` | 缺少 master 内可提交的浏览器会话 artifact。 |
| NAV-03-HISTORY-FOCUS | 导航、选区与查询 | 2 | `implemented-verified` | `src/workbench/timelineInteractionStore.ts`<br>`src/components/trace/workbench/TraceTimelineWorkbench.tsx` | `src/workbench/timelineInteractionStore.test.ts`<br>`src/components/trace/workbench/TraceTimelineWorkbench.test.tsx`<br>`SYNTH-WB-CONTRACT` | 页面刷新后不恢复本地文件。 |
| NAV-03-DECLARATIVE-QUERY | 导航、选区与查询 | 1 | `implemented-verified` | `src/workbench/timelineColumnarStore.ts`<br>`src/workbench/sessionKernel.ts`<br>`src/workbench/client.ts`<br>`src/components/trace/workbench/CustomQueryPanel.tsx` | `src/workbench/timelineColumnarStore.test.ts`<br>`src/workbench/sessionKernel.test.ts`<br>`src/workbench/client.test.ts`<br>`src/components/trace/workbench/CustomQueryPanel.test.tsx`<br>`src/workbench/stage6Protocol.test.ts` | 仅支持白名单字段和 1–8 个 AND 条件；不支持 SQL、正则、OR、嵌套表达式或用户函数；结果和证据引用最多 2000 项且截断限制可见，匹配数量不构成性能结论。 |
| DIA-01-DETERMINISTIC-RULES | 自动诊断与证据 | 6 | `implemented-verified` | `src/diagnosis/trace/traceDiagnosisRules.ts`<br>`src/diagnosis/trace/selectTraceDiagnoses.ts` | `src/diagnosis/trace/traceGoldenCorpus.test.ts`<br>`src/diagnosis/trace/selectTraceDiagnoses.test.ts`<br>`TRACE-GOLDEN-CORPUS` | 合成 corpus 只证明规则边界。 |
| DIA-01-REAL-PRECISION | 自动诊断与证据 | 2 | `implemented-unverified` | `src/diagnosis/trace/traceDiagnosisRules.ts` | 无 | 真实故障样本精确率门禁未通过。 |
| DIA-02-COMPETING-CAUSES | 自动诊断与证据 | 1 | `implemented-verified` | `src/diagnosis/trace/expertDiagnosis.ts` | `src/diagnosis/trace/expertDiagnosis.test.ts`<br>`SYNTH-EXTENSION-POSITIVE-NEGATIVE` | 时间重叠只允许 possible-contributor。 |
| DIA-02-REAL-CROSS-SOURCE | 自动诊断与证据 | 1 | `implemented-unverified` | `src/workbench/crossSourceStore.ts` | `src/workbench/crossSourceStore.test.ts` | 真实 Trace/HAR/NetLog 配对仍为 real-sample-blocked。 |
| SAFE-01-FORMAT-GATEWAY | 稳定性、隐私与离线能力 | 3 | `implemented-verified` | `src/upload/createFileFormatIntake.ts`<br>`src/upload/useAnalysisIntake.ts` | `src/upload/createFileFormatIntake.test.ts`<br>`src/upload/useAnalysisIntake.test.tsx`<br>`SYNTH-FORMAT-GATEWAY` | 未知 JSON 不回退为 NetLog。 |
| SAFE-02-WORKER-EXECUTION | 稳定性、隐私与离线能力 | 1 | `implemented-verified` | `src/workers/traceAnalysisWorker.ts`<br>`src/workers/traceWorkerTask.ts` | `src/workers/traceWorkerClient.test.ts`<br>`src/workers/buildTraceAnalysisResult.test.ts`<br>`SYNTH-WB-CONTRACT` | 自动化测试不测量独立 Worker 峰值内存。 |
| SAFE-02-WORKER-PEAK-MEMORY | 稳定性、隐私与离线能力 | 1 | `implemented-unverified` | `src/benchmark/workbenchBrowserBenchmark.ts` | 无 | 页面 JavaScript 无法测量独立 Worker 峰值内存。 |
| SAFE-03-PROGRESS | 稳定性、隐私与离线能力 | 2 | `implemented-verified` | `src/upload/analysisProgress.ts`<br>`src/workbench/sessionKernel.ts` | `src/upload/analysisProgress.test.ts`<br>`src/workbench/sessionKernel.test.ts`<br>`SYNTH-PROGRESS` | 进度不推导发布验收状态。 |
| SAFE-04-EXPORT-PROJECTION | 稳定性、隐私与离线能力 | 2 | `implemented-verified` | `src/parsers/trace/exportTraceReport.ts` | `src/parsers/trace/exportTraceReport.test.ts`<br>`TRACE-GOLDEN-CORPUS` | 截图不在默认导出内。 |
| SAFE-04-TRACK-PLUGIN-PROJECTION | 稳定性、隐私与离线能力 | 1 | `implemented-verified` | `src/workbench/spike/protocol.ts`<br>`src/workbench/sessionKernel.ts`<br>`src/components/trace/workbench/TrackPluginPanel.tsx`<br>`src/components/trace/workbench/TimelineCanvas.tsx` | `src/workbench/stage6Protocol.test.ts`<br>`src/workbench/sessionKernel.test.ts`<br>`src/workbench/client.test.ts`<br>`src/components/trace/workbench/TrackPluginPanel.test.tsx`<br>`src/components/trace/workbench/TimelineCanvas.test.tsx` | 插件仅为当前会话内声明式规则，只接收白名单投影；不执行用户代码，不访问 evidence payload、截图、原始事件、网络、文件或持久化存储；投影与证据引用共享 2000 项预算且截断限制可见，切换会话 client 时清除旧 overlay。 |
| DETAIL-01-EVIDENCE-DETAIL | 事件详情、搜索与过滤 | 2 | `implemented-verified` | `src/workbench/rawEvidenceStore.ts`<br>`src/components/trace/workbench/TraceTimelineWorkbench.tsx` | `src/workbench/rawEvidenceStore.test.ts`<br>`src/components/trace/workbench/TraceTimelineWorkbench.test.tsx`<br>`SYNTH-WB-CONTRACT` | UI 不接收 args、请求头或完整 URL 参数。 |
| DETAIL-02-SEARCH-FILTER | 事件详情、搜索与过滤 | 2 | `implemented-verified` | `src/workbench/timelineColumnarStore.ts`<br>`src/components/trace/workbench/ExpertAnalysisDrawer.tsx` | `src/workbench/timelineColumnarStore.test.ts`<br>`src/components/trace/workbench/ExpertAnalysisDrawer.test.tsx`<br>`SYNTH-WB-CONTRACT` | 搜索只匹配白名单名称、分类、轨道和状态。 |
| DETAIL-02-CUSTOM-QUERY | 事件详情、搜索与过滤 | 1 | `implemented-verified` | `src/workbench/timelineColumnarStore.ts`<br>`src/components/trace/workbench/CustomQueryPanel.tsx` | `src/workbench/timelineColumnarStore.test.ts`<br>`src/components/trace/workbench/CustomQueryPanel.test.tsx`<br>`src/workbench/stage6Protocol.test.ts` | 查询仅返回 WorkbenchTimelineEventDto 白名单投影，并按当前选区或视口执行；结果、证据引用、continuation 和截断状态有界且限制可见；修改条件会清除旧结果。 |

该汇总由 `node scripts/build-workbench-stage0-evidence.js` 从 JSON 明细生成，不手写总体完成度。
