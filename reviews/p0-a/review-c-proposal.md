# REVIEW-C 最小兼容修订方案

基线：`e76030e4ae88e7bfb7ab0db08456f5e128560692`，[Draft PR #3](https://github.com/WLWadmin/netlog-analyzer-react/pull/3)。本文保留设计阶段历史；负责人随后明确批准 D-C-V1、D-C-META，并授权限定实现、测试、提交、推送与同一 Draft PR 更新。**当前实现、实际 JSON 和验证以 [review-c-implementation.md](review-c-implementation.md) 为准；不授权 Ready、合并或部署。** 以下“拟议/待批准/未实现”描述均为批准前历史，不代表当前状态。

负责人已拒绝 C-02 的筛选重编号和 C-03 的固定字符串方案；C-01 当前代理字符串方案未获批准。这三项旧行为保留在审查基线中用于复现，均不作为可发布契约。A、B、D 不重新实现，真实大文件继续 not-run。

## 推荐边界与备选

推荐增加仅用于默认分享的 v1 envelope，保留无 envelope 的旧专家 JSON。分享 envelope 明确指出数据已投影，并将三个代理字段、Go Headers/Body/BodyRaw 的状态放入 `redactions`，不在原字段名下伪装原内容。Go 保留解析器原 ID。此方案改动限定在导出投影、共用字段状态检测及两处现有专家选择说明。

直接将字符串替换成 `{}` 或 null 无法保持原事实状态；不采用。递归遍历原对象并尝试脱敏虽然可能保留部分结构，但违反本轮不读取开放内容的要求，增加私有键名和未知字段泄漏风险，也不采用。新增 parser metadata 能区分更多状态，但超出本轮最小范围，不启动。

## Schema 与专家兼容

拟议分享根结构固定为：

```json
{
  "schema": "netlog-analyzer-sharing",
  "version": 1,
  "profile": "safe-sharing",
  "kind": "netlog",
  "data": {}
}
```

`kind` 只有 netlog/go；上面的 data 是 envelope 示意，完整合法样例见 [review-c-examples.json](review-c-examples.json)，约束见 [review-c-sharing-v1.schema.json](review-c-sharing-v1.schema.json)。schema 标识是契约常量，不向外网查询，不增加运行时网络或依赖。未知 schema/version/profile 必须被消费者拒绝或明确提示不支持，不能回退成旧 JSON 猜测解析。

- NetLog：原 exportTime/overview/requests/errors 移至 `data`；保留原数值、条目和 Timing 投影。`data.proxyInfo` 保留既有安全字段，删除其三个原开放字段值槽位，新增 `redactions.{proxySettings,effectiveProxy,originalProxy}`。整个 proxyInfo 的 null 或 missing 仍按原事实保留，不能生成虚构代理容器。
- Go：原 exportTime/total/entries 移至 `data`；每条 entry 保留原 ID 和已批准的其他安全文本投影。删除 headers/body/bodyRaw 原值槽位，新增该 entry 的 `redactions.{headers,body,bodyRaw}`，与 ID/记录同处，不另造可错位的并行 metadata 列表。
- Go `data.identity = {"scope":"analysis-local","crossFileUnique":false}` 描述范围，不代表拥有跨分析唯一身份。没有添加解析器、上传、Worker 或新文件身份模型。
- 专家 JSON 不增加 schema/version/profile/envelope，不挪动原字段，不增加 redactions。继续输出 NetLog 的 exportTime/overview/proxyInfo/requests/errors，以及 Go 的 exportTime/total/entries；保留原类型、值和 optional 字段的 JSON.stringify 行为。
- JSON 仍是原有格式，不新增另一个文件格式；分享 profile 的新结构是明确的格式契约变化，须批准后才接入默认出口。CSV/MD/Trace/HAR 不改；Go 分享 TXT 仅拟恢复原 ID 前缀，专家 TXT 原始行拼接不改。

机器消费者需要旧布局时：在当前“导出 JSON → 导出预览”中勾选“保留本地专家字段”，下载原结构。获批实施后仅在 App/LogRawList 的现有 JSON 专家说明中注明“专家兼容 JSON：旧结构，含所列原字段”；不重做共用预览。消费者应主动选择匹配其 schema 的文件，不能把安全分享 v1 自动还原成旧数据。专家文件可能含原始敏感字段，继续按既有显式选择范围处理。

## 状态契约与读取边界

检测对象限定为解析器产出的本地记录自身的数据属性。检查 own property descriptor 的存在及值的基本状态，**不触发 getter、不调用 toJSON、不递归、不遍历 Headers/Body/代理对象、不扫描或复制其内容**。读取 descriptor.value 的引用以检测 undefined/null/类型、字符串是否为空，是本方案请求批准的有限元数据检查；不能对外宣称“完全不接触字段值”。

| 原输入事实 | metadata | 内容处理 |
|---|---|---|
| 没有 own property 且无继承字段 | `{"state":"missing","reason":"absent-property"}` | 不输出原字段值 |
| own property 值 undefined | `{"state":"missing","reason":"undefined-value"}` | JSON 原值本就省略；与没有属性区分 |
| own property 值 null | `{"state":"null"}` | 保留“记录的是 null”，不称有隐藏正文 |
| 空字符串 | `{"state":"redacted","valueType":"string","emptiness":"empty"}` | 不输出原字符串 |
| 非空字符串 | 同上，emptiness 为 nonempty | 不输出内容、长度、哈希或前缀 |
| 数字 0/其他数字 | `{"state":"redacted","valueType":"number"}` | 不输出原数值；0 不误判 missing |
| false/true | `{"state":"redacted","valueType":"boolean"}` | false 不误判 missing |
| 对象或数组，含 `{}`/`[]` | `{"state":"redacted","valueType":"object或array","emptiness":"uninspected"}` | 不访问容器内部，不能断言空/非空 |
| accessor/getter | `{"state":"uninspected","reason":"accessor-not-read"}` | 已声明属性的值未读取，不能称有隐藏正文 |
| 字段仅来自继承关系 | `{"state":"uninspected","reason":"inherited-property-not-read"}` | 仅检查顶层记录的字段声明，不访问继承值 |
| 不支持的值或 descriptor 无法取得 | uninspected + 对应 reason | 不猜测类型/正文存在，不进入原内容 |

metadata 不设 value 字段；JSON Schema 排除私有内容、未知键和错误状态组合。`redacted` 代表值的数据类型已知、原内容未导出；`uninspected` 代表无法安全确定。Headers 对象的结构类别能说明为 object，但其键/数量/是否空均未检查。Headers 自身缺失、null 或 accessor 同样不能伪造为有结构化内容。

当前 Go parser 的 buildEntry 总是创建 body/bodyRaw 属性，即使值 undefined；parseTail 无 Body 时返回 undefined，`body -> null` 会得到 body=null 和 bodyRaw="null"，只有 `body ->` 会得到 body=undefined、bodyRaw=""。所以检查 `hasOwn` 一项不足以判断 Body 是否存在，必须区分 undefined。上游解析器若已把某些状态折叠成 undefined，本导出只能保留 parser 记录的事实，不能重读 rawLine 还原采集事实。

完全不访问对象内部，与精确区分 `{}`/非空对象、`[]`/非空数组之间存在约束冲突。本方案选择 emptiness=uninspected，不宣称完成容器空值检测。若负责人要求精确判断容器是否为空，需另行批准可读取的元数据边界或 parser 提供状态；本轮不能擅自扩大范围。

仅支持上述本地 own-data-record 事实契约；继承属性/代理对象/无法取得 descriptor 的异常输入不能被当作已采集 missing，须明确 uninspected。后续实现需对这些异常边界建立回归，不依赖 schema 文件完成运行时检测。

## Go ID 与跨文件关系

源码事实：`GoServiceLogParser.parse` 每次将 entryIdCounter 重置为 0；`buildEntry` 使用 `entry-${++counter}`，不包含 worker、URL、Cookie 或用户字段；随后按 timestampMs 排序，不重建 ID（src/logParser.ts）。没有发现原 ID 的隐私泄漏证据。C-02 的无证据别名推断撤销。

拟议 JSON 和分享 TXT 均直接用 `e.id`。同一分析的过滤、反向排序、分页或再次导出不能改变 ID；专家 JSON 已有该行为，分享应恢复。导出全部筛选结果的范围不变。

两次独立解析都可出现 entry-1。同一次解析 ID 唯一，不等于跨文件全局唯一。接收端合并独立文件时须以接收端自己的 import namespace + 原 id 为复合键，并只在已知同一分析时合并重复导出。最小方案没有导出 analysis UUID；因此接收端不能仅从两个文件自动判定是否同一分析，也不能把 exportTime 当分析身份。无需读取/输出原文件名或内容哈希。

## 实际 JSON 对照与实施门禁

[review-c-examples.json](review-c-examples.json) 的 currentShareFragment/expertFragment 已用当前生产 builder 对合成输入生成并核对；proposedNetlog/proposedGo 是待实现的预期 JSON。示例明确展示 null、删除属性和 body=undefined/空 bodyRaw 的差异；完整 Body 状态矩阵含 12 类输入。当前专家原类型和可选字段保留，拟议专家输出不变。

设计阶段 Go 样例按 Asia/Shanghai 记录现有时间数值；没有时区的日志时间沿用原 parser 行为。随后负责人明确要求时间保真测试：当前实现对完整受控时间语法保留原文本，不再把横线日期误作电话；未知文本仍脱敏，不重算 timestampMs 或时区。实际样例见 [review-c-actual-examples.json](review-c-actual-examples.json)。

| 组 | 当前已拒绝或未获批行为 | 拟议修订 | 仍需批准 |
|---|---|---|---|
| C-01 | 原代理 object/null/missing 统一变 string | 分享 v1 envelope + 代理 redactions；专家原结构 | **D-C-V1** 新分享布局与原字段值槽位删除；**D-C-META** 有限状态检查 |
| C-02 | 按筛选顺序重新编号 | JSON/TXT 原 ID；声明仅分析内稳定 | 保留原 ID 本身已由本轮明确要求，无额外隐私降级审批；新 identity metadata 随 D-C-V1 批准 |
| C-03 | Headers/Body 类型变化，undefined 变假占位存在 | 分享 v1 内仅状态 metadata；专家原类型及 optional 行为 | D-C-V1；D-C-META，尤其容器 emptiness 未检查与 accessor 状态 |

现有专家入口可以保持旧消费者兼容，但默认分享 v1 **不兼容旧默认 JSON 布局**。这项差异不可被“保留格式”或“专家可替代”掩盖；审批单必须确认默认消费者迁移说明。三项旧差异不会原封不动重新申请批准。

获批后的最小实施预计涉及 netlogExport.ts、exportLogEntries.ts、一份两者共用的字段状态工具和类型，以及 App/LogRawList 两处 JSON 专家说明；测试就近覆盖状态、Go ID、专家旧 DTO 和两个出口的 profile 选择。不得触碰其他 P0、parser、Worker、诊断、导航、Flags 或 A/B/D 的实现。该文件范围是计划，不是本轮改动。

实施顺序：先把本轮 [复现与测试设计](review-c-test-design.md) 中稳定 ID、missing 与分享 v1 校验转成 RED 测试；再实现共用状态投影；保持专家路径原 DTO；接入版本化分享及说明；GREEN 后全量回归及静态检查。当前新 DTO GREEN、真实样本和新版本机器消费者验收均 not-run。负责人批准前，PR #3 必须保持 Draft、合并/发布 blocked。
