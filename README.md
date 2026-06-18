# NetLog / HAR / Go 服务日志 网络定因分析工具

> 一个面向 Chrome / Edge `NetLog`、`HAR` 与 Go 服务 `.log` 文件的本地可视化分析工具，用于快速梳理网络请求、错误码、协议、证书、代理、DNS 与性能瓶颈，辅助定位浏览器侧及服务端网络访问问题。上传文件后会**自动识别类型**（NetLog JSON / HAR / Go Log），分别进入对应的解析结果页面。

在线体验地址：<https://wlwadmin.github.io/netlog-analyzer-react/>

## 项目用途

本项目用于解析 `chrome://net-export/` 或 `edge://net-export/` 导出的 `.json` 网络日志文件，并在浏览器本地完成分析与展示。工具不会把日志上传到服务器，适合用于包含访问链路、网络错误、代理配置、TLS 握手、HTTP/2、QUIC、DNS 解析、请求耗时等信息的排查场景。

除 NetLog 外，工具还支持：

- **HAR 文件**：浏览器 DevTools → Network 面板导出的 `.har` 文件，进入独立的「请求列表 + 汇总诊断」结果页面，便于按请求维度查看 Headers、响应体、耗时瀑布与 `x-tt-logid`、`Server-Timing` 等关键诊断字段。
- **Go 服务日志**：Go 后端服务输出的 `.log` 文件（如 `[worker] Level Time Got Result Method:URL | header -> ... +duration` 格式），支持解析 Success / Error / Retrying / Network Error 等多种日志格式，展示核心发现、统计图表、操作流程分组和原始日志列表。

典型使用场景包括：

- 分析用户侧访问失败、连接超时、DNS 解析失败、证书错误等问题。
- 从大量 NetLog 事件中提取 URL 请求、错误来源、失败域名、慢请求与关键链路。
- 判断是否存在代理、VPN、PAC、HTTP/2 GOAWAY、QUIC 错误、网络切换等异常线索。
- 将分析结果导出为 Markdown 报告，便于沉淀到工单、文档或排查记录中。

## 核心特性

- **纯前端本地解析**：通过 `FileReader` 在浏览器内读取文件，不上传服务器。
- **三种格式自动识别**：上传后根据文件结构自动判断 NetLog JSON、HAR 或 Go 服务日志，并进入对应的解析结果页面。
- **NetLog 事件归类**：按 URL 请求、DNS、连接、SSL/TLS、HTTP/2、QUIC、缓存、代理、网络变更等维度聚合事件。
- **自动定因诊断**：基于 `net_error`、协议事件、证书错误、慢请求、代理信息等生成问题、告警和排查建议。
- **HAR 关键响应头置顶**：`server-timing`、`x-response-cinfo`、`x-response-sinfo`、`x-tt-logid`、`server` 等诊断字段以卡片形式置顶展示，支持一键复制。
- **一键复制能力**：请求列表的 Domain / Remote Address 列、详情页的关键诊断字段均支持一键复制。
- **详情面板文本截断与 Hover 提示**：超长 URL、header value、query string、params 等自动截断并以省略号显示，hover 以浅色主题 Tooltip 展示完整内容，未超长时不显示 Tooltip。
- **Go 服务日志解析**：支持 `[worker] Level Time Got Result Method:URL | header -> ... +duration` 格式，自动识别 Success / Error / Retrying / Network Error，展示核心发现、统计图表、操作流程分组和原始日志列表。
- **HAR 文件损坏自动修复**：上传损坏的 HAR 文件时，自动检测并尝试修复（状态机扫描 entries 数组 + 括号栈补全），修复成功后展示恢复率与丢弃请求数，用户确认后进入解析页面。
- **使用说明引导**：首页提供 HAR、NetLog 和 Go 日志文件获取教程链接，帮助新用户快速上手。
- **模块化可视化界面**：通过总览、定因诊断、事件列表、SSL/TLS、协议分析、性能分析等 Tab 展示不同排查视角。
- **深浅色主题切换**：支持浅色 / 深色主题，并将选择保存在本地。
- **报告导出**：可一键导出 Markdown 格式的分析报告。
- **错误边界与加载遮罩**：全局 ErrorBoundary 捕获解析异常，LoadingOverlay 展示解析进度。

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

### 3. 查看分析结果

**NetLog 文件**解析完成后，页面会展示摘要卡片和多个分析模块。可以按以下顺序阅读：

