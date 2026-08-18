# 浏览器诊断工作台

面向 Chrome / Edge NetLog、浏览器 HAR、Chromium Performance Trace 和项目约定 Go 服务日志的纯前端诊断工具。

文件解析、索引和诊断默认在当前浏览器页面或 Web Worker 内完成，不会把原始文件上传到项目服务器。工具同时提供普通用户可读的结论与行动入口，以及可以回到请求、source、event 和原始字段的专家复核入口。

在线地址：<https://wlwadmin.github.io/netlog-analyzer-react/>

## 当前状态

- NetLog、HAR 和 Go 服务日志是常规可用入口。
- HAR 与 NetLog 可以独立分析，也可以追加同次复现文件进行联合诊断。
- 正常样本与异常样本支持 HAR、NetLog、HAR + NetLog 三种 A-B 对比模式。
- Performance Trace 是 Beta 能力。源码默认关闭，当前 GitHub Pages 构建会设置 `REACT_APP_ENABLE_TRACE_ANALYSIS=1` 开启入口。
- Trace Workbench、时间线、跨来源分析和高级查询属于独立的内部灰度链路，默认不随 Trace Beta 一起开启。
- 当前发布目标是桌面浏览器 Web 端，不以手机、平板、Electron、Tauri 或原生 App 为交付范围。

本项目的自动化测试用于保护解析、诊断、隐私和性能行为，但不能代替真实故障样本、浏览器验收或用户可理解性验收。代码中已有发布门禁模型；缺少这些外部验收材料时，不应把“测试通过”表述为“现实诊断准确性已经证实”。

## 支持的数据源与证据边界

| 数据源 | 当前能力 | 可以支持的判断 | 不能单独证明的内容 |
| --- | --- | --- | --- |
| Chromium NetLog | 请求、source chain、事件、DNS、Proxy/PAC、Sockets、TLS、HTTP/2、QUIC、缓存和网络状态 | 浏览器网络栈内发生了什么，以及错误与 source/event 的关联 | 企业链路、设备外部网络和服务端内部根因 |
| HAR | 请求列表、Headers、Cookies、Timing、响应预览、失败字段和 Server-Timing | 请求是否失败或缓慢、HTTP/浏览器层现象、Timing 分布 | DNS、TCP、TLS、代理或服务端根因；除非有同次 NetLog 或其他链路证据 |
| HAR + NetLog | 请求、域名、时间和 source 证据关联 | 对同次复现中的请求现象与网络栈事实进行交叉验证 | 弱关联、错时文件或只有同类线索时，不会自动升级为确定根因 |
| Performance Trace | 页面里程碑、网络生命周期、主线程任务、渲染、交互和有限 CPU profile 事实 | 录制窗口内的浏览器性能现象和优先排查方向 | 浏览器外部网络根因，以及 Trace 未采集或时间域未校准的事实 |
| Go 服务日志 | 项目约定日志行的解析、流程分组、统计和原始行浏览 | 服务侧已记录的流程、状态、耗时和关联字段 | 浏览器网络栈根因；它也不是通用 Go 日志解析器 |
| A-B 对比 | HAR、NetLog、Combined 的正常/异常差异 | 异常环境新增或退化的现象 | 差异本身不等于根因，仍需回到两侧证据确认 |

诊断输出遵循以下原则：

- 确定性结论必须有可定位证据；证据不足时使用“现象”“疑似”“优先排查”或“需要补证”。
- HAR 的 `status=0` 会结合 `_error`、`_netError`、`errorText`、blocked reason 和浏览器信息解释，不只按 HTTP status 判断。
- DNS server、DNS answer、DoH candidate、socket peer、CIP、SIP 和服务端观察到的客户端 IP 分开建模，不因都包含 IP 就互相替代。
- NetLog `eventId` 与 `source.id` 是不同语义，source chain 不只依赖事件序号。
- 请求关联和证据融合保留支持证据、反证、冲突、置信度因素、限制和缺失信息。

## 文件格式与解析路由

| 解析器 | 常用扩展名 | 解析器 ID |
| --- | --- | --- |
| HAR | `.har`、结构明确的 `.json` | `har@1` |
| Chromium NetLog | `.json` | `chromium-netlog@1` |
| Performance Trace | `.trace`、`.json2`、结构明确的 `.json` | `chromium-performance-trace@1` |
| Go 服务日志 | `.log` | `go-service-log@1` |

上传流程不是按扩展名直接猜测解析器：

