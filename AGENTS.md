# NetLog Analyzer React：Codex 编码约束

## 项目定位

- 本项目是面向 Chrome/Edge NetLog、浏览器 HAR 和 Go 服务日志的纯前端本地网络诊断工作台。文件默认在浏览器内解析，不上传服务器；任何改动都不得破坏这一隐私边界。
- 当前产品与发布范围仅面向桌面/笔记本上的浏览器 Web 端，优先把 Chrome、Edge 等桌面浏览器中的文件接入、解析、诊断和证据复核能力做完整、可靠。
- 当前不把手机、平板等移动设备浏览器兼容性作为设计目标或发布门槛，也不提前建设原生桌面客户端、移动 App、Electron/Tauri 容器或跨端抽象。只有用户明确启动对应阶段后，才评估和实施这些平台能力。
- 不得以“未来可能支持桌面客户端或 App”为理由增加当前 Web 端不需要的适配层、依赖、配置、面向移动设备的交互或平台分支；未来规划不能稀释当前浏览器 Web 主路径的质量。
- 核心产品定位是：提供接近 `netlog-viewer` 的完整证据浏览能力，同时把底层网络证据翻译成普通用户能理解的“发生了什么、影响多大、证据是否足够、下一步怎么做”。不能只做日志查看器，也不能只输出无法回溯证据的诊断结论。
- 目标用户分为两层：普通用户/一线支持先看统一第一屏、影响范围和行动建议；IT、网络及研发人员再进入请求详情、证据链、事件列表、Source Chain、状态视图和原始证据进行复核。两类入口必须共用同一套诊断模型和证据导航，不能产生相互矛盾的结论。
- NetLog 是浏览器网络栈与 source 链的主要验证证据；HAR 是请求现象和 Timing 证据；Go 服务日志是服务侧流程与结果证据。HAR+NetLog 联合诊断用于交叉验证同次复现，正常/异常 A-B 用于识别新增差异，但差异本身不等于根因。
- NetLog 证据浏览目标包括摘要、Data Loaded、全量事件查询与过滤、DNS/Host Resolver Cache、Proxy/PAC、QUIC、HTTP/2、Sockets、Source Chain 和 Raw Event Detail；大文件场景不能用截断 preview 冒充完整能力。
- 所有用户可见结论都应能回到具体请求、source、event 或原始字段；同时展示支持证据、反证、限制、缺失信息和置信度。证据不足时只给排查方向，不输出确定根因。
- 项目成功标准不是“展示更多指标”，而是让用户更快理解自己的网络问题，并让专家能够验证结论；代码与自动化测试证明实现行为，真实脱敏故障样本证明现实诊断有效性。
- 技术栈：React 19、TypeScript、Ant Design、Create React App（`react-scripts`）。
- 主要源码在 `src/`；测试与被测代码就近放置，文件名使用 `*.test.ts` 或 `*.test.tsx`。
- 详细的模块地图、开发与发布命令见 `README.md`；进行大范围架构调整前先阅读相关章节。

## 解析与诊断产品目标

1. NetLog、HAR 和 Chromium Performance Trace 文件的解析能力，应对标 Chrome DevTools 及相关 Chromium 工具对同类数据的呈现和解释，确保关键事实、时序、错误、请求链路和性能事件不缺失、不误读。
2. 产品不能止步于复刻 Chrome 的专业视图，还应提供比 Chrome 更适合普通用户的解释能力，将底层字段和专业指标转化为小白用户能够理解的现象、影响、原因和处理建议，同时保留专家复核入口。
3. 结论输出必须可靠、准确、可追溯。每项确定性结论都必须有明确证据支持并能跳转或定位到原始事实；证据不足时必须明确指出缺失信息和验证方法，不能给出模棱两可、无法执行或伪确定性的答案。
4. 诊断结果必须分别为普通用户、技术支持、IT 运维和网络技术人员提供可执行的下一步方案。方案应明确操作顺序、适用角色、预期结果、验证方式和必要的回退措施，优先帮助用户止损、恢复网络或设备正常使用，再开展进一步根因定位。

## 开始前

