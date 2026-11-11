# Draft PR #3 · REVIEW-A～E 定向整改

被审查 HEAD：`0d1581aff49ee143e7cd3185152c591264129ca5`。本修订以承载本文的提交为候选标识，继续使用 `fix/export-sharing-safety` 和 [Draft PR #3](https://github.com/WLWadmin/netlog-analyzer-react/pull/3)。仅 P0-A；无新的 PR、Ready、合并或部署。

**整体状态：blocked。A、D 的代码与回归通过；B 完成有限预览和合成评估；C 三项兼容损失未获批准，禁止合并及发布。E 本地验证通过，真实大文件、Excel 和 Edge 验收仍未完成。**

负责人已明确回复：“三项均暂不建议直接批准，PR #3 应继续保持 Draft，并阻止合并及发布。”不会把 D04-A 或测试通过解释成 C-01～C-03 的批准，也不进一步实施该兼容契约变化。

## 逐项结论

| Review | 状态 | 改动与证据 | 尚未覆盖/阻塞 |
|---|---|---|---|
| A | passed（合成回归） | 地址投影区分合法绝对 URL、相对引用、空字符串、空白、缺失/null、unknown 与损坏/不确定；只为合法绝对 URL 分配主机别名，保留协议。相对引用没有 HTTPS origin。file 地址标为本地地址。NetLog JSON/CSV/PAC、Go JSON/TXT、HAR 摘要、Trace URL 对象均有回归 | 无法从没有显式标记的任意字符串推断采集者的主观不确定性；自由文本中的“可能”等措辞保留，不提升结论等级。真实样本 not-run |
| B | passed（限定预算与合成测量） | textarea 最多 32,768 UTF-16 code units，避开半个代理对，明确“预览仅显示部分内容”。复制/下载仍用完整不可变字符串，不用截断片段。job 元数据固定；取消、替换、owner 变化及迟到的旧 open/回调失效 | 完整分享文本仍同步生成；专家文本按需生成并缓存。没有证明总内存降低或立即 GC；真实 Edge、500/800MB 和系统下载 not-run |
| C | blocked | [完整字段对照及审批单](json-compatibility.md)列明旧/默认/专家名与类型、下游影响、测试、替代方案。增加多种开放对象/body 类型、缺失字段与 ID 差异检查。专家原结构继续保留 | C-01 开放代理对象变 string；C-02 Go ID 无法跨文件 join；C-03 Go Headers/Body 类型与缺失状态改变，均未批准。本轮不静默修改这些契约 |
| D | passed（合成回归） | origin/pathname 放行只针对在已知 requests.url / cpuHotspots.script 中登记并已生成安全投影的对象。非 URL 同名字段、嵌套/未来字段走普通脱敏。异常 URL 对象仍保留两项 string 结构并显示未知。仅已知 DTO 身份字段/引用数组保留 ID，不对任意同名属性放行 | 原 buildTraceJsonExport 的白名单、引用筛选和事实边界未改变。ID 保持 builder 已输出的身份，不额外匿名化；不把本轮 serializer 修正扩大到 Trace parser |
| E | passed（本地自动化）；not-run/blocked（现场） | 先 RED：6 套、32 项失败，45 项通过；修复后定向 7 套、109 项通过。最终全量 208 套/1752 项通过，12 项既有 skip。Typecheck、Lint、Trace flag Production Build、diff 检查通过 | Excel/表格软件实际打开、真实脱敏样本及大文件 not-run；Edge 路径 blocked。当前 HEAD GitHub CI 以 PR 实态为准，旧 HEAD 的 CI 不替代新提交 |

## 修改文件与原因

| 文件 | 原因 |
|---|---|
| src/diagnosis/shared/maskedExport.ts | 共享地址分类；不把 URL() 的自动修复和解析失败变成已知 HTTPS 请求 |
| src/components/shared/useExportPreview.tsx | 仅限制 DOM 文本；保留完整复制/下载、专家缓存，固定元数据并收紧快照生命周期 |
| src/components/har/buildHarRequestCopyText.ts | runtime 缺失地址在文本里明确标记 |
| src/components/log/exportLogEntries.ts | TXT runtime 缺失地址标记；JSON 默认/专家契约不另改 |
| src/parsers/trace/exportTraceReport.ts | 缩小结构化 URL 例外；只保护已知身份字段和引用关系 |
| src/diagnosis/shared/maskedExport.test.ts | 完整/相对/空/缺失/null/未知/损坏/不确定/URL 自动修复案例 |
| src/utils/netlogExport.test.ts | JSON、CSV、PAC 不补造地址；缺失保持；开放代理字段多类型默认/专家对照 |
| src/components/log/exportLogEntries.test.ts | JSON/TXT 地址语义、缺失、body 各 JSON 类型及原 ID 对照 |
| src/components/har/buildHarRequestCopyText.test.ts | HAR 相对、未知、损坏和 runtime 缺失摘要 |
| src/parsers/trace/exportTraceReport.test.ts | 非 URL/嵌套/未来同名字段；异常 URL 结构；具有域名形状的 ID 与引用保持 |
| src/components/shared/useExportPreview.test.tsx | 大文本末尾完整复制/下载、专家文本、UTF-16、元数据及旧回调失效 |
| src/components/trace/TraceResultPage.test.tsx | 用真实完整 builder DTO 替代不完整 mock，保留原 Markdown/JSON 精确下载断言 |
| scripts/benchmark-export-preview.cjs | 可复现 1 万/5 万请求的旧 HEAD 与最终实现 Node/React/JSDOM 基准，无浏览器或凭据访问 |
| reviews/p0-a/*.md、export-performance.json | 审查结论、兼容审批、实际命令、合成基线和限制；更正首轮文档的兼容/安全过度概括 |

净新增 54 项测试，无删除或新增 skip。原相对地址别名断言改为明确相对地址标记，仍检查原路径不泄漏；这是 REVIEW-A 指定的语义修正。Trace 页面测试 fixture 现在覆盖实际完整 DTO，未去掉或放宽原下载内容断言。

## 可复现命令与执行记录

```sh
# RED：先加入地址、Trace 与有限预览回归，旧生产实现未修改
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/diagnosis/shared/maskedExport.test.ts src/utils/netlogExport.test.ts src/components/log/exportLogEntries.test.ts src/components/har/buildHarRequestCopyText.test.ts src/parsers/trace/exportTraceReport.test.ts src/components/shared/useExportPreview.test.tsx

# GREEN：最终定向
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/components/trace/TraceResultPage.test.tsx src/components/shared/useExportPreview.test.tsx src/diagnosis/shared/maskedExport.test.ts src/utils/netlogExport.test.ts src/components/log/exportLogEntries.test.ts src/components/har/buildHarRequestCopyText.test.ts src/parsers/trace/exportTraceReport.test.ts

CI=true npm test -- --watchAll=false --runInBand
npm run typecheck
npm run lint
REACT_APP_ENABLE_TRACE_ANALYSIS=1 npm run build
git diff --check

# 基准默认比较被审查 HEAD 与工作区源码；--baseline 只从 git show 读取三个旧模块
node --expose-gc scripts/benchmark-export-preview.cjs 10000 --baseline
node --expose-gc scripts/benchmark-export-preview.cjs 50000 --baseline
node --expose-gc scripts/benchmark-export-preview.cjs 10000
node --expose-gc scripts/benchmark-export-preview.cjs 50000
```

最终全量用时 30.039s，4 套/12 项既有 skip 保留。构建 main gzip 332.6 kB，较被审查补丁增加 453 B。Node 本地 v24.13.0 与 CI Node 20 不同，因此保留远端 CI 验证边界。

冻结的 13 个源码/测试/基准脚本摘要：`35ffb50bb79bc837433a731e207ea5d4f8b6a2836aceb3f960f06c0dbba2ff68`。算法与首轮一致：按路径排序 `relative-path:SHA256(file bytes)`，LF 连接再 SHA-256；不含评审文档。7 处文档本地链接与性能 JSON 解析通过；18 个候选文件的已知私钥/令牌/真实工作区路径/协作署名模式命中 0，仅代表限定模式检查。

过程中曾失败：完整回归 1 项失败，因为 Trace 页面 mock 缺少 DTO 必需列表；改用完整真实 DTO 后通过。Lint 曾因基准的 JSDOM document 局部变量和测试字面量拼接失败，已修正并重新通过。没有降低规则、删测试或加 skip。

## 性能结论与限制

实际数字见 [export-performance.json](export-performance.json)。下表是最后一次在其他检查结束后的独立进程单次观测，不是统计保证；此前测量有波动，不能将几毫秒差值推广为浏览器性能结论。

| 请求数 | JSON 完整字符数（前后相同） | textarea 前 → 后 | 分享 JSON ms 前 → 后 | CSV ms 前 → 后 | 打开 ms 前 → 后 | 专家切换 ms 前 → 后 |
|---|---:|---:|---:|---:|---:|---:|
| 10,000 | 3,058,369 | 3,058,369 → 32,768 | 40.10 → 43.05 | 37.01 → 39.53 | 5.35 → 5.31 | 9.70 → 8.38 |
| 50,000 | 15,333,970 | 15,333,970 → 32,768 | 167.42 → 169.94 | 175.37 → 172.10 | 7.45 → 4.79 | 32.00 → 25.20 |

5 万请求分享切换 4.80 → 1.28ms，取消 2.88 → 1.20ms，owner reset 0.61 → 0.30ms。能够证明的是**DOM 绑定文本预算恒定、完整快照未截断、操作状态失效**；JSDOM 没有真实排版引擎，时间差不能证明 Edge 响应达标。

- 完整生成仍是 O(请求数)，5 万请求约 170ms 的同步分享 JSON 生成仍会占用主线程；预览截断没有消除这一开销。未引入新 Worker/流式协议，避免超出本轮。
- 分享和专家字符串各保留一份；state.text 与 job.sharingText/expertText 是字符串引用，不应按三个独立序列化版本计算。专家首次选择才构建，同一预览内缓存以避免重复同步构建；取消/owner 变化清除活跃状态和缓存访问。
- 5 万请求修复后 GC 观测的 heap：起始约 69.7MB，分享+CSV 约 91.0MB，专家选中约 108.9MB，取消后约 109.1MB。该进程有意保留输入、完整分享和 CSV，React/JSDOM 也可持有上一轮引用。**没有证明取消后立即释放全部字符串，也没有声称总 heap 降低。**
- 完整下载回调直接使用快照，不等 textarea 渲染全部文本。Blob 创建/系统保存仍可能分配完整内容；真正浏览器下载耗时和峰值内存 not-run。
- 真实 500/800MB、HAR 大正文、实际 Excel/表格软件打开、多设备性能均 not-run。本脚本无浏览器启动、无登录数据、无网络请求，不能替代这些验收。

## Feature Parity 与发布阻塞

重新读取设计分支矩阵，311 行/311 唯一 feature_id，排序后 ID 摘要仍为 `bd5e351b64e584eef0260f078d436280bf9bf4bca06a52eb0c69f47bbe86dfd0`，未改矩阵或重编号。

| 受影响 Feature ID | 本轮验证 | 判定范围 |
|---|---|---|
| X-OUT-001–002 | NetLog JSON/CSV 地址、数值、缺失及专家 DTO；大快照完整复制/下载 | 自动化 passed；默认开放代理契约 C-01 blocked |
| X-OUT-003–004、N-EXPERT-009、G-VERIFY-001–002 | 共用 sanitizer/预览；全量既有 App、诊断摘要、交接与专家证据包回归 | passed（现有自动化）；原 builder/诊断内容规则不改 |
| L-RAW-007–008 | 全筛选范围、专家原 JSON/TXT、未知地址、开放 body 类型对照 | 功能范围自动化 passed；默认兼容 C-02/C-03 blocked |
| T-BASE-004–005 | Trace JSON 白名单例外/身份关系、异常 URL、页面 JSON/MD 下载；全量 Trace 门禁 | passed（自动化），原事实上限/schemaVersion/Flag 不改 |
| H-FIELDS-010–011 | HAR 摘要地址语义；全量请求/问题组与按需正文回归 | passed（自动化），不读取正文或 Headers |

这不是 C1 新 UI 或全量生产运行时完整性 PASS。没有关闭、隐藏、删除格式/入口/本地字段；兼容损失已明确列入 C-01～C-03，**整体 Parity/发布 Gate 仍 blocked**。

回退：新增 revert 提交撤回本次定向整改，不改写已推送历史、不关闭导出入口；这样会恢复未知地址伪造与 Trace 例外/预览风险。本说明不授权执行回退。任何泄漏、完整下载截断、事实引用变更、专家字段减少或未获批兼容契约均阻止发布。
