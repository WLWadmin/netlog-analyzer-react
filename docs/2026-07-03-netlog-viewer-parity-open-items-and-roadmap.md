# NetLog Viewer Parity 未完成项与后续方向计划

日期：2026-07-03

## 2026-07-06 收口状态

本轮已按本文剩余清单完成可由当前仓库和本机样本闭环的事项：

```text
1. 326MB 真实样本已完成 upload-single-scan、upload-fallback、dataset-import/browser-worker 对照。
2. DNS answer 差异报告已更新：326MB 样本 endpoint=248、DNS State=247、both=247、endpoint-only=1、state-only=0。
3. Socket source graph 已复测：326MB 样本 socketPeerTotal=598、sourceGraphAssociated=328、globalCandidate=270、hostTimeCandidate=0。
4. Raw search 真实样本 worst-case/p95 已复测，并补了“新查询重新计算不完整状态”的回归测试。
5. 诊断 confirmed guard 已扩展到导出/复制文本扫描，覆盖 state fact/candidate 被 confirmed 包装的风险。
6. 全量测试和 build 已通过。
```

当前唯一不能在本机完全消除的门禁是：

```text
缺少第二个 >=100MB 的真实 NetLog 大文件样本来触发 upload-single-scan 路径。
```

本机可用第二样本 `chrome-net-export-log.json` 为 77,388,480 bytes，低于当前大文件阈值 100MB，因此只能补 Dataset/import/raw search/socket/DNS 多样本证据，不能作为 single-scan 默认开启证据。结论：parity 证据闭环已完成，`single scan 默认开启` 仍应保持关闭，直到提供第二个可触发大文件 single-scan 的真实样本。

本文用于后续 AI coding 接手。它基于当前最新代码、官方网络诊断资料、本地测试和 326,930,225 字节 NetLog 样本 benchmark，不沿用旧判断。

## 0. 最短执行摘要

2026-07-03 打断后最新复核：其他 AI coding 提到的五刀，源码层已经能看到对应实现入口和 targeted tests。不要再按旧文档把这些当成“完全未做”：

```text
1. DNS answer 口径对齐：已抽出共享 dnsAnswerCandidates helper，并被 streaming analyzer / DNS State reducer / Endpoint Evidence reducer 复用。
2. socket peer 与 source graph 关联率提升：Endpoint reducer 已输出 source graph 关联统计、global-candidate 分布和 unresolved reasons。
3. 状态树增强：Proxy / QUIC / HTTP/2 / Sockets reducers 已从基础计数推进到更多 state/error/source link 聚合。
4. 诊断端到端防误判：final summary / combined / export 相关测试已覆盖 proxy/protocol/DNS answer/socket peer/x-request-ip 等不能误升 confirmed 的路径。
5. 一次扫描主路径：`REACT_APP_ENABLE_NETLOG_SINGLE_SCAN_DATASET=1` 已接入大文件 worker 路径，成功时一次返回 summary + Dataset meta，失败时回退旧 summary fallback。
```

但这五刀还不能直接标记“目标完成”。当前缺的是证据闭环，不是继续堆功能：

- 还没有用真实 326MB 样本复跑 single scan 浏览器上传路径，不能证明“大文件解析慢”已经解决。
- 还没有给出新代码下 `dnsRecords=41`、Dataset DNS answer、Endpoint Evidence DNS answer 的差异报告，不能证明 DNS IP 展示已经全量且口径一致。
- 还没有用真实样本复核 socket peer 关联率是否从旧的 `52/827` 明显提升，不能证明 CIP/SIP/socketPeer 展示不全已经闭环。
- 还没有跑全量测试和 build；本轮只跑了目标相关的 targeted suites。
- Proxy / QUIC / HTTP/2 / Sockets 状态树增强已经推进，但仍需证明状态事实不会在 UI/导出/复制文本中被误写成 confirmed 根因。

下一刀必须回答：

```text
1. 开启 single scan flag 后，326MB 文件真实浏览器上传是否只扫描一次？
2. single scan 和 fallback 双扫路径分别耗时多少：first diagnosis、Dataset ready、UI takeover、main thread blocked？
3. 新 DNS helper 下，summary / DNS State / Endpoint Evidence 的 DNS answer 数量为什么相同或不同？
4. 新 source graph 下，socketPeerSourceGraphAssociated、globalCandidate、unresolved reasons 在真实样本上分别是多少？
5. Dataset ready 后，Events/Data Loaded/DNS/Proxy/QUIC/HTTP2/Sockets/Endpoint Evidence 是否全部来自 Dataset？
6. raw search 达到扫描/耗时上限时，UI 是否明确说明结果不完整，并引导用户先加过滤条件？
```

下一刀不要做：

- 不要把 DNS answer / socket peer 塞进 SIP。
- 不要把 DoH candidate 塞进 DNS server。
- 不要把 Proxy/QUIC/HTTP2/Sockets 状态事实接进 confirmed。
- 不要在原始 NetLog / Dataset / raw detail 不可用时给 confirmed。
- 不要默认打开 single scan；必须先拿真实样本 telemetry 证明它优于 fallback 双扫且指标不丢。

交付时必须附：

```text
10.4 真实样本回归证据包
10.8 PR / 交付审查清单自检结果
```

## 1. 当前结论

当前代码已经比上一轮计划推进明显：

- Dataset 后台索引入口已存在，并且 `importNetlogDatasetInWorker(file)` 已传入 `largeNetlogTimeout(file.size)`。
- 大文件 single scan 路径已存在：`parseUploadedInput.ts` 通过 `REACT_APP_ENABLE_NETLOG_SINGLE_SCAN_DATASET=1` 传入 `singleScanDataset`，`analysisWorker.ts` 在同一次 `buildNetlogCompactEventIndex()` 扫描中把事件送入 streaming analyzer 和 Dataset reducers，成功时返回 `datasetMeta`，失败时回退旧路径。
- 上传链路 telemetry 已明显增强：`App.tsx` 记录 `upload-start`、`summary-ready`、`dataset-auto-start`、`dataset-progress`、`dataset-ready`、`dataset-error`、`dataset-takeover`。
- Dataset raw search 已有扫描/耗时保护：query 结果返回 `scanned`、`scanLimitHit`、`timeLimitHit`、`hasMoreMatchesUnknown`，`DatasetEventsTab` 已有结果不完整提示。
- `ExpertAnalysisTab.tsx` 源码中未再搜到“完整 Dataset 查询将在后续阶段启用”这句旧文案；旧表述只还残留在本文档历史判断里。
- DNS answer 已有共享 helper：`src/parsers/netlog/dnsAnswerCandidates.ts` 输出 `hostResolverCache`、`dnsTaskResult`、`genericDnsEvent`、`summaryOnlyCandidate` 等 source kind。
- Endpoint Evidence 已输出 source graph 关联统计、global candidate 分布和 unresolved reasons。
- Batch E 根因守门已推进：`combined` 模式不再单靠 high confidence / 双源证据进入 `confirmed`，会经过 `canBeConfirmedRootCause()`。
- Dataset Events 已支持 `sourceId`、`sourceChainId`、type/source name、phase、time range、errorOnly、text/params 搜索和筛选状态保存。
- Data Loaded、DNS、Proxy、QUIC、HTTP/2、Sockets 都已有 Dataset state view 基础实现，不再是完全空白。
- Endpoint Evidence 已有 source dependency 图、trace、association、CIP/SIP/socketPeer/dnsAnswer/x-request-ip 分列。
- 本轮 targeted tests 绿色；全量测试和 build 需要在真实样本回归后再跑一遍。

但这还不是 netlog.viewer parity 完成：

- 326MB 样本在真实浏览器 Worker 直跑 Dataset import 已经明显快于 Node/Jest 基线：约 12.963 秒，主线程阻塞约 57ms；但这只证明 Dataset Worker 直导路径可行，还没有证明真实上传流程没有被 summary fallback 双扫拖慢。
- Node/Jest Dataset benchmark 约 166 秒，不能作为用户体感结论，但可保留为非浏览器 baseline。
- 真实样本 endpoint evidence 旧基线关联率低：827 个 socket peer 中只有 52 个 source-graph 关联，775 个仍是 global-candidate。新代码已增强关联统计，但尚未用同一真实样本复测新数值。
- Dataset DNS answer 数量与 summary 日志旧口径不一致：旧使用日志 `dnsRecords=41`，旧 Dataset benchmark `dnsAnswerCount=27`。新共享 helper 已落地，但尚未输出新差异报告。
- Proxy / QUIC / HTTP/2 / Sockets 已从基础聚合继续增强，但仍不是完整 netlog.viewer 级状态树；重点是先证明“状态事实不误判根因”和“可跳 source/event/raw detail”。
- Source Chain 页面仍主要依赖 summary/preview events，尚未接 Dataset source graph query。
- Raw search 已有保护字段和 UI 提示，但仍需真实大文件 worst-case / p95 验证。

最新代码复核补充：

- 默认路径仍可能是 summary fallback 先出、Dataset 后台再接管；single scan 需要 flag 开启，且不能默认视为生产主路径已完成。
- single scan 的实现是真实的一次扫描入口，但当前仍通过 `buildNetlogCompactEventIndex()` 解析事件对象并把事件送给 analyzer/reducers。它解决了“双扫”结构问题，但是否解决大文件慢，需要浏览器真实上传 benchmark 证明。
- `App.phase3.test.tsx` 已覆盖 fallback 背景 Dataset 索引和 single scan ready 后不再后台索引。
- `parseUploadedInput.test.ts` 已覆盖 single scan 成功和失败 fallback。
- `netlogDatasetQuery.test.ts` 已覆盖 raw search scan/time limit 字段。
- DNS helper 和 Endpoint reducer targeted tests 已通过，但真实样本 41 vs 27 差异需要重新跑。

2026-07-03 续审补充：

- 工作树当前没有可见源码 diff；`docs/` 被 `.gitignore` 忽略，所以本文档需要 `git add -f` 才能提交。
- 已发现 single scan 开关：`REACT_APP_ENABLE_NETLOG_SINGLE_SCAN_DATASET=1`。后续审查要同时看 flag on/off 两条路径。
- `DatasetEventsTab` 已有 type/source/time/error/raw text 搜索 UI，并已接入 raw search 不完整提示；后续还要补浏览器 worst-case 性能证据和取消/新查询覆盖体验验证。
- `finalSummaryBuilder`、`fromNetlog/fromCombined`、`exportReport` 已有更多防误判测试；后续仍要用真实 reducer 输出串到 UI/导出做端到端证据包。
- Proxy/QUIC/HTTP2/Sockets state reducer 已增强，这是正确方向；后续不要反向把这些 state fact 接进根因权重。

## 2. 外部定因规则基线

后续诊断规则必须遵守这些网络事实：

- Chrome DevTools Network timing 将请求拆为 DNS、initial connection、SSL、request sent、Waiting/TTFB、download 等阶段；TTFB 包含一段网络往返延迟和服务端准备响应时间。因此没有同 host 的 DNS/TCP/TLS/Proxy/net_error 证据时，不能把 TTFB 慢直接写成客户端网络根因。
- MDN PerformanceResourceTiming 也把 DNS lookup、TCP handshake、TLS negotiation、request time、fetch time 拆开计量；这些阶段应分别映射到不同排查方向。
- Chromium NetLog 事件是扁平事件流，必须依赖 `source.id`、`source.type`、`phase` 和 `params` 把事件归成逻辑链路。不能把 eventId 当 sourceId，也不能只靠 20,000 preview events 做全量判断。
- NetLog 的 `params` 是事件特定参数，不同 Chrome 版本会变动；所有 reducer 都要保留 evidence gap 和 raw event 跳转。
- Chromium 文档明确 NetLog 是 logging 机制，不是稳定业务接口；本项目可以用它做诊断证据展示，但不能把单个日志字段当作永远稳定的定因 API。字段漂移时应降级为 evidence gap，而不是硬判根因。

参考：

- Chrome DevTools Network reference: https://developer.chrome.com/docs/devtools/network/reference/
- MDN PerformanceResourceTiming: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming
- Chromium NetLog design: https://www.chromium.org/developers/design-documents/network-stack/netlog/
- Chromium net error list: https://source.chromium.org/chromium/chromium/src/+/main:net/base/net_error_list.h

2026-07-03 官方资料复核补充：

- Chrome DevTools 把 Timing 明确拆成 DNS Lookup、Initial connection、Proxy negotiation、Request sent、Waiting (TTFB)、Content Download；其中 TTFB 同时包含一次 RTT 和服务端准备响应时间。这意味着“TTFB 慢”本身不是客户端网络根因。
- MDN Resource Timing 给出了 DNS、TCP、TLS、request、response 等阶段的独立时间戳和计算方式；HAR/Performance 的阶段耗时应当映射到这些阶段，而不是压成一个“网络慢”结论。
- Chromium NetLog 设计说明强调 NetLog 是网络栈事件日志，event stream 是扁平事件流，必须通过 source id/type/phase 和 params 做逻辑归组；并且 NetLog 不是稳定业务接口，字段漂移时应降级为 evidence gap。
- Chromium net error list 可用于解释 `net_error`，但只能作为错误码语义来源；错误码必须和 request/source/time/raw event 关联后，才能进入 confirmed 候选。

## 3. 诊断证据分级和升级规则

本项目要比 netlog.viewer 更可读，但不能比它更武断。netlog.viewer 偏“完整展示事件和状态”，本项目可以输出“小白可理解结论 + 下一步操作”，前提是每个结论都能从证据层级升级而来。

### 3.1 证据分级

| 等级 | 可输出文案 | 典型证据 | 禁止行为 |
|---|---|---|---|
| State fact | 环境事实 | DNS server 配置、DoH candidate、Proxy config、QUIC/HTTP2 是否出现、socket peer 候选 | 不能写成故障根因 |
| Candidate | 排查线索 | DNS answer、socket peer、x-request-ip、global-candidate IP、协议错误但未关联 request | 不能放进 CIP/SIP/SERVER 根因列 |
| Request-scoped evidence | 请求级证据 | 同 URL_REQUEST/source chain/time window 的 DNS/TCP/TLS/Proxy/net_error | 可以进入根因候选，但仍要检查是否和用户问题一致 |
| Confirmed root cause | 确认根因 | 失败/慢请求与明确 NetLog error、阶段耗时、source/event/raw byte range 对齐 | 必须提供 event/source/byte range 或可跳转证据 |

### 3.2 TTFB 慢的处理

Chrome DevTools 明确把 DNS Lookup、Initial connection、Proxy negotiation、Request sent、Waiting (TTFB)、Content Download 拆成不同阶段；TTFB 包含一次网络往返和服务端准备响应的时间。MDN Resource Timing 也把 DNS、TCP、TLS、request、response 阶段拆成独立时间戳。

因此：

- 只有 HAR/Performance 里 TTFB 慢，不能输出“客户端网络问题 confirmed”。
- 若同 host/source/time 没有 DNS/TCP/TLS/Proxy/net_error 证据，应输出：`请求等待首字节慢，可能在服务端/CDN/回源/网络 RTT 任一环节；当前 NetLog 未发现客户端网络栈错误。`
- 若有同请求的 DNS 慢、connect 慢、TLS 失败、proxy tunnel 失败、socket timeout、QUIC/HTTP2 stream reset，才进入 request-scoped evidence。
- 若只有 DNS answer、socket peer 或协议状态事实，只能写“线索”，不能写“根因”。

### 3.3 DNS / IP 定因边界

DNS 相关输出必须分开：

- `DNS server`：只表示客户端配置或系统观测到的解析服务器。
- `DNS answer`：只表示某 host 被解析到哪些 IP，不代表这些 IP 一定被实际连接。
- `DoH candidate`：只表示安全 DNS 配置或模板线索，不等同当前 DNS server。
- `socketPeer`：表示连接层 peer 候选，只有和 URL_REQUEST/source chain 关联后，才可说明“这个请求实际连接到该 peer”。
- `cip/sip`：只能来自明确 header 或业务语义字段，不能用 DNS answer 或 socketPeer 补齐。

用户问“为什么 DNS IP / CIP / SIP 没展示全”时，产品上应优先解释：

