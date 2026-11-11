# REVIEW-C · 获批限定实现

本轮承接设计提交 `c105779e83b0f7767750d1134a9a33b03c9492de`，只在 `fix/export-sharing-safety` / [Draft PR #3](https://github.com/WLWadmin/netlog-analyzer-react/pull/3) 修订 P0-A。实现身份为承载本文的提交；最新远端检查以该 HEAD 的 GitHub Check 为准。前轮 A/B/D 保留，不扩展其他 P0 单元。

## 授权与状态

负责人明确批准 D-C-V1、D-C-META，授权限定生产实现、测试、提交、推送及现有 Draft PR 更新；不授权 Ready、合并 master 或部署。此前拒绝 C-01～C-03 旧字符串/顺序别名方案的意见仍有效；本轮替换这些行为，没有将旧差异视为获批。

- D-C-V1：默认安全分享 JSON v1 新布局与旧默认 JSON 不兼容，已明确批准。UI 两处现有 JSON 预览显示“安全分享 JSON v1”或“专家兼容 JSON（旧结构）”。
- D-C-META：仅检查解析器本地记录的 own property descriptor，分辨状态；不递归进入 Headers、Body 或三个开放代理字段，不执行 getter/toJSON，不判断容器是否为空。
- Go 保留解析器原 ID；JSON/TXT 均不因筛选、排序、分页而重新编号。只在同一分析内稳定，独立解析可能同为 entry-1；不增加分析 UUID、文件哈希或上传。
- 新增未经批准的破坏性变化：**NONE**。待独立技术复核，整体发布仍 blocked。

## C-01～C-03 实际差异

[实际 JSON 对照](review-c-actual-examples.json)通过当前真实 builder 对合成输入生成；包含旧分享片段、当前完整分享和专家 JSON。旧片段沿用已审查 `e76030e4ae88e7bfb7ab0db08456f5e128560692` 的合成对照；没有重放真实用户文件。

| 项目 | 修改前 | 当前安全分享 JSON v1 | 当前专家兼容 JSON |
|---|---|---|---|
| C-01 代理 null | `proxySettings: "[expert only]"` | 不输出原值槽位；`redactions.proxySettings: {"state":"null"}` | `proxySettings: null` |
| C-01 代理字段缺失 | 仍生成占位字符串 | `state: missing, reason: absent-property` | 原字段省略 |
| C-01 开放代理对象 | 固定字符串 | `state: redacted, valueType: object, emptiness: uninspected` | 原对象与字段值 |
| C-02 选中第二条 Go 记录 | 重新编号为 entry-1 | 原 entry-2；`identity.scope: analysis-local, crossFileUnique: false` | 原 entry-2 |
| C-03 Headers 对象 | 固定字符串 | 不输出 headers 值；metadata 表示 object，内容及空值未检查 | 原 Headers 对象 |
| C-03 own body=undefined | 生成固定字符串 | `state: missing, reason: undefined-value` | body 省略 |
| C-03 body=null | 生成固定字符串 | `state: null` | body 为 null |
| C-03 bodyRaw="" | 生成固定字符串 | `state: redacted, valueType: string, emptiness: empty` | 原空字符串 |

分享根为 `schema="netlog-analyzer-sharing", version=1, profile="safe-sharing", kind=netlog/go, data=...`。原 exportTime、overview/total、requests/entries、errors 移入 data。三个代理原值槽位和 Go headers/body/bodyRaw 原值槽位移除，以同一记录内 redactions 表达状态。整个 proxyInfo 的 null/缺失保留；不伪造容器。原条目数量、数值、六阶段端点和既有其他安全文本投影保持。

metadata 为 missing（absent-property/undefined-value）、null、redacted（已知基础类型；字符串 empty/nonempty；容器 emptiness=uninspected）、uninspected（accessor/inherited/unsupported/descriptor unavailable）。不输出值、长度、哈希、私有键或内容前缀。对象/数组即使确实为空也不声明 empty。检查只保存 descriptor.value 的引用做基础状态检测；“不读取任何字段值”并非准确描述，边界是已获批的有限检查。

专家不增加 envelope、identity 或 redactions；保留旧顶层、顺序、类型、null 和 undefined 经 JSON.stringify 省略的行为。专家原 Headers/Body/代理内容仍按原导出语义序列化，不能把分享模式的 getter 禁读规则误用于关闭原专家功能。

时间保真按负责人本次要求实现：完整受控日期/时钟/ISO offset 语法保留原 timestamp 文本；未匹配文本仍用既有脱敏，不因日期前缀放行后缀。timestampMs、duration、NetLog 阶段时间及 exportTime 原值不重算。语法匹配不宣称验证日历有效性，也不将无时区文本重新解释为 UTC；现有 parser 对异常时间的归一化不是本轮范围。

## 机器消费者迁移

1. 需要旧布局/原字段：在 JSON 导出预览勾选“保留本地专家字段”，确认当前格式为“专家兼容 JSON（旧结构）”；文件可含原始敏感字段，按已授权接收范围使用。
2. 接收安全分享：先核对 schema/version/profile/kind，再读取 data；使用附带 JSON Schema 校验。未知版本/标识应拒绝或明确提示不支持，不猜测旧布局。
3. 原开放值槽位已不存在：按 redactions 处理 missing/null/redacted/uninspected；不能把 redacted 或 uninspected 当作原值存在、非空或根因。
4. 跨文件导入：以接收端 import namespace + 原 ID 作为复合键；仅已知同一分析时关联重复导出。exportTime 不是分析身份，单独 entry-N 不能跨分析唯一定位。

没有新增格式、依赖或 runtime validator。Ajv 使用现有 npm 锁定的传递依赖，仅用于测试/离线复验；Schema 不发起网络请求。CSV、Markdown、Trace、HAR 与专家证据包保持现有行为。完整复制/下载仍使用同一不可变文本快照，DOM 预览仅有限显示。

## 功能与消费者核对

| Feature ID | 本轮范围 | 实际保护 |
|---|---|---|
| X-OUT-001 | App NetLog JSON；netlogExport | 真实 builder Schema、专家旧结构精确序列化、原数值/时间、地址缺失；App 预览格式切换/下载/reset |
| L-RAW-007–008 | Go JSON/TXT；LogRawList | 原 ID/筛选排序分页、独立解析碰撞、Body parser 状态、专家旧 DTO；Go 120 条完整复制/下载及 reset |
| X-OUT-002–004、N-EXPERT-009 | 共用预览间接消费者 | 原有限 DOM、完整快照、取消、过期响应及专家缓存测试；本轮仅新增两项格式标签元数据 |
| H-FIELDS-010–011、T-BASE-004–005、G-VERIFY-001–002 | 共用预览间接消费者 | 原测试纳入全量回归；无 builder/字段/Flag 改动 |

311 项保护矩阵和 ID 不改；没有格式、入口、本地字段或全量下载能力删除。不把这些定向/既有回归视为全部 C1 运行时功能完整性验收。普通解析和 Worker/Dataset 的导出消费者共用 AnalysisResult；本轮不读 dataset/events，不变更 parser、Worker、导航、诊断/置信度或 Flags。

## 复验与验证结果

修改前仅新增真实 builder 契约测试，在旧实现执行：1 套 **31 项 failed、2 项 passed**。失败覆盖新 envelope、状态、ID 与时间保真；既有专家结构检查通过。修改后先通过定向 107 项；类型检查发现 helper typeof 联合类型不兼容，改为显式 number/boolean 分支；新增时间测试 fixture 缺少必需 detail 导致一次构建 failed，已补齐 fixture，未削弱测试。

```sh
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/utils/sharingJsonContract.test.ts src/utils/netlogExport.test.ts src/components/log/exportLogEntries.test.ts src/components/log/LogRawList.export.test.tsx src/App.phase3.test.tsx src/components/shared/useExportPreview.test.tsx
CI=true npm test -- --watchAll=false --runInBand
REACT_APP_ENABLE_TRACE_ANALYSIS=1 npm run build
npm run typecheck
npm run lint
node reviews/p0-a/verify-sharing-v1.cjs
git diff --check
```

离线实际对照可用 `node reviews/p0-a/verify-sharing-v1.cjs --write` 重新生成；默认模式只核对 artifact 与当前 builder，不写文件。只读取仓库合成 fixture，固定 Asia/Shanghai 以稳定示例，实际导出不改变用户时区。

| 检查 | 状态 | 结果 |
|---|---|---|
| 最终定向回归 | passed | 6 套、111 项；真实 builder Schema/负面 schema、专家精确 JSON、状态/禁读、时间/ID、两个 UI 出口和完整快照 |
| 全量 Jest | passed | 210 套、1789 项通过；4 套/12 项既有 skip，净新增 37 项，无新增 skip；30.908s |
| Trace production build | passed | CRA optimized production build；仅既有 Node fs.F_OK deprecation 提示 |
| Typecheck / Lint | passed | tsc --noEmit；全项目 ESLint 零 warning |
| 实际 JSON 对照复验 | passed | builder/schema/专家值/原 ID/时间与 artifact 一致 |
| diff 与范围 | passed | 不改 package/lockfile、parser、Worker、导航、Flags 或其他 P0；21 个候选文件的已知凭据/私钥/私人工作区路径/署名模式检查命中 0；不是完整秘密扫描 |
| 远端当前 HEAD CI | not-run（提交前） | 推送后由 PR 最新 HEAD Check 与最终交付报告记录；本文不把历史 CI 当本轮通过 |
| 真实脱敏故障样本/机器消费者迁移实测 | not-run | 当前只有合成 DTO/Schema 和旧结构回归 |
| 500/800MB 同设备性能/总内存 | not-run | 同步生成完整文本、专家缓存仍存在；未宣称内存下降 |
| Excel/表格软件 CSV、系统下载 | not-run | 本轮无实际软件或系统下载验收；单测不代替 |
| Edge 视觉验收 | blocked | 未确认避开钥匙串的自动化路径；未启动浏览器 |
| 当前实现外部独立复核 | not-run | 等待独立技术 Review；作者自检不代替 |

Schema 测试仅证明 DTO 契约；合成回归不证明真实故障诊断准确性。没有额外隐私风险证据证明原 Go ID 必须脱敏；新默认布局的破坏性变更已审批，不隐藏其迁移成本。专家文件继续含原敏感字段。

最终 12 个源码/测试文件摘要：`287725eb160937c6c1ede6c114082382ab986c7394bc4d0fa789e9a9df610a23`。算法沿用首轮：`relative-path:SHA256` 按路径排序，以 LF 连接后再次 SHA256；不含评审文件。实际变更文件清单见本提交 diff。311 项原矩阵未改，引用的 13 个 Feature ID 已逐项核对存在；不把源码路径/矩阵存在当作新 UI 运行时证明。

回退须新增 revert 并重新验证；不改写历史、不关闭出口。撤回本轮会恢复已拒绝的旧分享字符串、顺序别名及时间问题，不能把回退候选自动当作可发布版本。任何新增破坏性变化仍需另行审批。
