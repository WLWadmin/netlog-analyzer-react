# Performance Workbench 阶段 3 证据

- 基线：`62d5ea87bb18615e590c23f35af377a87cfceb08`
- 浏览器 runner：`node scripts/run-workbench-stage3-browser.js`（CDP，非 Playwright）
- 专家任务：3 / 12 closed；阶段 3 完整验收：否
- 高置信诊断精确率：1 TP / 0 FP = 100.0%（仅合成审核语料，分母 1）
- 真实样本：`real-sample-blocked`
- Worker 独立峰值内存：未测量
- 发布验收：未接受

| Batch | 状态 | 限制 |
|---|---|---|
| BATCH-20 | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`real-sample-blocked` | The synchronized V5 design is present in the working tree but is not committed by this task |
| BATCH-21 | `implemented`<br>`automated-verified`<br>`synthetic-corpus-verified`<br>`real-sample-blocked` | Real external CPU Profile shapes remain blocked |
| BATCH-22 | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`real-sample-blocked` | Only synthetic CPU profiles have browser evidence; real external profiles remain blocked |
| BATCH-23 | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`real-sample-blocked` | Virtualization is a repository-local bounded window, without a new dependency |
| BATCH-24 | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`real-sample-blocked` | Search covers projected names, categories and tracks; raw args are intentionally unavailable |
| BATCH-25 | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`real-sample-blocked` | Missing relationship evidence is not inferred from temporal proximity |
| BATCH-26 | `implemented`<br>`automated-verified`<br>`synthetic-corpus-verified`<br>`real-sample-blocked` | No trusted page origin degrades classification to unknown; extension IDs are not returned |
| BATCH-27 | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`synthetic-corpus-verified`<br>`real-sample-blocked` | Trace-only overlap never upgrades a finding to confirmed; cross-source causes remain unavailable |
| BATCH-28 | `implemented`<br>`automated-verified`<br>`browser-benchmark-verified`<br>`real-sample-blocked`<br>`stage4-blocked`<br>`stage6-blocked` | Production component CDP verification passed; 12/12 expert tasks are not closed |

| 事件数 | Flame 查询 P95 | Call Tree P95 | Bottom-up P95 | Event Log P95 | Search P95 |
|---:|---:|---:|---:|---:|---:|
| 100,000 | 2.1 ms | 1.8 ms | 1.7 ms | 3.2 ms | 0.6 ms |
| 500,000 | 2.5 ms | 2.6 ms | 2.2 ms | 2.4 ms | 1.7 ms |
| 1,000,000 | 4.9 ms | 4.0 ms | 4.1 ms | 2.5 ms | 0.5 ms |

自动测试、合成语料和本地 CDP benchmark 不替代真实样本、独立 Worker 内存测量或发布验收。
