# Performance Workbench 阶段 2 证据

- 代码基线：`7399b1eec05bd6f846a74f854b117147e6ef8fa7`
- Working-tree diff hash：`a595db38b20bbb3524f22b488db8e20d65e30b8d2997e08feb1e7e55e529b3cc`
- 浏览器 runner：`node scripts/run-workbench-stage2-browser.js`（CDP，非 Playwright）
- V5 设计进入代码 ref：否
- 真实样本：`real-sample-blocked`
- Worker 独立峰值内存：未测量
- 发布验收：未接受

| Batch | 状态 | 代码证据 | 自动化证据 | 浏览器证据 | 限制 |
|---|---|---|---|---|---|
| BATCH-13 阶段 0/1 基线与门禁收口 | `implemented`<br>`automated-verified`<br>`real-sample-blocked` | `src/workbench/featureFlag.ts`<br>`docs/superpowers/reports/workbench-stage0-capabilities.json`<br>`docs/superpowers/reports/workbench-stage2-evidence.json` | `src/workbench/featureFlag.test.ts`<br>`scripts/build-workbench-stage0-evidence.js`<br>`scripts/build-workbench-stage2-evidence.js` | 无 | The V5 design source is not integrated into the current committed code ref<br>Real samples and direct Worker peak memory remain blocked |
| BATCH-14 Timeline 页面骨架与唯一状态所有权 | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`real-sample-blocked` | `src/workbench/timelineInteractionStore.ts`<br>`src/components/trace/workbench/TraceTimelineWorkbench.tsx` | `src/workbench/timelineInteractionStore.test.ts`<br>`src/components/trace/workbench/TraceTimelineWorkbench.test.tsx` | `docs/superpowers/reports/workbench-stage2-ui-validation.json` | The workbench remains behind two internal compile-time flags |
| BATCH-15 Canvas Viewport 与交互合同 | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`real-sample-blocked` | `src/workbench/timelineGeometry.ts`<br>`src/components/trace/workbench/TimelineCanvas.tsx` | `src/workbench/timelineGeometry.test.ts`<br>`src/components/trace/workbench/TimelineCanvas.test.tsx`<br>`src/workbench/client.test.ts` | `docs/superpowers/reports/workbench-stage2-browser-100k.json`<br>`docs/superpowers/reports/workbench-stage2-browser-500k.json`<br>`docs/superpowers/reports/workbench-stage2-browser-1000k.json`<br>`docs/superpowers/reports/workbench-stage2-ui-validation.json` | The repository CDP runner mounts production components; Playwright remains unavailable<br>Synthetic browser corpora do not prove real Trace semantic coverage |
| BATCH-16 Overview、Milestones 与 Network | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`real-sample-blocked` | `src/workbench/timelineTracks.ts`<br>`src/workbench/traceEngineAdapter.ts`<br>`src/components/trace/workbench/TimelineCanvas.tsx` | `src/workbench/timelineTracks.test.ts`<br>`src/workbench/traceEngineAdapter.test.ts` | `docs/superpowers/reports/workbench-stage2-ui-validation.json` | Stage 3 search and filtering are not implemented<br>Trace-only network evidence does not assert DNS, TCP, TLS, proxy, server root cause, or TTFB |
| BATCH-17 Main、Rendering、Interactions 与 Frames | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`real-sample-blocked` | `src/workbench/traceEngineAdapter.ts`<br>`src/components/trace/workbench/TimelineCanvas.tsx` | `src/workbench/traceEngineAdapter.test.ts`<br>`src/components/trace/workbench/TimelineCanvas.test.tsx` | `docs/superpowers/reports/workbench-stage2-ui-validation.json` | Frame budget uses a 60Hz reference and does not infer the actual display refresh rate<br>Flame Chart, Call Tree, Bottom-up, Event Log, and automatic competition attribution are out of scope |
| BATCH-18 Screenshot Filmstrip | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`real-sample-blocked` | `src/workbench/rawEvidenceStore.ts`<br>`src/components/trace/workbench/ScreenshotFilmstrip.tsx` | `src/workbench/rawEvidenceStore.test.ts`<br>`src/workbench/sessionKernel.test.ts`<br>`src/components/trace/workbench/ScreenshotFilmstrip.test.tsx` | `docs/superpowers/reports/workbench-stage2-browser-100k.json`<br>`docs/superpowers/reports/workbench-stage2-ui-validation.json` | Real external screenshot Trace files are not available in this environment |
| BATCH-19 双向导航、响应式、可访问性与阶段 2 验收 | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`real-sample-blocked` | `src/components/trace/workbench/TraceTimelineWorkbench.tsx`<br>`src/components/trace/traceResultPage.css`<br>`src/benchmark/stage2ProductBenchmark.tsx`<br>`scripts/run-workbench-stage2-browser.js`<br>`scripts/build-workbench-stage2-evidence.js` | `src/components/trace/workbench/TraceTimelineWorkbench.test.tsx`<br>`src/components/trace/TraceWorkbenchInternalPanel.test.tsx`<br>`src/components/trace/TraceResultPage.test.tsx` | `docs/superpowers/reports/workbench-stage2-ui-validation.json` | Playwright is not installed; local Chrome/CDP is used for this stage<br>Visual screenshots are local validation artifacts and are not committed because they may contain rendered screenshot frames |

## 产品组件浏览器指标

| 事件数 | JSON bytes | 视口 P95 | 选区 P95 | Canvas P95 | 缩放 P95 | 平移 P95 | 悬浮 P95 | 取消 P95 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100,000 | 8,573,206 | 4.2 ms | 34.6 ms | 67.3 ms | 32.7 ms | 33.9 ms | 65.7 ms | 22.1 ms |
| 500,000 | 43,310,406 | 4.0 ms | 33.2 ms | 65.6 ms | 34.5 ms | 33.4 ms | 65.7 ms | 2.6 ms |
| 1,000,000 | 86,731,906 | 35.8 ms | 33.7 ms | 66.5 ms | 34.1 ms | 34.0 ms | 64.7 ms | 15.7 ms |

自动测试、合成产品组件 benchmark 和本地 UI 验证均不能替代仓库外真实样本或发布验收。
