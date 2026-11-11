# P0-A · 恢复真实诊断数据与保留有效导出修复

**当前产品决定（2026-11-11）：负责人已撤销默认匿名分享与 D-C-V1 / D-C-META 的产品使用决定。** 本工具默认导出原出口支持的真实诊断数据；不再提供分享/专家双模式、地址别名或 redactions 状态投影。当前实现与验证见 [导出纠偏记录](diagnostic-export-restoration.md)；当前 PR 说明见 [pr-description.md](pr-description.md)。

当前默认 NetLog/Go JSON 恢复实施前 master 的字段结构与含义，Go TXT 恢复原始行。CSV 编码/公式保护、0 与负数、时间与可选字段、Go 原 ID、完整复制/下载、有限 DOM 预览和旧快照失效保留。HAR、Trace、证据包及摘要原本已有的内容边界保留，撤销其外层新增匿名化；不新增原始大字段读取。

PR #3 继续 Draft；不转 Ready、不合并、不部署。本轮检查只证明导出纠偏候选；真实样本、安全 Edge/Excel、500/800MB 和真实消费者尚未验收。旧匿名 Schema、字段状态 helper 及对应验证脚本已退出当前树；其历史源码可在 [已审核 f4dd913 快照](https://github.com/WLWadmin/netlog-analyzer-react/tree/f4dd91380da343d97faa02a6f0ecae49dad2fe19/reviews/p0-a) 复核。

## 历史记录（截至 f4dd913；不代表当前产品契约）

以下保留原审查结论、当时的授权和验收限制。历史“安全分享”“专家切换”“待批准”及旧 Schema/脚本的相对链接均对应上述固定历史快照，不能用来要求当前默认出口继续匿名化。历史 REVIEW-C PASSED 是对当时实现的结论，不代表本轮新代码已获独立复核。

本分支仅实施 P0-A，交由技术顾问 Review；不合并、不部署、不启动其他 P0 单元。