```text
这不是简单的 IP 缺失，而是证据角色不同：
- DNS answer 有 IP，但只是解析结果。
- socket peer 有 IP，但部分未能关联到具体 URL_REQUEST。
- CIP/SIP 需要明确字段或业务 header，不能用 DNS/socket 候选强行填充。
```

### 3.4 NetLog parity 和可读诊断的关系

NetLog 是扁平事件流。要做 netlog.viewer parity，必须先保证完整事件、source、phase、params、byte range 可查询；要做可读诊断，则必须在完整事件之上增加保守的证据升级规则。

落地规则：

- Events / Data Loaded / DNS / Proxy / QUIC / HTTP2 / Sockets 是浏览器 netlog.viewer parity 面。
- Final Diagnosis / Next Steps 是本项目产品增强面。
- parity 面可以展示状态事实；诊断面只能把 request-scoped failure evidence 升级为 confirmed。
- 每个 reducer 都要输出 `evidenceGaps`，说明“没有看到什么”与“不能推出什么”。
- 每条进入诊断卡片的证据都应保留 `eventId/sourceId/byteStart/byteEnd` 或 request URL/time anchor。

### 3.5 诊断输出模板

后续诊断文案必须固定分层，避免一句话把线索写成结论。

每张诊断卡建议结构：

```text
结论级别：confirmed | likely | candidate | evidence-gap | info
一句话结论：用用户能懂的话说明发生了什么。
证据：列出 request/source/event/byte range/阶段耗时/错误码。
不能推出：明确说明哪些常见结论当前不能推出。
下一步：给 1-3 个可操作动作。
```

示例模板：

```text
confirmed:
结论：这个请求失败与客户端网络栈错误有关。
证据：同一 URL_REQUEST/source chain 中出现 net_error=-105，eventId=..., sourceId=..., byteStart=..., byteEnd=...
不能推出：不能仅凭该错误说明 DNS server 配置错误，除非同时有 DNS server 配置或 DNS task 证据。
下一步：检查对应域名 DNS 解析链路，重试同域名请求并对比 DNS task result。

candidate:
结论：发现 DNS answer 指向多个 IP，这是解析线索，不是确认连接目标。
证据：host=...，DNS answer IP=...，eventId=...
不能推出：不能把这些 IP 当成 SIP，也不能说明这些 IP 都被实际连接。
下一步：查看 socket peer 或 URL_REQUEST source chain，确认实际连接目标。

evidence-gap:
结论：请求 TTFB 慢，但当前 NetLog 没有同 host 的 DNS/TCP/TLS/Proxy/net_error 证据。
证据：HAR/Performance 显示 TTFB 高；NetLog 未发现同源网络栈失败锚点。
不能推出：不能确认是客户端网络问题；可能是服务端、CDN、回源或网络 RTT。
下一步：补采 HAR + NetLog 同时段日志，或在服务端/CDN 侧查询 request id / logID。
```

禁用措辞：

- 禁止：`DNS 服务器异常`，除非有 DNS server 配置或 DNS transaction 失败证据。
- 禁止：`SIP 是 ...`，除非来自明确 SIP 字段或已确认 request-scoped 连接目标。
- 禁止：`代理导致失败`，除非 proxy error / tunnel failure / bad proxy 与失败请求关联。
- 禁止：`QUIC/HTTP2 导致问题`，除非协议错误与 request/stream/session 关联。
- 禁止：`客户端网络问题 confirmed`，如果只有 TTFB、状态事实、DNS answer、socket peer candidate 或 x-request-ip。

报告导出也必须保留这些级别，不能在导出摘要里把 `candidate/evidence-gap/info` 压缩成 `confirmed`。

### 3.6 无法定因时的输出规则

用户更需要“准确且可执行”，不是看起来确定但实际不可用的结论。后续诊断生成必须允许明确输出“当前无法确认网络根因”。

不可用结论定义：

- 没有 request/source/event/time/byte range 锚点，却输出具体根因。
- 只有状态事实或候选 IP，却给出“DNS/代理/QUIC/HTTP2/socket 导致问题”的结论。
- 只有 TTFB 慢，却输出“客户端网络异常”。
- 只有 Log 里的业务错误或 logID，却反推网络栈根因。
- 把缺失字段写成真实环境状态，例如没有 `polledData` 就写“用户没有 DNS 配置”。
- 给出用户无法执行或无法验证的行动，例如“联系网络管理员排查网络”但不说明排查哪个 host、哪个 error、哪个时间段。

必须降级为 `evidence-gap` 或 `needs-more-data` 的情况：

| 情况 | 允许输出 | 禁止输出 |
|---|---|---|
| 只有 HAR/Performance 慢，没有 NetLog 错误 | `请求慢在 TTFB/连接/DNS 阶段，但当前没有足够证据确认客户端网络根因` | `客户端网络异常 confirmed` |
| NetLog 有 DNS answer，但无 DNS task error / request failure | `发现解析结果，可作为 DNS 线索` | `DNS 服务器异常` |
| NetLog 有 socket peer，但无法关联 URL_REQUEST | `发现连接候选 IP，但未确认属于失败/慢请求` | `SIP 是该 IP` |
| Proxy/QUIC/HTTP2/Sockets 只有状态事实 | `检测到相关协议/代理状态，需要结合 request/source 判断` | `代理/协议导致请求失败` |
| Log 只有 logID 或业务错误 | `可用 logID 到服务端/CDN/业务系统继续查` | `网络根因来自该 log` |

无法定因时的固定输出模板：

```text
结论级别：evidence-gap | needs-more-data
一句话结论：当前日志不足以确认网络根因。
已看到的证据：列出可验证事实，例如慢请求、错误码、DNS answer、socket peer、logID。
缺少的关键证据：说明缺 request/source/event/time/byte range、缺同请求 net_error、缺 DNS task error、缺 proxy/tunnel error 等。
不能推出：明确写出不能确认 DNS server、SIP、代理、QUIC/HTTP2 或客户端网络问题。
下一步：给 1-3 个取证动作，例如补采 HAR+NetLog、按 logID 查服务端/CDN、按 sourceId/eventId 查看 raw event、复现时同时抓包。
```

示例：

```text
结论级别：evidence-gap
一句话结论：当前日志能证明请求慢，但不足以确认是客户端网络根因。
已看到的证据：目标 host 的 TTFB 偏高；NetLog 中未发现同 host 的 DNS/TCP/TLS/Proxy net_error。
缺少的关键证据：没有能关联到该慢请求的 URL_REQUEST/source chain 错误事件。
不能推出：不能确认 DNS server 异常、不能确认代理导致、不能把 DNS answer/socket peer 当成 SIP。
下一步：补采同一复现窗口的 HAR + NetLog；用 request id/logID 查询服务端或 CDN；若有 eventId/sourceId，再查看 raw event detail。
```

验收要求：

- 最终诊断 UI、导出报告、复制文本都必须保留 `evidence-gap/needs-more-data`，不能在二次加工时改成“已确认”。
- 无法定因时必须给“缺什么证据”和“下一步怎么补证”，不能只显示空状态。
- 端到端测试必须覆盖“证据不足但 UI/导出仍然诚实降级”的路径。

### 3.7 原始 NetLog 证据绑定规则

“结合 NetLog 原文件内容输出准确网络定因”不是只看 summary 字段或截图。诊断层必须能把结论追溯到原始 NetLog 文件中的事件、source、时间和 byte range。

可以用于定因的证据：

- Dataset event index 中的完整事件计数。
- `eventId/sourceId/typeName/sourceTypeName/phase/time`。
- `byteStart/byteEnd` 指向的 raw event detail，且 `JSON.parse(file.slice(byteStart, byteEnd).text())` 能读回同一事件。
- request/source chain 中同 host、同时间窗口、同 URL_REQUEST 的 DNS/TCP/TLS/Proxy/QUIC/HTTP2/socket 错误。
- DNS/Proxy/QUIC/HTTP2/Sockets reducer 输出的状态事实，并带 event/source/raw detail 跳转或明确 evidence gap。

不能用于确认定因的材料：

- 只有 summary preview events，不能访问完整 Dataset。
- 只有使用日志、截图、控制台日志、业务 logID，没有原始 NetLog event/source 证据。
- 只有聚合计数，没有可回跳 event/source/byte range。
- `byteStart/byteEnd` 不可信，或 raw event detail 读取/解析失败。
- eventCount 与原文件真实事件数不一致。
- 只有 synthetic benchmark，没有真实样本或用户原文件验证。

原文件不可用或不可验证时，产品必须直接告知用户：

```text
当前无法确认网络根因：没有可验证的原始 NetLog 事件证据。
已看到：列出可用但不足以定因的材料，例如 HAR 慢请求、业务 logID、summary 计数、截图描述。
缺少：原始 NetLog 文件、完整 Dataset event index、raw event detail、同请求 source chain 或明确 net_error。
下一步：重新上传原始 NetLog；若文件过大，等待 Dataset 索引完成；若只有 logID，请到服务端/CDN 查询对应请求，再补采同一时间窗口 HAR + NetLog。
```

实现门禁：

- 任何 `confirmed` 诊断都必须至少有一个可点击或可查询的原始证据锚点：eventId/sourceId/byteStart/byteEnd 或 requestId + source chain。
- 如果 raw event detail 读取失败，相关诊断最多只能是 `evidence-gap`，并提示“原始事件无法读取，不能确认根因”。
- 如果 Dataset 未 ready，专家视图可以展示 fallback summary，但诊断文案必须说明不是完整 NetLog 证据。
- benchmark 只能证明性能，不能单独证明诊断正确；诊断正确性必须用真实 NetLog 或覆盖同类事件结构的 fixture 验证。

### 3.8 可用诊断契约

用户要的不是“看起来像结论”的句子，而是能执行、能验证、不会误导的结论。后续 AI coding 必须让每个诊断输出通过这个契约。

一条可用网络诊断必须同时包含：

| 字段 | 最低要求 | 不满足时怎么降级 |
|---|---|---|
| 结论级别 | `confirmed`、`likely`、`candidate`、`evidence-gap`、`needs-more-data` 之一 | 没有证据锚点时降为 `evidence-gap` 或 `needs-more-data` |
| 用户可懂结论 | 说明发生了什么、影响哪个请求/host/阶段 | 只能说明“看到的现象”，不能写根因 |
| 证据锚点 | request/source/event/time/byteStart/byteEnd 至少一种强锚点，confirmed 必须能跳 raw event | 无 raw event 时只展示状态事实或线索 |
| 不能推出 | 明确写不能确认 DNS server、SIP、代理、QUIC/HTTP2 或客户端网络问题 | 若无法列出不能推出项，说明证据边界没建好 |
| 下一步 | 指向具体 host/request/source/event/logID 和动作 | 只剩泛泛建议时，主行动应改成补采证据 |

不可用诊断示例：

```text
网络异常，请联系网络管理员。
DNS 解析异常，因为看到了 DNS answer。
SIP 是 1.2.3.4，因为 socket peer 里出现了该 IP。
代理导致失败，因为状态页有 proxy config。
客户端网络问题 confirmed，因为 TTFB 很高。
```

可用诊断示例：

```text
结论级别：evidence-gap
结论：该请求等待首字节较慢，但当前 NetLog 没有同请求的 DNS/TCP/TLS/Proxy/net_error 锚点，不能确认是客户端网络根因。
证据：host=example.com，HAR TTFB=xxx ms；NetLog 未发现同 URL_REQUEST/source chain 的网络栈错误。
不能推出：不能确认 DNS server 异常，不能把 DNS answer 或 socket peer 当 SIP，不能确认代理或 QUIC/HTTP2 导致。
下一步：用同一复现窗口重新采集 HAR + NetLog；若有 logID，按该 logID 查服务端/CDN；Dataset ready 后查看同 host 的 source chain raw events。
```

实现验收：

- UI 卡片、导出报告、复制文本都必须保留 `结论级别 / 证据 / 不能推出 / 下一步` 四段。
- `confirmed` 必须能点击或引用到 raw event detail；raw detail 读取失败时自动降级。
- `candidate` 不能在二次汇总里被改写成 `confirmed`。
- `needs-more-data` 不是失败状态，而是准确诊断的一种合法输出。

### 3.9 证据到下一步操作的映射

“下一步”必须能被用户执行、复核或交给研发/IT 继续查。不能把模糊建议当作行动方案。

现有代码已有 `src/diagnosis/shared/commandLibrary.ts`，覆盖 DNS、连通性、TLS、代理和 HTTP timing。后续诊断卡应复用或对齐这些动作，而不是每个卡片随意写一套命令。

| 证据级别 | 可以推荐的下一步 | 不应推荐 |
|---|---|---|
| confirmed DNS error | 对同 host 执行 `nslookup` / `dig`；对比系统 DNS 与公共 DNS；查看 DNS task raw event | 直接让用户更换 DNS，除非确认 DNS server 或 DNS transaction 异常 |
| confirmed connect/socket error | `curl --connect-timeout`、ping/traceroute/tracert；记录目标 host、端口、时间段 | 只写“检查网络” |
| confirmed TLS/cert error | `openssl s_client` 检查证书链、SNI、有效期；联系服务端/IT 核对证书 | 让用户清缓存或换 DNS 作为主动作 |
| confirmed proxy/tunnel error | 查看系统代理配置；在安全策略允许下对比 `curl --noproxy '*'`；检查 PAC/bad proxy raw event | 未确认 proxy error 时要求关闭代理 |
| TTFB 慢但无网络栈错误 | `curl -w` 复测 DNS/Connect/TLS/TTFB 分段；带 request id/logID 查服务端/CDN | 写成客户端网络问题 |
| DNS answer / socket peer candidate | 查看 URL_REQUEST source chain、socket peer、DNS task detail；等待 Dataset ready 或补采原始 NetLog | 把候选 IP 当 SIP 或根因 |
| 只有 Log / logID | 用 logID 查服务端/CDN/业务系统；补采同时间窗口 HAR + NetLog | 用业务错误反推客户端网络根因 |

下一步文案要求：

- 必须包含对象：哪个 host / request / sourceId / eventId / logID。
- 必须包含动作：执行什么命令、查看哪个状态页、补采什么文件。
- 必须包含预期：什么结果支持该方向，什么结果说明需要换方向。
- 对高风险动作要加前提，例如“在公司安全策略允许下临时关闭代理/VPN 对比”。

不可用下一步示例：

```text
联系网络管理员排查网络。
检查 DNS 是否正常。
优化服务器。
换个网络试试。
```

可用下一步示例：

```text
对 host=api.example.com 执行 `curl -v -o /dev/null -w "... DNS:%{time_namelookup} Connect:%{time_connect} TLS:%{time_appconnect} TTFB:%{time_starttransfer}" https://api.example.com`，若 DNS/Connect/TLS 正常但 TTFB 高，优先查服务端/CDN。
用 eventId=12345 查看 raw event detail；若同一 URL_REQUEST source chain 中存在 net_error=-105，再进入 DNS 失败排查。
使用 logID=... 在服务端日志查询同一时间段请求；若服务端处理耗时高，不能归因客户端网络。
```

验收要求：

- `FinalDiagnosisPanel`、导出报告和复制文本里的每个主行动都必须能追溯到证据级别。
- `needs-more-data/evidence-gap` 的行动应以补证为主，不应给修复性动作当主建议。
- 命令里的域名必须来自已脱敏 host，不带 query string、Cookie、Authorization 或 body。

### 3.10 net_error 分类使用边界

当前代码已有 `src/parsers/netlog/errorClassifier.ts`，能把 `net_error` 粗分为 DNS、证书、代理、网络变更、阻止、协议、连接、应用层、缓存、其他。这个分类适合做排序、分组和用户解释，但不能单独作为 confirmed 根因。

使用规则：

- `net_error` 分类只能回答“错误大概属于哪一类”，不能回答“谁导致了错误”。
- 进入 confirmed 前，必须同时满足：
  - 错误码来自原始 NetLog event 或同请求 HAR/NetLog 关联证据。
  - 有 request/source/event/time/byte range 或 source chain 锚点。
  - 错误发生在失败/慢请求的相关阶段，而不是同文件里另一个无关 source。
  - raw event detail 可读取，或至少 Dataset index 能证明 event/source/byte range 存在。
- 分类到 DNS 不等于 DNS server 异常；必须另有 DNS server 配置或 DNS transaction 失败证据。
- 分类到代理不等于代理导致用户问题；必须有 proxy error/tunnel failure/bad proxy 与失败请求关联。
- 分类到协议不等于 QUIC/HTTP2 导致问题；必须有关联 session/stream/request 的协议错误。
- 分类到连接不等于 SIP；socket peer 仍需 request-scoped 关联。

诊断输出建议：

```text
可说：同一 URL_REQUEST 中出现 net_error=-105，按 Chromium 错误码语义属于 DNS 类失败，且 raw event 可回跳。
不可说：DNS 服务器异常。

