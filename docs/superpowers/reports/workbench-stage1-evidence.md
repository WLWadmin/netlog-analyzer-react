# Performance Workbench 阶段 1 证据

- 基础 ref：`5ee405903edf9bf9b54c077412369e71034c22dd`
- 复核日期：2026-08-01
- 发布验收：未接受
- 真实样本：`real-sample-blocked`
- Worker 独立峰值内存：未测量

| Batch | 状态 | 代码证据 | 自动化证据 | 浏览器证据 | 限制 |
|---|---|---|---|---|---|
| BATCH-7 生产 TraceEngineAdapter 与稳定契约 | `implemented`<br>`automated-verified`<br>`real-sample-blocked` | `src/workbench/traceEngineAdapter.ts`<br>`src/workbench/protocol.ts` | `src/workbench/traceEngineAdapter.test.ts` | 无 | MinimalTraceAggregator is the only production adapter<br>Chromium Trace Engine and Perfetto remain rejected pending real spikes |
| BATCH-8 Timeline Columnar Store、Raw Evidence Store 与索引 | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`real-sample-blocked` | `src/workbench/timelineColumnarStore.ts`<br>`src/workbench/rawEvidenceStore.ts` | `src/workbench/timelineColumnarStore.test.ts`<br>`src/workbench/rawEvidenceStore.test.ts` | `docs/superpowers/reports/workbench-stage1-browser-100k.json`<br>`docs/superpowers/reports/workbench-stage1-browser-500k.json`<br>`docs/superpowers/reports/workbench-stage1-browser-1000k.json` | Synthetic browser corpora do not prove real Trace semantic coverage |
| BATCH-9 生产 Workbench Session 与 Worker Query Protocol | `implemented`<br>`automated-verified`<br>`real-sample-blocked` | `src/workbench/sessionKernel.ts`<br>`src/workbench/client.ts`<br>`src/workers/traceAnalysisWorker.ts`<br>`src/workers/traceWorkerTask.ts` | `src/workbench/sessionKernel.test.ts`<br>`src/workbench/client.test.ts`<br>`src/workers/traceWorkerClient.test.ts` | 无 | The internal entry is not release-accepted |
| BATCH-10 协作式取消、超时与背压 | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`real-sample-blocked` | `src/parsers/trace/readTraceFile.ts`<br>`src/parsers/trace/minimalTraceAggregator.ts`<br>`src/workbench/client.ts`<br>`src/workbench/sessionKernel.ts` | `src/workbench/client.test.ts`<br>`src/workbench/sessionKernel.test.ts`<br>`src/workers/traceWorkerClient.test.ts` | `docs/superpowers/reports/workbench-stage1-browser-1000k.json` | Cancellation latency is browser-benchmark evidence, not a release acceptance |
| BATCH-11 截图与 Raw Evidence 安全生命周期 | `implemented`<br>`automated-verified`<br>`real-sample-blocked` | `src/workbench/rawEvidenceStore.ts`<br>`src/workbench/sessionKernel.ts` | `src/workbench/rawEvidenceStore.test.ts`<br>`src/workbench/sessionKernel.test.ts`<br>`src/parsers/trace/exportTraceReport.test.ts` | 无 | No Filmstrip UI is implemented<br>Decoded screenshot memory uses a conservative estimate when dimensions are absent |
| BATCH-12 集成、feature flag、百万事件与阶段 1 证据 | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`real-sample-blocked` | `src/workbench/featureFlag.ts`<br>`src/components/trace/TraceWorkbenchInternalPanel.tsx`<br>`src/benchmark/workbenchBrowserBenchmark.ts`<br>`scripts/build-workbench-stage1-evidence.js` | `src/workbench/featureFlag.test.ts`<br>`src/components/trace/TraceResultPage.test.tsx` | `docs/superpowers/reports/workbench-stage1-browser-100k.json`<br>`docs/superpowers/reports/workbench-stage1-browser-500k.json`<br>`docs/superpowers/reports/workbench-stage1-browser-1000k.json` | Worker peak memory is unavailable<br>No release-accepted state is claimed |

## 浏览器指标

| 事件数 | JSON bytes | 首次可交互 | 视口 P95 | 选区 P95 | 缩放 P95 | 平移 P95 | 悬浮 P95 | 取消 | 队列 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100,000 | 9,229,806 | 453.8 ms | 2.5 ms | 119.0 ms | 3.7 ms | 2.4 ms | 0.1 ms | 0.4 ms | 2 |
| 500,000 | 46,593,406 | 2395.8 ms | 2.5 ms | 120.3 ms | 3.4 ms | 2.6 ms | 0.0 ms | 0.5 ms | 2 |
| 1,000,000 | 93,297,906 | 4972.1 ms | 2.4 ms | 122.3 ms | 3.4 ms | 2.4 ms | 0.1 ms | 0.4 ms | 2 |

浏览器 smoke、自动化测试和构建均不能替代仓库外真实样本或发布验收。
