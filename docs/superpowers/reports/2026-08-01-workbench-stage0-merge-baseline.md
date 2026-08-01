# Performance Workbench 阶段 0 合流基线附件

## 结论

截至 2026-08-01，尚不存在一个同时包含可靠接入、Batch 6 功能和 V5 设计的已提交 Git ref。

- 当前实施基线：`ec6fc9ab4152118dd0b023d0a6f85863494012bc`
- 当前分支：`feat-netlog-offline-workbench-8u1Ea4`
- 工作树开始状态：干净
- 功能来源：`feat-trace-batch-3-facts`，与当前 HEAD 相同
- 设计提交：`80fd2d3e742091ce05af4f99818a29508d30bc05`
- V5 设计：位于设计 worktree 的未提交修订，不属于 `80fd2d3`

创建单一合流 ref 必须执行 merge/cherry-pick 和 commit。用户明确禁止代理自行 commit，并要求改变历史前停止，因此本轮没有执行合流，也不能把当前脏工作树称为最终合流 ref。该项是阶段 0 未通过门禁。

## Git 对象核验

| 对象 | 完整 SHA | 关系 |
|---|---|---|
| 当前 HEAD / `feat-trace-batch-3-facts` | `ec6fc9ab4152118dd0b023d0a6f85863494012bc` | 包含可靠接入和 Batch 6 |
| 本地 `master` | `6d6dad800cba77445558033b1e0ecc3ff394cd0d` | 合并设计分支，不包含功能分支 |
| 设计分支 | `80fd2d3e742091ce05af4f99818a29508d30bc05` | 不在当前 HEAD 祖先链 |
| 设计分支与功能分支共同基线 | `68d72ac0a5b8b8e070147581e994483dee162d2a` | 两分支在此后分叉 |
| `master` 与功能分支共同基线 | `56386d20e51dc0c8c7ddb46af07a57f1a56e6ecc` | `master` 不能证明包含 Batch 6 |

核验使用了 `git rev-parse`、`git merge-base`、`git merge-base --is-ancestor`、`git ls-tree`、`git show <ref>:<path>` 和 `git merge-tree`。`git merge-tree` 未报告已提交设计分支与功能分支的文本冲突，但 V5 未提交修订仍必须单独纳入并复核。

## 能力来源

| 能力 | 来源 ref | 文件证据 |
|---|---|---|
| 可靠接入 | `374262f`，当前 HEAD 的祖先 | `src/upload/createFileFormatIntake.ts`、`src/upload/fileFormatRegistry.ts`、`src/upload/useAnalysisIntake.ts` |
| 未知 JSON 不默认回退 NetLog | `374262f`，当前 HEAD 的祖先 | `src/upload/resolveFileFormat.ts`、`src/parsers/trace/sourceSniffer.ts` |
| 真实工作量进度 | 当前 HEAD | `src/upload/analysisProgress.ts`、`src/upload/parserProgress.test.ts` |
| Trace Worker 解析 | 当前 HEAD | `src/workers/traceAnalysisWorker.ts`、`src/workers/traceWorkerTask.ts` |
| Trace 事实与诊断 | `68d72ac` 至 `ec6fc9a` | `src/parsers/trace/minimalTraceAggregator.ts`、`src/diagnosis/trace/` |
| 白名单导出 | `ec6fc9a` | `src/parsers/trace/exportTraceReport.ts` |
| 五样本门禁机制 | `ec6fc9a` | `src/benchmark/traceBatch6RealSamples.test.ts` |
| V5 设计 | 未提交设计 worktree 修订 | `docs/superpowers/specs/2026-07-31-offline-performance-workbench-design.md` |
| 阶段 0 协议与查询 Spike | 当前工作树 | `src/workbench/spike/`、`src/benchmark/workbenchBrowserBenchmark.ts` |

生产 `traceAnalysisWorker.ts` 仍向聚合器传入 `isCancelled: () => false`。本轮 Spike 验证了局部查询取消，但没有把它包装成生产阶段 1 实现。

## 最小安全合流方案

该方案仅记录，不在本轮执行：

1. 由用户决定目标分支和提交边界。
2. 将 `80fd2d3` 合入当前功能分支，保留 merge 记录或采用用户指定的非重写策略。
3. 将设计 worktree 的 V5 未提交修订作为独立文档改动纳入。
4. 将本轮阶段 0 文件纳入同一可审阅提交序列。
5. 在最终提交上重跑构建、契约测试、benchmark 和真实样本门禁。
6. 将最终完整 SHA 回填到能力表、ADR、协议契约和 benchmark artifact。

在用户授权前，不执行 commit、push、rebase、reset 或 PR 操作。