1. 先阅读相关实现、类型、已有测试和调用方；不要根据文件名猜测行为。
2. 明确本次目标、影响范围和可验证的成功标准。涉及多个模块时，先给出简短计划与验证方式。
3. 遇到会改变产品行为、数据语义、对外接口或诊断置信度的歧义，说明假设并向用户确认；不要擅自选择一种业务含义。
4. 先检查是否已有可复用的类型、解析器、诊断模型、导航规则或组件；避免创建功能重复的实现。
5. 用户只要求审查、方案、设计、解释、排查或文档时，不修改业务代码；只有明确要求“写代码”“修改代码”“实现”时才进入代码改动。

## 编码工作流程

1. 修改前使用 `rg` 等工具检索目标文件、类型、函数、导入、调用方、测试和脚本引用，阅读真实输入输出、生命周期与错误边界；不得只看函数名或单个文件就开始改动。
2. 先判断项目中是否已有语义一致的公共能力。存在时直接复用；多个活跃调用方确实重复且语义一致时，再提取到合适的公共工具函数，并同步迁移调用方和测试。不得为了形式上的“复用”合并语义不同的逻辑，也不得为未来假设提前抽象。
3. 代码注释重点解释业务语义、证据边界、算法原因、非显然约束和安全取舍，不复述代码表面行为。新增或修改复杂解析、状态机、Worker 协议、索引和诊断规则时，应在关键边界保留足够注释，便于后续复核。
4. 完成修改后再次检索引用关系，清理由本次改动产生或确认已被替代的无用导入、变量、函数、分支、旧实现、调试代码和临时兼容代码。删除既有代码前必须确认运行时、构建、脚本和文档均无有效引用，且删除与当前任务直接相关。
5. 测试代码同样需要维护：删除仅用于临时调试、已经失效或与现有测试完全重复的测试代码、fixture 和测试文件；行为仍受支持时必须保留有效回归覆盖，替换测试时先确认新测试覆盖原风险，不得通过删测试让检查通过。
6. 收尾时核对公共能力是否只有一个事实来源、调用方是否全部迁移、注释是否仍准确、无用代码是否清理，并运行与改动范围匹配的测试、构建及 `git diff --check`。

## Git 提交与推送规范

### 提交标题

- 使用 Conventional Commits：`<type>(<scope>): <summary>`；没有明确 scope 时可省略括号。
- `type` 只使用 `feat`、`fix`、`refactor`、`perf`、`test`、`docs`、`style`、`build`、`ci`、`chore`、`revert`。
- `scope` 使用稳定的业务或模块名，例如 `trace`、`har`、`netlog`、`upload`、`diagnosis`、`ui`、`worker`，不要使用临时任务编号。
- `summary` 应准确描述用户可感知行为或工程结果，避免“update code”“fix issue”“完成任务”等无信息标题；建议不超过 72 个字符。
- 标题使用英文；标题下空一行添加简短中文摘要，再保留英文详细正文。中文摘要是补充，不得替换或删减原有详情；不追溯改写历史提交。

### 提交正文

- 每次提交均在英文标题下添加简短中文摘要，说明做了什么和主要影响。
- 满足任一条件时必须写正文：跨模块或多个生产文件、Batch/里程碑交付、解析算法或 Worker 协议变更、公共类型或数据结构变更、诊断规则/阈值/置信度变更、隐私或性能边界变更、重要回归修复。
- 正文使用以下结构；无对应内容的可选段落可以省略，但不得编造未执行的验证：

```text
<English Conventional Commits title>

<简短中文摘要>

Why:
- <English reason, symptom or risk>

Changes:
- <English behavior and implementation boundaries>

Validation:
- <Actual successful checks and results in English>

Limitations:
- <Remaining limitations or verification gaps in English>
```

- 正文说明行为和证据边界，不逐文件复述 diff；禁止写入密钥、真实用户数据、完整 URL 查询参数、外部样本路径或其他敏感信息。
- `Validation` 只能记录实际成功的命令或结果；跳过、失败或受环境阻塞的检查必须放入 `Limitations` 或最终报告。
- 已有或适用的 `Why / Changes / Validation / Limitations` 必须保留；仅确实不适用的章节可省略，不为凑格式编造内容。PR 描述同样在详细正文前增加中文摘要，保留原有范围、测试和风险说明。
- Squash/Merge 提交同样遵循上述格式，不使用 GitHub 默认生成的标题/正文替代已核验详情。合并前对照原提交和 PR，逐项检查中文摘要、英文原因、改动、验证和限制均无遗漏；合并后读取实际提交正文确认。
- 合并时更新过期状态，例如远端 CI 已通过后不得继续写“尚未运行”；保留仍有效的环境差异与未验证项。此规则不授予 Commit、Push、Merge 或改写历史的权限。