可说：发现 proxy tunnel failure 与失败请求 source chain 关联，代理是确认排查方向。
不可说：因为系统存在代理配置，所以代理导致失败。
```

## 4. 本轮当前证据

### 4.1 测试和 build

```text
CI=true npm test -- --watchAll=false
结果：30 suites / 164 tests passed

npm run build
结果：Compiled successfully
备注：CRA bundle size warning 存在，但不是本轮阻塞。
```

2026-07-03 续审补跑：

```text
CI=true npm test -- --watchAll=false src/diagnosis/shared/finalSummaryBuilder.test.ts
结果：1 suite / 30 tests passed

CI=true npm test -- --watchAll=false src/workers/netlogDatasetQuery.test.ts
结果：1 suite / 6 tests passed
```

2026-07-03 打断后复核补跑：

```text
PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm test -- --watchAll=false src/App.phase3.test.tsx
结果：1 suite / 10 tests passed

PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm test -- --watchAll=false src/workers/netlogDatasetQuery.test.ts
结果：1 suite / 9 tests passed

PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm test -- --watchAll=false src/upload/parseUploadedInput.test.ts
结果：1 suite / 10 tests passed

PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm test -- --watchAll=false src/parsers/netlog/dnsAnswerCandidates.test.ts src/parsers/netlog/streamingAnalyzer.test.ts src/workers/netlogDnsStateReducer.test.ts
结果：3 suites / 17 tests passed

PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm test -- --watchAll=false src/workers/netlogEndpointEvidenceReducer.test.ts src/parsers/netlog/sourceGraph.test.ts
结果：2 suites / 7 tests passed

PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm test -- --watchAll=false src/workers/netlogProxyStateReducer.test.ts src/workers/netlogQuicStateReducer.test.ts src/workers/netlogHttp2StateReducer.test.ts src/workers/netlogSocketsStateReducer.test.ts
结果：4 suites / 13 tests passed

PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm test -- --watchAll=false src/diagnosis/shared/finalSummaryBuilder.test.ts src/parsers/netlog/exportReport.test.ts
结果：2 suites / 40 tests passed

PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm test -- --watchAll=false src/workers/netlogDatasetIndexer.test.ts src/upload/parseUploadedInput.test.ts
结果：2 suites / 15 tests passed
```

解释：

- `App.phase3` 证明 fallback 背景 Dataset 索引、upload-flow telemetry、single scan ready 后不再重复后台索引已有测试覆盖。
- `parseUploadedInput` 证明 single scan 成功、single scan 失败 fallback、旧路径 fallback 仍有测试覆盖。
- `netlogDatasetQuery` 证明 raw search scan/time limit 字段已有单测覆盖。
- DNS helper / streaming / DNS State targeted tests 证明共享 DNS answer candidate 方向已落地到代码层。
- Endpoint reducer / sourceGraph targeted tests 证明 socket peer source graph 关联增强已有基础测试覆盖。
- Proxy / QUIC / HTTP/2 / Sockets reducer targeted tests 证明状态树增强不是空壳。
- `finalSummaryBuilder` 与 `exportReport` 测试证明部分端到端防误判已经覆盖到导出层。
- 这仍不能证明目标完成：本轮没有跑全量 `CI=true npm test -- --watchAll=false` 和 `npm run build`，也没有用真实 326MB 样本复跑 single scan 浏览器上传、DNS answer 差异、socket peer 关联率和 raw search worst-case。

### 4.2 本地 326MB 样本 Node/Jest Dataset benchmark

命令：

```bash
npm run benchmark:netlog-worker -- --file /Users/bytedance/Downloads/chrome-net-export-log_副本.json --label local-312mb
```

输出摘要：

```json
{
  "fileSize": 326930225,
  "datasetIndexMs": 166053,
  "datasetEventCount": 2235117,
  "queryP50": 14,
  "queryP95": 26,
  "detailP50": 0,
  "detailP95": 3,
  "mainThreadBlockedMs": null,
  "memoryPeakEstimateMb": 297,
  "endpointEvidenceCount": 1307,
  "endpointRowCount": 32,
  "dnsAnswerCount": 27,
  "socketPeerCount": 827,
  "serverObservedClientIpCount": 222,
  "sourceGraphAssociatedCount": 52,
  "globalCandidateCount": 775,
  "sourceDependencyEdges": 3709,
  "sourceDependencyUnparsed": 3
}
```

解读：

- Dataset query/detail 的 compact index 方向是对的，查事件和打开 detail 很快。
- Dataset index 在 Node/Jest 环境很慢。166 秒不能直接等同浏览器用户体感，但说明非浏览器基线不适合证明性能达标。
- Endpoint Evidence 的数据有了，但 source graph 关联仍弱。775 个 global candidate 说明大量 socket peer 无法绑定到 URL_REQUEST，CIP/SIP 展示“不全”的核心仍可能是关联问题，不是没有 IP。
- `dnsAnswerCount=27` 小于旧日志 `dnsRecords=41`，说明 Dataset reducer 与 summary streaming analyzer 的 DNS answer 口径可能不一致，需专项对齐。

### 4.3 本地 326MB 样本浏览器 Worker benchmark

命令：

```bash
npm run benchmark:netlog-browser -- --file /Users/bytedance/Downloads/chrome-net-export-log_副本.json --label local-326mb --no-build
```

备注：

- sandbox 内启动 `127.0.0.1` 本地 server 可能报 `listen EPERM: operation not permitted 127.0.0.1`。
- 本轮通过授权在非 sandbox 环境运行成功；后续复测也可能需要同类授权。

输出摘要：

```json
{
  "fileSize": 326930225,
  "datasetImportMs": 12963,
  "datasetEventCount": 2235117,
  "queryP50": 15,
  "queryP95": 21,
  "detailP50": 1,
  "detailP95": 2,
  "mainThreadBlockedMs": 57,
  "rafMaxDelayMs": 1,
  "memoryPeakEstimateMb": 7,
  "endpointEvidenceCount": 1307,
  "endpointRowCount": 32,
  "dnsAnswerCount": 27,
  "socketPeerCount": 827,
  "serverObservedClientIpCount": 222,
  "sourceGraphAssociatedCount": 52,
  "globalCandidateCount": 775,
  "sourceDependencyEdges": 3709,
  "sourceDependencyUnparsed": 3
}
```

解读：

- Dataset Worker 直导路径在浏览器里不是当前最大瓶颈：约 13 秒导入 2,235,117 events，query/detail p95 都在几十毫秒以内。
- 主线程阻塞指标可接受：`mainThreadBlockedMs=57`、`rafMaxDelayMs=1`，说明 Worker dataset + compact index 方向成立。
- 不能因此直接宣布“大文件解析慢”已解决。用户真实上传路径可能仍先跑 streaming summary，再后台 Dataset import；如果 summary 仍旧耗时约 75 秒，用户体感仍会慢。
- 后续性能优化重点应从“Dataset Worker 直导是否可行”转向“真实上传流程是否双扫、Dataset 是否及时接管 UI、fallback 文案是否误导”。
- DNS answer 27 vs 41、socket peer 52/827 关联率低的问题在浏览器 benchmark 中仍存在，和运行环境无关。

### 4.4 使用日志证据

用户最初提供的日志路径：

```text
/Users/bytedance/Downloads/localhost-1782960040179.log
```

当前本机该文件已不存在；同目录下找到相近时间日志：

```text
/Users/bytedance/Downloads/localhost-1782963161540.log
```

只提取非敏感指标，不展开原始业务 URL、header value 或 token。该日志显示：

```json
{
  "fileName": "chrome-net-export-log_副本.json",
  "fileSize": 326930225,
  "durationMs": 75023.4,
  "parsedEvents": 2235117,
  "eventsPreview": 20000,
  "dnsRecords": 41,
  "dnsServers": 0,
  "urlRequests": 510,
  "failedDomains": 3,
  "hasPolledData": false,
  "hasSystemInfo": false,
  "fullyParsedEvents": 55955,
  "lightweightCountedEvents": 2179162,
  "dnsCandidateEvents": 7537,
  "hostResolverCandidateEvents": 6987,
  "eventsWithHeaders": 2463,
  "eventsWithIpLikeParams": 4904,
  "xRequestIpHeaderCount": 444
}
```

日志里没有看到：

```text
dataset-index:start
dataset-index:finish
dataset-index:error
Dataset ready
```

解读：

- 这份日志证明用户当时看到的体验大概率仍停在 large summary + 20,000 preview events，而不是 Dataset full index。
- `durationMs≈75s` 是用户感知“大文件解析慢”的直接证据。
- `dnsRecords=41` 且 `dnsServers=0` 是合理组合：有 DNS answer，不代表有 DNS server 配置记录；尤其 `hasPolledData=false` 时不能反推 DNS server。
- `eventsWithIpLikeParams=4904`、`x-request-ip` header 计数存在，说明 IP 线索很多；CIP/SIP 看起来“不全”更可能是证据角色和 source/request 关联问题，不是完全没有 IP。
- 该日志不能证明当前最新代码没有 Dataset，因为日志采集时间早于本轮浏览器 Worker benchmark；但它必须作为真实用户问题复现证据保留。

## 5. 已落地能力清单

| 能力 | 当前状态 | 证据 |
|---|---|---|
| 大文件 Dataset timeout | 已修正 60s 默认 timeout 风险 | `App.tsx` 调用 `largeNetlogTimeout(file.size)` |
| Dataset compact index | 已有 | `netlogDatasetIndexer.ts` |
| 真实 byteStart/byteEnd | 已有基础测试 | `netlogDatasetIndexer.test.ts`、event detail slice |
| Events 名称映射 | 已有 | constants -> `eventTypeNames/sourceTypeNames` |
| Events 过滤 | 已有基础版 | source/type/phase/error/time/sourceChain/searchText |
| Data Loaded | 已有基础版 | file info/top event/source/evidence gaps |
| DNS State | 已有基础版 | configServers/cache/taskResults/dnsErrors/DoH/IPv6 |
| Endpoint Evidence | 已有基础版 | CIP/SIP/socketPeer/dnsAnswer/serverObservedClientIp/association |
| Proxy State | 已有基础版 | config/PAC/proxy server/bypass |
| QUIC State | 已有基础版 | sessions/versions/peer/error |
| HTTP/2 State | 已有基础版 | sessions/streams/GOAWAY/RST/window/error |
| Sockets State | 已有基础版 | socket/connect/tls/stall/peer/error |
| confirmed 根因守门 | 已有明显进展 | Batch E tests 覆盖 TTFB/proxy/protocol/DNS answer/socket peer/x-request-ip |
| Node/Jest Dataset benchmark | 已有 | `benchmark:netlog-worker` |
| Browser benchmark harness | 已跑通一次 | `benchmark:netlog-browser`，326MB 样本 `datasetImportMs=12963`、`mainThreadBlockedMs=57` |

## 6. netlog.viewer parity 模块差距矩阵

这个矩阵用于防止后续把“组件已出现”误判成“对标完成”。对标目标不是逐字复制 netlog.viewer，而是覆盖它的核心证据浏览能力，并在此基础上增加可读诊断。

| 模块 | netlog.viewer 对标能力 | 当前实现 | 差距 | 验收方式 |
|---|---|---|---|---|
| Summary / 摘要 | 文件基本信息、事件规模、错误和关键状态概览 | summary fallback + Data Loaded 基础字段；single scan flag 已接入 | single scan 未默认开启，真实 326MB 上传证据缺失；首屏和 Dataset ready 耗时未闭环 | 记录 `uploadToFirstDiagnosisMs`、`datasetReadyMs`、Dataset 接管时间；对比 flag on/off |
| Data Loaded | constants、polledData、systemInfo、clientInfo、netLogInfo 可见 | `DataLoadedView` 有 top keys 和 top counts | 顶层原始 JSON 结构未懒加载展示，缺可跳转原始字段树 | Dataset ready 后能查看顶层 metadata，并显示缺失项 evidence gap |
| Events | 全量事件列表、type/source/phase/time/source 过滤、事件详情 | Dataset Events 支持分页和基础过滤；detail 按 byte range 读取；raw search 已有 scan/time limit 字段和 UI 提示 | source chain tab 未完全接 Dataset；无虚拟 JSON 树；raw search 仍缺真实大文件 worst-case 证据 | 326MB 文件 eventCount 匹配；query/detail p95 达标；raw search 达上限时不假装完整 |
| Source / Dependencies | source 维度重建异步链路和依赖 | index 有 `sourceDependencyFrom/To`，Events 支持 `sourceChainId` | SourceChainViewer 仍用 preview events；source graph 关联率低 | DatasetSourceChainView 展示 source 节点、边、errors、first/last event |
| DNS | DNS config、Host Resolver cache、DNS task results、DoH/Secure DNS、IPv6 检查 | `DnsStateView` 已分 config/cache/task/error/DoH/IPv6；共享 DNS answer helper 已落地 | 旧基线 DNS answer 41 vs 27 需要用新代码重新复测并解释 | 差异报告列出每条来源；DNS server/answer/DoH 分区不混淆 |
| Proxy | proxy config、PAC、代理列表、bypass、bad proxy、fallback、请求影响 | `ProxyStateView` 已增强 config/PAC/server/bypass/request-scoped errors | resolver/PAC match/bad proxy/fallback chain/request 影响仍需真实样本验证 | 代理错误必须能跳 source/event，并说明是否影响失败请求 |
| QUIC / HTTP3 | session、version、peer、handshake、migration、error、request/stream 关联 | `QuicStateView` 已增强 state events/errors | handshake/migration/version negotiation/request mapping 仍未完整 | QUIC error 不能只展示聚合，要能关联 session/request 或保留 gap |
| HTTP/2 | session、stream、GOAWAY/RST/window update、request 影响 | `Http2StateView` 已增强 source links/errors/sessions/streams | session-stream-request 映射仍浅；GOAWAY/RST 影响范围未闭环 | 能说明哪些 stream/request 受影响，不能关联时展示 gap |
| Sockets | socket pool、connect job、TLS、stall、peer address、reuse、error | `SocketsStateView` 已增强 socket/connect/tls/stall/peer/error/source links | connect job/socket pool/request 关联仍需真实样本证明；socket peer 旧基线大量 global-candidate | `socketPeerSourceGraphAssociated` 明显提升，未关联不进 SIP |
| Endpoint Evidence | CIP/SIP/socketPeer/dnsAnswer/x-request-ip 分列 | Dataset Endpoint Evidence 已分角色；source graph stats/unresolved reasons 已增强 | 新关联率未用 326MB 样本复测，用户看到“不全”仍未闭环 | 角色表不混淆；每行显示 association 和 evidence gap |
| Raw Evidence | 完整 JSON 树、原始事件查看 | event detail 可按 byte range 读取；raw search 已有限流结果字段 | 顶层 metadata 和 events 虚拟树未完成；raw search 需要真实大文件 worst-case | 不把完整 events 放主线程，按需展开顶层和单 event |
| Diagnosis | 比 viewer 更可读：结论、证据、下一步 | final summary / combined / export 已有 confirmed 守门测试 | 从真实 reducer/state 到 UI/导出/复制文本的证据包未全覆盖 | 状态事实不进 confirmed；每个 confirmed 可跳证据 |

优先级解释：

- P0 从“继续实现这些入口”转为“用真实样本验收这些入口”：single scan 上传、DNS answer 差异、socket peer 关联率、raw search worst-case。这些直接对应用户当前反馈：大文件慢、DNS IP 不全、CIP/SIP 不全。
- Proxy/QUIC/HTTP2/Sockets 虽是 parity 必需模块，但当前应先保守展示状态事实；在 endpoint/source graph 和根因守门稳定前，不应把它们升级成根因判断主路径。
- Raw Evidence 和 Source Chain 是 parity 完整性的关键，但实现上必须继续遵守“不在主线程保存完整大文件 events”。

### 6.1 netlog.viewer 源码对标基线

Chromium Catapult 的 `netlog_viewer/netlog_viewer` 目录里能看到这些独立模块：

```text
loaded_status_view
events_view
dns_view
proxy_view
quic_view
sockets_view
alt_svc_view
spdy_view
stream_pool_view
http_cache_view
reporting_view
modules_view
timeline_view
details_view
source_tracker / log_grouper
```

这说明对标不能只理解为“展示几个统计数字”。本项目可以不逐字复刻 UI，但必须覆盖三层能力：

| 层级 | 含义 | 最低验收 |
|---|---|---|
| Loaded 层 | 文件、constants、polledData、systemInfo、clientInfo、NetLog 信息 | Dataset ready 后展示完整事件数、constants 映射、顶层 metadata presence、缺失项 evidence gap |
| Event 层 | 全量事件浏览、过滤、source 维度定位、单事件 raw detail | 不依赖 preview events；按 type/source/phase/time/error 查全量；event detail 由真实 byte range 读取 |
| State 层 | DNS/Proxy/QUIC/HTTP2/Sockets 等状态重建 | reducer 来自完整 Dataset；状态项可跳 event/source；无法关联 request 时显示 evidence gap |
| Diagnosis 层 | 本项目额外能力：可读结论、证据、下一步 | 只能消费 Event/State 层证据；状态事实不自动升级 confirmed；每个 confirmed 有 request/source/event/byte range 锚点 |

后续 coding 不能用这些说法替代验收：

- “页面已经有 DNS/Proxy/QUIC/HTTP2/Sockets tab”，但数据仍来自 summary 或 preview。
- “Dataset import benchmark 很快”，但真实上传仍先 summary 后 Dataset。
- “Events 能分页”，但 eventCount 不等于原文件真实事件数。
- “有 socket peer IP”，但无法说明它属于哪个 URL_REQUEST。
- “有 DNS answer”，但把它写成 DNS server 或 SIP。
- “final summary 有 confirmed 守门”，但没有覆盖从真实 `fromNetlog/fromCombined` 卡片到导出报告的端到端路径。

参考源码目录：

- Chromium Catapult netlog_viewer: https://chromium.googlesource.com/catapult/+/refs/heads/main/netlog_viewer/netlog_viewer/

### 6.2 二线 parity 模块分级

官方 netlog_viewer 还包含 Alt-Svc、HTTP cache、Reporting、Stream Pool、Modules、Timeline 等视图。它们也是 parity 的一部分，但不应该抢在当前 P0 前面，因为用户当前反馈集中在大文件慢、DNS IP、CIP/SIP 和证据可用性。

分级原则：

| 模块 | 当前项目状态 | 是否进入近期 | 理由 |
|---|---|---|---|
| `details_view` | Dataset event detail 已能按 byte range 读取单 event；完整虚拟 JSON 树未完成 | 是，Batch 8 | 这是 raw evidence 和 confirmed 证据回跳的基础 |
| `source_tracker / log_grouper` | Dataset index 有 source dependency；SourceChainViewer 仍走 preview | 是，Batch 7 | request-scoped evidence 依赖 source chain |
| `stream_pool_view` | Sockets reducer 有 socket/connect/tls/stall/peer，但 stream pool/connect job/request 映射浅 | 中期 | 能提升 socket peer 关联率，但必须先完成 Batch 3/7 |
| `http_cache_view` | summary 里有 cacheEvents，HAR 也有缓存诊断；缺 Dataset HTTP cache reducer | 中期 | 缓存影响性能/重试，但不是当前 DNS/CIP/SIP 痛点 |
| `alt_svc_view` | QUIC/HTTP2 reducer 可见部分协议状态；未单独建 Alt-Svc 状态 | 中期 | 与 HTTP/3/QUIC fallback 有关，但不能先进入根因权重 |
| `reporting_view` | 当前未见 NetLog Reporting reducer | 后续 | 更偏浏览器上报状态，和当前网络根因主路径弱相关 |
| `modules_view` | 当前无对应模块 | 后续 | 属于 viewer 完整性，不影响当前大文件事件/诊断闭环 |
| `timeline_view` | preview EventsTab 有 timeline；Dataset Events 还不是全量 timeline | 后续 | 需要 Dataset event virtualization，否则大文件会卡 |

进入中期开发的门槛：

- Batch 1-6 的真实样本证据包通过。
- Batch 7 Source Chain 能把 request/source/stream/socket 关联清楚。
- Batch 8 Raw Evidence 能稳定回跳 raw event。
- Batch 5 结构化证据适配层能保证新增状态页不误升 confirmed。

暂缓期间的产品表达：

- 不要宣称“完整复刻 netlog.viewer 所有状态页”。
- 可以宣称“已优先覆盖网络诊断核心状态：Loaded、Events、DNS、Proxy、QUIC/HTTP2、Sockets，并保留二线 parity backlog”。
- HTTP cache / Alt-Svc / Reporting / Stream Pool 若只从 summary 看到线索，只能展示为 state fact 或 candidate，不能写成根因。

## 7. 未完成项优先级

### P0：验证真实上传流程，而不是只看 Worker 直导 benchmark

原因：浏览器 Worker 直导 benchmark 已经跑通，但真实用户上传不等于 benchmark。真实路径可能仍先跑 streaming summary，再后台 Dataset import；这会让用户感觉“大文件解析慢”，即使 Dataset Worker 本身只需约 13 秒。

当前代码路径有两条，后续必须同时验证：

```text
flag off / fallback path:
src/upload/parseUploadedInput.ts
  大文件 -> parseLargeNetlogFileInWorker(file) -> 返回 summary fallback