1. 检查容器和文件前缀。
2. 根据根结构和关键字段对所有已启用解析器执行有限探测。
3. 只有唯一明确匹配时才自动推荐；歧义或证据不足时要求用户选择。
4. 绑定解析器后执行该格式的专属校验和解析。
5. 解析失败不会静默切换到另一个格式。

补充限制：

- gzip 目前只支持 Trace，接受 `.json.gz`、`.trace.gz` 和 `.json2.gz`。
- ZIP 不支持，需要先在本地解压。
- gzip 文件按 magic bytes 判断，不只依赖扩展名。
- Trace 默认安全限制为压缩文件 64 MiB、解压后 JSON 128 MiB、最多 1,000,000 个事件。

## 隐私与外部请求

- 原始诊断文件在浏览器内读取，并通过本地 Web Worker 完成重型解析或索引。
- 页面不会自动上传 HAR、NetLog、Trace 或日志内容。
- 报告和数据文件只在用户点击导出时生成并下载到本地。
- IP 归属查询是例外：只有用户主动点击查询按钮时，选中的公网 IP 才会发送到配置的 Cloudflare Worker 代理；内网、loopback 和保留地址会在本地过滤。
- HAR、NetLog 和日志可能包含 Cookie、Authorization、token、完整 URL、用户标识和响应体。共享前仍应检查导出结果，即使专家协作摘要会执行脱敏扫描。
- 主题、侧栏状态、部分筛选条件和开发开关会保存在 `localStorage` 或 `sessionStorage`，不包含原始文件副本。

## 快速开始

### 获取诊断文件

NetLog：

- Chrome：打开 `chrome://net-export/`
- Edge：打开 `edge://net-export/`
- 开始记录，复现问题后停止并导出 JSON。

HAR：

- 打开 DevTools → Network。
- 复现问题后使用 “Save all as HAR” 或导出按钮保存文件。
- 如需与 NetLog 联合诊断，应尽量在同一次复现窗口采集。

Performance Trace：

- 打开 DevTools → Performance。
- 只录制必要的问题窗口，停止后导出 Trace。
- Trace 可能包含 URL、脚本名、页面内容线索和截图信息，分享前应脱敏。

### 上传与格式确认

将文件拖入首页，或点击上传区域选择文件。自动识别只有在结构唯一明确时才继续；也可以切换为“指定文件格式”。首页支持一次选择多个文件，HAR + NetLog 会进入联合诊断路径。

### 推荐阅读顺序

NetLog：

1. **结论与行动**：先确认最值得看的 episode、影响范围、证据是否足够和第一步行动。
2. **请求详情**：核对失败/慢请求、错误码、耗时和关键请求字段。
3. **证据链**：查看 HAR 关联、DNS/IP、代理、错误分布和限制。
4. **专家分析**：进入 Data Loaded、事件、源链路、Timeline、协议、网络状态、性能、A-B 和完整报告。
5. **原始事件**：按结构或 Dataset 分页结果复核原始字段。

HAR：

1. **网络问题定位**：查看请求层现象、影响和补证建议。
2. **请求详情**：查看 Headers、Cookies、Timing、响应预览和失败字段。
3. **原始证据**：按 JSON path 搜索或展开原始 HAR。

Trace：

1. **结论**：查看有限诊断和限制。
2. **概览 / 网络 / 主线程 / 渲染 / 交互**：复核聚合事实。
3. **全部证据**：回到诊断所引用的事实对象。

Go 日志：

1. **日志概览**：查看核心发现、统计和 Top 流程。
2. **操作流程**：查看结构化流程和失败记录。
3. **日志统计**：查看耗时与分布。
4. **原始日志**：搜索和复核原始行。

## 当前页面能力

### NetLog

一级入口：

- `结论与行动`
- `请求详情`
- `证据链`
- `专家分析`
- `原始事件`

专家分析二级入口：

- `Data Loaded`
- `事件列表`
- `源链路`
- `Timeline`
- `安全与协议`
- `网络状态`
- `性能分析`
- `A-B 对比`
- `完整诊断报告`

当 Dataset 可用时，事件分页、Raw Event Detail、Source Chain、Data Loaded、DNS、Proxy、QUIC、HTTP/2、Sockets、Cache、Alt-Svc、Stream Pool、Reporting、Modules、Prerender 和 endpoint evidence 等视图由 Worker 中的全量索引提供。Dataset 不可用时，页面会明确回退到摘要能力，而不是把 preview 数量当作全量事件数。

### HAR

