# NetLog / HAR / Go 服务日志网络诊断分析工具

一个面向 Chrome / Edge `NetLog`、浏览器 `HAR` 和 Go 服务 `.log` 的本地可视化分析工具。文件在浏览器本地解析，不上传服务器；上传后自动识别类型，并进入对应的诊断页面。

在线体验地址：<https://wlwadmin.github.io/netlog-analyzer-react/>

## 项目现状

当前项目已经形成较完整的本地网络诊断工作台：NetLog、HAR、Go 服务日志可独立解析；HAR + NetLog 可联合诊断；正常/异常样本可做 A-B 对比；普通用户入口和专家分析入口共用同一套诊断模型与证据导航。

自动化测试已经覆盖核心诊断模型、真实样本基线、性能预算和发布前风险检查。正式发布前仍建议补齐脱敏故障样本、浏览器桌面与窄屏截图，以及非网络专业用户的可理解性验证。


## 项目用途

本项目用于解析 `chrome://net-export/` 或 `edge://net-export/` 导出的 `.json` 网络日志文件，并在浏览器本地完成分析与展示。它适合用于包含访问链路、网络错误、代理配置、TLS 握手、HTTP/2、QUIC、DNS 解析、请求耗时等信息的排查场景。

除 NetLog 外，工具还支持：

- **HAR 文件**：浏览器 DevTools → Network 面板导出的 `.har` 文件，进入独立的「请求详情 + HAR 现象摘要 + 原始证据」结果页面，便于按请求维度查看 Headers、响应体、耗时瀑布与 `x-tt-logid`、`Server-Timing` 等关键字段。HAR 单独使用时只描述请求现象，不把 DNS / TCP / TLS / 代理写成确定根因。
- **Go 服务日志解析**：Go 后端服务输出的 `.log` 文件（如 `[worker] Level Time Got Result Method:URL | header -> ... +duration` 格式），支持解析 Success / Error / Retrying / Network Error 等多种日志格式，展示核心发现、统计图表、操作流程分组和原始日志列表。
- **HAR + NetLog 联合诊断**：支持同时上传同次复现的 HAR 和 NetLog，系统按请求、域名、时间和网络栈 source 关联证据，输出支持证据、反证、冲突说明和置信度因子。
- **正常/异常 A-B 对比**：支持 HAR、NetLog 和 HAR + NetLog 三种模式，对比正常环境与异常环境新增了什么。差异本身不是根因，结果会保留证据跳转和限制说明。

典型使用场景包括：

- 分析用户侧访问失败、连接超时、DNS 解析失败、证书错误等问题。
- 从大量 NetLog 事件中提取 URL 请求、错误来源、失败域名、慢请求与关键链路。
- 判断是否存在代理、VPN、PAC、HTTP/2 GOAWAY、QUIC 错误、网络切换等异常线索。
- 将分析结果导出为 Markdown 报告，便于沉淀到工单、文档或排查记录中。
- 通过统一第一屏快速知道最值得先看的问题、影响范围、证据是否足够、下一步该找谁。

## 核心特性

### 解析能力

- **纯前端本地解析**：通过 `FileReader` 在浏览器内读取文件，不上传服务器。
- **三种格式自动识别**：上传后根据文件结构自动判断 NetLog JSON、HAR 或 Go 服务日志，并进入对应的解析结果页面。
- **NetLog 事件归类**：按 URL 请求、DNS、连接、SSL/TLS、HTTP/2、QUIC、缓存、代理、网络变更等维度聚合事件。
- **NetLog 结论与行动**：基于 `net_error`、协议事件、证书错误、慢请求、代理信息等生成面向普通用户的结论、行动建议和缺失信息。
- **专家分析保留完整能力**：事件列表、源链路、安全与协议、性能分析、A-B 对比和完整诊断报告收敛到 NetLog「专家分析」二级入口。
- **Dataset 模式（支持大文件路径）**：为避免大文件把完整 events 拉回主线程，项目提供 Worker Dataset 索引与查询协议，并已支持大文件 `single scan` 主路径与 `fallback` 双扫回退路径。大文件会优先尝试在上传链路中完成 summary + Dataset 建立；小文件也可在「专家分析 → Data Loaded」手动点击「启动 Dataset 索引」启用。Dataset 就绪后，事件分页查询、DNS State、证据跳转、Raw Event Detail、部分状态视图与专家分析查询都以 Dataset 为主，摘要路径作为 fallback。Dataset 状态为 `unavailable` 时表示当前文件未启用 Dataset（或 Worker 不可用），此时专家视图只展示解析摘要字段。
- **Chromium `net_error` 行动知识库**：基于 Chromium 错误码分类和项目诊断证据生成分角色行动清单，覆盖 DNS、连接、证书、代理、协议、阻止、缓存等场景；代理诊断优先做代理/直连对比，采集类动作不会进入“用户先做”清单。
- **DNS 与 CIP/SIP 定位证据（支持 Dataset 跳转）**：HAR / NetLog 诊断页在最终诊断摘要后展示 DNS server、DNS answer、失败/慢请求关联的 CIP/SIP；同域名同 CIP/SIP 自动去重并保留最长耗时前三个代表请求。各类 IP 列（CIP/SIP/socket peer/DNS answer/服务端观察客户端 IP）默认只展示前 **3** 个，剩余以 `+N` 收起，点击可展开完整列表；DNS answer 也支持按网段分组展开完整 IP，并支持按行复制全部解析 IP。**当 Dataset 索引就绪时**，DNS answer / 失败慢请求证据可直接点击「查看事件」打开 Raw Event Detail（无 trace 的证据会明确提示）。IP 归属查询必须由用户显式点击触发，通过 Cloudflare Worker 代理查询公网 IP，内网 / loopback / 保留地址不会外发；结果以卡片列表展示中文运营商、归属地、ASN、关联域名和风险线索，并支持自助输入 IP 查询。
- **HAR 关键响应头置顶**：`server-timing`、`x-response-cinfo`、`x-response-sinfo`、`x-tt-logid`、`server` 等诊断字段以卡片形式置顶展示，支持一键复制。
- **Go 服务日志解析**：支持 `[worker] Level Time Got Result Method:URL | header -> ... +duration` 格式，自动识别 Success / Error / Retrying / Network Error，展示核心发现、统计图表、操作流程分组和原始日志列表。
- **HAR 文件损坏自动修复**：上传损坏的 HAR 文件时，自动检测并尝试修复（状态机扫描 entries 数组 + 括号栈补全），修复成功后展示恢复率与丢弃请求数，用户确认后进入解析页面。
- **诊断观察与覆盖率**：HAR 和 NetLog 先生成 `DiagnosisObservation`，再汇总为诊断卡和覆盖率，区分已解释、部分解释、未解释和分母不完整。
- **请求关联与证据融合**：联合诊断使用 method、origin、pathname、时间窗口和 NetLog source 关联请求；融合结果会保留支持证据、反证、冲突说明、置信度因子和限制说明。
- **故障 episode**：多个连续异常会聚合成 incident episode，包含开始/结束时间、恢复状态、影响请求、影响域名、代表证据和叙事文案；时间不可比时不会伪造持续时间。
- **影响范围和业务权重**：诊断会区分单请求、单域、多域、全局、服务端侧和 HTTPS 专属影响；document、业务 XHR/fetch、POST/API 等请求在排序中优先于图片、媒体和埋点请求。
- **行动 Playbook 与验证会话**：DNS、连接、TLS、代理、网络切换、服务端、CORS、性能等类别都有低风险优先的行动建议；用户记录验证结果后，系统只给下一步方向，不把“改善”直接写成新的确定根因。
- **正常/异常联合对比**：HAR 对比共同请求的状态码类别、协议、缓存来源和阶段耗时；NetLog 对比 DNS server、代理/PAC、IP、TLS、协议、网络切换和错误分布；Combined 对比关联率、episode 数量和 Top 结论变化。
- **发布前风险检查**：`diagnosisReleaseGate` 汇总样本校准、覆盖率、禁用结论、敏感值泄漏、性能预算和产品验收结果，帮助在发布前发现高风险回归。

### 交互体验

- **一键复制能力**：请求列表的 Domain / Remote Address 列、详情页的关键诊断字段均支持一键复制。
- **详情面板文本截断与 Hover 提示**：超长 URL、header value、query string、params 等自动截断并以省略号显示，hover 以浅色主题 Tooltip 展示完整内容，未超长时不显示 Tooltip。
- **使用说明引导**：首页提供 HAR、NetLog 和 Go 日志文件获取教程链接，帮助新用户快速上手。
- **模块化可视化界面**：NetLog 一级入口收敛为「结论与行动」「请求详情」「证据链」「专家分析」「原始数据」；HAR 收敛为「请求详情」「HAR 现象摘要」「原始证据」；Log 收敛为「日志概览」「操作流程 / 结构化日志」「日志统计」「原始日志」。
- **统一第一屏**：HAR、NetLog 和 Combined 诊断都通过 `FinalDiagnosisPanel` 收敛，第一屏展示主 episode、影响范围、关键证据、覆盖率、缺失信息和下一步行动。
- **证据导航**：主 episode 可跳转到 HAR 请求表、NetLog source chain、Raw Event Detail 或未解释对象列表，避免结论和原始证据脱节。
- **深浅色主题切换**：支持浅色 / 深色主题，并将选择保存在本地。
- **报告导出**：可一键导出 Markdown / JSON / CSV 三种格式的分析报告（NetLog 模式）。
- **更稳健的基础交互 Hook**：键盘导航会自动避开 `input` / `textarea` / `contenteditable` 编辑场景，响应式断点在挂载后立即同步，减少误触和首屏状态偏差。
- **多文件同时上传**：首页上传区支持一次选择或拖拽多个文件，可同时上传 HAR + NetLog，系统自动识别并进入联合诊断。
- **追加上传**：单文件状态下可通过 NetLog「结论与行动 / 证据链」或 HAR 页面入口追加上传另一类型文件，无需重新上传。

