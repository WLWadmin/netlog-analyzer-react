# P0-A 导出纠偏记录

负责人明确要求：本地网络日志分析和诊断工具应直接导出真实诊断数据，撤销此前默认匿名分享决定。本轮仅恢复导出契约、保留有效编码和预览修复，不进行整体 revert，不启动 C1 或其他 P0。

修改前与远端 PR #3 HEAD 一致：`f4dd91380da343d97faa02a6f0ecae49dad2fe19`。兼容基准为实施前 master `5d6f3f1da4931eeff13fb028d069862e8cb86530` 的实际出口。分支沿用 `fix/export-sharing-safety`，没有覆盖其他提交；原有未跟踪分享缓存未纳入修改。

## 出口与修改文件

| 入口 / 文件 | 纠偏与保留边界 | Feature ID |
|---|---|---|
| `src/utils/netlogExport.ts`、`src/App.tsx` | JSON 恢复 exportTime/overview/proxyInfo/requests/errors；URL/PAC/代理对象/错误 detail 原值，CSV 真实 URL；完整 MD 和专家证据包直接使用原 builder。保留异步 result 校验及既有 12 个 Dataset state 查询 | X-OUT-001–003、N-EXPERT-009 |
| `src/components/log/exportLogEntries.ts`、`LogRawList.tsx` | Go 默认 JSON 恢复全部旧 DTO 字段和类型，TXT 为原始行；全部筛选结果导出，原 ID 不重编号 | L-RAW-007–008 |
| `src/components/shared/useExportPreview.tsx` | 单一 text 快照；删除双模式、专家生成器/缓存和分级文案。保留完整复制/下载、32768 字符 DOM 预算、UTF-16 边界、取消、owner 重置与过期回调保护 | 以上出口的共用预览 |
| `src/diagnosis/shared/maskedExport.ts`、`src/components/shared/ExportSummaryButton.tsx`、`DiagnosticCard.tsx`、`FinalDiagnosisPanel.tsx` | 删除新增 sanitizer 外层；诊断卡片和 MD 保留原 maskEvidenceValue，IT/客服摘要保留旧 sanitizeDiagnosisText。原域名/IP 和未被旧规则处理的文本默认可见；原 query/凭据/本地路径处理未删除；交接预览按钮改为“导出交接摘要” | X-OUT-004、G-VERIFY-001–002 |
| `src/components/har/buildHarRequestCopyText.ts`、`buildHarClusterCopyText.ts`、`HarRequestDetail.tsx`、`HarIssueClusterList.tsx` | 恢复原域名/路径/Remote Address/x-tt-logid；旧摘要原本移除 query/hash、不含 Headers/Body，维持该边界。缺失 URL 说明未记录；HTTP 地址缺斜线/反斜线时保留原文本，不调用 URL() 修补；请求导出按钮改为“导出请求摘要” | H-FIELDS-010–011 |
| `src/components/trace/TraceResultPage.tsx`、`src/parsers/trace/exportTraceReport.ts` | MD 用原报告，JSON 原 origin/pathname 原值；序列化器更名为 serializeTraceJsonExport。保留仅实际 URL 节点可放行 origin/pathname、已登记 ID/引用保护、旧 DTO/白名单/引用校验，不读 args/sourceText | T-BASE-004–005 |
| `src/utils/sharingFieldState.ts`（删除） | redactions 状态投影无产品调用方，移除 | 已撤销的匿名分享内部契约 |
| `reviews/p0-a/review-c-sharing-v1.schema.json`、`verify-sharing-v1.cjs`（删除） | 版本化匿名 JSON 已退出产品，移除活跃契约与专用验证脚本；原文件及全部历史报告保留在 Git 固定历史快照 | 同上 |
| `scripts/benchmark-export-preview.cjs`、`reviews/p0-a/verify-runtime-acceptance.cjs` | 改测单一真实数据快照与旧消费者，不再生成匿名样本或执行 Schema 测试；历史 safe-v1 样本保留作历史证据，当前脚本对旧 expert 文件验证默认输出逐字一致 | 验证支持 |
| 本 README、本文、`pr-description.md` | 当前产品决定、真实检查、旧契约撤销和兼容说明 | 评审入口 |

直接复制 URL、Headers、原始日志行、命令、DNS/IP 列表和 IP 查询结果的入口，本来就未增加 P0-A 匿名投影，本轮无需改动。未改变 `netlogExpertEvidenceExport` 的原 Top 样例和原始 params 排除规则，也未改 HAR 正文网关、解析器、Worker、Dataset、诊断模型、Feature Flags、依赖或锁文件。

## 合成字段前后对照

下列地址、IP 和值均为合成测试值，不包含真实日志或凭据。