1. **总览**：先看整体错误、失败域名、协议分布和关键异常。
2. **定因诊断**：查看自动生成的根因建议和下一步排查动作。
3. **事件列表**：必要时回到原始事件级别核对细节。
4. **SSL/TLS、协议分析、性能分析**：针对证书、HTTP/2、QUIC、耗时分布等方向深入定位。

**HAR 文件**解析完成后，页面会进入独立的 HAR 结果页：顶部为汇总卡片（总请求数 / 失败 / 慢请求 / 总传输大小 / 总耗时），下方为「请求列表」与「汇总诊断」两个 Tab，详见下文「HAR 解析模块说明」。

**Go 服务日志**解析完成后，页面会展示：

1. **核心发现 Banner**：自动识别错误模式（如"上传临时文件持续被拒"）并给出诊断建议。
2. **摘要卡片**：总请求数、成功/失败数、成功率、错误类型分布、域名分布、耗时分布。
3. **日志级别分布**：Info / Warn / Error / Debug 的占比统计。
4. **操作流程分组**：按时间顺序聚合请求流程，错误流程红色高亮，支持展开查看详情。
5. **原始日志列表**：支持按关键词搜索、按级别筛选，展示完整日志行。

### 4. 导出报告

（NetLog 模式）解析完成后点击页面顶部的导出按钮，可下载 `netlog-analysis-report-<timestamp>.md` 格式的 Markdown 报告。HAR 模式暂不提供报告导出，关键诊断字段可在页面中一键复制。

## 页面模块说明

### 上传模块：`UploadZone`

对应文件：`src/components/netlog/UploadZone.tsx`

负责 NetLog / HAR / Go Log 文件的入口交互，包括：

- 支持拖拽上传和点击上传。
- 支持 `.json`（NetLog）、`.har`、`.log` 三种格式，并自动识别类型。
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

### 总览页：`OverviewTab`

对应文件：`src/components/netlog/OverviewTab.tsx`

总览页用于把分析结果按排查视角汇总展示，包含：

- 错误、告警、提示信息的聚合展示。
- 请求 Top 列表和失败域名列表。
- 协议分布、代理信息、系统信息等整体画像。
- 对重复错误和大量问题做分组、折叠和“加载更多”，避免大日志页面过载。

适合用来快速回答“这份日志主要问题在哪里”。

### 定因诊断页：`DiagnosisTab`

对应文件：`src/components/netlog/DiagnosisTab.tsx`

定因诊断页基于解析结果生成更接近排查动作的结论，包括：

- 按类别聚合错误、告警和信息项。
- 展示自动生成的排查建议、结论和行动项。
- 提供“下一步排查”视图，例如 DNS、代理 / VPN、防火墙、证书、协议等方向。
- 对大量同类问题进行分组和分页加载，便于阅读。

该模块的建议来源主要由 `src/diagnosis.ts` 生成。

### 事件列表页：`EventsTab`

对应文件：`src/components/netlog/EventsTab.tsx`

事件列表页用于查看解析后的 NetLog 原始事件，适合做细节核对：

- 支持按关键词搜索事件类型、参数、Source ID 等信息。
- 支持按阶段、Source 类型、Source ID 过滤。
- 支持快速筛选包含 `net_error` 的事件。
- 表格中会提取错误码、错误文本、IP、耗时等关键信息。
- 可打开弹窗查看事件参数 JSON 明细。

当自动诊断结论需要人工复核时，可以回到该模块查看原始证据。

### SSL/TLS 分析页：`SSLTab`

对应文件：`src/components/netlog/SSLTab.tsx`

SSL/TLS 分析页聚焦证书和加密握手相关问题，包括：

- 统计 TLS 版本、Cipher Suite、涉及的主机和证书错误。
- 识别旧 TLS 版本、弱加密套件、证书错误、握手耗时过长等风险。
- 根据 SSL 事件生成健康状态、发现项和建议。
- 展示 SSL 主机列表和证书问题明细。

适合排查 HTTPS 证书异常、安全设备劫持、TLS 握手慢等问题。

### 协议分析页：`ProtocolTab`

对应文件：`src/components/netlog/ProtocolTab.tsx`

协议分析页聚焦 HTTP/2 与 QUIC 相关行为，包括：