### 性能优化

- **虚拟滚动优化**：事件列表和请求瀑布使用 antd 虚拟滚动，流畅处理大数据量。
- **统一加载更多策略**：NetLog 瀑布流、Log 流程分组、Log 原始日志统一使用 `useLoadMore` hook 管理"加载更多"分页，筛选条件变化时通过 `resetDeps` 自动重置；HAR 请求表保留 antd 原生分页（表格型数据更适合分页浏览）。
- **统一阈值常量**：所有慢请求、Top N 截断、时间线限制、加载更多初始值/步长、搜索防抖等阈值集中管理于 `analysisThresholds.ts`，便于统一调整。
- **HAR 诊断阈值抽离**：HAR 诊断中的慢请求判定、证据关联数量、严重度分级等阈值集中管理于 `harThresholds.ts`，避免魔法数字散落。
- **NetLog 采集质量补全**：`checkNetlogQuality` 新增 polledData、socket 层事件、URL_REQUEST 深度检查，帮助用户判断 NetLog 采集是否完整。
- **HAR Cookie 细化检测**：新增 Set-Cookie 数量检测（>5 个），识别响应头膨胀风险。
- **分层搜索索引**：原始日志搜索采用核心字段优先 + 大字段按需 fallback 策略（仅在核心字段未命中且搜索词较长时动态拼接 headers/body），避免大数据量时预计算大字段索引。
- **参数懒计算**：事件列表预览只保留轻量 shallow 索引，`paramsJson` 在点击详情弹窗或 hover Tooltip 时才执行 `JSON.stringify`，减少初始渲染开销。
- **HAR 诊断单次遍历**：`harDiagnosis.ts` 将所有基础统计合并为单次 `for...of` 遍历，domain/ip 的 `avgTime` 在遍历阶段累加后一次性计算，避免多次 `.filter()` 全量扫描和 O(N²) 回查。
- **useMemo 缓存**：EventsTab 的 phases/sourceTypes/mainEventTypes、PerformanceTab 的 PhaseChart 均使用 `useMemo` 缓存，避免每次渲染重复计算。
- **文件加载竞态保护**：`handleFileLoaded` 使用 `loadTaskIdRef` 计数器，连续上传新文件时旧任务的 `setTimeout` 回调会被自动丢弃，避免状态覆盖。
- **定因诊断首次进入非阻塞化**：`DiagnosisTab` 首次进入时先完成 Tab 切换并展示 loading，再异步构建诊断摘要和旧版详细问题列表，避免大文件下 click handler 长时间阻塞。
- **诊断卡片分批渲染**：`DiagnosisPanel` 首屏只挂载前一批诊断卡片，后续通过“加载更多诊断卡片”继续展示完整结果，减少首次进入页面时的 DOM 挂载压力。

### 架构一致性

- **URL hash 路由持久化**：Tab 切换状态自动写入 URL hash（如 `#netlog/conclusion`、`#netlog/expert/events`、`#har/requests`、`#log/raw`），刷新页面后保持当前位置；旧 hash（如 `#netlog/diagnosis`、`#netlog/events`、`#har/diagnosis`）会自动映射到新信息架构。
- **跨 Tab 诊断联动**：诊断建议支持一键跳转到事件列表或请求瀑布，并自动设置筛选条件（通过 NavigationContext 实现）。`DiagnosisTab` 使用 `extractNetErrorCode()` 从标题中精确提取 Chrome NetLog 错误码（优先匹配括号内、标签后、"涉及错误码"后的负数，避免 `HTTP/2`、`TLS 1.3`、`P90` 被误识别），并根据诊断类型（DNS / SSL / 连接 / 代理 / QUIC / HTTP/2 等）构造结构化 `NavigationFilters`（含 `keyword`、`errorCode`、`errorOnly` 等精确维度），而非传入人类可读标题文本；`EventsTab` 支持 `net_error:-105` 精确匹配语法；`NetLogRequestList` 收到 `errorCode` 时自动设置错误码筛选并将状态切为"仅失败"。
- **统一颜色体系**：所有图表和 UI 组件使用 `CHART_COLORS` 语义化常量（`semantic.error/warning/success`、`phases.dns/connect/ssl` 等），避免硬编码颜色值。HarTimingChart 与 NetLog PerformanceTab 使用相同的阶段颜色。
- **统一免责声明**：`AnalysisDisclaimer` 共享组件支持 `netlog` / `har` / `log` 三种变体，统一 Alert 样式和语义化颜色，替代各页面中分散的硬编码免责声明。
- **统一 Loading 机制**：全局使用 `LoadingOverlay` 全屏遮罩组件，支持动态 `phase` 和 `message` 文案，解析过程中实时更新进度提示。
- **Top N 预览标注**：概览和性能分析中的截断列表明确标注"Top N 预览"，并提供"查看全部"跳转链接。
- **统一诊断模型**：NetLog 和 HAR 的诊断结果统一输出为 `DiagnosticCard` 结构（结论、证据、动作、限制、导航目标），由 `DiagnosisPanel` 统一渲染。诊断卡片支持证据跳转、自助命令库内嵌、脱敏导出等功能。
- **最终诊断模型**：在统一诊断模型之上新增 `FinalDiagnosisSummary` 收敛层，基于已有诊断卡片线性聚合，不重新扫描原始大文件；输出最终结论、根因簇、统一行动清单、缺失信息和专家卡片。
- **联合诊断作为 NetLog 证据链**：HAR + NetLog 联合诊断不再使用独立 `fileType='combined'` 页面，也不占用一级 Tab，而是进入 NetLog「证据链」。NetLog 是主诊断工作台，HAR 是请求现象补充证据源。
- **统一证据跳转规则**：`navigation.ts` 集中管理 HAR 和 NetLog 的证据跳转规则（`buildHarNavigationTarget` / `buildNetlogNavigationTarget`），页面组件不再根据 title/icon 自行推断。

## 快速使用

### 1. 导出 NetLog 文件

在 Chrome 或 Edge 中打开：

- Chrome：`chrome://net-export/`
- Edge：`edge://net-export/`

按页面提示开始记录，复现网络问题后停止记录，导出 `.json` 文件。

> 如果排查的是页面 / 接口层面的请求，也可以使用 HAR 文件：打开浏览器 DevTools（F12）→ **Network** 面板 → 复现问题后右键请求列表选择「Save all as HAR」（或点击导出按钮），得到 `.har` 文件。

### 2. 上传并解析

打开在线地址：<https://wlwadmin.github.io/netlog-analyzer-react/>

将导出的 `.json`（NetLog）或 `.har` 文件拖拽到页面上传区域，或点击上传区域选择文件。页面会在本地读取并自动识别文件类型后完成解析。

支持同时上传 HAR + NetLog 两个文件，自动进入 NetLog「结论与行动」（`#netlog/conclusion`），并可在「证据链」查看联合证据。

对于 NetLog 大文件，项目会优先走 Worker + Dataset 路径，尽量避免把完整事件直接拉回主线程；如果当前环境或文件条件不满足，也会自动回退到更保守的 fallback 流程，保证结果完整性优先。

### 3. 查看分析结果

**NetLog 文件**解析完成后，页面会展示摘要卡片和多个分析模块。可以按以下顺序阅读：

1. **结论与行动**：先看统一第一屏，确认主 episode、影响范围、证据是否足够和第一步行动。
2. **请求详情**：查看失败/慢请求、错误码、耗时和关键请求字段。
3. **证据链**：查看代理/VPN、DNS 与 CIP/SIP、失败域名与错误码、HAR + NetLog 联合证据。
4. **专家分析**：需要深挖时再进入事件列表、源链路、安全与协议、性能分析、A-B 对比和完整诊断报告。
5. **原始数据**：必要时回到原始 JSON / 结构化数据核对证据。

**HAR 文件**解析完成后，页面会进入独立的 HAR 结果页：顶部为汇总卡片（总请求数 / 失败 / 慢请求 / 总传输大小 / 总耗时），下方为「请求详情」「HAR 现象摘要」「原始证据」三个 Tab。HAR 现象摘要会复用统一第一屏，但仍只描述请求层表现，不单独证明浏览器网络栈根因。