### 提交边界

- 提交前必须核对 `git status --short`、staged 文件清单、`git diff --cached --check` 和 staged diff，确保只包含当前任务范围。
- 不使用 `git add .`、`git add -A` 或无法审阅范围的宽泛暂存；按明确文件或受控目录暂存。
- 一个提交只承载一个可解释、可验证的目标；无关修改必须拆分或保留在工作区。
- 不通过 amend、rebase 或 force push 重写已推送历史，除非用户明确授权且已确认不会覆盖他人工作。

### 推送与结果说明

- `commit` 只创建本地提交，不等同于 `push`；没有明确推送授权时不得修改远端。
- 推送前确认当前分支、HEAD、上游和工作区状态；禁止从错误 worktree 或错误分支推送。
- 新分支首次推送使用明确的远端与分支名并建立 upstream；不得将功能分支误推到 `master`。
- 推送后核对本地 HEAD 与远端跟踪分支 SHA 一致，并报告分支、完整 commit SHA、远端状态和是否创建 PR。
- 禁止未经用户明确授权的 `--force`；确需重写远端时优先使用 `--force-with-lease`，并在执行前说明目标分支和影响。

## 改动范围与实现原则

- 只修改完成当前任务所必需的文件；不要顺手重构或全项目格式化。发现范围外的可疑旧代码时先报告，不借当前任务扩大清理范围。
- 采用最小、直接的实现。不要为了未来可能性增加抽象层、配置项或依赖。
- 保持现有命名、目录结构、类型安全和组件风格。项目已启用 TypeScript `strict`；不得以 `any`、类型断言或降低类型安全来绕过错误。
- 不新增生产或开发依赖、不升级运行时/框架、不修改锁文件，除非用户明确授权。
- 页面层应复用 `src/diagnosis/`、`src/parsers/`、`src/utils/` 和共享组件的既有逻辑；不要在多个页面复制解析或诊断规则。
- 变更公共类型、数据结构、解析输出或跨 Tab 导航时，必须同步更新所有调用方与相关测试。
- 不删除、跳过或弱化失败测试来使检查通过。

## 诊断与隐私约束

- HAR 是请求现象证据，NetLog 是更深层验证证据。证据不足时使用“现象”“疑似”“优先排查”等保守表述，不得断言未经验证的根因。
- 面向用户的诊断应优先回答：哪些请求慢、哪些请求失败/为何失败、`status=0` 或 `netError` 表明什么、下一步如何验证；不要只堆砌指标。
- 专家视图应明确区分“可定位问题”“只作验证”“背景信息”，并给出排查顺序。
- DNS、TCP、TLS、代理、QUIC、HTTP/2、服务端响应等证据必须保持语义边界，不能由单一指标推出跨层结论。
- 新增或修改诊断规则时，应让置信度、覆盖度和跳转证据来自诊断/证据模型，而不是仅来自 UI 文案或卡片状态。
- 不在代码、测试、日志、文档或最终回复中暴露令牌、Cookie、完整 URL 查询参数、用户标识或其他敏感数据；必要时使用脱敏值或占位符。

## 历史 Issue 与防回归约束

以下问题曾经出现或被明确指出。改动相关模块时必须保留对应行为并补充回归测试：

### HAR 与用户可读性

- HAR 解析必须保留常见的非标准失败字段，包括 `_error`、`_netError`、`errorText` 等，并统一映射为可诊断字段；不得只根据 HTTP `status` 判断成功或失败。`status=0` 必须结合 `netError`、`blockedReason`、CORS/浏览器信息和时序解释。
- HAR 首屏优先展示“长耗时请求、请求不通的原因、`status` 中的 `netError`”，交互心智尽量贴近 DevTools Network Timing；不要用新增图表或指标代替失败原因解释。
- 证据跳转必须携带真实的 HAR request ID、NetLog source ID 或 event ID，不得只跳到一个通用 Tab 后让用户自行查找。

### 联合诊断、对比与测试环境