- 判断日志中是否出现 HTTP/2、QUIC 或回退到 HTTP/1.x。
- 统计 HTTP/2 Session、Stream、GOAWAY、Stream Error 等事件。
- 统计 QUIC Session、版本、错误码和异常事件。
- 对 HTTP/2 GOAWAY、QUIC 错误、连接重置、代理兼容性等情况生成健康评估。
- 对比 QUIC 与 TCP 请求耗时，辅助判断协议层收益或异常。

适合排查新协议兼容性、代理 / 防火墙干扰、弱网下 QUIC 异常等问题。

### 性能分析页：`PerformanceTab`

对应文件：`src/components/netlog/PerformanceTab.tsx`

性能分析页聚焦请求耗时和阶段拆解，包括：

- 统计平均耗时、P50、P90、P95、P99、最大耗时等指标。
- 找出慢请求并展示 URL、方法、状态、耗时和时间线。
- 将请求阶段拆分为 DNS、连接、SSL、发送、等待、下载等环节。
- 提供瀑布流视图和单请求阶段详情，辅助定位慢在哪个网络阶段。

适合排查页面加载慢、接口响应慢、DNS 慢、TLS 握手慢、下载慢等性能问题。

## Go 服务日志解析模块说明

当上传文件被识别为 Go 服务日志（`.log`）时，主应用会渲染独立的日志分析结果页面，相关组件位于 `src/components/log/` 目录，解析引擎位于 `src/logParser.ts`。

### 结果页容器：`LogResultPage`

对应文件：`src/components/log/LogResultPage.tsx`

- 组合核心发现 Banner、摘要卡片、统计图表、操作流程分组和原始日志列表三个 Tab。
- 支持"仅显示失败"筛选，自动跳转到操作流程 Tab。

### 核心发现 Banner：`LogInsightBanner`

对应文件：`src/components/log/LogInsightBanner.tsx`

- 根据错误模式自动生成诊断摘要（如"上传临时文件持续被拒 (403 Forbidden)，共 2 次失败"）。
- 显示严重级别（success / warning / error）和排查建议。

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
- 详情页展示每条请求的 worker、级别、方法、URL、状态码、耗时和原始日志行。

### 原始日志列表：`LogRawList`

对应文件：`src/components/log/LogRawList.tsx`

- 支持按关键词搜索（防抖 250ms，预索引优化）。
- 支持按日志级别筛选（全部 / Info / Warn / Error / Debug）。
- 展示完整原始日志行，高亮匹配关键词。

### 解析引擎：`src/logParser.ts`

- 配置化解析引擎（方案 C），支持通过配置对象描述日志结构，新增格式无需修改引擎代码。
- 提取器注册表：bracket、word、number、until、keyValue、json、suffix 等纯函数。
- 支持变体解析：根据 Got 后的结果类型（Success / Error / Retrying / Network）选择不同解析路径。
- 统一换行符处理（支持 Windows \r\n 和旧 Mac \r）。

## HAR 解析模块说明

当上传文件被识别为 HAR 时，主应用会渲染一套独立于 NetLog 的结果页面，相关组件位于 `src/components/har/` 目录。

### 结果页容器：`HarResultPage`

对应文件：`src/components/har/HarResultPage.tsx`

- 组合顶部汇总卡片与「请求列表」「汇总诊断」两个 Tab。
- 维护当前激活 Tab 与状态筛选（全部 / 失败 / 慢请求），实现卡片点击联动到请求列表。

### 汇总卡片：`HarSummaryCards`

对应文件：`src/components/har/HarSummaryCards.tsx`

- 展示总请求数、失败请求、慢请求、总传输大小、总耗时。
- 「失败请求」「慢请求」卡片可点击，自动跳转到请求列表并按对应条件筛选。

### 请求列表：`HarRequestTable`

对应文件：`src/components/har/HarRequestTable.tsx`

- 列：Name、Status、Protocol、Domain、Remote Address、Type、Size、Time。
- **Domain 和 Remote Address 列支持一键复制**，点击复制图标即可复制对应值。
- 顶部按资源类型筛选（All / Fetch·XHR / Doc / CSS / JS / Font / Img / Media / Other），以及失败 / 慢请求状态快捷筛选。
- 支持列头排序（Status / Domain / Type / Size / Time）与 URL 关键词搜索。
- 支持屏蔽域名过滤（逗号分隔多个域名）。
- 分类标签与状态标签采用淡色背景 + 同色系字体，点击行可打开请求详情抽屉。

### 请求详情：`HarRequestDetail`

对应文件：`src/components/har/HarRequestDetail.tsx`