**Go 服务日志**解析完成后，页面会展示：

1. **日志概览**：展示核心发现 Banner、摘要卡片、统计图表和 Top 操作流程预览。
2. **操作流程 / 结构化日志**：按时间顺序聚合请求流程，错误流程红色高亮，支持展开查看详情。
3. **日志统计**：展示请求耗时分布、慢请求列表和域名 / 接口级别的耗时统计。
4. **原始日志列表**：支持按关键词搜索、按级别筛选，展示完整日志行。

### 4. 导出报告

（NetLog 模式）解析完成后点击页面顶部的导出按钮，可下载 `netlog-analysis-report-<timestamp>.md` 格式的 Markdown 报告。

**诊断卡片脱敏导出**：在 NetLog「专家分析 → 完整诊断报告」中点击「生成协作摘要」，可导出已脱敏的诊断报告（自动脱敏 Cookie、Authorization、Token、URL 敏感参数等），便于安全地分享给他人协作排查。

HAR 模式暂不提供报告导出，关键诊断字段可在页面中一键复制。

## 当前限制

- HAR 单独使用时不能确认 DNS / TCP / TLS / 代理等浏览器网络栈根因；这类结论需要同次 NetLog 或外部链路测试支撑。
- A-B 对比回答“异常环境新增了什么”或“哪里退化了”，差异本身不是根因。无共同请求、无共同域名或采集不完整时，对比结果会降级。
- `single scan` 和 Dataset 大文件路径已可用，但仍保留 fallback 路径；大文件场景继续以证据完整性优先。
- 发布前风险检查已具备自动化测试入口，但真实脱敏故障样本、浏览器截图和用户可理解性验证仍需要按发布要求补齐。

## 页面模块说明

### 上传模块：`UploadZone`

对应文件：`src/components/netlog/UploadZone.tsx`

负责 NetLog / HAR / Go Log 文件的入口交互，包括：

- 支持拖拽上传和点击上传。
- 支持 `.json`（NetLog）、`.har`、`.log` 三种格式，并自动识别类型。
- **支持多文件同时上传**：可一次选择 HAR + NetLog 两个文件，系统自动识别类型并进入联合诊断。
- 使用 `FileReader` 在浏览器本地读取文件内容。
- 展示读取进度、拖拽高亮和解析中的加载状态。
- **HAR 文件损坏自动修复**：`.har` 文件 JSON 解析失败时，自动调用 `harRepair.ts` 尝试修复，修复成功后弹窗展示恢复率，用户确认后继续解析。
- 上传非法格式时通过醒目的 `notification` 弹窗提示。
- 解析成功后将原始数据传给主应用，由主应用判定走 NetLog、HAR 或 Go Log 解析逻辑。

### 使用说明模块

位于首页上传区域下方，帮助新用户了解如何获取待分析文件：

- **HAR 文件获取指南**：链接到飞书文档，引导用户通过浏览器 DevTools → Network 面板导出 HAR 文件。
- **NetLog 文件获取指南**：链接到飞书文档，引导用户通过 `chrome://net-export/` 或 `edge://net-export/` 导出网络日志。
- 两列卡片布局，hover 时有上浮 + 边框高亮交互效果。

### 摘要卡片：`SummaryCards`

对应文件：`src/components/netlog/SummaryCards.tsx`

负责在解析完成后展示核心指标概览，包括：

- 总事件数、URL 请求数、失败请求数、慢请求数量。
- 平均请求耗时、日志时间跨度、峰值并发。
- SSL/TLS、HTTP/2、QUIC、DNS、代理等关键统计。

该模块适合作为第一眼判断问题规模和异常方向的入口。

### NetLog 结论与行动：`ConclusionActionTab`

对应文件：`src/components/netlog/ConclusionActionTab.tsx`

NetLog 默认入口，面向普通用户优先回答“现在该做什么”：

- 展示 `FinalDiagnosisPanel` 收敛摘要、统一行动清单和缺失信息。
- 提供「查看关键证据」「查看失败/慢请求」「查看完整专家报告」入口。
- 展示核心指标解释，帮助用户理解失败数、慢请求、代理/VPN、错误域名和并发指标。
- 在缺少 HAR 时提供追加上传入口；已加载 HAR 时提示可进入证据链查看联合证据。

### NetLog 证据链：`EvidenceChainTab`

对应文件：`src/components/netlog/EvidenceChainTab.tsx`

证据链页用于把关键证据集中给 IT / 网络 / 研发人员核对：

- 代理 / VPN 证据：展示代理模式、PAC、代理地址、VPN 线索和代理事件数量。
- DNS 与 CIP/SIP：展示 DNS server、DNS answer、失败/慢请求关联 CIP/SIP，支持显式 IP 归属查询、自助查询、中文运营商归一化和结果卡片。
- 失败域名与错误码：聚合失败域名、错误码、失败次数和解析 IP。
- HAR + NetLog 联合诊断：在已有同次 HAR 时展示联合诊断摘要；缺 HAR 时提供追加上传入口。

### NetLog 专家分析：`ExpertAnalysisTab`

对应文件：`src/components/netlog/ExpertAnalysisTab.tsx`

专家分析页保留原有细节能力，并通过二级 Tab 降低首屏复杂度：

- **事件列表**：查看 NetLog 原始事件、参数、错误码、source id 和上下文。
- **源链路**：查看 `source_dependency` 关系，追踪请求背后的 DNS、Socket、SSL、HTTP/2、QUIC 等底层 source。
- **安全与协议**：集中展示 SSL/TLS 与协议分析。
- **性能分析**：查看阶段耗时、慢请求和性能分布。
- **A-B 对比**：适合已有正常/异常基线文件时使用。
- **完整诊断报告**：复用共享诊断摘要 hook，展示完整专家卡片，不重复首屏结论和证据链布局。

### A-B 对比页：`BaselineCompareTab`

对应文件：`src/components/shared/BaselineCompareTab.tsx`

支持 HAR、NetLog 和 HAR + NetLog 三种对比模式：

- **HAR 对比**：对比共同请求的状态码类别、协议、缓存来源和阶段耗时，识别异常环境新增失败、协议变化或缓存路径变化。
- **NetLog 对比**：对比 DNS server、DoH、代理/PAC/VPN、IP、TLS、协议路径、网络切换和错误分布。
- **HAR + NetLog 对比**：对比强关联率、episode 数量和 Top 结论变化。
- 对比结果只说明新增差异或退化线索，不把差异本身写成根因。

### 事件列表页：`EventsTab`

对应文件：`src/components/netlog/EventsTab.tsx`

事件列表页用于查看解析后的 NetLog 原始事件，适合做细节核对：

- 支持按关键词搜索事件类型、参数、Source ID 等信息（防抖 250ms）。
- 支持按阶段、Source 类型、Source ID 过滤。
- 支持快速筛选包含 `net_error` 的事件。
- 表格中会提取错误码、错误文本、IP、耗时等关键信息。
- 可打开弹窗查看事件参数 JSON 明细。
- **Source ID 聚合时间线视图**：按 source.id 分组展示事件链，支持前后上下文窗口查看。
- **参数字段过滤**：支持按事件参数中的具体字段名过滤。
- **虚拟滚动**：大数据量时使用虚拟滚动，避免 DOM 过载。
- **时间线渲染量限制**：分组超过 50 或每组超过 20 条时统一截断并提示先筛选（`MAX_TIMELINE_GROUPS` / `MAX_TIMELINE_EVENTS_PER_GROUP`）。
- **参数懒计算**：列表预览只保留轻量 shallow 索引（前 50 字符），`paramsJson` 在点击详情弹窗或 hover Tooltip 时才执行 `JSON.stringify`，减少初始渲染开销。
- **originalIndex 正确记录**：在 `events.map((e, originalIndex) => ...)` 阶段直接记录索引，避免 `indexOf` 在新对象上返回 -1。
- **phases/sourceTypes 缓存**：使用 `useMemo` 缓存去重后的阶段列表和 Source 类型列表，避免每次渲染重复计算。

当自动诊断结论需要人工复核时，可以回到该模块查看原始证据。

### 源链路页：`SourceChainViewer`

对应文件：`src/components/netlog/SourceChainViewer.tsx`

源链路页用于查看 NetLog 中 `source_dependency` 关系组成的依赖链，帮助理解一个失败请求背后还牵涉了哪些底层 source，包括：

- 从 URL 请求向下追踪 DNS、Socket、SSL、HTTP/2、QUIC 等相关 source。
- 支持按耗时、host、source 类型查看慢链路和异常链路。
- 提供链路长度、节点类型和耗时分布等结构化信息。
- 支持与事件列表联动，便于从链路节点回跳到具体事件证据。

适合排查“请求表面失败，但真正问题发生在底层依赖 source”的场景。

### 原始证据页：`RawEvidenceExplorer`

对应文件：`src/components/raw/RawEvidenceExplorer.tsx`

原始证据页用于浏览上传文件的原始 JSON / 结构化数据，适合作为最终证据核对入口，包括：

