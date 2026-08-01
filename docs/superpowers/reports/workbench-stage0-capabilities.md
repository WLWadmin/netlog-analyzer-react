# Performance Workbench 阶段 0 能力证据表

- 基础代码 ref：`ec6fc9ab4152118dd0b023d0a6f85863494012bc`
- 复核人：TRAE
- 复核日期：2026-08-01
- 自动计分：37 / 100
- 状态计数：implemented-verified=12，implemented-unverified=0，partial=0，designed=1，absent=12
- 计分规则：仅 `scoreEligible=true` 且状态为 `implemented-verified` 的原子项计分；阶段 0 Spike 不计入当前产品得分。

| ID | 能力域 | 分值 | 状态 | 用户可观察行为 | 代码 ref 与文件证据 | 测试/任务证据 | 样本 ID | 已知限制 | 复核日期 |
|---|---|---:|---|---|---|---|---|---|---|
| TL-01 | 时间轴与跨轨联动 | 8 | `absent` | 在统一时间轴查看 CPU、网络和渲染轨道。 | `ec6fc9a:src/components/trace/TraceResultPage.tsx` | 无 | 无 | 当前是报告页签，不是统一时间轴。 | 2026-08-01 |
| TL-02 | 时间轴与跨轨联动 | 6 | `absent` | 缩放、平移并保持跨轨证据游标。 | 无 | 无 | 无 | 完整 Timeline 明确不在阶段 0 实施范围。 | 2026-08-01 |
| TL-03 | 时间轴与跨轨联动 | 不计分 | `implemented-verified` | 阶段 0 测试界面按视口查询相交事件并用 Canvas 绘制。 | `working-tree@ec6fc9a:src/workbench/spike/kernel.ts`<br>`working-tree@ec6fc9a:src/benchmark/workbenchBrowserBenchmark.ts` | `src/workbench/spike/kernel.test.ts`<br>`workbench-browser-benchmark-100k.json`<br>`workbench-browser-benchmark-500k.json`<br>`workbench-browser-benchmark-1000k.json` | `SYNTH-WB-100K`<br>`SYNTH-WB-500K`<br>`SYNTH-WB-1000K` | 仅为阶段 0 Spike，scoreEligible=false，不代表产品 Timeline。 | 2026-08-01 |
| TL-04 | 时间轴与跨轨联动 | 6 | `absent` | 产品 Timeline 按视口查询所有相交事件并跨轨联动。 | 无 | 无 | 无 | 阶段 0 只有隔离 Spike，尚未接入产品会话。 | 2026-08-01 |
| CPU-01 | 主线程与 CPU 分析 | 5 | `implemented-verified` | 报告页展示主线程任务、长任务与 CPU Profile 事实。 | `ec6fc9a:src/parsers/trace/minimalTraceAggregator.ts`<br>`ec6fc9a:src/components/trace/tabs/TraceMainThreadTab.tsx` | `src/parsers/trace/cpuProfileFacts.test.ts`<br>`src/parsers/trace/taskFacts.test.ts` | `TRACE-SAMPLE-01`<br>`TRACE-SAMPLE-02`<br>`TRACE-SAMPLE-05` | 没有 Flame Chart、Call Tree 或 Bottom-up。 | 2026-08-01 |
| CPU-02 | 主线程与 CPU 分析 | 5 | `absent` | 按时间顺序浏览 Flame Chart。 | 无 | 无 | 无 | 阶段 3 候选能力。 | 2026-08-01 |
| CPU-03 | 主线程与 CPU 分析 | 5 | `absent` | 按选区查看 self time、total time 和调用次数。 | 无 | 无 | 无 | 当前聚合事实不等同于选区 CPU 查询。 | 2026-08-01 |
| NET-01 | 网络瀑布 | 5 | `implemented-verified` | 报告页展示 Trace 请求生命周期、状态与发起关系。 | `ec6fc9a:src/parsers/trace/requestFacts.ts`<br>`ec6fc9a:src/components/trace/tabs/TraceNetworkTab.tsx` | `src/parsers/trace/requestFacts.test.ts`<br>`src/parsers/trace/minimalTraceAggregator.real-shapes.test.ts` | `TRACE-SAMPLE-01`<br>`TRACE-SAMPLE-02`<br>`TRACE-SAMPLE-05` | 没有统一时间轴上的网络瀑布。 | 2026-08-01 |
| NET-02 | 网络瀑布 | 5 | `absent` | 在时间轴瀑布中缩放、过滤并联动发起关系。 | 无 | 无 | 无 | 阶段 2 候选能力。 | 2026-08-01 |
| RFI-01 | 渲染、帧与交互 | 5 | `implemented-verified` | 报告页展示渲染、帧、交互和 Forced Reflow 事实。 | `ec6fc9a:src/parsers/trace/traceFactCollectors.ts`<br>`ec6fc9a:src/components/trace/tabs/TraceRenderingTab.tsx`<br>`ec6fc9a:src/components/trace/tabs/TraceInteractionsTab.tsx` | `src/parsers/trace/interactionFacts.test.ts`<br>`src/parsers/trace/minimalTraceAggregator.batch3.test.ts` | `TRACE-SAMPLE-01`<br>`TRACE-SAMPLE-02`<br>`TRACE-SAMPLE-05` | 事实位于报告列表，不能与时间轴帧轨联动。 | 2026-08-01 |
| RFI-02 | 渲染、帧与交互 | 3 | `absent` | 在统一范围定位掉帧、交互和渲染活动。 | 无 | 无 | 无 | 阶段 2 候选能力。 | 2026-08-01 |
| RFI-03 | 渲染、帧与交互 | 2 | `absent` | 按时间浏览 Trace 内已有截图。 | 无 | 无 | 无 | 当前不解析或展示 Screenshot 胶片。 | 2026-08-01 |
| AGG-01 | Call Tree、Bottom-up、Event Log | 10 | `absent` | 在当前选区切换 Call Tree、Bottom-up 和 Event Log。 | 无 | 无 | 无 | 阶段 3 候选能力。 | 2026-08-01 |
| NAV-01 | 导航、选区与查询 | 2 | `implemented-verified` | 报告页可在结论、事实和证据页签间定位。 | `ec6fc9a:src/components/trace/useTraceTargetNavigation.ts`<br>`ec6fc9a:src/components/trace/TraceResultPage.tsx` | `src/components/trace/useTraceTargetNavigation.test.tsx`<br>`src/components/trace/TraceResultPage.test.tsx` | `TRACE-GOLDEN-CORPUS` | 不是时间范围历史或选区查询。 | 2026-08-01 |
| NAV-02 | 导航、选区与查询 | 不计分 | `implemented-verified` | Spike 支持 session/revision/request、视口、详情、取消和 release。 | `working-tree@ec6fc9a:src/workbench/spike/protocol.ts`<br>`working-tree@ec6fc9a:src/workbench/spike/kernel.ts` | `src/workbench/spike/kernel.test.ts` | `SYNTH-WB-CONTRACT` | 阶段 0 风险验证，不计入当前产品得分。 | 2026-08-01 |
| NAV-04 | 导航、选区与查询 | 5 | `absent` | 产品 Workbench 支持会话、视口、详情、局部取消和释放。 | 无 | 无 | 无 | 阶段 0 Spike 不等于阶段 1 产品查询底座。 | 2026-08-01 |
| NAV-03 | 导航、选区与查询 | 3 | `absent` | 产品工作台保存并恢复视口、选区和焦点。 | 无 | 无 | 无 | 完整交互状态不在阶段 0 实现。 | 2026-08-01 |
| DIA-01 | 自动诊断与证据 | 8 | `implemented-verified` | 报告页输出证据约束诊断、确定性排序和白名单证据引用。 | `ec6fc9a:src/diagnosis/trace/traceDiagnosisRules.ts`<br>`ec6fc9a:src/diagnosis/trace/selectTraceDiagnoses.ts` | `src/diagnosis/trace/traceGoldenCorpus.test.ts`<br>`src/diagnosis/trace/selectTraceDiagnoses.test.ts` | `TRACE-GOLDEN-CORPUS` | 最高分主诊断只可视为报告页基线。 | 2026-08-01 |
| DIA-02 | 自动诊断与证据 | 2 | `designed` | 围绕症状实体展示必要证据、反证和竞争原因。 | `V5 design section 10` | 无 | 无 | 竞争归因尚未实现。 | 2026-08-01 |
| SAFE-01 | 稳定性、隐私与离线能力 | 3 | `implemented-verified` | 预检推荐后由用户确认 parser，并执行专用校验。 | `ec6fc9a:src/upload/createFileFormatIntake.ts`<br>`ec6fc9a:src/upload/useAnalysisIntake.ts` | `src/upload/createFileFormatIntake.test.ts`<br>`src/upload/useAnalysisIntake.test.tsx` | `SYNTH-FORMAT-GATEWAY` | 未知 JSON 不回退为 NetLog；Workbench 必须复用该入口。 | 2026-08-01 |
| SAFE-02 | 稳定性、隐私与离线能力 | 2 | `implemented-verified` | Trace 在 Worker 中读取、聚合并返回报告 DTO。 | `ec6fc9a:src/workers/traceAnalysisWorker.ts`<br>`ec6fc9a:src/workers/traceWorkerTask.ts` | `src/workers/traceWorkerClient.test.ts`<br>`src/workers/buildTraceAnalysisResult.test.ts` | `TRACE-SAMPLE-01`<br>`TRACE-SAMPLE-02`<br>`TRACE-SAMPLE-05` | 生产聚合取消仍传入恒定 false。 | 2026-08-01 |
| SAFE-03 | 稳定性、隐私与离线能力 | 2 | `implemented-verified` | 进度使用 bytes、events、requests、lines 或 rules 等真实工作量。 | `ec6fc9a:src/upload/analysisProgress.ts` | `src/upload/analysisProgress.test.ts`<br>`src/upload/parserProgress.test.ts` | `SYNTH-PROGRESS` | Workbench 索引进度尚未接入生产 UI。 | 2026-08-01 |
| SAFE-04 | 稳定性、隐私与离线能力 | 3 | `implemented-verified` | Trace 报告仅通过白名单 DTO 导出并经过敏感数据扫描。 | `ec6fc9a:src/parsers/trace/exportTraceReport.ts` | `src/parsers/trace/exportTraceReport.test.ts` | `TRACE-GOLDEN-CORPUS` | 截图不在当前导出能力内。 | 2026-08-01 |
| DETAIL-01 | 事件详情、搜索与过滤 | 2 | `implemented-verified` | 报告页可查看受控事实与 evidence 引用。 | `ec6fc9a:src/components/trace/tabs/TraceEvidenceTab.tsx`<br>`ec6fc9a:src/parsers/trace/eventAccessors.ts` | `src/parsers/trace/eventAccessors.test.ts`<br>`src/components/trace/TraceResultPage.facts.test.tsx` | `TRACE-GOLDEN-CORPUS` | 不是按事件 ID 查询原始详情。 | 2026-08-01 |
| DETAIL-02 | 事件详情、搜索与过滤 | 3 | `absent` | 在 Timeline 与 Event Log 中搜索、过滤和前后导航。 | 无 | 无 | 无 | 阶段 3 候选能力。 | 2026-08-01 |

该汇总由 `node scripts/build-workbench-stage0-evidence.js` 从 JSON 明细生成，不手写总体完成度。