src/App.tsx
  parsed.dataset.status === 'fallback'
  -> startDatasetIndexingForFile(file, { background: true, token })
  -> importNetlogDatasetInWorker(file, { timeout: largeNetlogTimeout(file.size) })

flag on / single scan path:
REACT_APP_ENABLE_NETLOG_SINGLE_SCAN_DATASET=1
  -> parseLargeNetlogFileInWorker(file, { singleScanDataset: true })
  -> analysisWorker.ts buildNetlogCompactEventIndex(file, { onTopLevelField, onEvent })
  -> 同一扫描产出 summary + Dataset meta
  -> 成功后 App 直接 dataset-ready / dataset-takeover，不再启动后台 Dataset import
  -> 失败时回退 flag off 路径
```

风险：

- flag off 下 Dataset 自动启动已存在，但它发生在 summary 完成之后，不是和 summary 并行。
- flag on 下 single scan 入口已存在，但还没有真实 326MB 浏览器上传证据证明它只扫一次、指标不丢、UI 能稳定接管。
- Dataset ready 后能否稳定接管所有专家视图，需要真实上传 UI 验证，不是 targeted tests 能单独证明。
- 进度和 takeover telemetry 已有日志入口，但需要把真实样本数值填入 `10.4 真实样本回归证据包`。

已跑通的回归命令：

```bash
npm run benchmark:netlog-browser -- --file /Users/bytedance/Downloads/chrome-net-export-log_副本.json --label local-326mb
```

或跳过 build：

```bash
npm run benchmark:netlog-browser -- --file /Users/bytedance/Downloads/chrome-net-export-log_副本.json --label local-326mb --no-build
```

真实上传路径需要新增或手工验证这些指标：

```text
uploadToFirstDiagnosisMs
summaryScanMs
datasetAutoStartMs
datasetReadyMs
datasetTakesOverEventsMs
datasetTakesOverStateViewsMs
streamingFallbackVisibleDurationMs
```

通过标准：

- `datasetEventCount=2235117` 或等于实际文件 event count。
- 上传后 Dataset 自动启动，不需要用户手动点击。
- 首屏诊断可以先出来，但 Dataset ready 后 Events/Data Loaded/DNS/Proxy/QUIC/HTTP2/Sockets/Endpoint Evidence 必须切 Dataset。
- 顶部大文件提示不能再出现“完整 Dataset 查询将在后续阶段启用”这类过期文案；当前源码未搜到该句，但真实 UI 仍需验证 fallback/importing/ready/error 四态。
- 如果 summary + Dataset 仍然双扫，总耗时必须明确显示，并进入一次扫描主路径优化。

### P0：解释并修正 DNS answer 口径差异

现象：

```text
旧使用日志：dnsRecords=41
旧 Dataset benchmark：dnsAnswerCount=27
```

最新状态：

- `src/parsers/netlog/dnsAnswerCandidates.ts` 已成为共享 DNS answer candidate helper。
- `streamingAnalyzer`、`netlogDnsStateReducer`、`netlogEndpointEvidenceReducer` 已复用这个 helper。
- helper 已把 source kind 拆成 `hostResolverCache`、`dnsTaskResult`、`genericDnsEvent`、`summaryOnlyCandidate` 等类别。
- 这说明“代码口径对齐”已有实现，但旧样本的 41 vs 27 差异必须用新代码重新跑，不能沿用旧 benchmark 结论。

后续 AI coding / review 必须验证：

```text
summary dnsRecords
DNS State hostResolverCache/taskResults/generic candidates
Endpoint Evidence dnsAnswer rows
DoH candidates
DNS server config
```

推断：

- `dnsRecords=41` 和旧 `dnsAnswerCount=27` 可能来自旧三套提取器口径不一致，也可能来自新 helper 对误收项做了收口。
- Dataset DNS State 应按 netlog.viewer 状态页分区展示，Endpoint Evidence 可以消费更宽的 IP 线索，但必须标成 DNS answer 线索。
- 不能用“全部合并成 DNS server”来凑数量。正确做法是统一一个 `DnsAnswerCandidate` 提取 helper，输出 source kind：`hostResolverCache`、`dnsTaskResult`、`genericDnsEvent`、`summaryOnlyCandidate`。

验收：

- 用新代码列出 41 与新 Dataset DNS answer 数量的差异来源。
- 如果 summary 是误收，修 summary 并补测试。
- 如果 Dataset 漏收，修 Dataset reducer 并补 fixture。
- DNS server、DNS answer、DoH candidate 继续分开；不能为了数量一致而混淆语义。

### P0：提高 socket peer 与请求/source graph 的关联率

现状：

```text
socketPeerTotal=827
socketPeerSourceGraphAssociated=52
socketPeerGlobalCandidate=775
sourceDependencyEdges=3709
sourceDependencyUnparsed=3
```

判断：

- source dependency 抽取已经比旧版强，且新代码已增加 source graph 关联统计、global-candidate 分布和 unresolved reasons。
- 旧基线 socket peer 关联率仍低；新实现需要用同一 326MB 样本重新跑，不能直接沿用 52/827 的旧数值。
- 不能把 global-candidate 塞进 SIP。
- 需要扩展从 URL_REQUEST -> HTTP_STREAM_JOB / CONNECT_JOB / SOCKET / DNS / HTTP2 / QUIC 的链路映射。

后续实现方向：

- 统计 global-candidate 的 `typeName/sourceTypeName/params` 分布，先找高频未关联形态。
- 扩展 dependency parser，不只看 `source_dependency`，还要覆盖 connect job、stream job、socket pool、group、request key、host/endpoint 可回链字段。
- 在 Dataset source graph 中建立邻接表，避免每次 query O(edges * nodes) 扫描。
- UI 对 global-candidate 明确显示 evidence gap：可疑连接目标，未确认归属于某个 URL_REQUEST。

当前源码审查重点：

```text
src/workers/netlogEndpointEvidenceReducer.ts
  是否仍有高频 global-candidate 无法回链 URL_REQUEST。
  globalCandidateByTypeName/sourceTypeName/ParamKeys 是否能解释未关联原因。
  sourceGraphDepthHit 是否说明 graph 深度不足。
  sourceGraphUnresolvedReasons 是否能指导下一轮规则扩展。
```

下一轮不要直接扩大 SIP 列。应该先做统计：

```text
global-candidate by typeName/sourceTypeName
global-candidate params key topN
socket peer 是否有 host/group/socket_pool/connect_job/http_stream_job/quic_session 可回链字段
URL_REQUEST 与 SOCKET/CONNECT/HTTP_STREAM_JOB 的时间窗口重叠情况
```

只有能和 URL_REQUEST/source chain/host/time 确认关联后，才可升级为 request-scoped endpoint；否则仍保持 `socketPeer + evidence gap`。

验收：

- 326MB 样本 `socketPeerSourceGraphAssociated` 明显提升。
- `socketPeerGlobalCandidate` 降低，且仍保留未关联候选。
- SIP 列不接收 socket peer。

### P0：大文件 index 慢必须进入优化设计

现状：

```text
summary scan 旧日志约 75s
Dataset Worker 浏览器直导 benchmark 约 13s
Dataset Node/Jest benchmark 166s
如果用户上传后先 summary 再 Dataset，体感仍可能被 summary 阶段拖慢。
```

短期优化：

- 保持 summary fallback，但 UI 明确展示 Dataset importing/ready/error。
- Dataset import progress 需要更细：events count、percent、elapsed、estimated remaining。
- 减少 reducer 每个 event 的完整 JSON.parse 成本。对轻量事件只抽顶层字段，只有 reducer 需要 params 时再 parse。

中期主路径：

- 一次扫描产出 summary + compact index + reducers。
- 不在主线程保存完整 events。
- 保持 `byteStart/byteEnd` 真实原始字节 offset。
- Event detail 继续按 `file.slice(byteStart, byteEnd).text()` 懒加载。

验收：

- 326MB 样本一次上传到 Dataset ready 时间显著低于当前 summary+Dataset 双扫。
- 浏览器 benchmark 证明主线程不卡。
- 大文件 Events 不依赖 20,000 preview。

### P1：Proxy / QUIC / HTTP/2 / Sockets 从基础视图升级为可追因状态树

当前基础 reducer 主要是“聚合事实 + error list + evidence gap”。距离 netlog.viewer parity 仍缺：

- request/source/event 关联跳转。
- session -> stream -> request 映射。
- proxy resolver、PAC 命中、bad proxy、fallback chain。
- QUIC connection migration、handshake、version negotiation、HTTP3 stream 关系。
- HTTP/2 GOAWAY/RST_STREAM 影响哪些 request/stream。
- Socket pool、connect job、stalled waiting、connection reuse。

原则：

- 状态事实不能直接 confirmed。
- 只有错误事件与 request/source/host/time 关联后，才能进入根因候选。
- 每条状态证据都要能跳 raw event。

### P1：Events raw search 需要限流或索引化

当前 `searchText` 会对候选 event 逐个 `file.slice(...).text()`。这符合“不把 params 常驻内存”的边界，但大文件搜索可能非常慢。新代码已经加入 scan/time limit 和结果不完整提示，下一步是验证 worst-case，而不是重复实现同一字段。

当前代码位置：

```text
src/workers/netlogDatasetQuery.ts
  queryNetlogEventsWithRawSearch()
  rawEventMatches()