- 展示原始结构概览，支持按 path 展开查看。
- 支持关键词搜索 path 和字段值。
- 支持读取任意 path 的原始值预览。
- 右侧值预览默认自动换行，支持切换“保持原格式”、复制路径、复制值和 96vw 全屏预览，便于核对长 JSON。
- 大文件场景下优先通过 Worker 执行结构分析、path 搜索和值读取，减少主线程卡顿。

NetLog 和 HAR 结果页都可以进入该模块，用于回看原始输入数据。

### 联合诊断证据：`CombinedDiagnosisTab`

对应文件：`src/components/shared/CombinedDiagnosisTab.tsx`

联合诊断证据由 NetLog「证据链」承载，用于把 NetLog 与 HAR 的分析结果放在一起交叉验证，包括：

- 以 NetLog 网络层证据为主，结合 HAR 请求视角补充上下文。
- 在缺少 HAR 时提示追加上传同次复现文件。
- 用统一诊断面板展示联合线索，减少在多个结果页之间来回切换。

适合排查“同一次复现既有浏览器网络层日志，也有页面请求层日志”的问题。

### SSL/TLS 分析页：`SSLTab`

对应文件：`src/components/netlog/SSLTab.tsx`

SSL/TLS 分析页聚焦证书和加密握手相关问题，包括：

- 统计 TLS 版本、Cipher Suite、涉及的主机和证书错误。
- 识别旧 TLS 版本、弱加密套件、证书错误、握手耗时过长等风险。
- 根据 SSL 事件生成健康状态、发现项和建议。
- 展示 SSL 主机列表和证书问题明细。
- **SSL 握手耗时分布**：柱状图展示握手耗时分布（<50ms / 50-100ms / 100-300ms / 300-1000ms / >1s），附带平均/P90/最大耗时统计。

适合排查 HTTPS 证书异常、安全设备劫持、TLS 握手慢等问题。

### 协议分析页：`ProtocolTab`

对应文件：`src/components/netlog/ProtocolTab.tsx`

协议分析页聚焦 HTTP/2 与 QUIC 相关行为，包括：

- 判断日志中是否出现 HTTP/2、QUIC 或回退到 HTTP/1.x。
- 统计 HTTP/2 Session、Stream、GOAWAY、Stream Error 等事件。
- 统计 QUIC Session、版本、错误码和异常事件。
- 对 HTTP/2 GOAWAY、QUIC 错误、连接重置、代理兼容性等情况生成健康评估。
- **QUIC vs TCP 性能对比**：柱状图对比平均耗时、P90、错误率、连接建立时间四个维度。
- 协议字段从解析结果推断（HTTP/1.1 / HTTP/2 / QUIC），不再依赖 URL 字符串 heuristic。

适合排查新协议兼容性、代理 / 防火墙干扰、弱网下 QUIC 异常等问题。

### 性能分析页：`PerformanceTab`

对应文件：`src/components/netlog/PerformanceTab.tsx`

性能分析页聚焦请求耗时和阶段拆解，包括：

- 统计平均耗时、P50、P90、P95、P99、最大耗时等指标。
- 找出慢请求并展示 URL、方法、状态、耗时和时间线。
- 将请求阶段拆分为 DNS、连接、SSL、发送、等待、下载等环节。
- 提供瀑布流视图和单请求阶段详情，辅助定位慢在哪个网络阶段。
- **Host / API 维度聚合**：按域名和接口路径聚合耗时统计，识别高耗时来源。
- **瓶颈归因排名**：按阶段统计总耗时和影响请求数，定位最大瓶颈。
- **成功 vs 失败耗时对比**：对比成功和失败请求的平均/P90/最大耗时。
- **请求耗时时间线**：散点图展示请求耗时随时间分布（成功绿/失败红），叠加吞吐量折线图。支持**智能时间模式切换**：当存在完成请求且时间范围 < 5 秒时自动切换为相对时间（以首个请求为起点），避免散点退化为垂直线；空数据时默认使用绝对时间；提供「自动/绝对/相对」Segmented 控件供手动切换；Tooltip 保留原始绝对时间。
- **PhaseChart 缓存**：各阶段平均耗时柱状图提取为独立 `PhaseChart` 组件，内部使用 `useMemo` 缓存 `phaseChartData`，避免每次渲染重复计算。

适合排查页面加载慢、接口响应慢、DNS 慢、TLS 握手慢、下载慢等性能问题。

### 请求瀑布流：`NetLogRequestList`

对应文件：`src/components/netlog/NetLogRequestList.tsx`

请求瀑布流展示所有 URL 请求的瀑布图和列表视图，包括：

- 多维筛选：状态码、域名、错误码、协议、慢请求。
- URL 关键词搜索。
- **使用 `useLoadMore` hook**：瀑布流分页加载由 `useLoadMore` 统一管理，筛选条件变化时通过 `resetDeps` 自动重置 `visibleCount`，避免手动维护 `waterfallVisibleCount` 状态。
- 初始展示 30 条（`NETLOG_WATERFALL_INITIAL_COUNT`），每次加载 30 条（`NETLOG_WATERFALL_LOAD_STEP`）。

## Go 服务日志解析模块说明

当上传文件被识别为 Go 服务日志（`.log`）时，主应用会渲染独立的日志分析结果页面，相关组件位于 `src/components/log/` 目录，解析引擎位于 `src/logParser.ts`。

### 结果页容器：`LogResultPage`

对应文件：`src/components/log/LogResultPage.tsx`

- 包含概览、操作流程、日志统计和原始日志四个 Tab。
- 支持"仅显示失败"筛选，自动跳转到操作流程 Tab。
- **支持外层 activeTab 控制**：由 App hash 路由统一驱动 Tab 切换，刷新页面后保持当前位置。
- 使用 `AnalysisDisclaimer` 组件展示免责声明（`variant="log"`）。

### 核心发现 Banner：`LogInsightBanner`

对应文件：`src/components/log/LogInsightBanner.tsx`

- 根据错误模式生成阅读提示（如"上传临时文件持续被拒 (403 Forbidden)，共 2 次失败"）。
- 显示严重级别（success / warning / error）和上下文线索。

### 摘要卡片：`LogSummaryCards`

对应文件：`src/components/log/LogSummaryCards.tsx`

- 展示总请求数、成功数、失败数、成功率。
- 错误类型分布、域名分布（含成功/失败计数）、耗时分布。
- 失败卡片可点击，自动筛选并跳转到操作流程 Tab。

### 统计图表：`LogStatsCharts`

对应文件：`src/components/log/LogStatsCharts.tsx`

- 错误类型分布饼图、域名分布柱状图、耗时分布条形图、日志级别分布（Info/Warn/Error/Debug）。

### 操作流程分组：`LogFlowGroups`

对应文件：`src/components/log/LogFlowGroups.tsx`

- 按时间顺序聚合请求流程，每个分组显示起始时间、请求数量、成功/失败计数。
- 错误分组红色边框高亮，支持展开/折叠查看详情。
- **单 group 内 entries 限制**：展开时最多显示 100 条记录（`MAX_GROUP_ENTRY_PREVIEW`），超出部分提示总数，避免单个大流程渲染卡顿。
- 使用 `useLoadMore` hook 管理分组列表加载（初始 50 条，步长 30 条）。
- 详情页展示每条请求的 worker、级别、方法、URL、状态码、耗时和原始日志行。

### 原始日志列表：`LogRawList`

对应文件：`src/components/log/LogRawList.tsx`

- 支持按关键词搜索（防抖 250ms，核心字段预索引 + 大字段按需 fallback，仅在搜索词 > 3 字符且核心字段未命中时动态拼接 headers/body）。
- 支持按日志级别筛选（全部 / Info / Warn / Error / Debug）。
- 支持按域名筛选和时间范围筛选（DatePicker.RangePicker）。
- 展示完整原始日志行、Headers、Body，高亮匹配关键词。
- 每条日志显示 logID，便于追踪。
- 使用 `useLoadMore` hook 管理列表加载（初始 600 条，步长 300 条）。

### 解析引擎：`src/logParser.ts`

- 配置化解析引擎（方案 C），支持通过配置对象描述日志结构，新增格式无需修改引擎代码。
- 提取器注册表：bracket、word、number、until、keyValue、json、suffix 等纯函数。
- 支持变体解析：根据 Got 后的结果类型（Success / Error / Retrying / Network）选择不同解析路径。
- 统一换行符处理（支持 Windows \r\n 和旧 Mac \r）。

## HAR 解析模块说明

当上传文件被识别为 HAR 时，主应用会渲染一套独立于 NetLog 的结果页面，相关组件位于 `src/components/har/` 目录。

### 结果页容器：`HarResultPage`

对应文件：`src/components/har/HarResultPage.tsx`

- 组合顶部汇总卡片与「请求详情」「HAR 现象摘要」「原始证据」三个 Tab。
- 维护当前激活 Tab 与状态筛选（全部 / 失败 / 慢请求），实现卡片点击联动到请求列表。
- **支持外层 activeTab 控制**：由 App hash 路由统一驱动 Tab 切换，刷新页面后保持当前位置。
- 使用 `AnalysisDisclaimer` 组件展示免责声明（`variant="har"`）。

