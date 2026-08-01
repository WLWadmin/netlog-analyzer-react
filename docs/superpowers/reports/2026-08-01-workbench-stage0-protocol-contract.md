# Performance Workbench 阶段 0 协议与 DTO 契约

## 边界

- `TraceAnalysisResult` 继续服务现有报告页。
- Workbench UI 只接收 `WorkbenchSessionDescriptor`、视口事件 DTO 和事件详情 DTO。
- 原始 `traceEvents`、`args`、截图字节和 `privateDetail` 不属于 UI 协议。
- 阶段 0 实现位于 `src/workbench/spike/`，未接入生产上传流程或 `traceAnalysisWorker.ts`。

协议 schema 为 `1`，定义源为 `src/workbench/spike/protocol.ts`。

## 请求

| type | 必需关联字段 | 语义 |
|---|---|---|
| `create-session` | `schemaVersion`、`requestId`、source ref | 绑定已经确认的 parser/source，不传原始事件数组 |
| `query-viewport` | `sessionId`、`sessionRevision`、`requestId`、range、limit | 返回所有与闭区间相交的事件 |
| `query-event-detail` | session ref、requestId、eventId | 返回白名单详情 |
| `cancel-query` | session ref、requestId、targetRequestId | 只取消目标查询 |
| `release-session` | session ref、requestId | 释放索引、查询、Blob URL 和 Transferable 引用 |

## 响应

响应是版本化可判别联合类型：

- `progress`：真实 `events` 单位。
- `session-created`
- `viewport-result`
- `event-detail-result`
- `query-cancelled`
- `session-released`
- `capability-missing`
- `structured-error`

错误码固定为：

- `unsupported-capability`
- `invalid-range`
- `query-cancelled`
- `query-timeout`
- `result-truncated`
- `session-released`
- `worker-failed`

成功结果的截断通过 `WorkbenchTruncation` 明示 `returnedCount`、`totalMatched` 和 continuation。调用方设置 `allowTruncation=false` 时，截断提升为 `result-truncated` 结构化错误；不得静默截断。

## 会话与迟到响应

UI 接受响应前同时检查：

1. `sessionId` 等于当前会话。
2. `sessionRevision` 等于当前 revision。
3. 视口或详情响应的 `requestId` 等于该查询通道的 latest request。

任一不匹配都只增加 discarded 计数，不更新稳定画面。相关实现为 `WorkbenchSpikeClientState`。

Worker 边界同时校验请求、响应和 benchmark 外层 envelope。未知类型、缺失字段、非法 session/revision 或不完整 DTO 不进入客户端状态；重复 `requestId` 不允许覆盖尚未完成的 pending promise。

高频视口变化使用 `LatestViewportDispatcher`：

- 最多一个 active 和一个 latest pending。
- 新请求替换旧 pending。
- 每个 active 至多发送一次局部取消；后续高频请求只替换 latest pending。
- 取消或错误不清空已提交的稳定结果。

## 区间查询

事件按 `(startUs, sourceIndex)` 稳定排序，同时维护 prefix max end。查询先用 prefix max end 找到可能与范围左边界相交的最早事件，再用 start time 上界限制右侧候选，最后检查 `event.endUs >= range.startUs`。

该算法不会漏掉从视口外开始、在视口内结束的长事件。阶段 0 只验证正确性与风险，不将该内存实现声明为百万事件生产索引。

## 资源释放

`release-session` 和 worker failure 执行：

- 标记并取消该会话 active queries。
- 清空 event map、排序列和 prefix max end。
- 调用注入的 Blob URL revoker。
- 清空 Transferable 引用。
- 删除会话；后续迟到查询因会话不存在返回 `session-released`，不保留无界 tombstone 集合。

浏览器 Worker 客户端关闭时还会移除监听器、reject pending promise 并 terminate Worker。

## 验证

`src/workbench/spike/kernel.test.ts` 覆盖：

- 判别联合类型和完整错误码集合。
- session/revision/request 过期响应。
- 局部取消且稳定结果不变。
- release 后查询。
- 重叠区间。
- 截断与 continuation。
- worker failure。
- Blob URL、Transferable、索引和查询释放。
- 详情白名单。
- 同一输入的 DTO 和 ID 确定性。
- 高频请求队列上限。

10 万、50 万和 100 万事件 Chrome benchmark 另外验证真实 Worker 消息、Canvas、取消和 latest-wins。完整结果见三个 `workbench-browser-benchmark-*.json` artifact。