```

旧问题与新状态：

- `scanned`、`scanLimitHit`、`timeLimitHit`、`hasMoreMatchesUnknown` 已出现。
- UI 已能提示 raw search 结果可能不完整。
- 仍需验证无条件 search 在 2M events 上的 p95 / worst-case，以及新查询覆盖旧查询的体验。
- 如果后续要做取消 token，应作为体验补强，不再作为“raw search 保护完全未做”的前置。

后续方向：

- UI 强制提示先加 type/source/time 条件。
- 对无条件 raw search 设置结果上限、扫描上限、取消按钮。
- benchmark 覆盖 raw search p95 / worst case。
- 后续可考虑构建轻量 token index，但不能把完整 params 常驻主线程。

### P1：Source Chain 页面接 Dataset

当前 `SourceChainViewer` 仍主要看 summary/preview events。大文件下这会误导用户。

后续方向：

- Dataset query 支持 source chain event list 已有基础。
- 新增 DatasetSourceChainView：输入 sourceId 后展示相关 source 节点、边、event count、errors、first/last event。
- Source Chain tab 在 Dataset ready 后不再使用 20,000 preview events。

### P1：Raw Evidence 大文件完整 JSON 树

目标是“大 NetLog 追求完整 JSON 树”，但不能把完整 326MB JSON parse 到主线程。

后续方向：

- Dataset event detail 已能按 byte range 读取单 event。
- 顶层 metadata 需要懒加载结构视图：constants / polledData / systemInfo / clientInfo / netLogInfo。
- 对 events 数组提供虚拟树：eventId、typeName、sourceId、byte range，而不是展开完整数组。
- raw search 与 Dataset search 共享取消/限流策略。

### P2：诊断表达继续收口

已完成的方向：

- HAR only 为 symptom-only。
- combined/netlog confirmed 必须有明确失败证据和关联锚点。
- TTFB、proxy config、protocol facts、DNS answer、socket peer、x-request-ip 都有负面测试。

仍需补：

- 从实际 `fromNetlog` / `fromCombined` 生成卡片的端到端测试，不能只测手写 card。
- 对 Proxy/QUIC/HTTP2/Sockets 新 reducer 产出的状态事实，确保不会被上游卡片包装成 confirmed。
- 导出报告里也要保持“线索/确认/缺口”的区别。

## 8. 下一轮建议执行顺序

不要再从“新增更多页面”或“重复实现已存在入口”开始。下一轮按这个顺序：

1. 用真实 326MB 样本分别跑 flag off 和 flag on：上传到首屏诊断、Dataset ready、Events/State Views 接管、main thread blocked、是否双扫。
2. 重新输出 DNS answer 差异报告：summary dnsRecords、DNS State、Endpoint Evidence、DoH candidates、DNS server config 分开计数。
3. 重新输出 socket peer 关联报告：sourceGraphAssociated、globalCandidate、unresolved reasons、top type/source/param keys。
4. 跑 raw search worst-case：无过滤、有 type/source/time 过滤、命中 scan/time limit 时 UI 是否诚实说明不完整。
5. 跑端到端防误判：真实 reducers/state -> final diagnosis -> export/report copy，确认状态事实不进 confirmed。
6. 根据证据决定是否继续优化 single scan 内部解析成本、SourceChain Dataset 视图、Raw Evidence 虚拟 JSON 树。

### 8.1 下一轮 coding 执行总表

这张表用于直接派给其他 AI coding。每一行都是一个可交付切片；不要把多行合并成一个大改动，除非已经完成前一行的证据包。

| 顺序 | 对应 Batch | 先做什么 | 必交付物 | 验收证据 | 禁做项 |
|---|---|---|---|---|---|
| 1 | Batch 1 + Batch 6 验收 | 跑真实 326MB `dataset-import-baseline` 与 `upload-single-scan-check` | flag on/off 指标表、upload-flow 日志、UI 四态截图或日志 | `datasetEventCount=2235117`、`singleScanDatasetReady=true`、`backgroundDatasetImportExpected=false`、Dataset takeover 明确 | 不改诊断规则，不默认打开 single scan，不用 synthetic 替代 |
| 2 | Batch 2 | 用新 DNS helper 重跑真实样本 DNS 差异 | DNS 差异报告：summary / DNS State / Endpoint Evidence / DoH / DNS server 分区 | 解释旧 `41 vs 27` 是否仍存在；每条差异有 sourceKind 和 event trace | 不把 DNS answer/DoH 塞进 DNS server |
| 3 | Batch 3 | 用真实样本重跑 socket peer 关联统计 | source graph 关联报告：associated/global/unresolved/top params | `socketPeerSourceGraphAssociated` 高于旧 52 或解释未提升原因；global-candidate 保留 gap | 不把 global-candidate 写进 SIP |
| 4 | Batch 4 | 跑 raw search worst-case | 无过滤/有过滤 raw search 指标和 UI 截图 | 命中 scan/time limit 时 `hasMoreMatchesUnknown=true`，UI 不假装 total 完整 | 不构建完整 params 常驻主线程索引 |
| 5 | Batch 5 | 打通真实 reducer/state 到诊断/导出 | 结构化证据适配层或等价字段、UI/导出/复制文本证据包 | 状态事实不进 confirmed；confirmed 都有 event/source/byte range 或 source chain | 不用文案里的域名/URL 当强锚点 |
| 6 | Batch 7 | Source Chain 切 Dataset | DatasetSourceChainView 或等价 Dataset source chain 查询 | Dataset ready 后不再用 preview source chain；错误事件能跳 raw detail | 不把 preview chain 当全量 |
| 7 | Batch 8 | Raw Evidence 虚拟树 | 顶层 metadata 懒加载、events 虚拟列表、单 event detail | 大文件不进主线程完整 events；Data Loaded/Events/State 能跳 raw evidence | 不 parse 完整 326MB JSON 到 React state |
| 8 | 二线 parity | 评估 Stream Pool / HTTP cache / Alt-Svc / Reporting / Timeline | 独立 reducer 或明确暂缓说明 | 已有 Batch 1-8 证据包通过后再启动 | 不绕过 Batch 5 把状态事实接根因 |

每个切片交付时必须回答：

```text
这次证明了什么？
还有什么不能证明？
如果不能 confirmed，用户应看到哪条 evidence-gap？
是否改变了 feature flag 默认值？
是否有任何敏感信息进入日志、测试快照、文档或导出？
```

## 9. 可执行 coding backlog

后续 AI coding 应按 Batch 小步落地。每个 Batch 都必须先补或更新测试，再跑验收命令；不要把 Proxy/QUIC/HTTP2/Sockets 继续扩成新页面来绕开 P0 问题。

### Batch 1：真实上传路径可观测性和文案修正

目标：

- 证明真实上传是否仍被 summary fallback 阶段拖慢。
- 让用户能看到 Dataset importing/ready/error，而不是只看到“后续阶段启用”。

最新状态：

- `App.tsx` 已有 upload-flow telemetry 事件。
- `ExpertAnalysisTab.tsx` 源码中未再搜到旧 stale 文案。
- `App.phase3.test.tsx` 已覆盖 fallback 自动后台索引和 single scan takeover。
- 本 Batch 剩余重点是填真实样本数值和 UI 四态截图/日志，不是重复加同名 telemetry。

涉及文件：

```text
src/App.tsx
src/upload/parseUploadedInput.ts
src/components/netlog/ExpertAnalysisTab.tsx
src/App.phase3.test.tsx
```

实现要点：

- 在大文件上传路径记录并展示或导出 `summaryScanMs`、`datasetAutoStartMs`、`datasetReadyMs`。
- 复核 `background=true` 的 Dataset import 是否已有用户可见进度；若只有日志无 UI，再补 phase、elapsed、eventCount/percent。
- 大文件顶部 Alert 按状态区分：
  - fallback：当前是 summary preview，Dataset 尚未开始或等待开始。
  - importing：Dataset 正在索引，当前专家视图不是全量。
  - ready：Dataset 已接管 Events/Data Loaded/DNS/Proxy/QUIC/HTTP2/Sockets/Endpoint Evidence。
  - error：保留 summary fallback，但显示错误和重试入口。
- 复核真实 UI 不再出现“完整 Dataset 查询将在后续阶段启用”这种过期文案；如果只在历史文档中出现，不需要改源码。

验收：

```bash
CI=true npm test -- --watchAll=false src/App.phase3.test.tsx
CI=true npm test -- --watchAll=false
npm run build
```

真实样本验收：

```bash
npm run benchmark:netlog-browser -- --file /Users/bytedance/Downloads/chrome-net-export-log_副本.json --label local-326mb --no-build
```

### Batch 2：DNS answer 口径对齐

目标：

- 用新共享 helper 解释并修正旧基线 `dnsRecords=41` vs `dnsAnswerCount=27`。
- 保持 DNS server、DNS answer、DoH candidate 语义分离。

最新状态：

- `src/parsers/netlog/dnsAnswerCandidates.ts` 已存在，且 targeted tests 通过。
- 本 Batch 不应重新发明 helper；应基于真实样本输出差异报告，判断是修漏收、删误收，还是保留 evidence gap。

涉及文件：

```text
src/parsers/netlog/streamingAnalyzer.ts
src/workers/netlogDnsStateReducer.ts
src/workers/netlogEndpointEvidenceReducer.ts
src/parsers/netlog/streamingAnalyzer.test.ts
src/workers/netlogDnsStateReducer.test.ts
src/workers/netlogEndpointEvidenceReducer.test.ts
```

实现要点：

- 复核共享 DNS answer candidate 解析规则，确保 host / ips / sourceKind / event trace 在 summary、DNS State、Endpoint Evidence 中一致消费。
- sourceKind 建议：
  - `hostResolverCache`
  - `dnsTaskResult`
  - `genericDnsEvent`
  - `summaryOnlyCandidate`
- Dataset DNS State 仍按状态页分区：Host Resolver cache、DNS task results、DNS errors、DoH candidates。
- Endpoint Evidence 可以消费更宽的 DNS answer，但必须标成 `dns-answer`，不能进 DNS server/SIP。
- 对真实样本生成差异报告：哪些 host/IP 在 summary 有、Dataset 没有，原因是什么。

验收：

```bash
CI=true npm test -- --watchAll=false src/parsers/netlog/streamingAnalyzer.test.ts src/workers/netlogDnsStateReducer.test.ts src/workers/netlogEndpointEvidenceReducer.test.ts
npm run benchmark:netlog-worker -- --file /Users/bytedance/Downloads/chrome-net-export-log_副本.json --label dns-diff-check
```

通过标准：

- 41 vs 27 的差异被解释清楚。
- 若 Dataset 漏收，修复后 `dnsAnswerCount` 应提高或另有明确 evidence gap。
- DoH candidate 不进入 DNS server。

### Batch 3：socket peer source graph 关联率提升

目标：

- 先统计 `global-candidate` 的真实形态，再扩关联规则。
- 提高 `socketPeerSourceGraphAssociated`，但不把未关联 IP 混入 SIP。

最新状态：

- `netlogEndpointEvidenceReducer` 已有 source graph stats、global candidate 分布和 unresolved reasons。
- 本 Batch 的下一步是用真实样本验证关联率是否提升，并基于未关联分布补最小规则。

涉及文件：

```text
src/workers/netlogEndpointEvidenceReducer.ts
src/workers/netlogDatasetIndexer.ts
src/workers/netlogEndpointEvidenceReducer.test.ts
scripts/benchmark-netlog-worker.js
scripts/benchmark-netlog-browser.js
```

实现要点：

- benchmark 输出复核：
  - `globalCandidateByTypeName`
  - `globalCandidateBySourceTypeName`
  - `globalCandidateParamKeys`
  - `sourceGraphDepthHit`
- 对 `sourceGraphUnresolvedReasons` 做 topN 分析，再决定是否扩展 connect job、stream job、socket pool、group、request key、host/endpoint 可回链字段。
- 为 Dataset source graph 建邻接表或压缩索引，避免每次 source-chain query 全量扫边。
- 只有能关联 URL_REQUEST/source chain/host/time 的 socket peer 才升级为 `source-graph`；其余保留 `global-candidate`。

验收：

```bash
CI=true npm test -- --watchAll=false src/workers/netlogEndpointEvidenceReducer.test.ts
npm run benchmark:netlog-worker -- --file /Users/bytedance/Downloads/chrome-net-export-log_副本.json --label endpoint-association-check
```

通过标准：

- 326MB 样本 `socketPeerSourceGraphAssociated` 明显高于 52。
- `socketPeerGlobalCandidate` 下降，但未关联候选仍可见。
- `sipIps` 不接收 socket peer 或 DNS answer。

### Batch 4：Dataset raw search 保护

目标：

- 避免用户在 2M+ events 上无条件 raw search 造成长时间 Worker 忙碌。

最新状态：

- `queryNetlogEventsWithRawSearch()` 已返回 `scanned`、`scanLimitHit`、`timeLimitHit`、`hasMoreMatchesUnknown`。
- `DatasetEventsTab` 已提示 raw search 结果可能不完整。
- 本 Batch 剩余重点是 browser worst-case / p95、取消或新查询覆盖体验，而不是重复添加这些返回字段。

涉及文件：

```text
src/workers/netlogDatasetQuery.ts
src/workers/protocols.ts
src/workers/workerClient.ts
src/components/netlog/DatasetEventsTab.tsx
src/workers/netlogDatasetQuery.test.ts
```

实现要点：

- 复核 UI 在没有 type/source/time/error 条件时是否足够强提示先过滤。
- 支持取消或新查询覆盖旧查询。
- total 不要假装完整；达到上限时明确告诉用户“结果可能只是前 N 个候选中的命中”。

验收：

```bash
CI=true npm test -- --watchAll=false src/workers/netlogDatasetQuery.test.ts
CI=true npm test -- --watchAll=false
npm run build
```

### Batch 5：诊断端到端防误判

目标：

- 防止新增 Dataset state/reducer 事实被上游包装成 confirmed 根因。
- 防止 `fromNetlog.ts` 里已有的高置信环境卡片、配置卡片、协议卡片在真实生成链路中被误当根因。

最新状态：

- `finalSummaryBuilder.test.ts` 与 `exportReport.test.ts` targeted suites 已通过。
- 已看到 `fromNetlog` / `fromCombined` 相关防误判测试继续扩展。
- 本 Batch 剩余重点是把真实 reducer/state 输出接入 UI/导出/复制文本做证据包，而不是只看手写 card。

涉及文件：

```text
src/diagnosis/shared/fromNetlog.ts
src/diagnosis/shared/fromCombined.ts
src/diagnosis/shared/finalSummaryBuilder.ts
src/diagnosis/shared/commandLibrary.ts
src/parsers/netlog/errorClassifier.ts
src/diagnosis/shared/finalSummaryBuilder.test.ts
src/parsers/netlog/exportReport.test.ts
src/components/shared/FinalDiagnosisPanel.tsx
```

实现要点：

- 新增或收敛 `DiagnosisEvidenceAdapter` 层，把 Dataset reducers/state facts 转成诊断层可消费的结构化证据，而不是让 final summary 通过正则读取文案：
  - `evidenceLevel`: `state-fact | candidate | request-scoped | confirmed-candidate`
  - `role`: `dnsServer | dnsAnswer | dohCandidate | cip | sip | socketPeer | proxyState | quicState | http2State | socketState | netError`
  - `anchors`: `eventId/sourceId/byteStart/byteEnd/time/host/requestId/sourceChainId`
  - `rawDetailAvailable`: boolean
  - `cannotConclude`: string[]
  - `recommendedNextEvidence`: string[]
- `confirmed` 只允许来自 `evidenceLevel=request-scoped` 且具备强锚点的失败证据；强锚点必须是结构化字段，不是标题、结论、evidence.value 里的域名字符串。
- `hasCorrelationAnchor()` 应收口为兼容旧卡片的兜底逻辑；新 Dataset 证据必须通过 `anchors` 判定关联。
- 增加从 `fromNetlog` / `fromCombined` 到 final summary 的端到端测试。
- 覆盖导出报告，确保导出摘要不把 `candidate/evidence-gap/info/highly-likely` 压缩成 `confirmed`。
- 覆盖：
  - Proxy config only
  - Proxy config + no request failure
  - QUIC/HTTP2 state only
  - DNS answer only
  - DNS special IP only but no request-scoped net_error
  - socket peer global-candidate only
  - x-request-ip only
  - TTFB only
  - `fromNetlog.ts` 生成的 `netlog-proxy` / `netlog-protocol-decision` / `netlog-hijack` 类卡片
- 只有明确 request-scoped failure evidence 才允许 confirmed。
- `hasCorrelationAnchor()` 不能只因为文案里出现“域名/URL/source”字样就当作强关联；端到端测试必须覆盖“有错误码但缺 request/source/event/byte range”的降级。
- command library 只能在证据级别允许时推荐修复动作：`candidate/evidence-gap/needs-more-data` 的主行动必须是补证或复核，不能直接建议改 DNS、关代理、切协议。

验收：

```bash
CI=true npm test -- --watchAll=false src/diagnosis/shared/finalSummaryBuilder.test.ts
CI=true npm test -- --watchAll=false src/parsers/netlog/exportReport.test.ts
CI=true npm test -- --watchAll=false
```

### Batch 6：一次扫描主路径设计

目标：

- 解决真实上传路径仍可能被 summary fallback + Dataset import 双扫拖慢的问题。
- 让大 NetLog 主路径回到 `Worker dataset + analysisId + compact index + reducer`，streaming summary 只作为失败 fallback。
- 保持 netlog.viewer parity 的完整事件索引能力，同时不牺牲小白可理解的诊断结论。

最新状态：

- `REACT_APP_ENABLE_NETLOG_SINGLE_SCAN_DATASET=1` 已接入，single scan 成功会返回 `datasetMeta`，失败会 fallback。
- `App.phase3.test.tsx` 和 `parseUploadedInput.test.ts` 已覆盖 single scan 分支。
- 本 Batch 已从“设计入口”推进到“真实样本验收 + 内部性能继续优化”。不要再写成完全未实现。

当前代码拆分：

```text
flag off legacy path:
parseUploadedInput.ts
  大文件 -> parseLargeNetlogFileInWorker(file)