- **Headers**：
  - General（URL / Method / Status / Remote Address / Protocol），URL 和 Remote Address 支持一键复制。
  - **关键响应头**：`server-timing`、`x-response-cinfo`、`x-response-sinfo`、`x-tt-logid`、`server` 以卡片形式置顶展示，其中 `x-response-cinfo`、`x-response-sinfo`、`x-tt-logid` 支持一键复制。
  - 其余响应头和请求头以网格对齐排版展示，超长内容自动截断，hover 以浅色 Tooltip 显示完整内容。
- **Preview**：响应体 JSON 格式化预览（自动处理 base64 编码）、图片预览、媒体预览。
- **Payload**：Query String Parameters 和 Request Payload 展示，JSON 自动格式化，超长参数值自动截断，hover 显示完整内容。
- **Timing**：DNS / Connect / SSL / Send / Wait / Receive 各阶段耗时瀑布图（`HarTimingChart`）。
- **诊断**：提取 `Server-Timing`、`x-tt-logid`、`x-tt-cip`、`x-lsc-source-ip`、Remote Address 等关键字段，支持一键复制。
- **文本截断与 Hover 提示**：详情面板内所有文本字段（URL、header value、query string、params 等）超长时自动截断并以省略号显示，hover 以浅色主题 Tooltip 展示完整内容，未超长时不显示 Tooltip，避免视觉干扰。

### 汇总诊断：`HarSummaryDiagnosis`

对应文件：`src/components/har/HarSummaryDiagnosis.tsx`

- 当前为占位模块，后续将补充汇总诊断功能。

### 辅助组件：`HarTimingChart` / `CopyText` / `TruncatedText`

- `HarTimingChart`：各网络阶段的分段耗时条与占比明细。
- `CopyText`：通用「文本 + 一键复制」字段组件，支持 clipboard API 不可用时的兜底处理，超长文本自动截断并显示 Tooltip。供请求列表、详情页与诊断 Tab 复用。
- `TruncatedText`：通用文本截断组件，内容超过阈值时显示省略号并在 hover 时以浅色主题 Tooltip 展示完整内容，未超过阈值时直接显示文本无 Tooltip。用于 HeaderList、Payload Tab 等需要截断展示的场景。

## 核心代码模块说明

### 应用入口：`src/App.tsx`

`App.tsx` 是主应用容器，负责：

- 管理是否已有数据、解析事件、分析结果、加载状态等全局状态。
- 自动识别上传文件类型：NetLog 调用 `parseLog()` 生成 `AnalysisResult`，HAR 调用 `parseHar()` 生成 `HarAnalysisResult`。
- 组织页面 Header、上传区、摘要卡片和各个 Tab。
- 处理重置、返回顶部、主题切换和报告导出。

整体数据流如下：