- HAR+NetLog 融合只能在时间、域名、请求或 source 链等相关证据足够时提高置信度；弱相关或跨类别线索不得自动升级为确定根因。
- A/B 对比不仅检查诊断类别；当顶部结论标题或语义发生变化时也必须识别，防止“类别相同但结论已经改变”被漏报。
- `coverage`、`confidence` 和结论级别必须由证据对象与相关强度计算。修改规则时同步更新黄金基线和保守行为测试，不得让 UI 卡片状态成为事实来源。
- 浏览器 Worker 客户端包含 `import.meta.url`。供 Jest 使用的解析模块不得在测试环境静态加载该 Worker；浏览器路径使用运行时动态导入，测试保留普通解析路径。

### 大文件与 NetLog 数据正确性

- `20,000` 条 `eventsPreview` 只能用于流式摘要 fallback，不能代表全量 Events、Source Graph、DNS/Endpoint 或状态 reducer；不得把 preview 数量展示成全量事件数或产品能力上限。
- 大文件主路径保持为 `Worker dataset + analysisId + compact index + reducers`。500MB/800MB 级文件的设计不能退化为主线程全量对象化，也不能让 streaming summary 持续膨胀成主路径。
- `eventId` 与 `source.id` 语义不同，构建请求链时必须同时考虑 `source.id`、`source.type`、`phase` 和 `params`；不得只靠事件序号或 preview 事件推断全量 source 链。
- 事件详情的 `byteStart`/`byteEnd` 必须是原始文件字节偏移，不是解码后字符串字符位置；索引改动必须覆盖跨 chunk 和多字节字符 fixture。
- DNS server、DNS answer、DoH candidate、socket peer/CIP/SIP 必须分开建模和展示，不能因都包含 IP 就互相替代或合并为同一种证据。

### 错误码、域名与真实样本

- Chromium NetError 映射必须核对真实语义并有测试保护；特别是 `-106` 是 `ERR_INTERNET_DISCONNECTED`（网络已断开），不能归因为 DNS 失败。
- 涉及飞书/Lark 域名优先级或白名单时，只使用官方白名单中的域名规则，采用严格的“域名或子域名”匹配；不得用子串匹配，也不得从页面脚本、CDN、媒体 URL 猜测白名单。
- 自动化测试只能证明代码层行为。诊断准确性还必须通过真实故障文件矩阵验证，至少覆盖 DNS、TCP、TLS、PAC/代理、网络切换、CORS/`status=0`、TTFB/5xx/Server-Timing、QUIC/HTTP2 fallback、HAR+NetLog 配对、错时配对和正常/异常 A/B 样本。

## 测试与验证

- 修改逻辑时，补充或更新能够覆盖该行为的测试；Bug 修复优先先写可复现的测试。
- 按影响范围运行最小充分验证：
  - 单个模块：`CI=true npm test -- --watchAll=false --runTestsByPath <test-path>`
  - 跨模块、解析器、诊断模型或共享组件：`CI=true npm test -- --watchAll=false`
  - 任意 TypeScript/React/CSS 或构建相关改动：`npm run build`（同时执行 CRA 的类型与 ESLint 检查）
  - 提交前：`git diff --check`
- 变更诊断发布门槛、黄金语料或性能基线时，额外运行 README 列出的三个诊断门禁测试。
- 未实际运行且成功的命令不得声称“通过”；如未运行，说明原因与剩余风险。
- 自动化测试和构建通过不等于真实故障诊断已被证实。修改诊断逻辑后，要说明仍缺少的真实样本或现场验证。

## 完成标准

任务完成前确认：

1. 实现满足用户明确提出的范围，没有无关改动。
2. 类型、调用方、测试与文案保持一致，且新增规则具有对应证据或测试。
3. 已执行与风险相称的验证，并检查 `git diff --check`。
4. 最终回复简要说明修改内容、验证结果、未运行的检查及剩余风险。

## 实际工具链与命令