analysisWorker.ts
  parseLargeNetlogFile()
    -> scanNetlogEventJson()
    -> createNetlogStreamingAnalyzer()
    -> recordLightweightEvent() / analyzer.accept(JSON.parse(eventJson))
    -> 返回 summary fallback

App.tsx
  summary 返回后 -> startDatasetIndexingForFile(file, { background: true })

analysisWorker.ts
  import-netlog-dataset
    -> buildNetlogCompactEventIndex(file)
    -> 重新扫描 events
    -> compact index + DNS/Endpoint/Proxy/QUIC/HTTP2/Sockets reducers

flag on single scan path:
parseUploadedInput.ts
  大文件 -> parseLargeNetlogFileInWorker(file, { singleScanDataset: true })

analysisWorker.ts
  parseLargeNetlogFile()
    -> buildNetlogCompactEventIndex(file, { onTopLevelField, onEvent })
    -> createNetlogStreamingAnalyzer()
    -> Dataset reducers
    -> 返回 summary + datasetMeta
```

这说明浏览器 Worker benchmark 的 `datasetImportMs≈13s` 只证明 Dataset 直导快。single scan flag 已解决一部分“双扫结构”，但真实上传还必须证明 flag on 只扫一次、Dataset 指标不丢、UI 接管完整。

目标架构：

```text
single NetLog worker scan
  -> raw event JSON slice metadata: byteStart/byteEnd
  -> shared NetlogEventSeed
      time/type/source/phase/typeName/sourceTypeName/phaseName
      hasErrorMarker/lightweight flags
      params lazy parser
  -> summary analyzer consumer
  -> compact index consumer
  -> data loaded reducer
  -> DNS reducer
  -> endpoint reducer
  -> Proxy/QUIC/HTTP2/Sockets reducers
  -> Dataset ready
```

实现原则：

- `byteStart/byteEnd` 必须来自原始文件字节 offset，不能来自 decoded string 字符位置。
- 常量映射 `constants.logEventTypes` / `constants.logSourceType` 应在同一次扫描中建表，事件名称 fallback 只能作为兼容。
- 轻量事件不要构造完整 `eventJson` 对象；先抽顶层字段，只有命中 reducer 关注的 type/source/param key 时才解析 params。
- Event detail 和 Raw Evidence 继续 lazy：按 `file.slice(byteStart, byteEnd).text()` 读取单事件，不把完整 events 放进主线程。
- summary fallback 仍保留：single scan 失败时可以回退旧 summary preview，但 UI 必须明确“不是全量 Dataset”。
- 不能因为 single scan 改造降低诊断门槛；DNS answer、socket peer、x-request-ip、Proxy/QUIC/HTTP2/Sockets state 仍只能作为线索或状态事实，不能自动 confirmed。

推荐剩余落地步骤：

1. 用真实 326MB 样本跑 flag on/off 对比，确认 eventCount、DNS answer、endpoint evidence、state reducer 指标不回退。
2. 复核 `buildNetlogCompactEventIndex()` 是否仍对全部 event 做完整 `JSON.parse`，如果是，下一刀再抽 seed 层和 lazy params parser。
3. 把 summary analyzer 和 Dataset reducers 的共享 seed/parser 继续收敛，减少重复对象构造和 reducer parse 成本。
4. 保留旧路径在 `REACT_APP_ENABLE_NETLOG_SINGLE_SCAN_DATASET=false` 下可回退，先用真实样本 telemetry 灰度验证。

必须补测试：

| 测试 | 目的 |
|---|---|
| 跨 chunk event JSON | 确认扫描器不会在 chunk 边界截断 event |
| 多字节字符 + byte offset | 确认 `byteStart/byteEnd` 是原始字节 offset |
| constants 在 events 前/后 | 确认 type/source name mapping 稳定 |
| summary 与 Dataset 共用同一扫描 | 确认真实上传不再触发两次全量 event scan |
| reducer parity 对比 | 同一 fixture 下 DNS/endpoint/proxy/quic/http2/sockets 输出不低于旧路径 |
| fallback 保留 | single scan 抛错时仍能展示 summary fallback，并标明非全量 |

验收：

```bash
CI=true npm test -- --watchAll=false src/workers/netlogDatasetIndexer.test.ts src/workers/netlogStreamScanner.test.ts src/parsers/netlog/streamingAnalyzer.test.ts
CI=true npm test -- --watchAll=false
npm run build
npm run benchmark:netlog-browser -- --file /Users/bytedance/Downloads/chrome-net-export-log_副本.json --label dataset-import-baseline --mode dataset-import --no-build
npm run benchmark:netlog-browser -- --file /Users/bytedance/Downloads/chrome-net-export-log_副本.json --label upload-single-scan-check --upload-single-scan --no-build
```

真实样本通过标准：

- 326MB 样本 `datasetEventCount=2235117`。
- `upload-single-scan-check` 输出 `mode=upload-single-scan`、`singleScanDatasetReady=true`、`backgroundDatasetImportExpected=false`。
- 上传链路 telemetry 只能出现一次完整 event scan；如果仍有两次 scan，不能宣称 single scan 完成。
- Dataset ready 时间明显低于当前 summary+Dataset 双扫路径。
- Events query p95 仍小于 300ms，detail p95 仍小于 500ms。
- 主线程不持有完整 events，Data Loaded / Events / DNS / Proxy / QUIC / HTTP2 / Sockets 都来自 Dataset。
- 诊断卡片 confirmed 规则与 Batch 5 保持一致。

暂不做：

- 不在这个 Batch 做完整 Raw Evidence JSON 树 UI。
- 不把 raw search 做成全文件倒排索引。
- 不新增诊断根因类型。
- 不删除 streaming summary fallback。

### Batch 7：Dataset Source Chain View

目标：

- 让 Source Chain 页面从 preview events 切到 Dataset source graph，避免大文件下只看前 20,000 条事件造成误导。
- 支撑诊断层的 request-scoped evidence：confirmed 或 likely 结论必须能回跳到同一 URL_REQUEST/source chain。

最新状态：

- `src/workers/netlogDatasetQuery.ts` 已支持 `sourceChainId` 过滤，并通过 `sourceDependencyFrom/sourceDependencyTo` 构建链路集合。
- `DatasetEventsTab` 已有 `sourceChainId` 过滤输入。
- `SourceChainViewer` 当前仍接收 `events` 和 `urlRequests`，在 `ExpertAnalysisTab` 中无论 Dataset 是否 ready 都走 preview/summary 数据。

涉及文件：

```text
src/workers/netlogDatasetQuery.ts
src/workers/protocols.ts
src/workers/workerClient.ts
src/components/netlog/SourceChainViewer.tsx
src/components/netlog/ExpertAnalysisTab.tsx
src/workers/netlogDatasetQuery.test.ts
```

实现要点：

- 新增 Dataset source chain query，输入 `analysisId + sourceId`，输出：
  - chain source nodes：sourceId、sourceTypeName、eventCount、firstTime、lastTime、errorCount。
  - edges：fromSourceId、toSourceId、edgeKind、sample eventId/byteStart/byteEnd。
  - events page：复用 Dataset Events row，不加载完整 raw event。
  - evidenceGaps：孤立 source、缺 dependency、无法关联 URL_REQUEST、chain 过大被截断。
- `SourceChainViewer` 在 Dataset ready 后切换到 DatasetSourceChainView；fallback 时继续显示 preview，并明确“不是全量链路”。
- 诊断卡片跳 source chain 时，必须优先使用 Dataset source chain；Dataset 未 ready 时降级为 evidence-gap。

验收：

```bash
CI=true npm test -- --watchAll=false src/workers/netlogDatasetQuery.test.ts
CI=true npm test -- --watchAll=false src/App.phase3.test.tsx
```

真实样本通过标准：

- 326MB 样本 Dataset ready 后，输入任一失败/慢请求 sourceId 能看到 chain nodes、edges、events。
- Source Chain tab 不再显示“基于 preview events”的结果作为全量链路。
- chain 中每个错误或关键事件都能继续打开 raw event detail。
- chain 过大或无法关联时展示 evidence gap，而不是空白或 confirmed。

### Batch 8：大 NetLog Raw Evidence 虚拟 JSON 树

目标：

- 对标 netlog.viewer 的 details/raw evidence 能力：既能看顶层 metadata，也能按 event/detail 读取原始 JSON。
- 大文件下不把完整 events 数组 parse 到主线程或 React state。

最新状态：

- `RawEvidenceExplorer` 已支持通用原始 JSON 结构和搜索，优先走 Worker，失败时受限降级。
- Dataset event detail 已能通过 `byteStart/byteEnd` 读取单个 event raw JSON。
- `DataLoadedView` 当前只暴露 file info、presence flags、top event/source counts 和 evidence gaps；还不是顶层 metadata 的懒加载 JSON 树。

涉及文件：

```text
src/components/raw/RawEvidenceExplorer.tsx
src/components/raw/rawEvidenceGateway.ts
src/workers/netlogDatasetQuery.ts
src/workers/netlogDatasetViews.ts
src/workers/workerClient.ts
src/components/netlog/ExpertAnalysisTab.tsx
src/workers/netlogDatasetIndexer.test.ts
```

实现要点：

- 新增 NetLog Dataset Raw Evidence view：
  - 顶层节点：constants、polledData、systemInfo、clientInfo、netLogInfo、events。
  - 顶层 metadata 按需读取和预览，不复制完整大对象到主线程。
  - `events` 节点显示虚拟列表：eventId、typeName、sourceId、time、byteStart/byteEnd。
  - 展开单 event 时按 `file.slice(byteStart, byteEnd).text()` 读取并格式化 JSON。
- Data Loaded 中的 presence flags 要能跳到对应 top-level raw evidence 节点。
- Raw search 与 Dataset Events raw search 共享“结果可能不完整”的提示模型，不假装全量。
- 如果 raw event detail 读取失败，所有依赖该事件的 confirmed 诊断必须降级。

验收：

```bash
CI=true npm test -- --watchAll=false src/components/raw/rawEvidenceGateway.test.ts src/workers/netlogDatasetIndexer.test.ts
CI=true npm test -- --watchAll=false src/workers/netlogDatasetQuery.test.ts
```

真实样本通过标准：

- 326MB 样本不把完整 events 放入主线程。
- 能从 Data Loaded 跳到 constants/polledData/systemInfo/clientInfo/netLogInfo 的 raw evidence。
- 能从 Events/DNS/Proxy/QUIC/HTTP2/Sockets/Endpoint Evidence 跳到单个 raw event detail。
- event detail 读取出的 JSON 与 Events row 的 eventId/type/source/byteStart/byteEnd 一致。

### Batch 依赖关系和停止条件

依赖关系：

- Batch 1 是所有后续大文件体验优化的前置。没有真实上传链路 telemetry，不能判断“大文件慢”是在 summary、Dataset import、UI 接管还是 raw search。
- Batch 2 可以和 Batch 1 并行做小 fixture，但真实样本 `41 vs 27` 差异报告必须等 Batch 1/benchmark 证据齐全后再定结论。
- Batch 3 必须先输出 global-candidate 分布，再扩 source graph 规则。不能先猜字段再把 socket peer 塞进 SIP。
- Batch 4 可以独立实现，但 raw search 的 UI 文案必须引用 Dataset 状态；Dataset 未 ready 时不能给用户“全量搜索”的错觉。
- Batch 5 是所有新增 reducer/state 进入诊断层前的门禁。没有 Batch 5 端到端测试，Proxy/QUIC/HTTP2/Sockets 状态事实不得进入 confirmed。
- Batch 6 不应先于 Batch 1 的真实上传 telemetry。浏览器 Dataset 直导 benchmark 已经证明 Worker 可行，但 single scan 要解决的是上传链路双扫，必须用上传链路指标验收。
- Batch 6 可以和 Batch 2/3 的解析规则共用 seed/parser，但不能为了性能绕过 DNS server / DNS answer / DoH candidate、CIP / SIP / socket peer 的角色分离。
- Batch 7 依赖 Dataset source graph 和 event detail 稳定。没有 Batch 7，诊断层很难证明 request-scoped evidence。
- Batch 8 依赖真实 byteStart/byteEnd 和 Dataset event detail 稳定。没有 Batch 8，Raw Evidence 不能算大 NetLog 完整 JSON 树能力。

必须停止并回报的情况：

- 真实样本文件或使用日志不存在，导致无法验证 `2235117` event count、`dnsRecords=41` 或 Dataset 接管。
- benchmark 只能跑 synthetic，无法跑真实 326MB 文件。
- 浏览器 benchmark 因 sandbox `listen EPERM` 失败且未获得授权复跑。
- Dataset import 出现 ready，但 `datasetEventCount` 与真实事件数不一致。
- DNS answer 数量对齐只能通过混淆 DNS server / DNS answer / DoH candidate 实现。
- socket peer 关联率提升只能通过把 global-candidate 写入 SIP 实现。
- 任何新 telemetry 需要打印原始 header/token/raw URL 才能排查。
- 任一 confirmed 结论缺少 request/source/time/event/byte range 锚点。
- 证据不足时仍输出具体根因，或只显示空状态而没有说明缺什么证据、下一步怎么补。
- 原始 NetLog 文件、Dataset index 或 raw event detail 不可用，却仍输出 confirmed 网络根因。
- `byteStart/byteEnd` 读取出的 raw event 与 Events 列表 eventId/type/source 不一致。
- single scan 后 `datasetEventCount`、DNS answer、endpoint evidence、Data Loaded 任一关键指标低于旧 Dataset 路径且无法解释。
- single scan 需要把完整 events 保存到主线程或 React state 才能完成。

每个 Batch 的交付说明必须包含：

```text
改了哪些文件
新增/更新了哪些测试
跑了哪些命令
真实样本指标前后对比
哪些指标仍未达标
是否改变 feature flag 默认值
是否可能影响 HAR/Log 边界
```

### Batch 闸门：Definition of Ready / Done

后续 AI coding 不能只按“看起来能实现”进入下一 Batch。每一刀都要满足 Ready / Done。

Definition of Ready：

```text
1. 已重新读取本文件和相关源码，不用旧记忆替代当前代码。
2. 已确认要改的是哪个 Batch，且不会同时跨越多个 P0 主题。
3. 已列出本 Batch 的真实样本指标基线。
4. 已确认测试文件位置和需要新增的 fixture。
5. 已确认是否会影响 HAR / Log 边界。
6. 若需要浏览器 benchmark，已确认能运行或说明 sandbox 授权需求。
```

Definition of Done：

```text
1. 代码和 UI 行为满足该 Batch 的验收标准。
2. targeted tests、全量 tests、build 至少按本文件要求执行或明确说明无法执行。
3. 真实样本证据包已填写，不能只贴 synthetic 或小 fixture。
4. 诊断输出没有新增不可用结论；无法定因路径能保留 evidence-gap/needs-more-data。
5. raw detail / event/source/byte range 证据链没有断。
6. 敏感信息没有进入 telemetry、测试快照、导出报告或文档。
7. feature flag 默认值符合本文件要求；默认 false 的新主路径不得偷开。
```

允许并行：

- Batch 1 的 UI/telemetry 小测试可以和 Batch 4 raw search 保护并行，但必须共享 Dataset 状态文案。
- Batch 2 的小 fixture 可以提前做，但真实样本 41 vs 27 结论必须等 benchmark / 证据包。
- Batch 5 的端到端防误判测试可以先补，因为它是所有新增 reducer 进入诊断层的门禁。

不允许并行：

- Batch 6 single scan 不能在 Batch 1 真实上传 telemetry 缺失时直接替换主路径。
- Proxy/QUIC/HTTP2/Sockets 深化不能绕过 Batch 5，把状态事实接入 confirmed。
- Endpoint 关联率优化不能和 SIP 展示扩展混在同一刀；先提升关联，再决定 UI 怎么解释。

## 10. 测试夹具、Feature Flag 和验收门禁

这一节是硬门禁。后续实现即使功能看起来可用，也不能跳过这些测试和开关策略。

### 10.1 必补测试夹具

| 夹具 | 目的 | 覆盖文件 |
|---|---|---|
| 跨 chunk event JSON | 确认 Dataset indexer 不因 chunk 边界截断 event | `src/workers/netlogDatasetIndexer.test.ts`、`src/workers/netlogStreamScanner.test.ts` |
| 多字节字符 + byte offset | 确认 `byteStart/byteEnd` 是原始文件字节 offset，不是 decoded string 字符位置 | `src/workers/netlogDatasetIndexer.test.ts`、`src/workers/netlogEventJsonProbe.test.ts` |
| raw detail mismatch | 确认 raw event detail 读取失败或 event/type/source 不一致时不能输出 confirmed | `src/workers/netlogDatasetIndexer.test.ts`、`src/diagnosis/shared/finalSummaryBuilder.test.ts` |
| dataset unavailable diagnosis | 确认只有 summary preview / 日志片段 / 截图描述时输出 evidence-gap，而不是网络根因 | `src/diagnosis/shared/finalSummaryBuilder.test.ts`、`src/components/shared/FinalDiagnosisPanel.test.tsx` |
| DNS server=0 + DNS answer>0 | 确认 DNS server、DNS answer、DoH candidate 不混淆 | `src/workers/netlogDnsStateReducer.test.ts`、`src/diagnosis/ipEvidence/ipEvidence.test.ts` |
| DoH candidate only | 确认 Secure DNS 线索不进入 DNS server，也不成为 confirmed 根因 | `src/workers/netlogDnsStateReducer.test.ts`、`src/diagnosis/shared/finalSummaryBuilder.test.ts` |
| socket peer global-candidate | 确认未关联 socket peer 展示为候选，不进入 SIP | `src/workers/netlogEndpointEvidenceReducer.test.ts`、`src/diagnosis/ipEvidence/ipEvidence.test.ts` |
| x-request-ip only | 确认服务端观察客户端 IP 只是线索，不是 CIP/SIP/root cause | `src/diagnosis/ipEvidence/ipEvidence.test.ts`、`src/diagnosis/shared/finalSummaryBuilder.test.ts` |
| Proxy/QUIC/HTTP2/Sockets state only | 确认状态事实不会被上游诊断包装成 confirmed | `src/diagnosis/shared/finalSummaryBuilder.test.ts` |
| evidence-gap end-to-end | 确认证据不足时 UI、导出报告、复制文本都输出无法定因 + 缺失证据 + 下一步取证 | `src/diagnosis/shared/finalSummaryBuilder.test.ts`、`src/parsers/netlog/exportReport.test.ts`、`src/components/shared/FinalDiagnosisPanel.test.tsx` |
| action traceability | 确认主行动建议能追溯到证据级别；evidence-gap 只给补证动作，confirmed 才给修复/对比动作 | `src/diagnosis/shared/finalSummaryBuilder.test.ts`、`src/components/shared/FinalDiagnosisPanel.test.tsx` |
| raw search limit hit | 确认大文件 search 达到扫描上限时不会假装 total 完整 | `src/workers/netlogDatasetQuery.test.ts` |

### 10.2 Feature Flag 策略

当前代码已经有 Dataset 路径，但后续更激进的主路径改造仍应走 flag。原则：

- 新的一次扫描主路径、SourceChain Dataset 视图、Raw Evidence 虚拟 JSON 树、raw search 索引化，都应默认关闭。
- flag 打开后必须保留 fallback：Dataset import 失败时仍可展示 summary preview，但 UI 必须说明不是全量。
- flag 不允许改变诊断定因门槛。即使打开新状态视图，也不能让状态事实直接进入 confirmed。
- flag 命名建议：
  - `ENABLE_NETLOG_SINGLE_SCAN_DATASET`
  - `ENABLE_NETLOG_DATASET_SOURCE_CHAIN`
  - `ENABLE_NETLOG_RAW_VIRTUAL_TREE`
  - `ENABLE_NETLOG_RAW_SEARCH_INDEX`

当前已存在的开关：

| 能力 | 环境变量 | 本地调试开关 | 默认 | 允许用途 |
|---|---|---|---|---|
| single scan Dataset | `REACT_APP_ENABLE_NETLOG_SINGLE_SCAN_DATASET=1` | `localStorage.netlog_single_scan_dataset=1` | false | 真实样本 benchmark、人工灰度、回归验证 |
| large debug log | 无 | `localStorage.netlog_large_debug=1` | false | 本地排查大文件解析日志 |
| diagnosis timing debug | 无 | `localStorage.netlog_diagnosis_timing_debug=1` | false | 本地排查诊断耗时 |

灰度顺序：

1. `localStorage` 只用于开发者本机和 benchmark，不写入用户默认流程。
2. 环境变量只允许在测试环境或灰度构建打开。
3. 真实 326MB 样本通过 `dataset-import-baseline` 与 `upload-single-scan-check` 对比后，才能考虑扩大灰度。
4. 默认开启前必须完成 10.4 证据包，并由 reviewer 确认没有诊断门槛下降。

必须回滚或保持关闭的条件：

- single scan 后 `datasetEventCount` 与基线不一致。
- DNS answer、endpoint evidence、Data Loaded、Proxy/QUIC/HTTP2/Sockets 任一关键 reducer 指标低于旧 Dataset 路径且无法解释。
- `backgroundDatasetImportExpected=false` 不成立，说明 single scan 成功后仍触发后台双扫。
- raw event detail 无法按 `byteStart/byteEnd` 读回同一 event。
- UI 把 fallback summary 展示成全量 Dataset。
- 任何状态事实因为新路径进入 `confirmed`。
- benchmark / telemetry 输出了 header、Cookie、Authorization、token、raw URL query 或 body。

### 10.3 必跑验收命令

默认验收：

```bash
CI=true npm test -- --watchAll=false
npm run build
```

真实样本 Dataset baseline：

```bash
npm run benchmark:netlog-worker -- --file /Users/bytedance/Downloads/chrome-net-export-log_副本.json --label local-326mb
```

真实浏览器 Worker benchmark：

```bash
npm run benchmark:netlog-browser -- --file /Users/bytedance/Downloads/chrome-net-export-log_副本.json --label local-326mb --no-build
```

注意：

- `benchmark:netlog-browser` 需要本地 `127.0.0.1` server；在 sandbox 环境可能报 `listen EPERM`，需要授权后再跑。
- benchmark 通过不等于真实上传路径通过。真实上传还要验证 summary fallback 到 Dataset ready 的 UI 接管耗时。
- 不允许用 synthetic benchmark 代替真实 326MB 样本验收；synthetic 只能做回归补充。

命令用途矩阵：

| 命令 | 能证明什么 | 不能证明什么 |
|---|---|---|
| `CI=true npm test -- --watchAll=false` | 单元/组件/端到端测试当前绿色 | 不能证明真实 326MB 大文件性能 |
| `npm run build` | 生产构建可通过 | 不能证明运行时不卡或 Dataset 接管 |
| `benchmark:synthetic-netlog` | synthetic 生成和脚本可用 | 不能代替真实用户 NetLog |
| `benchmark:netlog-worker` | Node/Jest 环境 Dataset index/query/detail 基线 | 不能代表浏览器用户体感 |
| `benchmark:netlog-browser -- --mode dataset-import` | 浏览器 Worker Dataset import/query/detail 性能 | 不能证明真实上传 single scan 或 UI takeover |
| `benchmark:netlog-browser -- --upload-single-scan` | single scan 上传路径能否直接产出 ready Dataset | 不能单独证明诊断正确，仍需 DNS/socket/confirmed 证据包 |

任何性能结论都必须同时写清：

```text
运行环境：Node/Jest | Browser Worker | Real Upload
样本文件：真实 326MB | synthetic | 小 fixture
路径：dataset-import | upload-single-scan | fallback-background-dataset
结论范围：性能 | 事件完整性 | 诊断正确性
```

### 10.4 真实样本回归证据包

每个 Batch 完成后都要提交一份证据包。证据包可以写在 PR 描述或交付说明中，但必须足够让下一个 AI / 人类 reviewer 判断是否真的向目标前进。

证据包必须包含：

```text
代码变更范围：
  touched files
  feature flags changed or not