### 汇总卡片：`HarSummaryCards`

对应文件：`src/components/har/HarSummaryCards.tsx`

- 展示总请求数、失败请求、慢请求、总传输大小、总耗时。
- 「失败请求」「慢请求」卡片可点击，自动跳转到请求详情并按对应条件筛选。
- **辅助健康评估**：展示总体健康评分（0-100），但明确标注为「辅助健康分（仅供参考）」，不能单独证明浏览器网络栈根因。

### 请求详情：`HarRequestTable`

对应文件：`src/components/har/HarRequestTable.tsx`

- 列：Name、Status、Protocol、Domain、Remote Address、Type、Size、Time。
- **Domain 和 Remote Address 列支持一键复制**，点击复制图标即可复制对应值。
- 顶部按资源类型筛选（All / Fetch·XHR / Doc / CSS / JS / Font / Img / Media / Other），以及失败 / 慢请求状态快捷筛选。
- 支持列头排序（Status / Domain / Type / Size / Time）与 URL 关键词搜索。
- 支持屏蔽域名过滤（逗号分隔多个域名）。
- 分类标签与状态标签采用淡色背景 + 同色系字体，点击行可打开请求详情抽屉。
- **使用 antd 原生分页**：表格型数据更适合分页浏览，与 NetLog/Log 的"加载更多"模式形成策略差异。

### 请求详情：`HarRequestDetail`

对应文件：`src/components/har/HarRequestDetail.tsx`

- **Headers**：
  - General（URL / Method / Status / Remote Address / Protocol），URL 和 Remote Address 支持一键复制。
  - **关键响应头**：`server-timing`、`x-response-cinfo`、`x-response-sinfo`、`x-tt-logid`、`server` 以卡片形式置顶展示，其中 `x-response-cinfo`、`x-response-sinfo`、`x-tt-logid` 支持一键复制。
  - 其余响应头和请求头以网格对齐排版展示，超长内容自动截断，hover 以浅色 Tooltip 显示完整内容。
- **Preview**：响应体 JSON 格式化预览（自动处理 base64 编码）、图片预览、媒体预览。
- **Payload**：Query String Parameters 和 Request Payload 展示，JSON 自动格式化，超长参数值自动截断，hover 显示完整内容。
- **Timing**：DNS / Connect / SSL / Send / Wait / Receive 各阶段耗时瀑布图（`HarTimingChart`），颜色与 NetLog PerformanceTab 统一使用 `CHART_COLORS.phases`。
- **诊断**：提取 `Server-Timing`、`x-tt-logid`、`x-tt-cip`、`x-lsc-source-ip`、Remote Address 等关键字段，支持一键复制。
- **文本截断与 Hover 提示**：详情面板内所有文本字段（URL、header value、query string、params 等）超长时自动截断并以省略号显示，hover 以浅色主题 Tooltip 展示完整内容，未超长时不显示 Tooltip，避免视觉干扰。

### HAR 现象摘要：`HarSummaryDiagnosis`

对应文件：`src/components/har/HarSummaryDiagnosis.tsx`

- 展示 HAR 请求现象摘要，由 `harDiagnosis.ts` 计算层驱动；该页用于描述请求层表现，不单独证明 DNS / TCP / TLS / 代理根因。
- **健康评分卡片**：使用 `HealthAssessmentCard` 展示总体健康评分（0-100）和状态（healthy/warning/critical）。
- **网络阶段状态**：DNS、TCP、TLS、TTFB、下载五个阶段的平均耗时、P95、最大耗时和慢请求数，用状态标签（健康/警告/严重）直观展示。
- **HTTP 状态分布**：2xx/3xx/4xx/5xx/0 的计数和占比。
- **慢请求分类**：按 DNS/TCP/TLS/TTFB/Receive/Blocked 分类统计慢请求数量。
- **域名/IP 统计**：展示请求最多的域名和 IP，含平均耗时、失败数、IP 类型（public/private/loopback/ipv6）。
- **DNS 与 CIP/SIP 定位证据**：从 HAR `serverIPAddress`、`x-tt-cip`、`x-lsc-source-ip` 提取失败/慢请求相关 SIP/CIP 证据，按域名 + CIP/SIP 去重并保留最长耗时前三个代表请求，支持分开复制 CIP / SIP 给 IP 归属查询工具或网络团队继续判断。
- **资源分析**：按资源类型（JS/CSS/Img/Font/XHR 等）统计数量、大小、平均耗时。
- **缓存与压缩**：缓存命中率、压缩率、未压缩大资源列表。
- **安全协议**：HTTPS/HTTP 占比、HTTP/2/HTTP/3/HTTP/1.1 分布、混合内容检测。
- **问题归因**：按客户端/网络/服务端/CDN/DNS 分类展示现象线索。
- **修复建议**：按优先级（P0/P1/P2）展示建议动作，并提示需要同次 NetLog 或链路测试进一步验证网络栈原因。

### 辅助组件：`HarTimingChart` / `CopyText` / `TruncatedText`

- `HarTimingChart`：各网络阶段的分段耗时条与占比明细。颜色统一使用 `CHART_COLORS.phases`（dns/connect/ssl/send/wait/download），与 NetLog PerformanceTab 保持一致。
- `CopyText`：通用「文本 + 一键复制」字段组件，支持 clipboard API 不可用时的兜底处理，超长文本自动截断并显示 Tooltip。供请求列表、详情页与诊断 Tab 复用。
- `TruncatedText`：通用文本截断组件（定义于 `HarRequestDetail.tsx` 内部），内容超过阈值时显示省略号并在 hover 时以浅色主题 Tooltip 展示完整内容，未超过阈值时直接显示文本无 Tooltip。用于 HeaderList、Payload Tab 等需要截断展示的场景。

## 共享组件说明

位于 `src/components/shared/` 目录，供各模块复用：

- `StatusTag`：语义化状态标签（success/warning/error/info/default），使用 `tagConfig.ts` 配置。`tagConfig.ts` 不仅包含样式配置，还提供 `getStatusTagType(statusCode)` 函数，根据 HTTP 状态码自动映射到对应的 Tag 类型。
- `SummaryCard`：通用摘要卡片，带图标、数值、趋势和描述。
- `HealthAssessmentCard`：健康评估卡片，显示评分和状态。
- `IssueDisplay`：问题/告警/信息聚合展示组件，支持分组和加载更多。
- `AnimatedNumber`：数值递增动效组件。
- `ErrorBoundary`：全局错误边界，捕获解析异常并提供重置按钮。
- `LoadingOverlay`：全屏加载遮罩，支持动态 `phase`（阶段文案）和 `message`（提示文案），可选 Progress 进度条。解析过程中 App 层实时更新 `loadingText` 同步到 LoadingOverlay 的 `phase` prop。
- `AnalysisDisclaimer`：统一免责声明组件，支持 `netlog` / `har` / `log` 三种变体，使用 `CHART_COLORS.semantic.warning` 语义化颜色，替代各页面中分散的硬编码免责声明块。
- `DiagnosisPanel`：统一诊断卡片容器，渲染 `DiagnosticCard` 列表，支持健康分展示和脱敏导出按钮。
- `DiagnosticCard`：统一诊断卡片，包含结论、证据列表、动作项（按角色分配）、限制说明、排查命令库（内嵌展开区块）和证据跳转按钮。
- `FinalDiagnosisPanel`：统一第一屏，展示主 episode、覆盖率、缺失信息、行动计划和复制摘要。
- `DiagnosisCoveragePanel`：展示已解释、部分解释、未解释和分母不完整状态，支持跳转未解释对象。
- `IncidentEpisodeList`：展示主 episode、次要 episode、影响范围、关键证据和 HAR / NetLog 证据跳转按钮。
- `ExportSummaryButton`：脱敏导出按钮，生成 Markdown 格式的协作摘要报告，自动脱敏敏感信息。
- `CombinedDiagnosisTab`：联合诊断证据组件，将 HAR 请求与 NetLog 事件对齐生成跨源线索，当前由 NetLog「证据链」承载。
- `BaselineCompareTab`：A-B 对比 Tab，支持 HAR、NetLog 和 HAR + NetLog 三种正常/异常样本对比。

## 核心代码模块说明

### 诊断共享层：`src/diagnosis/shared`

诊断共享层把 HAR、NetLog、Combined、A-B 对比和发布前风险检查统一到一组纯函数模块：

- `diagnosisObservation.ts`：从 HAR / NetLog 生成 observation，区分支持证据、候选证据和证据缺口。
- `diagnosisCoverage.ts`：计算已解释、部分解释、未解释和采集不完整状态。
- `requestCorrelation.ts`：按 method、origin、pathname、时间窗口和 source id 关联 HAR 请求与 NetLog 请求。
- `evidenceFusion.ts`：合并 HAR / NetLog 支持证据、反证、冲突说明和置信度因子。
- `incidentEpisode.ts` / `incidentNarrative.ts`：把连续异常收敛成 episode，输出恢复状态、影响范围和可读叙事。
- `impactScope.ts` / `requestImportance.ts`：判断单请求、单域、多域、全局、服务端侧、HTTPS 专属影响，并按业务请求重要性排序。
- `actionPlaybook.ts` / `verificationSession.ts`：为各类问题生成分角色行动，并根据验证结果给下一步。
- `baselineComparator.ts`、`netlogBaselineComparator.ts`、`combinedBaselineComparator.ts`：正常/异常环境对比。
- `diagnosisReleaseGate.ts`：发布前风险检查，汇总样本校准、覆盖率、禁用结论、敏感值泄漏、性能预算和产品验收结果。