- 技术栈以 `package.json` 和 `package-lock.json` 为准：清单声明 React `^19.2.7`、TypeScript `^4.9.5`、Ant Design `^6.4.3`、`react-scripts` `5.0.1`，测试使用 Jest/React Testing Library；包管理器为 npm，实际依赖版本由 lockfile 锁定。
- `tsconfig.json` 启用 `strict`、`noEmit` 和 `isolatedModules`。项目没有独立 `lint` 或 `typecheck` 脚本；`npm run build` 负责 CRA 的类型与 ESLint 检查。
- 常用命令：`npm ci`；本地开发使用 `npm start`；单模块测试使用 `CI=true npm test -- --watchAll=false --runTestsByPath <test-path>`；跨模块或共享能力测试使用 `CI=true npm test -- --watchAll=false --runInBand`；构建使用 `REACT_APP_ENABLE_TRACE_ANALYSIS=1 npm run build`。
- CI（`.github/workflows/deploy.yml`）当前由 `push` 到 `master` 或 `workflow_dispatch` 触发，使用 Node 20、npm 11.12.1，并按 `npm ci`、`CI=true npm test -- --watchAll=false --runInBand`、Trace flag 构建后发布 Pages。静态配置存在不等于本轮或当前 CI 已通过。
- PR CI（`.github/workflows/pr-checks.yml`）在指向 `master` 的 pull request 打开、更新或重新打开时触发，仅授予 `contents: read`，使用 Node 20、npm 11.12.1，并按相同的 `npm ci`、全量测试和 Trace flag 构建顺序验证；不发布 Pages。该工作流静态配置存在不等于本轮或当前 CI 已通过。
- 诊断发布门禁和真实样本矩阵按 `README.md` 执行：共享的三个诊断门禁、Trace 两个门禁，以及条件适用的 `diagnosis:real-sample-gate`。缺少样本、人工复核或现场环境时必须记为未验证，不能宣称 PASS；纯文档 INIT 只做静态校验，不运行 tests/build。

## Code Review Rules

### 1. 格式解析与数据完整性

- **约束**：文件入口必须按格式探测、显式解析和校验路径处理；不得错误 fallback 到另一解析器，不得伪造 `status=0` 的失败语义，也不得让过滤后的来源或 response body 与请求错位。正常与损坏输入都必须保留可追溯字段。
- **证据路径**：`src/upload/createFileFormatIntake.ts`、`src/upload/parseUploadedInput.ts`、`src/utils/parseHarInput.ts`、`src/utils/harRepair.ts`、`src/upload/fileFormatGateway.test.ts`、`src/utils/harRepair.test.ts`。
- **审查方法**：沿入口到 parser 的调用链核对格式判定、失败字段和索引映射；检查新增或修改测试是否覆盖正常与损坏 HAR/NetLog 输入，并以真实 request/source/event 关联确认数据没有错位。

### 2. 诊断证据与隐私边界

- **约束**：用户可见结论必须可回到证据对象和原始字段；弱关联只能给候选排查方向，不能抬升为根因。默认不上传文件；仅在用户明确触发时允许 IP 查询这一公网 IP 外发例外，并保留边界说明。
- **证据路径**：`src/diagnosis/shared/diagnosisEvidenceGuardReport.ts`、`src/diagnosis/shared/diagnosisReleaseGate.test.ts`、`src/diagnosis/shared/diagnosisGoldenCorpusGate.test.ts`、`src/diagnosis/shared/diagnosisPerformanceBaseline.test.ts`、`src/diagnosis/trace/traceDiagnosisReleaseGate.test.ts`、`src/diagnosis/ipEvidence/ipLookupClient.test.ts`。
- **审查方法**：检查结论级别、confidence、coverage 与 evidence 的来源，确认反证、限制和跳转标识未被 UI 文案替代；检查网络调用及测试，确认文件内容默认留在本地且主动 IP 查询有明确入口和测试保护。

### 3. Worker、React 状态与大文件

- **约束**：Worker 协议、客户端和 reducer 必须同步；旧响应不能覆盖新会话，reset/unmount 必须清理生命周期状态；事件详情使用真实原始字节偏移，`eventsPreview` 只作流式摘要 fallback，不得冒充全量能力。
- **证据路径**：`src/workers/protocols.ts`、`src/workers/workerClient.ts`、`src/workers/netlogDatasetIndexer.test.ts`、`src/components/har/harResponseBodyGateway.test.ts`。
- **审查方法**：逐项检查请求/响应类型和 analysis/session 标识，覆盖 reset、过期响应、错误和取消路径；核对跨 chunk、多字节输入的 byte offset，并确认大文件主路径仍是 Worker dataset/index/reducer 而非主线程全量对象化。