命令结果：
  CI=true npm test -- --watchAll=false
  npm run build
  targeted tests
  benchmark commands

真实样本指标：
  fileName
  fileSize
  mode=dataset-import | upload-single-scan | fallback-background-dataset
  singleScanDatasetReady
  backgroundDatasetImportExpected
  datasetEventCount
  uploadToFirstDiagnosisMs
  summaryScanMs
  datasetAutoStartMs
  datasetReadyMs
  datasetTakesOverEventsMs
  datasetTakesOverStateViewsMs
  completeEventScanCount
  queryP50/queryP95
  detailP50/detailP95
  mainThreadBlockedMs

证据完整性：
  raw detail 能否按 eventId 读取
  byteStart/byteEnd 是否来自原始文件字节 offset
  Events/Data Loaded/DNS/Proxy/QUIC/HTTP2/Sockets 是否 Dataset 接管
  summary / DNS State / Endpoint Evidence 的 DNS answer 计数和差异原因
  socketPeerSourceGraphAssociated / socketPeerGlobalCandidate / sourceGraphUnresolvedReasons

诊断准确性：
  confirmed 数量
  evidence-gap / needs-more-data 数量
  是否有任何 confirmed 缺 event/source/byte range
  是否有任何 DNS answer / socket peer / x-request-ip 被误写成根因
  UI / 导出报告 / 复制文本是否都保留证据级别

用户可用性：
  首屏结论是否简单明了
  无法定因时是否说明缺什么证据
  主行动是否包含 host/request/source/event/logID、动作和预期结果
  是否存在“看似确定但用户无法执行”的结论
```

真实样本固定基线：

```text
fileName=chrome-net-export-log_副本.json
fileSize=326930225
expectedEventCount=2235117
oldSummaryScanMs≈75023
browserDatasetImportMs≈12963
nodeDatasetIndexMs≈166053
oldDnsRecords=41
oldDatasetDnsAnswerCount=27
oldSocketPeerTotal=827
oldSocketPeerSourceGraphAssociated=52
oldSocketPeerGlobalCandidate=775
```

single scan 对比必须额外列出：

```text
dataset-import-baseline:
  datasetImportMs
  datasetEventCount
  dnsAnswerCount
  endpointEvidenceCount
  socketPeerSourceGraphAssociated
  socketPeerGlobalCandidate

upload-single-scan-check:
  summaryReadyMs
  datasetReadyMs
  singleScanDatasetReady
  backgroundDatasetImportExpected
  eventsPreview
  datasetEventCount
  dnsAnswerCount
  endpointEvidenceCount
  socketPeerSourceGraphAssociated
  socketPeerGlobalCandidate
  fallbackTriggered
```

判定规则：

- `datasetEventCount` 不等于真实事件数，不能通过。
- 只有 Node/Jest benchmark 快，不代表浏览器体验通过。
- 只有浏览器 Dataset import 快，不代表真实上传通过；必须证明 summary -> Dataset -> UI 接管链路。
- DNS answer 数量变化必须解释来源，不能通过混淆 DNS server / DNS answer / DoH candidate 凑数。
- socket peer 关联率提升必须说明关联规则和 evidence gap，不能把 global-candidate 写进 SIP。
- 如果 raw detail、导出报告、复制文本三者任一无法保留证据级别，诊断相关 Batch 不能通过。

### 10.5 真实上传路径 Telemetry 协议

真实上传路径必须能用日志或 benchmark JSON 证明状态流转。不要只依赖页面肉眼观察。

现有可复用事件：

```text
[netlog-large] worker:start
[netlog-large] worker:finish-scan
[netlog-large-summary]
[netlog-large] dataset-index:start
[netlog-large] dataset-index:endpoint-evidence-summary
[netlog-large] dataset-index:finish
[netlog-large] dataset-index:error
```

下一轮应补齐 App/UI 层事件，建议字段：

```json
{
  "event": "upload-flow:summary-ready | upload-flow:dataset-auto-start | upload-flow:dataset-ready | upload-flow:dataset-error | upload-flow:dataset-takeover",
  "fileName": "chrome-net-export-log_副本.json",
  "fileSize": 326930225,
  "mode": "fallback-background-dataset | upload-single-scan",
  "singleScanDataset": true,
  "singleScanDatasetReady": true,
  "backgroundDatasetImportExpected": false,
  "summaryScanMs": 75023,
  "datasetAutoStartDelayMs": 0,
  "datasetImportMs": 12963,
  "datasetReadyMs": 88000,
  "datasetEventCount": 2235117,
  "eventsPreview": 20000,
  "datasetStatus": "fallback | importing | ready | error",
  "analysisId": "dataset-xxx",
  "activeExpertViews": ["events", "data-loaded", "network-state", "evidence"],
  "error": "<only sanitized error message>"
}
```

字段含义：

- `summaryScanMs`：大文件 summary fallback 扫描耗时。
- `mode`：区分旧 fallback 后台 Dataset 路径和 single scan 上传路径。
- `singleScanDatasetReady`：single scan 成功时必须为 true；若 false，需要记录 fallback 原因。
- `backgroundDatasetImportExpected`：single scan 成功时必须为 false，防止成功后又启动后台 Dataset 双扫。
- `datasetAutoStartDelayMs`：summary ready 到 Dataset import start 的延迟。
- `datasetImportMs`：Dataset Worker import 耗时。
- `datasetReadyMs`：从上传开始到 Dataset ready 的总耗时。
- `datasetTakesOverEventsMs`：Events tab 切到 DatasetEventsTab 的耗时。
- `datasetTakesOverStateViewsMs`：Data Loaded / DNS / Proxy / QUIC / HTTP2 / Sockets 切到 Dataset reducer 的耗时。
- `datasetEventCount`：必须等于真实 event count。
- `eventsPreview`：只用于 fallback 说明，不能作为全量能力证明。

成功判定：

- fallback path：上传后出现 `upload-flow:summary-ready`，summary fallback 后自动出现 `upload-flow:dataset-auto-start`，不需要用户手动点击。
- single scan path：上传后直接出现 `upload-flow:dataset-ready` 和 `upload-flow:dataset-takeover`，且 `singleScanDataset=true`，不再出现后台 Dataset import。
- 两条路径最终都必须出现 `upload-flow:dataset-ready` 或明确 `upload-flow:dataset-error`。
- ready 时 `datasetEventCount=2235117` 或等于当前样本真实事件数。
- ready 后 Events/Data Loaded/DNS/Proxy/QUIC/HTTP2/Sockets/Endpoint Evidence 都使用 Dataset。

失败判定：

- 只有 summary，没有 dataset auto start。
- 有 dataset start，但没有 ready/error。
- ready 之后仍展示 preview Events 或 summary DNS/IP 证据。
- `eventsPreview=20000` 被当成全量事件数。
- 日志包含敏感 header/token/raw URL 明文。Telemetry 只能记录指标、类型名、sourceId/eventId 和脱敏错误。

### 10.6 不能回退的边界

- 主线程不能保存完整大文件 events。
- `byteStart/byteEnd` 必须是原始字节 offset。
- DNS server、DNS answer、DoH candidate 必须分离。
- CIP、SIP、socketPeer、dnsAnswer、x-request-ip 必须分离。
- streaming summary 只能是 fallback，不允许继续扩成 netlog.viewer parity 主路径。
- Log 模块只做阅读增强，不参与网络根因权重。
- 没有 request/source/time/event 关联的证据，不能输出 confirmed 根因。

### 10.7 隐私脱敏和 Log 模块边界

真实 NetLog / HAR / Log 经常包含业务 URL、Cookie、Authorization、登录态 token、trace header、request body、response body。后续实现必须把“证据可追溯”和“敏感信息不外泄”同时满足。

Telemetry / benchmark / 测试快照允许记录：

- eventId、sourceId、sourceTypeName、typeName、phase。
- byteStart、byteEnd。
- 计数和耗时：eventCount、dnsAnswerCount、socketPeerCount、queryP95、datasetImportMs。
- 脱敏 host：只保留 hostname，不保留 query string。
- 脱敏错误：只保留错误类型和 code，不保留 header/body/raw URL。
- logID / request id：可作为跨系统查询线索，但不参与网络根因权重。

Telemetry / benchmark / 测试快照禁止记录：

- 完整 URL query string。
- Cookie、Authorization、x-csrf-token、登录 token、session id。
- request body / response body 原文。
- 完整 rawLine。
- 未脱敏 headers JSON。
- 可还原用户身份或业务内容的 trace host/value。

Log 模块边界：

- Log 只做阅读增强、分组、搜索、logID 展示和上下文定位。
- Log 可以帮助用户拿 logID 去服务端/CDN/业务系统查证。
- Log 不参与 DNS/TCP/TLS/Proxy/QUIC/HTTP2/Sockets 根因权重。
- Log 中出现慢请求、错误码或业务报错，只能作为“业务侧/服务端侧待核查线索”，不能反推客户端网络根因。
- 联合诊断里若 HAR/NetLog 没有 request/source/event 证据，不能因为 Log 有 error 就输出网络 confirmed。

报告导出要求：

- 默认导出应隐藏敏感 header/body/rawLine。
- 若用户主动打开“导出原始证据”，必须显式提示可能包含敏感信息。
- 导出里的证据引用优先使用 event/source/byte range、host、error code、logID；避免复制完整请求内容。

### 10.8 PR / 交付审查清单

后续 AI coding 完成后，reviewer 应按这张清单审查。不要只看“页面能打开”或“测试绿”。

必须通过：

- 真实样本证据包完整，且 `datasetEventCount` 等于原始事件数。
- Dataset ready 后，Events/Data Loaded/DNS/Proxy/QUIC/HTTP2/Sockets/Endpoint Evidence 不再依赖 preview events。
- 大文件状态文案能区分 fallback/importing/ready/error，用户不会把 fallback 当完整 Dataset。
- 所有 confirmed 诊断都有 request/source/event/time/byte range 或 source chain 锚点。
- evidence-gap / needs-more-data 在 UI、导出报告、复制文本中保持原级别。
- DNS server、DNS answer、DoH candidate 三者没有混淆。
- CIP、SIP、socketPeer、dnsAnswer、x-request-ip 五类角色没有混淆。
- raw search 达到扫描/耗时上限时，不假装 total 完整。
- 诊断主行动能说明对象、动作和预期结果。
- Telemetry、benchmark、测试快照没有泄露 header/token/raw URL/body。

禁止合入：

- 用 synthetic benchmark 代替真实 326MB 样本验收。
- 只修 UI 文案，不证明 Dataset 是否自动启动和 ready。
- 只提高 IP 展示数量，但把 DNS answer 或 socket peer 写进 SIP。
- 只增加状态页，却把 Proxy/QUIC/HTTP2/Sockets 状态事实接进 confirmed。
- raw event detail 读取失败仍输出 confirmed。
- `byteStart/byteEnd` 不是原始字节 offset，或无法读回同一 event。
- Log 模块参与网络根因权重。
- 为了性能把完整大文件 events 存进主线程或 React state。
- feature flag 默认打开未经真实样本验证的新主路径。

如果审查不通过，交付说明必须写明：

```text
未通过项：
影响范围：
为什么不能给用户 confirmed 结论：
当前应展示的 evidence-gap 文案：
下一步补证或修复动作：
```

## 11. 给其他 AI coding 的提示词

```text
项目路径：
/Users/bytedance/Documents/Analysis-net-log/netlog-analyzer-react

