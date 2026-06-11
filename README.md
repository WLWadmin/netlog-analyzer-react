# NetLog 网络日志定因分析工具

> 一个面向 Chrome / Edge `NetLog` 文件的本地可视化分析工具，用于快速梳理网络请求、错误码、协议、证书、代理、DNS 与性能瓶颈，辅助定位浏览器侧网络访问问题。

在线体验地址：<https://wlwadmin.github.io/netlog-analyzer-react/>

## 项目用途

本项目用于解析 `chrome://net-export/` 或 `edge://net-export/` 导出的 `.json` 网络日志文件，并在浏览器本地完成分析与展示。工具不会把日志上传到服务器，适合用于包含访问链路、网络错误、代理配置、TLS 握手、HTTP/2、QUIC、DNS 解析、请求耗时等信息的排查场景。

典型使用场景包括：

- 分析用户侧访问失败、连接超时、DNS 解析失败、证书错误等问题。
- 从大量 NetLog 事件中提取 URL 请求、错误来源、失败域名、慢请求与关键链路。
- 判断是否存在代理、VPN、PAC、HTTP/2 GOAWAY、QUIC 错误、网络切换等异常线索。
- 将分析结果导出为 Markdown 报告，便于沉淀到工单、文档或排查记录中。

## 核心特性

- **纯前端本地解析**：通过 `FileReader` 在浏览器内读取 JSON 文件，不上传服务器。
- **NetLog 事件归类**：按 URL 请求、DNS、连接、SSL/TLS、HTTP/2、QUIC、缓存、代理、网络变更等维度聚合事件。
- **自动定因诊断**：基于 `net_error`、协议事件、证书错误、慢请求、代理信息等生成问题、告警和排查建议。
- **模块化可视化界面**：通过总览、定因诊断、事件列表、SSL/TLS、协议分析、性能分析等 Tab 展示不同排查视角。
- **深浅色主题切换**：支持浅色 / 深色主题，并将选择保存在本地。
- **报告导出**：可一键导出 Markdown 格式的分析报告。

## 快速使用

### 1. 导出 NetLog 文件

在 Chrome 或 Edge 中打开：

- Chrome：`chrome://net-export/`
- Edge：`edge://net-export/`

按页面提示开始记录，复现网络问题后停止记录，导出 `.json` 文件。

### 2. 上传并解析

打开在线地址：<https://wlwadmin.github.io/netlog-analyzer-react/>

将导出的 `.json` 文件拖拽到页面上传区域，或点击上传区域选择文件。页面会在本地读取并解析文件。

### 3. 查看分析结果

解析完成后，页面会展示摘要卡片和多个分析模块。可以按以下顺序阅读：

1. **总览**：先看整体错误、失败域名、协议分布和关键异常。
2. **定因诊断**：查看自动生成的根因建议和下一步排查动作。
3. **事件列表**：必要时回到原始事件级别核对细节。
4. **SSL/TLS、协议分析、性能分析**：针对证书、HTTP/2、QUIC、耗时分布等方向深入定位。

### 4. 导出报告

解析完成后点击页面顶部的导出按钮，可下载 `netlog-analysis-report-<timestamp>.md` 格式的 Markdown 报告。

## 页面模块说明

### 上传模块：`UploadZone`

对应文件：`src/components/UploadZone.tsx`

负责 NetLog 文件的入口交互，包括：

- 支持拖拽上传和点击上传。
- 限制上传文件为 `.json` 格式。
- 使用 `FileReader` 在浏览器本地读取文件内容。
- 展示读取进度、拖拽高亮和解析中的加载状态。
- JSON 解析成功后将原始数据传给主应用继续分析。

### 摘要卡片：`SummaryCards`

对应文件：`src/components/SummaryCards.tsx`

负责在解析完成后展示核心指标概览，包括：

- 总事件数、URL 请求数、失败请求数、慢请求数量。
- 平均请求耗时、日志时间跨度、峰值并发。
- SSL/TLS、HTTP/2、QUIC、DNS、代理等关键统计。

该模块适合作为第一眼判断问题规模和异常方向的入口。

### 总览页：`OverviewTab`

对应文件：`src/components/OverviewTab.tsx`

总览页用于把分析结果按排查视角汇总展示，包含：

- 错误、告警、提示信息的聚合展示。
- 请求 Top 列表和失败域名列表。
- 协议分布、代理信息、系统信息等整体画像。
- 对重复错误和大量问题做分组、折叠和“加载更多”，避免大日志页面过载。

适合用来快速回答“这份日志主要问题在哪里”。

### 定因诊断页：`DiagnosisTab`

对应文件：`src/components/DiagnosisTab.tsx`

定因诊断页基于解析结果生成更接近排查动作的结论，包括：