| 字段 | f4dd913 默认匿名输出 | 当前默认输出 |
|---|---|---|
| NetLog / Go URL | `https://host-1.invalid/resource-1` | `https://api.example.test/orders?id=123` |
| 代理字段 | 只有 redactions 状态，原对象槽位消失 | 旧 proxyInfo 对象，地址如 `203.0.113.7:8080` |
| NetLog 错误 detail | `[expert only]` | 原错误详情文本 |
| Go worker / path | `[worker masked]` / `[path masked]` | 原 worker / path |
| Go Headers / Body / BodyRaw | 仅 redactions 状态 | 原 JSON 值；null 保留、undefined 和缺失沿用 JSON 序列化省略，不转为假占位 |
| Go TXT | 重写的分享事实行 | 原始 rawLine 按选择顺序拼接 |
| 错误数值 | -101 / -202 / 0 / 缺失 | 相同数值 / 同样缺失；不归零、不推断新的错误原因 |
| HAR 摘要 | 域名/IP 别名、追踪标识占位 | 原域名/路径/IP/追踪标识；原摘要不支持 query/hash/Body 的边界保持 |
| Trace URL | 匿名 origin/resource pathname | 旧结构原 origin/pathname；不扩大为原始 args |
| HAR 不规范地址 `https:example.test/a` | 旧内容处理可被 URL() 修补为 `https://example.test/a` | 保留 `https:example.test/a`，不伪造有效地址 |

NetLog JSON 仍按旧出口的请求字段（url、method、status、statusCode、duration、error、timeline）导出；错误描述/详情按既有 errors 及报告出口呈现，未增加原来没有的完整请求事件或原始大字段。请求/证据 ID 保留在原本支持它们的 Go JSON、Trace、报告/证据包与交接出口；未为了新字段破坏旧 JSON 布局。

## 测试迁移逐项说明

所有仍有效的数值、时间、ID、类型、完整性、CSV 和原内容边界测试保留或迁移。旧匿名规则不是当前产品要求，以下变化不用于隐藏失败：

| 原测试 | 处理及原因 |
|---|---|
| netlogExport “absent addresses” | 保留；读取从 data 移回旧根 |
| netlogExport “replaces opaque value slots…” | 改为默认保留全部原 proxy 字段类型；新增 undefined |
| netlogExport “never invent a host…” | 改为直接原文本相等；覆盖空、相对、unknown、损坏、空白和可被 URL 自动修复的地址 |
| netlogExport “whitelist without reading raw…” | 保留不读 request events/Dataset、输入不变；移除“不得读旧 proxy 字段”的匿名条件，因为旧出口必须导出 proxy |
| netlogExport “expert JSON…” | 迁移为默认旧 DTO 精确兼容测试 |
| netlogExport CSV 十二列 / 公式前缀 / 引号换行 | 全部保留；删分享/专家差异断言，默认包含原 URL，新增 -202 |
| netlogExport “aliases stable…” / “alias spelling…” | 删除两项别名字典专用测试；对应实现已删除，原文本/无伪造地址测试替代 |
| Go “sharing does not access opaque…” | 替换为 120 条旧 DTO/raw TXT 全量相等与冻结输入；旧字段本来支持读取和序列化 |
| Go “explicit expert…” | 默认旧 DTO/TXT 精确相等覆盖，不再要求专家选择 |
| Go 非绝对 / 缺失 URL | 改测 JSON 原文本或省略；TXT 不再补造地址说明，应逐字等于 rawLine |
| Go body metadata 参数化 | 改测 undefined/null/对象/数组/0/false/字符串原类型和缺失；保留 ID |
| Go download helpers | 改测完整真实 builder 输出，继续保留 JSON/TXT 本地下载入口 |
| sharingJsonContract “actual builders Schema” / “reject unknown versions…” | 删除 Schema 专用校验，`diagnosticJsonContract.test.ts` 以实际 builder 和旧 JSON 精确字符串作为当前契约 |
| sharingJsonContract “field state” 12 个参数 / “opaque fields” 5 种情况 | 移除匿名 metadata 和“不读取旧支持内容”要求；实际解析 Body 缺失/null/空/对象/数组与代理类型测试接替 |
| sharingJsonContract “descriptor unavailable” / “nested getters/toJSON…” | 删除仅供匿名状态 helper 的测试；恢复普通 JSON 序列化，不承诺对任意人为 getter/toJSON 容器执行无读取投影 |
| sharingJsonContract “missing/null parent proxyInfo” | 保留 |
| sharingJsonContract “phase endpoints…” | 保留全部六阶段及负时刻/0，增加 -101/-202/缺失 |
| sharingJsonContract “parser Body states…” | 保留解析器真实输出与原字段类型相等，取消 redactions |
| sharingJsonContract “original IDs through filtering/sorting/paging…” | 保留 JSON 原 ID 和独立分析可能碰撞；TXT 改回原始行，不再要求附加 ID |
| sharingJsonContract “recorded time…” / “starts with timestamp…” | 原时间直接保真，不再检测其是否像敏感文本；增加未知时间原文本 |
| sharingJsonContract “exact legacy expert JSON…” | 保留逐字旧结构兼容，改为默认调用 |
| maskedExport “sharing address semantics” 18 个情况 | 删除 sanitizer 专用测试；NetLog/Go 当前原文本与缺失测试替代 |
| maskedExport “every free-text section…” | 改测原报告文本和原 maskEvidenceValue；原 scanner/maskUrl/sanitizeDiagnosisText 测试均保留 |
| Trace 四类新增测试 | URL 例外边界与未来同名字段、缺失/损坏地址对象、ID/引用原值、非变异均保留；别名断言替换为原地址/pathname |
| App 三项导出回归 | 默认旧 JSON 原字段、无切换、CSV 0/负数/转义、取消及重置仍验证 |
| LogRawList UI | 默认 120 条旧 DTO 全量复制/下载与重置，删除专家切换要求 |
| shared preview 四项 | 单一快照、完整复制/下载、DOM 截断、代理对、元数据冻结、过期打开、取消/替换后旧回调失效全部保留；仅移除模式/缓存断言 |
| HAR Request Copy / IT handoff | 旧内容边界仍测试，改为默认域名/IP/追踪标识可见；不要求专家切换 |
| diagnosticExportRestoration（新增） | 修改前五项确实失败；真实 builder 验证 -101/-202/0/缺失、URL/代理/detail、输入不变以及 Go 筛选顺序和原始 TXT |
| HAR malformed address（补充三项） | 二次边界测试复现旧 URL() 对缺斜线、过多斜线、反斜线的自动修补；修正导出摘要以保留采集事实，旧 query/hash 省略规则维持 |