- 网络问题定位
- 请求详情与筛选
- DevTools 风格 Timing
- Headers、Cookies、Query、Initiator、Server-Timing 和响应预览
- 大响应体按需读取；大 HAR 可省略部分 body 以控制内存，但请求、Headers、Timing、状态和诊断字段仍参与分析
- 原始证据搜索与展开

### Trace Beta

- 结论、概览、网络、主线程、渲染、交互和全部证据七个入口
- 专用 Worker 负责读取、解压、结构校验、事件扫描和事实聚合
- 进度来自已处理字节、事件和聚合阶段，不使用随机百分比
- Markdown 与白名单 JSON 导出不包含原始 Trace 事件
- 内部 Workbench 只有在完整 feature flag 链满足时才显示

### Go 服务日志

- 项目约定日志格式识别
- Success、Error、Retrying、Network Error 等记录归类
- 流程分组、失败筛选、耗时统计和原始日志搜索
- TXT 与 JSON 导出

## 大文件 NetLog

100 MiB 及以上 NetLog 进入 Worker 流式路径：

- 默认尝试在一次文件扫描中同时生成摘要和 Dataset。
- single scan 失败时回退到保守摘要路径，并明确记录 Dataset fallback 状态。
- 流式摘要最多保留 20,000 条关键 `eventsPreview`，它只用于摘要 fallback，不代表文件总事件数，也不承担全量 Events、Source Graph 或状态 reducer 能力。
- Dataset 使用 `analysisId`、compact index 和状态 reducers 保留全量查询能力，避免把完整事件对象复制到主线程。
- Dataset 生命周期由 Worker 管理；替换文件、重置页面或卸载时会释放关联数据。

小文件默认直接解析；保留原始 `File` 时，也可以从 NetLog 专家页手动启动 Dataset 索引。

## 导出

NetLog：

- Markdown 诊断报告
- 专家证据包；Dataset 未就绪时会标记为 summary-only
- JSON 摘要数据
- CSV 请求列表

Trace：

- Markdown 报告
- 白名单化 JSON 报告

Go 日志：

- TXT
- JSON

导出内容仍可能包含业务域名、请求路径、IP 或日志字段。向外部共享前需要人工复核。

## 架构概览

```text
File
  → upload/createFileFormatIntake
  → upload/probeFileFormat 或 fileFormatProbeWorker
  → fileFormatGateway 确认唯一解析器
  ├─ HAR      → harParser → diagnosis/shared/fromHar
  ├─ NetLog   → parsers/netlog → analysisWorker / Dataset reducers
  ├─ Trace    → traceAnalysisWorker → parsers/trace → diagnosis/trace
  └─ Go Log   → logParser
  → FinalDiagnosisSummary / 各格式事实模型
  → ResultWorkbenchShell + 证据导航 + 本地导出
```

主要目录：

```text
src/
├── components/          # 上传页、各格式结果页、共享诊断与证据组件
├── diagnosis/shared/    # HAR、NetLog、Combined 的诊断、融合、覆盖率和发布门禁
├── diagnosis/trace/     # Trace 规则、评分、黄金语料与发布门禁
├── parsers/netlog/      # NetLog 解析、请求生命周期、source graph 和报告
├── parsers/trace/       # Trace 接入、事实聚合和安全导出
├── upload/              # 格式探测、解析器注册、确认路由和真实进度
├── workers/             # 文件探测、NetLog、Trace Worker 与 Dataset 查询协议
├── workbench/           # Trace 内部 Workbench 会话、时间线和高级分析
├── harParser.ts         # HAR 结构化解析
├── harDiagnosis.ts      # HAR 请求层统计和现象分析
├── logParser.ts         # 项目约定 Go 服务日志解析
└── App.tsx              # 会话状态、hash 路由、追加上传和导出入口
```

URL hash 使用 `#fileType/tab[/subTab]`，例如：

- `#netlog/conclusion`
- `#netlog/expert/events`
- `#har/requests`
- `#trace/main-thread`
- `#log/raw`

旧版 NetLog/HAR hash 会由 `src/utils/hashRouting.ts` 映射到当前入口。

## 技术栈

- React 19
- TypeScript 4.9，`strict` 模式
- Ant Design 6
- Recharts 3
- Create React App / `react-scripts` 5
- Jest + Testing Library
- 浏览器 Web Worker、ReadableStream 和 DecompressionStream

## 本地开发

部署工作流使用 Node.js 20 和 npm 11.12.1，本地开发建议使用相同主版本。

```bash
npm ci
npm start
```

开发服务器默认地址：<http://localhost:3000>

生产构建：

```bash
npm run build
```