- 按类别聚合错误、告警和信息项。
- 展示自动生成的排查建议、结论和行动项。
- 提供“下一步排查”视图，例如 DNS、代理 / VPN、防火墙、证书、协议等方向。
- 对大量同类问题进行分组和分页加载，便于阅读。

该模块的建议来源主要由 `src/diagnosis.ts` 生成。

### 事件列表页：`EventsTab`

对应文件：`src/components/EventsTab.tsx`

事件列表页用于查看解析后的 NetLog 原始事件，适合做细节核对：

- 支持按关键词搜索事件类型、参数、Source ID 等信息。
- 支持按阶段、Source 类型、Source ID 过滤。
- 支持快速筛选包含 `net_error` 的事件。
- 表格中会提取错误码、错误文本、IP、耗时等关键信息。
- 可打开弹窗查看事件参数 JSON 明细。

当自动诊断结论需要人工复核时，可以回到该模块查看原始证据。

### SSL/TLS 分析页：`SSLTab`

对应文件：`src/components/SSLTab.tsx`

SSL/TLS 分析页聚焦证书和加密握手相关问题，包括：

- 统计 TLS 版本、Cipher Suite、涉及的主机和证书错误。
- 识别旧 TLS 版本、弱加密套件、证书错误、握手耗时过长等风险。
- 根据 SSL 事件生成健康状态、发现项和建议。
- 展示 SSL 主机列表和证书问题明细。

适合排查 HTTPS 证书异常、安全设备劫持、TLS 握手慢等问题。

### 协议分析页：`ProtocolTab`

对应文件：`src/components/ProtocolTab.tsx`

协议分析页聚焦 HTTP/2 与 QUIC 相关行为，包括：

- 判断日志中是否出现 HTTP/2、QUIC 或回退到 HTTP/1.x。
- 统计 HTTP/2 Session、Stream、GOAWAY、Stream Error 等事件。
- 统计 QUIC Session、版本、错误码和异常事件。
- 对 HTTP/2 GOAWAY、QUIC 错误、连接重置、代理兼容性等情况生成健康评估。
- 对比 QUIC 与 TCP 请求耗时，辅助判断协议层收益或异常。

适合排查新协议兼容性、代理 / 防火墙干扰、弱网下 QUIC 异常等问题。

### 性能分析页：`PerformanceTab`

对应文件：`src/components/PerformanceTab.tsx`

性能分析页聚焦请求耗时和阶段拆解，包括：

- 统计平均耗时、P50、P90、P95、P99、最大耗时等指标。
- 找出慢请求并展示 URL、方法、状态、耗时和时间线。
- 将请求阶段拆分为 DNS、连接、SSL、发送、等待、下载等环节。
- 提供瀑布流视图和单请求阶段详情，辅助定位慢在哪个网络阶段。

适合排查页面加载慢、接口响应慢、DNS 慢、TLS 握手慢、下载慢等性能问题。

## 核心代码模块说明

### 应用入口：`src/App.tsx`

`App.tsx` 是主应用容器，负责：

- 管理是否已有数据、解析事件、分析结果、加载状态等全局状态。
- 调用 `parseLog()` 将上传的 NetLog JSON 转换为结构化分析结果。
- 组织页面 Header、上传区、摘要卡片和各个 Tab。
- 处理重置、返回顶部、主题切换和报告导出。

整体数据流如下：

```text
NetLog JSON 文件
  → UploadZone 本地读取
  → App.handleFileLoaded
  → parser.parseLog
  → AnalysisResult
  → SummaryCards / OverviewTab / DiagnosisTab / EventsTab / SSLTab / ProtocolTab / PerformanceTab
  → diagnosis.exportReport 导出报告
```

### 解析引擎：`src/parser.ts`

`parser.ts` 是项目的核心解析模块，主要能力包括：

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

### 诊断与报告：`src/diagnosis.ts`

`diagnosis.ts` 负责把结构化分析结果转换为可读的排查建议和报告，主要包含：

- `generateSuggestions()`：根据错误码、失败请求、代理、DNS、证书、协议等信息生成建议。
- `generateNextStepInfo()`：生成下一步排查动作，例如检查 DNS、代理 / VPN、防火墙、证书、协议配置等。
- `generateChecklist()`：生成排查清单。
- `exportReport()`：导出 Markdown 格式分析报告。

其中内置了常见 Chromium `net_error` 错误码的解释和处理建议，并结合错误码区间做兜底判断。

### 常量与错误码：`src/constants.ts`

`constants.ts` 主要维护 NetLog 分析所需的静态映射：

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

## 数据结构概览

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

- 请上传 Chrome / Edge NetLog 导出的原始 `.json` 文件，不支持压缩包或其他格式。
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