**REVIEW-C：PASSED。** 负责人本次提供独立技术复核结论，绑定生产 HEAD `d45fd3a1a088fa12af1adf8dc15e0b874a1851ea`：D-C-V1 / D-C-META 静态审查通过，未发现需再次修改 C-01～C-03 的明确代码阻塞项。GitHub [同一 HEAD 的 CI](https://github.com/WLWadmin/netlog-analyzer-react/actions/runs/42993461216) 已另行读取确认通过；这不是 GitHub 上已提交 APPROVED Review 的声明。

**P0-A 运行/发布验收：blocked，PR #3 继续 Draft。** 最新 [最终运行验收报告与人工清单](runtime-acceptance.md)、[四态检查记录](runtime-checks.json)、[当前合成性能观测](runtime-performance.json) 区分已执行的契约/编码/合成交互检查与缺少条件的真实样本、浏览器、Excel、大文件和真实机器消费者验证。本轮只增加评审与验收材料，生产代码不变；不转 Ready、不合并、不部署。

实现材料：[限定实现](review-c-implementation.md)、[获批 schema](review-c-sharing-v1.schema.json)、[实际 builder 合成对照](review-c-actual-examples.json)、[可复验脚本](verify-sharing-v1.cjs)。默认安全分享 JSON v1 与旧默认布局不兼容，专家兼容 JSON 保持旧结构；该边界已批准并通过独立复核。

以下首轮实现记录及 A～E 的 [review-remediation.md](review-remediation.md)、旧 [json-compatibility.md](json-compatibility.md)保留为历史。后续状态仅在本入口和最终运行报告追加，不改写旧报告；下方旧“待批准/未复核”等措辞不代表当前结论。

## 授权与基线

- 负责人本轮明确回复：“D01–D07 均选择最新评审表中的方案 A，我授权 P0-A 在独立分支实施、测试和提交 Draft PR，不授权合并或部署。”
- D01–D07 方案 A 已获设计批准；工程执行范围仅 P0-A。创建 Draft PR 所必需的本地提交和分支推送属于本轮授权，不授权合并或发布。
- 开发基线：`origin/master`，`5d6f3f1da4931eeff13fb028d069862e8cb86530`。
- 已审核设计：[`915a23e6bc03bf0ef3106fd95d7caeccc77964de`](https://github.com/WLWadmin/netlog-analyzer-react/tree/915a23e6bc03bf0ef3106fd95d7caeccc77964de/reviews/workbench-v3)；实施前已读取 architecture、p0-work-units、parity-gate、feature-matrix、approvals、validation。
- 独立分支：`fix/export-sharing-safety`。设计评审分支未修改。
- 保留 311 项保护 ID，原 ID 集摘要：`bd5e351b64e584eef0260f078d436280bf9bf4bca06a52eb0c69f47bbe86dfd0`。本文件只记录受影响范围，不重写矩阵、不宣称完成 C1 全量运行时验收。

## 实现与结果差异

所有格式仍保留。默认分享采用单报告地址别名与字段投影；预览中显式勾选列明的“本地专家字段”后，可访问原出口支持的字段。专家选项不新增原先未导出的完整事件、Trace args 或正文读取能力。

| 格式/入口 | 默认分享 | 显式专家范围与兼容 |
|---|---|---|
| App JSON | 原顶层类别、请求数值与阶段端点保留；URL/PAC 别名；开放代理对象和错误 detail 用占位符 | 旧 proxyInfo、URL、错误 detail 和请求字段保留 |
| App CSV | 同 12 列、UTF-8 BOM；URL 别名，文本转义、公式/控制字符保护 | 原 URL/文本可导出；保护仍开启，数值 `0` 和负错误码不加保护前缀 |
| NetLog 完整 Markdown | 原报告结构，整份文本统一分享投影 | 既有 exportReport 原文，不修改诊断规则 |
| NetLog 专家证据包 | 保留 source/event 标识、计数、原有 Top 样例范围、summary-only/Dataset 状态，地址别名 | 原证据包原文及原脱敏范围保留；不扩展为全量事件导出 |
| 协作摘要/单卡片 Markdown | 标题、结论、范围、证据、置信度依据、动作和限制统一投影 | 既有报告文本及原证据脱敏保留 |
| Go JSON | 全部当前筛选条目；URL 别名，原始行/Headers/Body 不读取、不序列化 | 原展示 DTO 的所有字段（含原始行、Headers、Body）保留 |
| Go TXT | 同筛选范围的逐条事实文本；不读取原始行 | 原始行逐条拼接，原能力保留 |
| Trace Markdown/JSON | 继续复用原白名单及引用校验；另在分享边界投影地址/路径/文本 | 原 schemaVersion=1 白名单、原 MD、既有事实范围与引用保留；无原始 args/sourceText |
| HAR 请求摘要 | URL/Remote Address 别名，追踪标识占位；原始正文/Headers 不参与 | 原摘要域名、路径、Remote Address、x-tt-logid 保留；仍沿用 query/hash 移除 |
| HAR 问题组摘要 | 标题和证据统一分享投影；复制按钮先预览 | 原问题组文本及原 URL/Header 脱敏保留 |
| IT/客服交接与尝试记录 | 原结论、请求引用和验证结果保留，分享文本别名化 | 显式专家交接保留既有文本，沿用原严格凭据/query/本地路径脱敏 |

默认分享不是原始数据交换格式：JSON 中部分原对象字段现在是占位字符串，地址和文本也会改变。需要原结构或原字段的下游可使用列明范围的专家选项；**这不等于默认格式兼容损失已获批准。** C-01～C-03 仍是明确发布阻塞，不能用 D04-A 代替单独审批。CSV 含公式前缀的**文本**会加 `'`，引号加倍、记录分隔改为 CRLF；这些是有意编码修正。未移除格式或完整本地字段，但默认格式确有待批准的兼容损失。

## 受影响 Feature ID 与消费者

| Feature ID | 实际修改出口 | 间接消费者/边界 |
|---|---|---|
| X-OUT-001 | App → netlogExport JSON → 共用预览 | 普通解析及 Worker 产生的同一 AnalysisResult；本地请求详情不改 |
| X-OUT-002 | App → netlogExport CSV → 共用预览 | 请求列表/Timing 数值；不修改 parser、排序或置信度 |
| X-OUT-003、N-EXPERT-009 | App 原报告/专家证据包 → 分享投影 → 预览 | ExpertAnalysisTab、12 个 Dataset state 查询；原 builder 和 reducer 不改 |
| X-OUT-004 | ExportSummaryButton、DiagnosticCard | DiagnosisPanel、NetLog/HAR/Combined 摘要；只改导出边界 |
| T-BASE-004–005 | TraceResultPage | App 懒加载、原 Trace 白名单 builder 与证据引用；Flag 不改 |
| L-RAW-007–008 | LogRawList、exportLogEntries | LogResultPage、筛选后的全条目；可见列表加载上限不成为导出上限 |
| H-FIELDS-010–011 | HarRequestDetail、HarIssueClusterList、两个 CopyText builder | HarRequestTable、HarSummaryDiagnosis/问题组、请求详情预览；sanitizeHarUrl 本地显示兼容不改 |
| G-VERIFY-001–002 | FinalDiagnosisPanel 交接文本 | NoviceTroubleshootingFlow 提供尝试记录；verificationSession 仅评估，无独立文件出口，不改存储/结果判断 |

另盘点原字段复制（URL/Headers、原始行、命令、DNS/IP 列表和独立 IP 查询结果）：这些是明确选择本地证据字段的操作，不是标称默认安全的协作摘要，本轮保留其原访问能力。未新增网络发送、存储或远端查询。HAR 按需正文网关、Worker 协议、导航和 F01–F04/F06/F07 均未修改。

## 本地完整性与预览一致性

- 新 NetLog 投影不访问请求 events 或 Worker dataset，也不读取分享模式的开放代理对象；getter 抛错测试保护这些边界。
- Go 分享模式不读取 headers/body/bodyRaw/rawLine；120 条筛选条目全部保留，专家 JSON/TXT 对照原字段/原始行。
- 冻结输入和修改前后对照证明本地 URL、错误 detail、请求阶段和原白名单不被投影修改。
- 共享预览对一次生成的文本快照执行复制和下载；取消不下载，专家生成按选择缓存，每次新预览恢复分享模式，换数据清除旧预览。App 异步报告/state 查询完成后校验当前 result。
- 别名字典只在一次投影存活，反向映射不写入文件或持久存储；它不替代跨会话证据身份设计。

## 实际变更文件

- 生产：`src/App.tsx`、`src/utils/netlogExport.ts`、`src/diagnosis/shared/maskedExport.ts`。
- 共享出口：`src/components/shared/useExportPreview.tsx`、`ExportSummaryButton.tsx`、`DiagnosticCard.tsx`、`FinalDiagnosisPanel.tsx`（后三项位于同一 shared 目录）。
- HAR：`src/components/har/HarRequestDetail.tsx`、`HarIssueClusterList.tsx`、`buildHarRequestCopyText.ts`、`buildHarClusterCopyText.ts`。
- Go：`src/components/log/LogRawList.tsx`、`exportLogEntries.ts`。
- Trace：`src/components/trace/TraceResultPage.tsx`、`src/parsers/trace/exportTraceReport.ts`。
- 回归：`src/App.phase3.test.tsx`、`src/utils/netlogExport.test.ts`、`src/components/shared/useExportPreview.test.tsx`、`DiagnosisFirstScreen.test.tsx`、`src/components/log/exportLogEntries.test.ts`、`src/components/har/buildHarRequestCopyText.test.ts`、`src/components/trace/TraceResultPage.test.tsx`、`TraceResultPage.facts.test.tsx`、`src/diagnosis/shared/maskedExport.test.ts`、`src/parsers/trace/exportTraceReport.test.ts`。
- 评审材料：本 README 和 `validation.md`。共 27 个提交候选文件；构建产物、忽略的 docs、临时缓存不包含在提交中。

## 检查与限制

首轮命令和失败复现见 [validation.md](validation.md)，当前整改候选命令和最终状态见 [review-remediation.md](review-remediation.md)。四态证据只对应各自候选，不对应所有真实诊断、C1、新 UI 或全功能发布验收。

默认自由文本复用既有脱敏/scanner，再增加地址别名和未知敏感文本占位；有限模式不能证明任意用户备注、任意私有标识都已匿名。分享前需人工复核。专家文件可以含凭据和原始内容，应按预览列明范围仅交给获准接收者。

真实脱敏样本、500/800MB 设备性能、Edge 浏览器视觉/下载/Excel 打开验收及外部独立安全复验未执行。UI mock 测试证明快照与回调，不等于真实浏览器验收。首次构建的主包 gzip 比基线构建增加约 17.66 kB（预览引入 Modal/Checkbox 等），无新依赖；尚无同设备加载性能预算，需在 Review 中评估。

回退方式：如需撤回，新增 revert 提交撤销本 P0-A 补丁；不改写历史，不关闭原导出入口。回退会恢复旧泄漏/CSV 风险。泄漏、编码、专家字段或预览一致性回归失败阻止本修复发布；真实场景未验收项不得记录为 passed。
