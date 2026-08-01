# Performance Workbench 阶段 1 状态

- 实施基线：`5ee405903edf9bf9b54c077412369e71034c22dd`
- feature flag：`REACT_APP_ENABLE_TRACE_WORKBENCH=1`
- 发布状态：未验收
- 真实样本：`real-sample-blocked`

## Batch 7

- 代码：`MinimalTraceEngineAdapter` 以现有聚合器为首个实现，报告 DTO 与 Session 数据分离。
- 测试：Adapter 的能力、ID、排序、取消和释放契约。
- 证据：`automated-verified`。
- 限制：Chromium Trace Engine 与 Perfetto 未进入生产依赖。

## Batch 8

- 代码：TypedArray 时间列、去重字符串表、prefix-max-end、实体索引和 Worker Raw Evidence Store。
- 测试：闭区间长事件、continuation、确定性、隐私和释放。
- 证据：`automated-verified`、`browser-benchmark-verified`。
- 限制：合成语料不证明真实 Trace 语义覆盖。

## Batch 9

- 代码：同一 Trace Worker 提交报告后按 flag 保活，用户点击入口后才创建 Session；请求和响应均运行时校验。
- 测试：revision、迟到响应、显式 release、Worker failure、替换和页面卸载路径。
- 证据：`automated-verified`。
- 限制：内部入口不是发布入口。

## Batch 10

- 代码：读取、聚合、索引和查询使用协作式取消；视口采用一个 active 加一个 latest pending。
- 测试：局部取消、timeout、单次取消、队列上限和稳定结果保留。
- 证据：`automated-verified`、`browser-benchmark-verified`。
- 限制：共享机器绝对耗时不作为发布门禁。

## Batch 11

- 代码：截图和原始 args 仅保留在 Worker Evidence Store；截图按需查询、去重、预算和 release。
- 测试：截图重复、超限、白名单详情、failure/release 清零和默认导出隐私。
- 证据：`automated-verified`。
- 限制：没有 Filmstrip UI；缺少尺寸时使用保守解码内存估算。

## Batch 12

- 代码：Trace 报告页提供显式“分析工作台（内部）”入口，flag 关闭时保持原报告行为。
- 测试：flag-off/on、同 Worker 生命周期、三档 production browser benchmark、严格证据生成器。
- 证据：`implemented`、`automated-verified`、`browser-benchmark-verified`、`real-sample-blocked`。
- 限制：Worker 独立峰值内存不可测；没有单一设计合流 ref；不得标记 `release-accepted`。

## Spike 状态

阶段 0 的协议类型和 benchmark envelope 继续作为兼容源；生产模块只通过 `src/workbench/protocol.ts` 门面引用。阶段 0 内存 Kernel 不进入产品 Worker，浏览器 benchmark 已改为使用生产 Adapter、Store 和 Session Kernel，因此不存在两套生产查询实现。
