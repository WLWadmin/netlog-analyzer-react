# ADR：Performance Workbench Trace 引擎基线

- 状态：Accepted for stage 0
- 日期：2026-08-01
- 决策范围：阶段 0 Spike，不引入生产依赖

## 决策

阶段 1 以前继续以现有 `MinimalTraceAggregator` 作为生产基线，不把 Chromium DevTools Trace Engine 或 Perfetto Trace Processor 加入生产依赖。

这不是认定现有聚合器具备完整 Workbench 能力。它只是当前唯一已经通过本仓库构建、测试、隐私投影和部分真实样本验证的实现。阶段 1 若启动，应先围绕已冻结协议实现适配器；Chromium Trace Engine 只有在隔离 real Spike 通过后才能成为候选。Perfetto 暂不作为 CRA 5 纯浏览器首选，因为官方主路径是 C++/CLI/RPC，浏览器 WASM 交付、包体和本地隐私边界尚无本仓库证据。

## 证据

已实际执行：

- `node scripts/trace-spike/self-test.js`：27/27 通过。
- `node scripts/trace-spike/run-spike.js --dry-run`：工具边界、投影和清理流程通过；明确没有安装引擎、读取 manifest、读取样本或启动 Chromium。
- `npm view @paulirish/trace_engine@0.0.65 ...`：版本 `0.0.65`、BSD-3-Clause、unpacked size 15,773,065 bytes、618 files，依赖 `third-party-web` 与 `legacy-javascript`。
- 包 README 明确标记 “NOT FOR PUBLIC CONSUMPTION” 和 API 不稳定；入口接收 raw trace event array，支持 all handlers 或选择性 handlers。
- `npm view @perfetto/trace_processor` 返回 404；`perfetto` npm 包已撤下，不能据此建立 CRA 5 浏览器依赖。
- Perfetto 官方文档确认 Trace Processor 是 C++ 库，支持多格式摄入、SQL、分块 `Parse`、CLI 和 HTTP/stdio RPC。
- 当前仓库 production build 通过；阶段 0 Workbench Worker chunk 可由 CRA 5 构建并在 Chrome 151 运行。

未实际执行：

- Chromium Trace Engine `0.0.65` 的安装、CRA 5 build、Jest、Worker、五样本三次运行、包体增量和峰值内存。
- Perfetto C++/WASM 的下载、浏览器加载、Worker、查询、包体、内存和取消测试。
- 三引擎在同一 10 万/50 万/100 万语料上的可比 benchmark。

## 能力矩阵

| 维度 | MinimalTraceAggregator | Chromium DevTools Trace Engine | Perfetto Trace Processor |
|---|---|---|---|
| Trace 形状 | 已验证 Chromium object `traceEvents`；顶层数组不支持 | README 显示 raw event array；五样本形状未验证 | 官方称支持多种格式；本项目 Chromium JSON 形状未验证 |
| CPU Profile | 已实现采样与事实，报告级验证 | handlers 暗示支持，未做本仓库 real Spike | 可通过导入表/SQL实现，具体网页 CPU 语义未验证 |
| Network | 已实现请求生命周期与 initiator 事实 | `NetworkRequestHandler` 有文档证据，未跑样本 | 通用 slice/track/SQL 可查询，网页请求语义未验证 |
| Rendering | 已实现渲染事实与 Forced Reflow | DevTools 主引擎理论覆盖，未跑样本 | 通用事件可查询，DevTools 语义映射未验证 |
| Interaction | 已实现 EventTiming 配对事实 | 理论覆盖，未跑样本 | 未验证 |
| Frames | 已实现 animation frame 与 rendering facts | 理论覆盖，未跑样本 | 未验证 |
| Screenshot | 未实现 | 理论覆盖，未跑样本 | 未验证 |
| CRA 5 / Worker | 当前生产已通过；阶段 0 Worker chunk 已通过 | 未验证；包含 DOMRect 等浏览器/Node 差异 | 无可直接采用的 npm 浏览器包，本仓库未验证 |
| 浏览器支持 | 项目当前 Chrome 路径通过 | 未验证目标浏览器矩阵 | 未验证 WASM/Worker/browser matrix |
| 隐私边界 | 原始事件留在 Worker；报告白名单导出已有测试 | engine data 结构可能保留大量原始字段，必须另加投影 | SQL/RPC 结果可控，但 WASM 内存、文件和 RPC 边界未验证 |
| 大文件性能/内存 | 全量 `JSON.parse`，受 128 MiB 限制；百万事件未验证 | 单次遍历 handlers，但包体、峰值内存未验证 | 原生支持分块 Parse 和 SQL；浏览器 WASM 成本未验证 |
| API 稳定性 | 仓库自有，变更可控 | README 明示不稳定，升级维护成本高 | C++/SQL/RPC 公共面较稳定，但浏览器封装成本高 |
| 取消 | 聚合器有检查点；生产 Worker 仍传恒定 false | README 只有进度事件证据，协作式取消未验证 | 查询/解析取消能力未在本仓库验证 |
| 增量解析 | 不支持；完整 JSON 后聚合 | raw array parse，不足以证明增量摄入 | C++ API 明确支持重复 `Parse` chunk；浏览器路径未验证 |

“理论覆盖”不等于 `implemented-verified`。

## 拒绝方案

### 立即引入 Chromium Trace Engine

拒绝。理由：

- API 明示不稳定且非公开消费接口。
- 未完成 exact version 的隔离安装、许可证树、CRA/Jest/Worker、五样本、包体和峰值内存验证。
- 直接依赖其 handler DTO 会把生产协议绑定到候选引擎。

### 立即引入 Perfetto Trace Processor

拒绝。理由：

- 官方主实现是 C++；当前不存在经核验可直接采用的 npm 浏览器包。
- WASM/Worker/RPC 方案会扩大阶段 0 的构建、部署和隐私边界。
- 网页 Performance 的 CPU、Network、Rendering、Interaction、Frames、Screenshot 语义映射均未验证。

### 在阶段 0 重写现有聚合器为完整引擎

拒绝。理由：这会提前实施阶段 1 至阶段 3，并掩盖候选引擎仍缺少的比较证据。

## 后续必须验证

1. 在用户提供外部 manifest 并授权隔离执行后，使用 `scripts/trace-spike/run-spike.js --execute` 验证 Chromium 候选。
2. 为 Perfetto 先确定官方可维护的浏览器嵌入交付物，再做独立 WASM/Worker Spike。
3. 三个候选使用相同语料记录字节、事件族、截图、P50/P95、传输、内存、取消和确定性。
4. 在证据形成前，不修改生产依赖或锁文件。