构建产物位于被 Git 忽略的 `build/`。

## Feature flags

CRA 会在构建时注入 `REACT_APP_*` 环境变量，修改后需要重新启动开发服务器或重新构建。

| 环境变量 | 默认 | 作用 |
| --- | --- | --- |
| `REACT_APP_ENABLE_TRACE_ANALYSIS` | 关闭 | 注册并开放 Trace Beta 上传和结果页；GitHub Pages 工作流当前设置为 `1` |
| `REACT_APP_ENABLE_NETLOG_SINGLE_SCAN_DATASET` | 开启 | 控制大 NetLog summary + Dataset single scan；设置 `0` 使用 fallback 路径 |
| `REACT_APP_ENABLE_TRACE_WORKBENCH` | 关闭 | 开启 Trace 内部 Workbench 容器 |
| `REACT_APP_ENABLE_TRACE_TIMELINE` | 关闭 | 在 Workbench 基础上开启时间线 |
| `REACT_APP_ENABLE_TRACE_EXPERT_ANALYSIS` | 关闭 | 在时间线基础上开启专家分析 |
| `REACT_APP_ENABLE_TRACE_CROSS_SOURCE` | 关闭 | 在专家分析基础上开启跨来源关联 |
| `REACT_APP_ENABLE_TRACE_STAGE5` | 关闭 | 在前述开关全部开启时启用 Stage 5 |
| `REACT_APP_ENABLE_TRACE_STAGE6` | 关闭 | 在 Stage 5 基础上启用声明式查询和高级能力 |

Trace 内部开关是逐级依赖关系，只设置后一级不会绕过前置开关。

## 测试与验证

全量自动化测试：

```bash
CI=true npm test -- --watchAll=false
```

单个模块：

```bash
CI=true npm test -- --watchAll=false --runTestsByPath <test-path>
```

诊断共享层门禁：

```bash
CI=true npm test -- --watchAll=false --runTestsByPath \
  src/diagnosis/shared/diagnosisReleaseGate.test.ts \
  src/diagnosis/shared/diagnosisGoldenCorpusGate.test.ts \
  src/diagnosis/shared/diagnosisPerformanceBaseline.test.ts
```

Trace 诊断门禁：

```bash
CI=true npm test -- --watchAll=false --runTestsByPath \
  src/diagnosis/trace/traceGoldenCorpus.test.ts \
  src/diagnosis/trace/traceDiagnosisReleaseGate.test.ts
```

提交前至少运行：

```bash
CI=true npm test -- --watchAll=false
npm run build
git diff --check
```

真实样本测试不会把样本提交到仓库：

- NetLog parity 通过 `NETLOG_PARITY_SAMPLE_DIR` 指向外部样本目录。
- Trace plain/gzip 接入测试通过 `TRACE_PLAIN_SAMPLE_PATH` 和 `TRACE_GZIP_SAMPLE_PATH` 指向脱敏样本。
- Trace 多样本门禁通过 `TRACE_SAMPLE_MANIFEST_PATH` 指向仓库外 manifest。
- 未提供这些环境变量时，对应测试会跳过，不能据此宣称真实样本已经验收。

## 部署

`.github/workflows/deploy.yml` 在 `master` 分支 push 或手动触发时：

1. 使用 Node.js 20。
2. 执行 `npm ci`。
3. 设置 `REACT_APP_ENABLE_TRACE_ANALYSIS=1` 并运行 `npm run build`。
4. 将 `build/` 发布到 GitHub Pages。

`package.json` 的 `homepage` 为：

```text
https://wlwadmin.github.io/netlog-analyzer-react
```

## 已知限制

- 只面向桌面浏览器 Web 端；浏览器缺少 Worker、ReadableStream 或 DecompressionStream 时，部分大文件或 gzip Trace 能力不可用。
- 大文件的可用上限取决于浏览器、设备内存和文件结构，不能只用文件大小承诺成功。
- Trace 的完整性取决于录制类别、窗口和 Chromium 版本；缺失事件族时，对应规则会降级或禁用。
- HAR Timing 中的缺失值、`-1` 和浏览器扩展字段并不等价，解析结果会保留可用性信息。
- Go Log 只支持当前解析器识别的项目约定行格式。
- 自动化测试通过不代表 DNS、TCP、TLS、PAC/代理、网络切换、CORS、服务端性能或协议 fallback 已在真实现场被全部验证。
- 发布判断还需要脱敏真实故障矩阵、浏览器截图/交互验收和非网络专业用户可理解性记录。
