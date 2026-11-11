# P0-A 最终运行验收报告

日期：2026-11-11。生产基线：`d45fd3a1a088fa12af1adf8dc15e0b874a1851ea`。[Draft PR #3](https://github.com/WLWadmin/netlog-analyzer-react/pull/3)。

**REVIEW-C 已通过独立技术复核；P0-A 运行/发布验收仍 blocked。** 本轮完成安全条件内的补充检查并交付剩余人工清单，没有修改生产源码、JSON DTO、解析器、Worker、导航、诊断规则或其他 P0。不是 Ready/合并/部署建议。

## 审查与证据身份

- 独立技术复核：负责人在本轮消息提供 REVIEW-C=PASSED、D-C-V1/D-C-META 静态通过、无明确 C-01～C-03 代码阻塞项。该结论绑定 d45fd3a，不冒称 GitHub 已提交 APPROVED Review；实读 reviewDecision 为空。
- [GitHub PR Checks / Test and build](https://github.com/WLWadmin/netlog-analyzer-react/actions/runs/42993461216)：实读 headSha=d45fd3a，status=completed，conclusion=success；PR 仍 OPEN / Draft。
- 本轮定向复验：6 套、111 项 passed，4.551s；实际 Schema、专家精确结构、ID/时间、状态/禁读、App/Go 入口及完整快照。
- 前轮全量：210 套、1789 项 passed，12 项既有 skip；build/typecheck/lint passed。仅作为同一生产基线已执行历史。本轮为文档/合成材料，不重跑无变化生产源码的全量构建。
- 当前入口更新为 REVIEW-C=PASSED；原报告保留其历史语义。后续文档提交不会扩大 d45fd3a 的独立审查范围，新 HEAD 的 CI 需读取实际结果。

状态约定：passed 是该项明确范围内实际检查成功；failed 是已执行但失败；blocked 是缺少必要输入或安全条件，未执行；not-run 是已列入清单但本轮未执行。不得将 blocked 的未执行项写成测试失败，也不得用合成 passed 覆盖真实验收。

## 最终检查矩阵

| ID | 检查范围 | 状态 | 本轮实际证据与边界 |
|---|---|---|---|
| REV-C | 独立 REVIEW-C | passed | 负责人提供的 d45fd3a 复核结论；非作者自评 |
| CI | d45fd3a GitHub CI | passed | 上述 run 的 Test and build 成功；未运行发布 |
| AUTO | 现有合成契约与交互回归 | passed | 6 套、111 项；JSDOM/mock，不是真实浏览器 |
| JSON-SYN | 合成输入的实际 JSON 与最小机器消费者 | passed | 15 项探针；150 个 NetLog 请求、120 个 Go 条目，8 个 artifact 精确复验 |
| CSV-SYN | 独立 CSV 字节/读取验证 | passed | Python 标准 csv reader：45 项（含 ZIP 单文件检查）；10 行、12 列，BOM、引号、换行、公式前缀和零/负值 |
| PERF-SYN | 既定 10k/50k 合成基准观测 | passed | 每组 3 次串行测量；只说明测量完成，无浏览器性能预算 PASS |
| REAL-NETLOG | 真实脱敏 NetLog 分享/专家对照 | blocked | 无本轮明确提供的真实脱敏样本；附件目录不存在，未搜索私人目录 |
| REAL-GO | 真实脱敏 Go 分享/专家对照 | blocked | 同上；合成日志不能替代真实来源 |
| WEB | Edge 中预览/复制/下载/取消/切换 | blocked | 未确认安全自动化路径，不启动浏览器、不接管日常配置 |
| CSV-EXCEL | Excel/表格软件实际打开 | blocked | Excel 已安装但未运行；LibreOffice/soffice 不可用；未确认 Office 自动启动的钥匙串边界，不启动 |
| LARGE-500 | 真实 500MB 浏览器链路与内存 | blocked | 无获准样本及安全 Edge 会话；合成 DTO 数量不代表文件大小 |
| LARGE-800 | 真实 800MB 浏览器链路与内存 | blocked | 同上，不能从 50k 观测外推 |
| MIG-REAL | 已有下游程序与新消费者集成 | not-run | 未提供具体消费者、原 schema 或实际业务文件；最小离线探针已单独列 passed |

矩阵为 **6 passed / 0 failed / 6 blocked / 1 not-run**。运行验收未完成，不能据此发布。机器可读记录见 [runtime-checks.json](runtime-checks.json)。

## 实际补充结果

### JSON 与消费者

[离线探针](verify-runtime-acceptance.cjs)读取两个真实 parser/builder，对合成输入生成 [NetLog 上传样本](runtime-fixtures/synthetic-netlog.json)、[Go 上传样本](runtime-fixtures/synthetic-go.log)及分享/专家 artifact：

- [NetLog 安全 v1](runtime-fixtures/netlog-safe-v1.json) / [NetLog 专家旧结构](runtime-fixtures/netlog-expert-legacy.json)。
- [Go 安全 v1](runtime-fixtures/go-safe-v1.json) / [Go 专家旧结构](runtime-fixtures/go-expert-legacy.json)。

新消费者探针先校验真实 Schema 后读取 data；旧根结构消费者读取专家 JSON。旧消费者拒绝 envelope、新消费者拒绝旧结构/未知版本；两种正确选择都保留全部条目。Go 原 ID、analysis-local 范围和原专家 DTO 精确对照通过。分享内容不包含合成敏感标记。

这些是可复验的最小消费者契约探针，不是实际业务消费者迁移或真实数据验收。样本中的 query/header 仅含 `SYNTHETIC_ONLY` 等假值，不含真人或生产信息。真实样本只在获准后本地对照，不把原内容、文件路径或专家文件上传进评审材料。

### CSV

[实际 builder 生成的合成 CSV 压缩包](runtime-fixtures/excel-safety-synthetic.csv.zip) 使用专家模式保留测试文本，公式保护仍开启。解压得到 excel-safety-synthetic.csv。包含 `=1+1`、`+1+1`、`-1+1`、`@SUM(1)`、前导空白/Tab/CR/LF，以及中文、引号、逗号和嵌入换行；无外部链接、命令或 DDE。

[独立 Python 复验](verify-csv-artifact.py)检查 UTF-8 BOM、CRLF 记录分隔、10 行/12 列、保护前缀、原文本往返和数值 `0,0,-106`，45 项通过。没有运行 Excel、没有检查真实软件单元格公式状态，不把 Python parsing 写为 Excel 实测。原 CSV 的 CRLF 被 Git 空白检查判为 trailing whitespace，采用确定性 ZIP 保留原字节，不更改 CSV 内容或 Git 配置。解压后 CSV SHA256 为 `89734e3bef10ba48a02ca7b1d2b399828c93510f4ebf2eefe1c8d7aa93d9e062`。

### 当前合成性能

重用 `scripts/benchmark-export-preview.cjs`，未改脚本。最初两组并行探测会互相争用，未纳入正式统计；随后六个独立子进程串行执行，结果见 [runtime-performance.json](runtime-performance.json)。Node v24.13.0、React/JSDOM、显式 GC；未启动浏览器。

| 请求数 | 完整 JSON 字符 | DOM 预览字符 | 分享生成中位耗时（范围） | 打开 / 专家切换 / 取消中位耗时 | 最大已观测 heap |
|---|---:|---:|---:|---:|---:|
| 10,000 | 3,358,641 | 32,768 | 44.90ms（36.90–47.72） | 4.99 / 8.45 / 1.22ms | 68,177,448 B |
| 50,000 | 16,834,242 | 32,768 | 172.54ms（165.07–243.78） | 4.82 / 24.77 / 1.25ms | 110,902,936 B |

owner reset 每次都使旧预览失效。完整分享序列化和专家缓存仍存在；172ms 级同步生成不能被称为主线程无阻塞。这里没有页面渲染、浏览器 Long Task、Blob 下载或实际系统 clipboard，也没有 browser peak/RSS。GC 后 snapshot 不是完整内存峰值，不宣称取消后立即回收。

既有证据只给 10k/50k 合成观测及 500/800MB 真实验收需求；未找到负责人批准的浏览器时间/内存阈值。没有自行发明性能 PASS 门槛。负责人后续需根据同设备真实观测决定预算，或明确接受剩余性能风险。

## 剩余人工验收操作

### 安全条件先行

由负责人/测试人员在已确认安全的独立、无登录 Edge 测试会话中操作；助手不读取或复制日常配置、Cookie、密码或令牌。不要求输入钥匙串密码，不点“允许/始终允许”，不改系统权限。出现钥匙串或登录弹窗时停止；只记录 blocked 和弹窗类别，证据不要带私人窗口/路径。

Excel 当前不在运行。其安装本身不证明启动不会请求账户/钥匙串；本轮没有启动来试探。人工操作者只有在可确认安全条件下才打开合成 CSV；登录/钥匙串弹窗不是验收步骤，出现即停止，不提供凭据。

### 1. 本地运行与浏览器操作

在项目终端先核对源码基线，运行：

```sh
git rev-parse HEAD
git diff d45fd3a1a088fa12af1adf8dc15e0b874a1851ea -- src
BROWSER=none REACT_APP_ENABLE_TRACE_ANALYSIS=1 npm start
```

第二条应无生产源码差异。`BROWSER=none` 禁止 CRA 自动启动浏览器；操作者在安全条件满足后手动打开终端给出的 localhost 地址。不要用 GitHub Pages 旧 master 页面代替此候选。

先对上述两个合成上传样本操作，再对明确获准的真实脱敏样本复验：

1. 导入文件，记录解析条目数量与分析会话；Go 筛选到非首条记录。
2. 导出 JSON，确认显示“安全分享 JSON v1”、默认专家未勾选。查看字段状态；原 Body/代理值槽位应缺失，不从 metadata 推断未知内容。
3. 内容超过 32768 字符时应出现“预览仅显示部分内容”。复制后粘贴到本地空白文本文件并保存；下载到独立本地目录，核对两份完整内容一致、条目数量与尾条存在。下载的 exportTime 用实际文件比较，不要求与固定示例时刻一致。
4. 勾选专家，确认“专家兼容 JSON（旧结构）”；再次复制/下载并核对完整旧结构、null、可选字段和原 Go ID。取消勾选应回到原分享快照。
5. 点击取消，不应产生额外下载；重新打开默认应为安全分享。更换文件/reset 后旧弹层/操作失效。两份 profile 均应保留完整选中范围。
6. 至少在桌面两个主题下检查预览与操作可达；1440×900 为主，1280×800 / 1024×768 验证操作不遮挡。记录实际完成的组合，不把未查组合记 passed。

真实样本需先由提供者确认脱敏和授权范围。将本地原导出与专家兼容格式逐字段比较；新分享按 Schema 检查，并人工检查没有真实凭据、路径或私人域名残留。只在最终记录保存样本代号、条目数、比较结果和限制；原样本/专家内容不提交。

### 2. Excel 实际打开

在已满足安全条件的 Excel 会话中，用上述合成 CSV，分别检查直接打开与“从文本/CSV”导入（若该版本支持）。选择 UTF-8、逗号，记录 Excel 版本、导入路径和区域设置。

- 应为 12 列、10 条数据记录；中文、双引号、逗号、嵌入换行不串列/串行。
- 查看 `=1+1` 等单元格的类型与公式栏：应保持文本，不计算成 2、不执行公式、不出现由执行引发的错误结果。导入器可能保留或消费显示上的前导 apostrophe，以**公式未执行、文本事实未损失**为判据。
- 数字列应保留 0 和 -106，不变为空值或错误码文本截断。
- 另存一份 CSV 后独立读取核对；记录导入器的类型转换差异。不要打开真实专家 CSV 来首次试验。
- 若导出下载副本对应这份固定合成测试集，可运行 `python3 reviews/p0-a/verify-csv-artifact.py "/path/to/local-synthetic-copy.csv"`；它仍不能代替 Excel 单元格实际检查。

### 3. 500/800MB 性能与内存

分别使用获准真实脱敏文件，在同一设备/同一候选、安全 Edge 会话重复 3 次；不生成虚构“真实 500MB”样本，也不把 preview 当全部文件数据。记录设备内存/CPU、Edge 版本、文件大小和 dataset/index 路径，公开报告只写代号。

沿主链路记录导入/解析完成 → 打开分享 → 切换专家 → 完整复制 → 下载完成 → 取消/reset：耗时、UI 是否响应、Long Task、浏览器 heap、进程内存/峰值、双快照保留以及取消后的观测。以完整结果条数/末条/源证据复核验证，不能通过截断导出“通过”性能门槛。

已有导入基准需要时，只使用人工打开模式：

```sh
npm run benchmark:netlog-browser -- --file "/path/to/approved-sanitized-500mb.json" --label p0a-500 --mode dataset-import --no-launch --no-build --timeout-ms 1200000
```

800MB 同样替换获准本地路径。`--no-launch` 只启动本地基准服务，由操作者安全打开给出的 localhost；不运行脚本的自动启动分支，不使用 Chrome fallback。该基准主要测导入/索引，不测 P0-A 导出；仍需上述导出/clipboard/download/内存步骤。它可能在本地日志显示样本路径，分享记录须脱敏，不能贴完整命令输出。

没有获批性能预算时记录观测与失败现象，提交负责人判断；不能自动填写 passed=true 的人工 manifest 或通过旧导入 benchmark 宣称导出验收完成。

### 4. 真实机器消费者迁移

提供具体旧消费者及其 schema/test command，用同一获准样本：

1. 旧消费者加载专家兼容 JSON，结果须与旧 exporter 一致；原字段、ID 与缺失行为不丢失。
2. 新消费者先验证 v1 标识/Schema，再从 data 读取；metadata 状态有明确分支，未知版本必须拒绝或提示不支持。
3. 旧消费者遇到 v1 不可默默读取空数组并报成功；新消费者不能把专家文件猜作 v1。
4. 同一 Go 分析不同筛选/排序导出的原 ID 对应同一本地记录；两个独立解析的 entry-1 必须隔离到各自 import namespace。
5. 记录消费者版本、实际执行命令、总条目和业务结果；不要提交原始敏感文件。

本轮最小探针不能证明第三方软件已完成这些适配。

## 复验与负责人决策

安全的离线补充检查可以立即复验：

```sh
node reviews/p0-a/verify-sharing-v1.cjs
node reviews/p0-a/verify-runtime-acceptance.cjs
python3 reviews/p0-a/verify-csv-artifact.py
node --expose-gc scripts/benchmark-export-preview.cjs 10000
node --expose-gc scripts/benchmark-export-preview.cjs 50000
```

首个新探针需重新生成合成 artifact 时使用 `--write`；不接收外部路径、不读取私人样本。Python reader 可读取指定的合成副本，但本轮只运行默认 fixture。

负责人下一步可提供获准真实 NetLog/Go 与 500/800MB 样本、安排安全人工 Edge/Excel 会话及真实消费者验证。完成后按矩阵逐项追加新执行证据；历史结果不改。仅确认独立代码 Review 与 CI 通过，不能将 P0-A 运行验收改为完成。

本轮没有新的明确生产代码失败/整改请求，不重新实现 REVIEW-C。继续 Draft；不自动 Ready、合并、部署，也不把其他 P0 的门禁补齐当成本轮任务。
