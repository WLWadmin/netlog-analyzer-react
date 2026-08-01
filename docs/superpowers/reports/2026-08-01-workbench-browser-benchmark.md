# Performance Workbench 浏览器 Benchmark 基线

## 固定语料

`src/workbench/spike/benchmarkProtocol.ts` 固定三个级别：`SYNTH-WB-100K`、`SYNTH-WB-500K` 和 `SYNTH-WB-1000K`。

语料由 Worker 内的确定性生成器构造，随后执行 UTF-8 编码、模拟文件读取、`JSON.parse`、白名单投影和索引构建。超过既有 128 MiB JSON 限制时直接失败，不提高限制。artifact 同时记录字节规模、事件族、截图字节和 SHA-256。

## 测量

benchmark 入口仅在 production build 设置 `REACT_APP_ENABLE_WORKBENCH_BENCHMARK=1` 时允许激活；普通构建即使带查询参数也继续进入产品页面。页面参数为 `?workbench-benchmark=1`，可增加 `&autorun=1&event-count=100000|500000|1000000`。

每项执行 3 次预热和 10 次有效运行。P50/P95、取消回执、release 回执、队列背压和安全字段均由 `node scripts/build-workbench-stage0-evidence.js` 依据 JSON artifact 重新校验。

## 本轮结果

- 代码 ref：`ec6fc9ab4152118dd0b023d0a6f85863494012bc+review-working-tree`
- UA 报告的 Chrome：151.0.0.0
- 平台：MacIntel
- 逻辑核心：10
- 设备内存：16 GiB
- DPR：1

| 语料 | JSON bytes | 首次可交互 | 视口 P95 | 选区 P95 | Canvas P95 | 取消响应 |
|---|---:|---:|---:|---:|---:|---:|
| `SYNTH-WB-100K` | 9,612,606 | 164.1 ms | 2.0 ms | 134.5 ms | 0.6 ms | 1.5 ms |
| `SYNTH-WB-500K` | 48,507,406 | 750.2 ms | 3.2 ms | 136.9 ms | 0.5 ms | 0.4 ms |
| `SYNTH-WB-1000K` | 97,125,906 | 1421.3 ms | 2.5 ms | 134.8 ms | 0.4 ms | 0.5 ms |

三档语料均完成预热与有效运行，队列峰值不超过 2，取消和 release 返回预期响应，UI 未接收原始事件数组，128 MiB 限制未提高。结果满足设计中的取消不超过 500ms、缩放/平移 P95 不超过 50ms、悬浮 P95 不超过 100ms、选区 P95 不超过 300ms。

Worker 独立峰值内存无法由页面 JavaScript 测量，artifact 明确记录为 `null`。因此这些结果确认三档浏览器功能与时延 smoke，但不能声明完整内存门禁通过，也不能替代仓库外真实样本门禁。