## 实际检查

本轮最终候选检查记录；不把旧报告数字累加为本轮成果：

| 检查 | 状态 | 实际结果 |
|---|---|---|
| 修改前恢复测试 | failed（预期 RED） | 修正空事件测试输入后，五项仍因匿名根布局/字段损失失败；补充 HAR 三项复现 URL 自动修补 |
| 定向回归 | passed | 首轮 12 套、157 项；补充 HAR 最终 10 项通过 |
| 全量 `CI=true npm test -- --watchAll=false --runInBand` | passed | 补充修正后重新全量验证：211 套、1761 项；既有 4 套/12 项跳过保持 |
| `npm run lint` | passed | 清理基准脚本无用 path 导入后，0 警告 |
| `npm run typecheck` | passed | tsc --noEmit |
| `REACT_APP_ENABLE_TRACE_ANALYSIS=1 npm run build` | passed | CRA 编译成功；既有 Node fs.F_OK 弃用提示不影响成功 |
| `git diff --check` | passed | 最终候选无空白错误 |
| `node reviews/p0-a/verify-runtime-acceptance.cjs` | passed | 6 个消费者断言、6 个文件逐字对照，150 个 NetLog 请求/120 条 Go 记录 |
| `python3 reviews/p0-a/verify-csv-artifact.py` | passed | 45 项、10 行、12 列，独立 CSV reader 验证编码与公式保护 |
| `node --expose-gc scripts/benchmark-export-preview.cjs 50000` | passed（合成观测） | Node v24.13.0，JSON 16483933 字符/CSV 5783497，DOM 32768；JSON 38.39ms、CSV 61.43ms、打开 6.68ms、取消 3.88ms、reset 1.08ms；owner invalidated=true |
| 同设备真实 500/800MB、真实样本与实际消费者 | not-run | 无本轮可用样本/消费者，不宣称真实诊断或现场性能已验收 |
| 安全 Edge / Excel 复制与下载验收 | blocked | 当前未确认不触及钥匙串的安全自动化路径；未启动浏览器/读取私人配置。沿用历史运行报告的人工步骤，对当前单一模式执行 |
| 首次纠偏提交 GitHub CI | passed（历史候选） | `d8a2d33647da33b4cf65f653364f4278282a17d0` 的 [run 43003261223](https://github.com/WLWadmin/netlog-analyzer-react/actions/runs/43003261223) 成功；不替代补充 HAR 修正后的新 HEAD 检查 |

性能为单次 Node/JSDOM 观测，非 Edge 延迟和内存验收。堆起始 68607600 bytes、生成 JSON/CSV 后 92043880、打开后 93089856；输入/输出字符串仍在脚本作用域，取消后的数值不能证明全部内存立即释放。未新增 Worker 全量读取，取消双模式后也不再构建/缓存第二份专家导出。

## 兼容与收尾

恢复 master 旧默认 JSON 与原专家旧 JSON；JSON undefined/缺失按原生序列化省略，null/0 保留。不增加任何新的格式损失；获批过的匿名 v1 现在由负责人明确撤销，读取 data/redactions 的消费者须恢复旧根 requests/entries/proxyInfo。CSV 文本公式前缀仍有有意的 `'` 编码保护，数值负错误码没有该前缀。

旧 Schema、专用测试及脚本可从 f4dd913 固定历史树复核；历史报告、safe-v1 样本及旧审查结论未改写。当前 PR 保持 Draft，等待独立复核与负责人讨论 C1；不扩展 P0-A、不转 Ready、不合并、不部署。GitHub 新 HEAD/CI 以 PR 实际检查及最终交付为准，不能用旧 HEAD 的 CI 替代。