请先读取：
docs/2026-07-03-netlog-viewer-parity-open-items-and-roadmap.md
docs/netlog-viewer-parity-diagnostic-implementation-playbook-2026-07-02.md

开始 coding 前先按本文 `8.1 下一轮 coding 执行总表` 选择一个切片，再按 `Batch 闸门：Definition of Ready / Done` 自查；交付时按 `10.4 真实样本回归证据包` 给出证据，并按 `10.8 PR / 交付审查清单` 自检。

当前最新状态：
- 旧全量测试曾绿色：30 suites / 164 tests passed；打断后本轮只复跑 targeted suites，未重新跑全量测试和 build。
- 326,930,225 字节样本 Node/Jest Dataset benchmark：datasetIndexMs=166053，eventCount=2235117，queryP95=26，detailP95=3。
- 326,930,225 字节样本浏览器 Worker benchmark 已跑通：datasetImportMs=12963，eventCount=2235117，queryP95=21，detailP95=2，mainThreadBlockedMs=57，rafMaxDelayMs=1。
- Dataset import timeout 已接 largeNetlogTimeout，不要重复修旧的 60s timeout 问题。
- DNS answer 共享 helper 已存在，不要重复抽同名 helper；请用真实样本验证 41 vs 新计数差异。
- socket peer source graph stats / unresolved reasons 已存在，不要重复做统计字段；请用真实样本验证关联率是否提升。
- raw search scan/time limit 字段和 UI 不完整提示已存在；请验证 worst-case 和取消/新查询覆盖体验。
- single scan flag 已存在：`REACT_APP_ENABLE_NETLOG_SINGLE_SCAN_DATASET=1`；请跑 flag on/off 对比，不能再说“尚未发现开关”。
- Batch E confirmed guard、fromNetlog/fromCombined/export 防误判已有明显实现；下一步是用真实 reducer/state 到 UI/导出的证据包验证。
- Proxy/QUIC/HTTP2/Sockets 已增强 Dataset state view，不要再说完全没做；但它们还不是完整 netlog.viewer parity。

下一轮只做这些：
1. 真实 326MB flag on/off 上传对比：首屏诊断、Dataset ready、Events/State Views 接管、main thread blocked、是否双扫。
2. 新 DNS helper 下的差异报告：summary dnsRecords、DNS State、Endpoint Evidence、DoH candidate、DNS server config 分开计数。
3. 新 source graph 下的 socket peer 关联报告：sourceGraphAssociated、globalCandidate、unresolved reasons、top type/source/param keys。
4. raw search worst-case：无过滤、有过滤、命中 scan/time limit 时 UI 是否诚实说明不完整。
5. 真实 reducers/state -> final diagnosis -> export/report copy 防误判证据包。

如果不能一次完成多项，只做第 1 项。第 1 项不是“继续写 single scan 代码”，而是用真实 326MB 样本证明现有 single scan flag on/off 的行为、指标和 UI 接管。

推荐最小可验收切片：

第一刀只做 `真实样本回归证据包 + single scan flag on/off 对比`，不要重复实现已存在的 DNS helper、raw search limit、upload-flow telemetry。交付必须包含：

```text
1. 上传链路 telemetry：
   uploadStartMs
   summaryReadyMs
   datasetAutoStartMs
   datasetProgress events/count/percent/elapsed
   datasetReadyMs
   datasetTakeoverMs

2. UI 状态：
   fallback
   importing
   ready
   error
   retry

3. raw search 保护验证：
   scanned
   scanLimitHit
   timeLimitHit
   hasMoreMatchesUnknown
   UI 强提示先加 type/source/time/error 过滤

4. single scan 对比：
   REACT_APP_ENABLE_NETLOG_SINGLE_SCAN_DATASET=0/1
   是否只扫描一次
   datasetEventCount / dnsAnswerCount / endpointEvidenceCount
   fallback 是否触发
```

建议直接跑：

```bash
npm run benchmark:netlog-browser -- --file /Users/bytedance/Downloads/chrome-net-export-log_副本.json --label dataset-import-baseline --mode dataset-import --no-build
npm run benchmark:netlog-browser -- --file /Users/bytedance/Downloads/chrome-net-export-log_副本.json --label upload-single-scan-check --upload-single-scan --no-build
```

这一刀的验收标准不是“代码能跑”，而是能回答：

```text
用户上传 326MB 文件时，到底慢在 summary、Dataset import、UI 接管，还是 raw search？
Dataset ready 后，Events/Data Loaded/DNS/Proxy/QUIC/HTTP2/Sockets 是否真的接管？
用户是否还能误以为 fallback summary 是完整 Dataset？
```

交付时必须按本文 `10.4 真实样本回归证据包` 填写结果，至少包含：

```text
touched files
tests/build/benchmark commands
datasetEventCount
summaryScanMs / datasetReadyMs
queryP95 / detailP95
DNS answer / socket peer 指标前后对比
confirmed / evidence-gap / needs-more-data 数量
是否有 raw detail 读取失败
是否有敏感信息泄露风险
```

第二刀再根据证据决定是否继续修 `DNS answer 口径`，第三刀再根据 unresolved reasons 修 `socket peer source graph`。如果第一刀没有真实样本差异报告，后两刀容易变成重复实现。

已确认的源码事实：
- 大文件默认路径仍可能先 summary fallback，再后台 Dataset import；single scan 需要 `REACT_APP_ENABLE_NETLOG_SINGLE_SCAN_DATASET=1`。
- `ExpertAnalysisTab.tsx` 源码中未再搜到旧 stale 文案，但真实 UI 四态仍需验证。
- `queryNetlogEventsWithRawSearch()` 已有 scan/time limit 结果字段；取消或新查询覆盖体验仍需验证。
- DNS helper 已共享；需要用真实样本证明 summary、DNS State、Endpoint Evidence 的数量差异是否合理。
- socket peer 不全的核心仍可能是 source graph 关联率和 unresolved reasons，不能把 global-candidate 混进 SIP。

禁止：
- 不要把 socket peer / DNS answer 塞进 SIP。
- 不要把 DNS answer / DoH candidate 塞进 DNS server。
- 不要把 TTFB、代理配置、协议状态、x-request-ip 写成 confirmed 根因。
- 不要把 20,000 preview events 当成全量 Events。
- 不要在主线程保存完整大文件 events。
- 不要为了给答案而输出不可用结论；证据不足时必须明确写“当前无法确认网络根因”，并说明缺什么证据、下一步怎么补。
- 不要在原始 NetLog 文件、Dataset index、raw event detail 不可用时输出 confirmed；必须直接告诉用户当前无法确认网络根因，并要求补充原始 NetLog 或等待 Dataset ready。
- 不要给用户无法执行或无法验证的下一步；每个主行动都要说明 host/request/source/event/logID、执行动作和预期结果。
```

## 12. 目标完成度审计

不要把“已有代码路径”当成“目标已完成”。当前按原始目标逐项审计如下：

| 目标要求 | 当前证据 | 判断 | 还缺什么 |
|---|---|---|---|
| 新建文件记录未完成项和后续方向计划 | 本文件已创建并持续更新 | 已满足文档交付 | 若要提交，需 `git add -f`，因为 `docs/` 被忽略 |
| 结合最新代码，而不是凭旧计划 | 已复核 `parseUploadedInput.ts`、`App.tsx`、`ExpertAnalysisTab.tsx`、Dataset query/reducer、summary DNS 提取 | 已满足本轮审查 | 其他 AI 后续再改代码后需重新审查 |
| NetLog 解析能力对标 netlog.viewer | Events/Data Loaded/DNS/Proxy/QUIC/HTTP2/Sockets 已有 Dataset 视图；状态 reducers 已增强；326MB Dataset eventCount=2,235,117 | 部分完成 | Source Chain 仍走 preview，Raw Evidence 还不是完整虚拟 JSON 树；Proxy/QUIC/HTTP2/Sockets 仍需 request/source/raw detail 级验收；Alt-Svc/HTTP cache/Reporting/Stream Pool/Timeline 等二线 viewer 模块尚未进入主路径 |
| 大 NetLog 全量事件读取和展示 | Browser Worker Dataset import 已跑通，query/detail p95 可接受；raw search 已有 scan/time limit 字段 | 部分完成 | 真实上传路径仍需证明 Dataset ready 后接管所有页面；raw search worst-case 和取消/覆盖体验未验收 |
| 大文件解析慢问题 | Worker 直导约 13s；single scan flag 已接入并有 targeted tests | 未完成 | 真实 326MB flag on/off 上传未复跑；必须证明只扫一次、指标不丢、UI 接管完整 |
| DNS server / DNS answer / DoH candidate 分离 | DNS State reducer 已有 `configServers`、`hostResolverCache`、`taskResults`、`dohCandidates`；共享 DNS answer helper 已落地 | 部分完成 | 旧 `dnsRecords=41` vs `dnsAnswerCount=27` 需要用新代码重新复测并解释 |
| CIP / SIP / socketPeer / dnsAnswer / x-request-ip 分离 | Endpoint Evidence 已分角色，且明确 socket peer 不能进 SIP；source graph stats/unresolved reasons 已增强 | 部分完成 | 新 socket peer 关联率未用真实样本复测；真实 UI 中用户看到“不全”仍未闭环 |
| 输出网络诊断要有证据和简单结论 | `finalSummaryBuilder`、`fromNetlog/fromCombined`、`exportReport` 已有防误判测试；本文档已补原始 NetLog 证据绑定规则和可用诊断契约 | 部分完成 | 仍缺 `DiagnosisEvidenceAdapter` 这类结构化证据适配层；真实 reducers/state 到 UI/导出/复制文本的完整证据包未跑；raw detail 不可用时必须降级 |
| 不能乱给根因结论 | TTFB、代理配置、协议状态、DNS answer、socket peer、x-request-ip 均有 not confirmed 测试；本文档已补无法定因模板和 net_error 分类边界 | 部分完成 | 新增 Proxy/QUIC/HTTP2/Sockets reducer 产出的状态事实仍需真实链路验证不会进 confirmed；`hasCorrelationAnchor()` 不能靠文案域名/URL 当强锚点；UI/导出/复制文本都要保留 evidence-gap |
| Log 模块只做阅读增强 | 当前文档和代码审查未发现把 Log 纳入网络根因权重 | 暂无新增风险 | 后续实现仍需保持 Log 不参与网络根因定权 |
| streaming summary 只能 fallback | 架构文档和当前代码都把大文件 summary 标为 fallback；single scan flag 已存在 | 部分完成 | single scan 尚未默认开启；真实上传需证明 flag on 路径稳定，fallback 只作为失败保底 |
| 主线程不能保存完整大文件 events | Dataset Worker + compact index 路径成立；大文件 summary 只返回 preview events | 部分完成 | 需要真实浏览器上传时的内存和 UI 接管证据 |

结论：

- 当前目标没有达到“完成”。已有文档和更多代码能力，但 netlog.viewer parity、真实大文件上传体验、DNS/IP 证据完整性、以及准确根因定因仍有未验证项。
- 下一轮 coding 不应继续泛化扩页面，也不应重复实现已存在入口；应围绕 P0 闭环：真实上传 flag on/off 指标、DNS answer 差异报告、socket peer 关联率报告、raw search worst-case、状态事实防误判证据包。
- 任何新 reducer 或诊断规则都必须能回答两个问题：证据来自哪个 event/source/byte range；为什么它足以或不足以升级为根因。

## 13. 完成定义

目标完成必须同时满足：

- 真实 326MB 级样本浏览器上传后 Dataset ready，并接管 Events/Data Loaded/DNS/Proxy/QUIC/HTTP2/Sockets/Endpoint Evidence。
- Dataset eventCount 等于原始文件真实事件数。
- query/detail/raw event 跳转在大文件上可交互。
- confirmed 诊断能回跳原始 NetLog event/source/byte range；raw detail 不可用时只能输出 evidence-gap。
- 主行动建议能追溯到对应证据级别；无法定因时主行动是补证，不是修复性结论。
- browser benchmark 输出并达标，真实上传流程指标也达标。
- 真实上传链路不再 summary + Dataset 双扫；如 single scan flag 未打开，不能宣称大文件主路径完成。
- DNS server / DNS answer / DoH candidate 分离。
- CIP / SIP / socketPeer / dnsAnswer / x-request-ip 分离。
- confirmed 根因只来自明确网络栈错误 + request/source/event/host 关联。
- 无法确认根因时，UI、导出报告和复制文本都明确输出 `evidence-gap/needs-more-data`，并告诉用户缺什么证据和下一步怎么补。
- summary fallback 只作为保底，不作为 netlog.viewer parity 主路径。

当前还不能标记目标完成。