### 应用入口：`src/App.tsx`

`App.tsx` 是主应用容器，负责：

- 管理是否已有数据、解析事件、分析结果、加载状态等全局状态。
- 自动识别上传文件类型：NetLog 调用 `parseLog()` 生成 `AnalysisResult`，HAR 调用 `parseHar()` 生成 `HarAnalysisResult`，Go Log 调用 `parseLogFile()` 生成 `LogAnalysisResult`。
- 组织页面 Header、上传区、摘要卡片和各个 Tab。
- 处理重置、返回顶部、主题切换和报告导出（Markdown / JSON / CSV 三种格式）。
- **URL hash 路由**：Tab 切换状态写入 `#fileType/tab[/subTab]` 格式 hash，刷新后自动恢复。三种文件类型（NetLog / HAR / Go Log）的 Tab 切换均由 App 层统一控制并同步 hash，旧版 hash 通过 `hashRouting.ts` 映射到新信息架构。
- **NavigationContext**：提供跨 Tab 导航机制，支持诊断建议一键跳转到事件/请求列表并自动设置筛选条件。`DiagnosisTab` 使用 `extractNetErrorCode()` 从标题中精确提取 Chrome NetLog 错误码（避免 `HTTP/2`、`TLS 1.3`、`P90` 被误识别），并根据诊断类型构造结构化 `NavigationFilters`（`keyword`/`errorCode`/`errorOnly` 等精确维度）；`EventsTab` 支持 `net_error:-105` 精确匹配语法；`NetLogRequestList` 收到 `errorCode` 时自动设置错误码筛选并将状态切为"仅失败"。
- **文件加载竞态保护**：`handleFileLoaded` 使用 `loadTaskIdRef`（`useRef(0)`）计数器，连续上传新文件时旧任务的 `setTimeout` 回调会被自动丢弃，避免状态覆盖。
- **统一 Loading 机制**：仅使用 `LoadingOverlay` 全屏遮罩，`loadingText` 状态实时同步到遮罩的 `phase` prop，无内联 LoadingUI。
- **多文件上传与联合诊断**：支持同时上传 HAR + NetLog，自动进入 NetLog「结论与行动」（`#netlog/conclusion`），并在「证据链」展示联合诊断证据。使用 `resultRef` / `harResultRef` 避免连续多文件上传时的 state 异步判断问题。
- **追加上传**：单文件状态下可通过 NetLog「结论与行动 / 证据链」或 HAR 页面入口追加上传另一类型文件，无需重新上传。

整体数据流如下：

```text
NetLog / HAR / Go Log 文件
  → UploadZone 本地读取（支持多文件同时上传）
  → App.handleFileLoaded（自动识别类型 + 竞态保护）
  ├─ NetLog：parsers/netlog/parser.parseLog → AnalysisResult
  │    → SummaryCards / ConclusionActionTab / NetLogRequestList / EvidenceChainTab / ExpertAnalysisTab
  │    → EventsTab / SourceChainViewer / SSLTab / ProtocolTab / PerformanceTab / BaselineCompareTab
  │    → RawEvidenceExplorer
  │    → diagnosis.shared.fromNetlog / fromNetlogLifecycle 生成诊断模型
  │    → workers/analysisWorker + workerClient 支撑大文件原始证据查询
  │    → parsers/netlog/sourceGraphCache + requestLifecycle 做链路/生命周期加速
  │    → diagnosis.exportReport 导出报告
  │    → diagnosis/shared/fromNetlog + finalSummaryBuilder 生成统一第一屏
  │    → diagnosis/shared/fromCombined 对齐 HAR + NetLog 生成联合诊断卡片
  ├─ HAR：harParser.parseHar → HarAnalysisResult
  │    → HarResultPage（HarSummaryCards / HarRequestTable / HarSummaryDiagnosis / RawEvidenceExplorer）
  │    → harDiagnosis.ts 生成 HAR 请求现象摘要
  │    → diagnosis/shared/fromHar + finalSummaryBuilder 生成 HAR 第一屏诊断
  │    → 损坏时：harRepair.parseHarWithRepair → 自动修复 → 用户确认 → 解析
  │    → 联合诊断：追加 NetLog 后进入 NetLog 结论与行动 / 证据链
  └─ Go Log：logParser.parseLogFile → LogAnalysisResult
       → LogResultPage（LogInsightBanner / LogSummaryCards / LogStatsCharts / LogFlowGroups / LogRawList / LogPerformanceTab）
       → exportLogEntries 导出日志结果
```

### 解析引擎：`src/parsers/netlog/parser.ts`

`src/parsers/netlog/parser.ts` 是 NetLog 的核心解析模块（原 `src/netlog/parser.ts` 已重构至 `src/parsers/netlog/` 目录），主要能力包括：

- 兼容不同 NetLog JSON 结构，识别 `events`、`logEvents` 或数组形式的事件数据。
- 将原始事件转换为统一的 `ParsedEvent`。
- 按 Chromium 事件类型和 Source 类型归类：
  - URL 请求
  - DNS 事件
  - TCP / Socket / Transport 连接事件
  - SSL/TLS 事件
  - HTTP/2 事件
  - QUIC 事件
  - 代理事件
  - 缓存事件
  - 网络变更事件
- 构建 URL 请求的阶段时间线：DNS、连接、SSL、发送、等待、下载。
- **DNS 信息提取**：从 `polledData` 的 DNS 配置白名单容器中提取 DNS Server IP（`dnsServers`），兼容 `hostResolverInfo` / `host_resolver_info`、`dnsConfig` / `secureDnsConfig`、`nameServers` / `name_servers`、`dns_over_https_servers` / `dohServers` 等字段；从 DNS 事件和 DNS cache 提取域名解析 IP（`dnsRecords`），兼容 `DNS_TRANSACTION`、`HOST_RESOLVER`、`SECURE_DNS`、`DOH` 相关事件以及 `dnsCache` / `hostResolverCache` / `hostResolverInfo.cache` 形态，支持 `address_list`、`addresses`、`ip_addresses`、`endpoint_results`、`host_resolver_endpoint_results` 等字段。IP 验证使用严格校验（`isValidIpv4` / `isValidIpv6`）：IPv4 每段 0-255，IPv6 必须含 `:` 且最多 8 段，支持 `::` 压缩和 IPv4-mapped 地址，防止纯十六进制字符串被误判为 IP；同时保持强语义边界，避免把普通 socket / 业务连接 IP 误识别为 DNS server。
- **协议推断**：根据关联事件（QUIC / HTTP2 / SSL）为每个 URLRequest 推断 `protocol` 字段（HTTP/1.1 / HTTP/2 / QUIC）。
- 提取响应头中的 IP 线索，例如 `x-response-cinfo`、`x-tt-cip`、`x-lsc-source-ip`、`x-response-sinfo`。
- 识别失败请求、失败域名、错误码、慢请求、证书问题、代理 / VPN 线索等。
- 输出统一的 `AnalysisResult`，供所有页面模块使用。

### HAR 解析引擎：`src/harParser.ts`

`harParser.ts` 是 HAR 文件的独立解析模块，与 NetLog 的 `parser.ts` 互不影响，主要能力包括：

- `isHarFile()`：根据 `log.entries` 结构判断是否为 HAR 文件，供主应用自动识别类型。
- `parseHar()`：将 HAR 的每条 `entry` 转换为统一的 `HarRequestEntry`，并汇总为 `HarAnalysisResult`（总请求数 / 失败数 / 慢请求数 / 总大小 / 总耗时 / 各类型计数）。
- 资源类型归一化（`_resourceType` + mimeType 兜底）、协议归一化、传输大小计算（优先 `_transferSize`）。
- 解析 `Server-Timing` 响应头，提取 `x-tt-logid`、`x-tt-cip`、`x-lsc-source-ip` 等关键诊断字段。
- `decodeResponseBody()`：解码响应体（含 base64）并尝试 JSON 格式化。
- 提供分类标签 / 状态标签的淡色配色（`categoryStyle` / `statusStyle`）与格式化工具（`formatBytes` / `formatHarTime`）。

### HAR 现象摘要计算层：`src/harDiagnosis.ts`

`harDiagnosis.ts` 是 HAR 请求现象摘要的纯函数计算层，从 `HarAnalysisResult` 计算出请求层统计和线索供 `HarSummaryDiagnosis` 展示：