```text
NetLog / HAR / Go Log 文件
  → UploadZone 本地读取
  → App.handleFileLoaded（自动识别类型）
  ├─ NetLog：parsers/netlog/parser.parseLog → AnalysisResult
  │    → SummaryCards / OverviewTab / DiagnosisTab / EventsTab / SSLTab / ProtocolTab / PerformanceTab
  │    → diagnosis.exportReport 导出报告
  ├─ HAR：harParser.parseHar → HarAnalysisResult
  │    → HarResultPage（HarSummaryCards / HarRequestTable / HarSummaryDiagnosis）
  │    → 损坏时：harRepair.parseHarWithRepair → 自动修复 → 用户确认 → 解析
  └─ Go Log：logParser.parseLogFile → LogAnalysisResult
       → LogResultPage（LogInsightBanner / LogSummaryCards / LogStatsCharts / LogFlowGroups / LogRawList）
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

### 主题模块：`src/theme.tsx`

主题模块提供全局主题上下文，负责：

- 维护 `light` / `dark` 主题模式。
- 将主题选择保存到 `localStorage`。
- 在页面根节点设置 `data-theme` 属性。
- 提供 `useTheme()` Hook 供页面组件切换主题。

### 样式：`src/index.css`

`index.css` 定义全局样式、主题变量和页面视觉效果，包括：

- 浅色 / 深色模式下的背景、文字、边框、卡片、表格等变量。
- Ant Design 组件的主题适配样式。
- 上传区、卡片、Tab、瀑布流、滚动条等自定义样式。
- 动画效果，例如拖拽高亮、加载脉冲等。

## 项目目录结构

```
src/
├── App.tsx                    # 主应用入口，自动识别文件类型并路由
├── index.tsx                  # React 渲染入口
├── index.css                  # 全局样式与主题变量
├── theme.tsx                  # 主题上下文（浅色/深色切换）
├── harParser.ts               # HAR 文件解析引擎
├── logParser.ts               # Go 服务日志解析引擎（配置化）
├── logConstants.ts            # Go 日志解析常量与工具函数
├── react-app-env.d.ts         # React 类型声明
├── utils/
│   ├── copyText.ts            # 通用复制工具（clipboard + 降级方案）
│   └── harRepair.ts           # HAR 文件损坏自动修复引擎
├── components/
│   ├── har/                   # HAR 结果页面组件
│   │   ├── HarResultPage.tsx
│   │   ├── HarRequestTable.tsx
│   │   ├── HarRequestDetail.tsx
│   │   ├── HarSummaryCards.tsx
│   │   ├── HarSummaryDiagnosis.tsx
│   │   ├── HarTimingChart.tsx
│   │   └── CopyText.tsx
│   ├── log/                   # Go 服务日志结果页面组件
│   │   ├── LogResultPage.tsx
│   │   ├── LogInsightBanner.tsx
│   │   ├── LogSummaryCards.tsx
│   │   ├── LogStatsCharts.tsx
│   │   ├── LogFlowGroups.tsx
│   │   └── LogRawList.tsx
│   ├── netlog/                # NetLog 结果页面组件（原 src/netlog/components/ 已扁平化至此）
│   │   ├── UploadZone.tsx
│   │   ├── SummaryCards.tsx
│   │   ├── OverviewTab.tsx
│   │   ├── DiagnosisTab.tsx
│   │   ├── EventsTab.tsx
│   │   ├── SSLTab.tsx
│   │   ├── ProtocolTab.tsx
│   │   ├── PerformanceTab.tsx
│   │   └── NetLogRequestList.tsx
│   └── shared/                # 共享组件
│       ├── HealthAssessmentCard.tsx
│       ├── IssueDisplay.tsx
│       ├── SummaryCard.tsx
│       ├── StatusTag.tsx      # 语义化状态标签（success/warning/error/info/default）
│       ├── AnimatedNumber.tsx # 数值递增动效组件
│       ├── ErrorBoundary.tsx  # 全局错误边界
│       └── LoadingOverlay.tsx # 加载遮罩
├── constants/                 # 全局常量
│   ├── tagConfig.ts           # Tag 语义化配置
│   ├── chartColors.ts         # 图表配色常量
│   └── iconMapping.ts         # Emoji → Icon 映射
├── hooks/                     # 自定义 Hooks
│   ├── useAnimatedNumber.ts   # 数值动效 Hook
│   ├── useKeyboardNavigation.ts # 键盘导航 Hook
│   └── useMediaQuery.ts       # 响应式媒体查询 Hook
└── parsers/                   # 解析引擎（原 src/netlog/ 已重命名至此）
    └── netlog/
        ├── index.ts           # 统一导出（parser + diagnosis + constants）
        ├── parser.ts          # NetLog JSON 解析引擎
        ├── diagnosis.ts       # 诊断建议与报告生成
        └── constants.ts       # 事件类型/错误码常量映射
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
- 页面正文显示“本地解析，不上传服务器”，适合处理需要在本机浏览器内完成初步分析的日志。

## 推荐排查阅读顺序

1. 先看 **摘要卡片** 和 **总览页**，确认问题规模、失败数量、慢请求数量和主要错误类型。
2. 再看 **定因诊断页**，获取可能根因和下一步动作。
3. 如果是证书或 HTTPS 问题，查看 **SSL/TLS 分析页**。
4. 如果涉及 HTTP/2、QUIC、连接复用或代理兼容性，查看 **协议分析页**。
5. 如果问题表现为慢，查看 **性能分析页** 的瀑布流和阶段耗时。
6. 最后在 **事件列表页** 中按错误码、Source ID 或关键词回溯原始事件。

> 若上传的是 HAR 文件，则先看 **汇总卡片** 与 **汇总诊断 Tab** 锁定失败 / 慢请求，再在 **请求列表** 中按类型或状态筛选，点击具体请求查看 Headers、响应体、耗时瀑布与关键诊断字段。
>
> 若上传的是 Go 服务日志，则先看 **核心发现 Banner** 了解错误模式，再查看 **摘要卡片** 确认失败规模和分布，然后在 **操作流程** Tab 中查看错误流程详情，最后在 **原始日志** Tab 中核对具体日志行。