- **单次遍历优化**：所有基础统计（DNS/TCP/TLS/TTFB/Receive/Blocked 慢请求计数、HTTP 状态码分布、安全协议统计、缓存压缩统计、domain/ip 累加）合并为单次 `for...of` 遍历，避免多次 `.filter()` 全量扫描。
- **O(N) avgTime 计算**：domain 和 ip 统计在遍历阶段累加 `_totalTime`，最后一次性除法计算平均值，避免 O(N²) 回查。
- **IPv6 解析修正**：`extractHostFromAddress()` 正确处理 `192.168.1.1:8080`（IPv4:port）、`[::1]:443`（bracketed IPv6:port）、`2001:db8::1`（plain IPv6）等地址格式。
- 输出健康评分、网络阶段状态、HTTP 状态分布、慢请求分类、域名/IP 统计、资源分析、缓存压缩、安全协议、现象线索与建议动作等数据。

### 诊断与报告：`src/parsers/netlog/diagnosis.ts`

`src/parsers/netlog/diagnosis.ts` 负责把结构化分析结果转换为可读的排查建议和报告（原 `src/netlog/diagnosis.ts` 已随目录重构移至 `src/parsers/netlog/`），主要包含：

- `generateSuggestions()`：根据错误码、失败请求、代理、DNS、证书、协议等信息生成建议。
- `generateNextStepInfo()`：生成下一步排查动作，例如检查 DNS、代理 / VPN、防火墙、证书、协议配置等。
- `generateChecklist()`：生成排查清单。
- `exportReport()`：导出 Markdown 格式分析报告。

其中内置了常见 Chromium `net_error` 错误码的解释和处理建议，并结合错误码区间做兜底判断。

### 常量与错误码：`src/parsers/netlog/constants.ts`

`src/parsers/netlog/constants.ts` 主要维护 NetLog 分析所需的静态映射（原 `src/netlog/constants.ts` 已随目录重构移至 `src/parsers/netlog/`）：

- `EVENT_TYPES`：事件类型编号到事件名的映射。
- `SOURCE_TYPES`：Source 类型编号到 Source 名称的映射。
- `PHASE`：事件阶段映射，例如 `BEGIN`、`END`、`NONE`。
- `NET_ERRORS`：Chromium `net_error` 错误码到说明的映射。
- `getNetErrorDescription()`：根据错误码返回可读描述。

该文件是事件识别、错误展示和诊断建议的基础字典。

### 错误码分类器：`src/parsers/netlog/errorClassifier.ts`

`errorClassifier.ts` 提供 `classifyNetError` 和 `classifySslIssueCategory` 函数，用于将 Chromium `net_error` 错误码分类到以下维度：

- **DNS**：DNS 解析失败、超时、配置错误。
- **证书**：SSL/TLS 证书无效、过期、不受信任。
- **代理**：代理配置错误、认证失败、连接拒绝。
- **网络变更**：网络切换、连接中断。
- **阻止**：安全策略阻止、防火墙拦截。
- **协议**：HTTP/2、QUIC、TLS 版本不兼容。
- **连接**：TCP 连接失败、超时、重置。
- **应用层**：HTTP 错误码、服务端拒绝。
- **缓存**：缓存命中/未命中、缓存过期。
- **其他**：无法归类的错误码。

该分类器被 `parser.ts`、`diagnosis.ts` 和 `index.ts` 统一导出使用，是诊断建议生成的基础输入之一。

### 主题模块：`src/theme.tsx`

主题模块提供全局主题上下文，负责：

- 维护 `light` / `dark` 主题模式。
- 将主题选择保存到 `localStorage`。
- 在页面根节点设置 `data-theme` 属性。
- 提供 `useTheme()` Hook 供页面组件切换主题。

### 基础 Hooks：`src/hooks/useKeyboardNavigation.ts` / `src/hooks/useMediaQuery.ts`

这两个基础 Hook 在本轮优化后承担了更稳定的交互底座职责：

- `useKeyboardNavigation()`：提供列表型交互的上下键 / Enter / Escape 导航能力，并在编辑态元素（如 `input`、`textarea`、`select`、`contenteditable`）聚焦时主动跳过全局快捷键处理，避免输入过程中误触列表跳转。
- `useMediaQuery()`：封装 `matchMedia` 监听逻辑，组件挂载后会立即以当前查询结果回填状态，减少首屏断点状态与真实视口不一致的问题。

### 样式：`src/index.css`

`index.css` 定义全局样式、主题变量和页面视觉效果，包括：

- 浅色 / 深色模式下的背景、文字、边框、卡片、表格等变量。
- Ant Design 组件的主题适配样式。
- 上传区、卡片、Tab、瀑布流、滚动条等自定义样式。
- 动画效果，例如拖拽高亮、加载脉冲等。

## 项目目录结构

```
src/
├── App.tsx                          # 主应用入口，负责文件识别、Tab 路由、状态编排
├── index.tsx                        # React 渲染入口
├── index.css                        # 全局样式与主题变量
├── theme.tsx                        # 浅色 / 深色主题上下文
├── harParser.ts                     # HAR 文件解析引擎
├── harDiagnosis.ts                  # HAR 请求现象摘要计算层
├── logParser.ts                     # Go 服务日志解析引擎
├── logConstants.ts                  # Go 日志解析常量与辅助函数
├── react-app-env.d.ts               # React 类型声明
├── components/
│   ├── har/                         # HAR 结果页组件
│   │   ├── HarResultPage.tsx
│   │   ├── HarRequestTable.tsx
│   │   ├── HarRequestDetail.tsx
│   │   ├── HarSummaryCards.tsx
│   │   ├── HarSummaryDiagnosis.tsx
│   │   ├── HarTimingChart.tsx
│   │   └── CopyText.tsx
│   ├── log/                         # Go 服务日志结果页组件
│   │   ├── LogResultPage.tsx
│   │   ├── LogInsightBanner.tsx
│   │   ├── LogSummaryCards.tsx
│   │   ├── LogStatsCharts.tsx
│   │   ├── LogFlowGroups.tsx
│   │   ├── LogRawList.tsx
│   │   ├── LogRawContextModal.tsx
│   │   ├── LogPerformanceTab.tsx
│   │   ├── HighlightedText.tsx
│   │   └── exportLogEntries.ts
│   ├── netlog/                      # NetLog 结果页组件
│   │   ├── UploadZone.tsx
│   │   ├── SummaryCards.tsx
│   │   ├── ConclusionActionTab.tsx
│   │   ├── NetLogRequestList.tsx
│   │   ├── EvidenceChainTab.tsx
│   │   ├── ExpertAnalysisTab.tsx
│   │   ├── DiagnosisTab.tsx
│   │   ├── NetlogMetricExplainPanel.tsx
│   │   ├── NetlogProxyEvidencePanel.tsx
│   │   ├── EventsTab.tsx
│   │   ├── SourceChainViewer.tsx
│   │   ├── SSLTab.tsx
│   │   ├── ProtocolTab.tsx
│   │   └── PerformanceTab.tsx
│   ├── raw/
│   │   └── RawEvidenceExplorer.tsx  # 原始 JSON 证据浏览器
│   └── shared/                      # 共享组件与联合分析视图
│       ├── CombinedDiagnosisTab.tsx
│       ├── BaselineCompareTab.tsx
│       ├── FinalDiagnosisPanel.tsx
│       ├── DiagnosisCoveragePanel.tsx
│       ├── IncidentEpisodeList.tsx
│       ├── CollectionQualityAlert.tsx
│       ├── DnsAndIpEvidencePanel.tsx
│       ├── DiagnosisPanel.tsx
│       ├── DiagnosticCard.tsx
│       ├── ExportSummaryButton.tsx
│       ├── AnalysisDisclaimer.tsx
│       ├── LoadingOverlay.tsx
│       ├── ErrorBoundary.tsx
│       ├── HealthAssessmentCard.tsx
│       ├── IssueDisplay.tsx
│       ├── SummaryCard.tsx
│       ├── StatusTag.tsx
│       └── AnimatedNumber.tsx
├── constants/
│   ├── analysisThresholds.ts
│   ├── chartColors.ts
│   ├── iconMapping.ts
│   └── tagConfig.ts
├── contexts/
│   └── NavigationContext.tsx        # 跨 Tab 导航与筛选联动
├── diagnosis/
│   ├── ipEvidence/                  # DNS 优先的 CIP/SIP 证据整理与显式 IP 归属查询
│   │   ├── ipEvidenceTypes.ts
│   │   ├── ipNormalize.ts
│   │   ├── classifyDnsServer.ts
│   │   ├── extractDnsIpEvidence.ts
│   │   ├── buildCopyText.ts
│   │   ├── ipLookupTypes.ts
│   │   ├── ipLookupClient.ts
│   │   ├── ipLookupDiagnosis.ts
│   │   └── index.ts
│   └── shared/                      # 诊断模型拼装、导航、导出、对比
│       ├── fromNetlog.ts
│       ├── fromNetlogLifecycle.ts
│       ├── fromHar.ts
│       ├── fromCombined.ts
│       ├── finalSummaryBuilder.ts
│       ├── diagnosisObservation.ts
│       ├── diagnosisCoverage.ts
│       ├── requestCorrelation.ts
│       ├── evidenceFusion.ts
│       ├── incidentEpisode.ts
│       ├── impactScope.ts
│       ├── requestImportance.ts
│       ├── actionPlaybook.ts
│       ├── verificationSession.ts
│       ├── baselineComparator.ts
│       ├── netlogBaselineComparator.ts
│       ├── combinedBaselineComparator.ts
│       ├── baselineHarUpload.ts
│       ├── baselineNetlogUpload.ts
│       ├── diagnosisReleaseGate.ts
│       ├── evidenceNavigation.ts
│       ├── maskedExport.ts
│       ├── navigation.ts
│       ├── commandLibrary.ts
│       ├── timeAlignment.ts
│       ├── harThresholds.ts
│       ├── types.ts
│       └── index.ts
├── hooks/
│   ├── useAnimatedNumber.ts
│   ├── useKeyboardNavigation.ts
│   ├── useLoadMore.ts
│   └── useMediaQuery.ts
├── parsers/
│   ├── netlog/
│   │   ├── parser.ts
│   │   ├── diagnosis.ts
│   │   ├── errorClassifier.ts
│   │   ├── requestLifecycle.ts
│   │   ├── sourceGraph.ts
│   │   ├── sourceGraphCache.ts
│   │   ├── constants.ts
│   │   ├── index.ts
│   │   └── sourceGraph.test.ts
│   └── shared/
│       ├── evidenceIndex.ts
│       ├── rawJsonPath.ts
│       ├── rawJsonPath.test.ts
│       └── typeGuards.ts
├── utils/
│   ├── copyText.ts
│   ├── format.ts
│   ├── harRepair.ts
│   └── perfMark.ts
└── workers/
    ├── analysisWorker.ts
    ├── workerClient.ts
    └── protocols.ts
```

## 数据结构概览

### NetLog：`AnalysisResult`

`parseLog()` 最终返回的核心结构是 `AnalysisResult`，主要字段如下：

| 字段 | 说明 |
| --- | --- |
| `totalEvents` | NetLog 总事件数 |
| `uniqueSources` | 唯一 Source 数量 |
| `peakConcurrency` | 峰值并发请求数 |
| `urlRequests` | 解析出的 URL 请求列表 |
| `sslEvents` | SSL/TLS 相关事件 |
| `quicEvents` | QUIC 相关事件 |
| `http2Events` | HTTP/2 相关事件 |
| `dnsEvents` | DNS 解析事件 |
| `connectEvents` | 连接相关事件 |
| `proxyEvents` | 代理相关事件 |
| `errors` / `warnings` / `info` | 自动诊断出的错误、告警和提示 |
| `protocols` | 协议分布统计 |
| `hosts` | DNS 解析记录（兼容旧字段，新解析优先使用 `dnsRecords`） |
| `dnsServers` | DNS Server IP 列表（从 `polledData` 白名单配置字段提取） |
| `dnsRecords` | 域名解析 IP 记录（含 `host`、`ips`、`source`、`time`） |
| `errorSources` | 错误码出现次数统计 |
| `certIssues` | 证书 / TLS 问题 |
| `connectionFailures` | 连接失败请求 |
| `slowRequests` | 慢请求列表 |
| `networkChanges` | 网络变更事件 |
| `proxyInfo` | 代理、PAC、VPN 线索 |
| `failedDomains` | 失败域名聚合信息 |
| `systemInfo` | 系统、浏览器、NetLog 版本等信息 |

### HAR：`HarAnalysisResult`

HAR 模式下，`parseHar()` 返回的核心结构是 `HarAnalysisResult`，主要字段如下：

| 字段 | 含义 |
| --- | --- |
| `entries` | 解析出的请求列表（`HarRequestEntry[]`） |
| `totalRequests` | 总请求数 |
| `failedCount` | 失败请求数（状态码 ≥400 或 0） |
| `slowCount` | 慢请求数（耗时 ≥ 阈值，默认 1000ms） |
| `totalSize` | 总传输大小 |
| `totalTime` | 首尾请求时间跨度 |
| `typeCounts` | 各资源类型计数 |
| `creator` | HAR 来源（导出工具及版本） |

每条 `HarRequestEntry` 含 URL、方法、状态、协议、域名、Remote Address、类型、大小、耗时、各阶段 timings、请求 / 响应头、响应体，以及 `serverTiming`、`xTtLogid`、`xTtCip`、`xLscSourceIp` 等诊断字段。

### Go 服务日志：`LogAnalysisResult`

Go 服务日志模式下，`parseLogFile()` 返回的核心结构是 `LogAnalysisResult`，主要字段如下：

| 字段 | 说明 |
| --- | --- |
| `entries` | 解析出的日志条目列表（`LogEntry[]`） |
| `groups` | 操作流程分组（`LogFlowGroup[]`） |
| `stats` | 统计信息（总数、成功/失败、分布等） |
| `insight` | 核心发现与诊断建议 |

每条 `LogEntry` 含 worker 名、日志级别（Info/Error/Warn/Debug）、时间戳、HTTP 方法、URL、域名、路径、状态（Success/Error）、状态码、状态文本、请求头、响应体、耗时、友好名称和原始日志行。

### 统一诊断：`FinalDiagnosisSummary`

HAR、NetLog 和 Combined 诊断最终会收敛到 `FinalDiagnosisSummary`：

| 字段 | 说明 |
| --- | --- |
| `headline` | 小白第一屏结论，包含问题、原因、影响、置信度、关键证据和第一步行动 |
| `rootCauseClusters` | 按 episode 或类别收敛后的诊断簇 |
| `actionPlan` | 分角色行动建议 |
| `missingInfo` | 还缺什么证据，以及为什么缺 |
| `expertCards` | 专家诊断卡片，保留完整证据、限制、反证和跳转信息 |
| `executiveSummary` | 复制或导出时使用的摘要文本 |

诊断卡片不会仅凭 HAR 现象或 A-B 差异写“确定根因”。当证据不足时，输出会保留 `limitations`、`missingInfo`、`confidenceFactors` 或 `conflictNotes`。

## 技术栈

- React 19
- TypeScript
- Ant Design 6
- Recharts
- Create React App / react-scripts

## 本地开发

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm start
```

启动后访问：<http://localhost:3000>

### 构建生产包

```bash
npm run build
```

构建产物位于 `build/` 目录。

### 运行测试

```bash
npm test
```

提交前建议使用 CI 模式跑完整测试：

```bash
CI=true npm test -- --watchAll=false
npm run build
git diff --check
```

诊断发布前风险检查相关测试集中在：

```bash
CI=true npm test -- --watchAll=false --runTestsByPath \
  src/diagnosis/shared/diagnosisReleaseGate.test.ts \
  src/diagnosis/shared/diagnosisGoldenCorpusGate.test.ts \
  src/diagnosis/shared/diagnosisPerformanceBaseline.test.ts
```

## 部署说明

`package.json` 中配置了：

```json
{
  "homepage": "https://wlwadmin.github.io/netlog-analyzer-react"
}
```

因此项目可按 GitHub Pages 静态站点方式部署，当前在线地址为：

<https://wlwadmin.github.io/netlog-analyzer-react/>

## 使用注意事项

- 请上传 Chrome / Edge NetLog 导出的原始 `.json` 文件，或浏览器 DevTools → Network 导出的 `.har` 文件，不支持压缩包或其他格式。
- 大型 NetLog 文件解析可能需要数秒，浏览器性能会影响处理速度。
- 工具提供的是基于日志特征的辅助诊断，最终根因仍建议结合用户网络环境、服务端日志、代理 / 防火墙配置和复现路径综合判断。
- 页面正文显示"本地解析，不上传服务器"，适合处理需要在本机浏览器内完成初步分析的日志。

## 推荐排查阅读顺序

### NetLog 文件

1. 先看 **结论与行动**，确认主 episode、影响范围、证据是否足够和第一步行动。
2. 再看 **请求详情**，确认失败/慢请求、错误码和关键请求字段。
3. 进入 **证据链** 核对代理/VPN、DNS 与 CIP/SIP、失败域名与错误码、HAR + NetLog 联合证据。
4. 如果需要深挖，再进入 **专家分析** 的事件列表、源链路、安全与协议、性能分析、A-B 对比或完整诊断报告。
5. 最后在 **原始数据** 中核对原始 JSON / 结构化字段。

### HAR 文件

先看 **HAR 第一屏诊断** 和 **请求详情** 锁定失败 / 慢请求，再查看 **HAR 现象摘要** 理解请求层表现；如需判断 DNS / TCP / TLS / 代理原因，请补充同次 NetLog。

### Go 服务日志

1. 先看 **核心发现 Banner** 了解错误模式，再查看 **摘要卡片** 确认失败规模和分布。
2. 在 **日志统计** Tab 中查看请求耗时分布、慢请求列表和域名 / 接口级别统计。
3. 在 **统计图表** 中查看错误类型、域名和状态分布。
4. 在 **操作流程** Tab 中查看错误流程详情。
5. 最后在 **原始日志** Tab 中核对具体日志行。
