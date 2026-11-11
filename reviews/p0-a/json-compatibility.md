# REVIEW-C · JSON 字段兼容与审批

**历史差异表：** 下面记录已审核并被拒绝/未获批准的旧生产行为，已由后续实现替换。负责人批准 D-C-V1、D-C-META 后，当前默认分享采用显式 v1 envelope 与字段状态、保留 Go 原 ID；专家 JSON 保持旧结构。当前兼容差异、迁移与验证见 [review-c-implementation.md](review-c-implementation.md)，实际对照见 [review-c-actual-examples.json](review-c-actual-examples.json)。此前拒绝意见仍适用于三项旧方案，不能被解释为授权旧字符串/重编号行为。

对照基线：master `5d6f3f1da4931eeff13fb028d069862e8cb86530` 中 App JSON 和 Go JSON 出口；被审查实现：`0d1581aff49ee143e7cd3185152c591264129ca5`。下表来自实际 DTO 和类型，不把 D04-A 当作破坏性格式变更授权。默认分享与专家导出均使用原字段名，没有新建替代格式。

`?` 表示 undefined 时 JSON.stringify 省略；`open` 表示旧字段允许任意 JSON 值。分享占位字符串不代表原字段存在、有值或具有该字符串类型。专家保持旧出口支持的值与缺失情况；本地原数据不变。

## NetLog

| 旧字段名 | 旧 JSON 类型 | 默认分享字段名 / 类型 | 专家字段名 / 类型 | 下游影响 | 测试 | 新批准 |
|---|---|---|---|---|---|---|
| exportTime | ISO string | 同名 / ISO string | 同名 / ISO string | 无 | netlogExport：生成时刻 | 无 |
| overview.{totalEvents,uniqueSources,peakConcurrency,urlRequestCount,errorCount,warningCount,slowRequestCount} | number | 同名 / number | 同名 / number | 数值保留 | netlogExport、App.phase3 | 无 |
| proxyInfo | object | 同名 / object | 同名 / object | 内部字段见下表，不得声称对象全兼容 | netlogExport | 见 C-01 |
| proxyInfo.{hasProxy,isVPN} | boolean | 同名 / boolean | 同名 / boolean | 无 | 专家与默认对照 | 无 |
| proxyInfo.proxyType | string/null | 同名 / string/null | 同名 / string/null | 文本脱敏，类型保留 | 专家与默认对照 | 隐私投影已授权 |
| proxyInfo.{proxySettings,effectiveProxy,originalProxy} | open，通常 object/null | 同名 / 固定 string `[expert only]` | 同名 / 原 open 值 | **对象/null/数组变 string；访问属性、判空、schema 校验会失败**；当前不读取开放对象 | getter 防读取；专家原值对照 | **C-01 待批准** |
| proxyInfo.pacUrl | string/null | 同名 / string/null | 同名 / string/null | 地址内容改变；未知/相对语义由 REVIEW-A 修正 | netlogExport 地址回归 | 隐私投影已授权 |
| proxyInfo.proxyList | string[] | 同名 / string[]（等长占位） | 同名 / 原 string[] | 列表长度保留，原端点内容不能从分享文件恢复 | 专家与默认对照 | 隐私投影已授权 |
| proxyInfo.proxyFallback | string/null | 同名 / string/null（非 null 占位） | 同名 / 原 string/null | 原代理文本不在分享内 | 专家与默认对照 | 隐私投影已授权 |
| proxyInfo.vpnHints | string[] | 同名 / 脱敏 string[] | 同名 / 原 string[] | 文本改变，不得当作原提示 | 专家与默认对照 | 隐私投影已授权 |
| requests | object[] | 同名 / object[]，不减条目 | 同名 / object[] | 无新增列表截断 | netlogExport、预览完整下载 | 无 |
| requests[].{url,method,status?} | string | 同名 / string | 同名 / 原 string | URL 别名；其余文本脱敏；status 缺失仍省略 | netlogExport、地址回归 | 隐私投影已授权 |
| requests[].{statusCode?,duration?,error?} | number | 同名 / number | 同名 / number | 0/负错误码/缺失保留 | netlogExport、App.phase3 | 无 |
| requests[].timeline.{dns?,connect?,ssl?,send?,wait?,download?}.{start,end,duration} | object / number | 同名 / object / number | 同名 / object / number | 既有六阶段端点保留；不扩展 parser 类型 | netlogExport 专家 DTO 对照 | 无 |
| errors[].{severity,category,message,time} | string/string/string/number | 同名 / 同类型 | 同名 / 原值 | category/message 文本脱敏 | netlogExport | 隐私投影已授权 |
| errors[].detail | string | 同名 / 占位 string | 同名 / 原 string | 类型保留，原细节仅专家可读；不是可搜索的原错误内容 | getter/泄漏/专家测试 | 隐私投影已授权 |

## Go

| 旧字段名 | 旧 JSON 类型 | 默认分享字段名 / 类型 | 专家字段名 / 类型 | 下游影响 | 测试 | 新批准 |
|---|---|---|---|---|---|---|
| exportTime,total,entries | ISO string,number,object[] | 同名 / 同类型，全筛选条目 | 同名 / 同类型 | 不按可见列表上限截断 | exportLogEntries：120 条 | 无 |
| entries[].id | string 原标识 | 同名 / `entry-N` string | 同名 / 原 string | **不能用分享 ID 与旧文件/本地 ID join**；仅当前导出顺序别名，不是证据身份 | 默认/专家 DTO 差异测试 | **C-02 待批准** |
| entries[].{timestamp,method,domain,durationText,friendlyName,statusText?} | string | 同名 / 脱敏 string | 同名 / 原 string | 文本改变；timestampMs 才是数值时间 | 默认/专家 DTO 差异 | 隐私投影已授权 |
| entries[].{timestampMs,duration,statusCode?} | number | 同名 / number | 同名 / number | 0/缺失保留 | exportLogEntries | 无 |
| entries[].{level,status} | string 枚举 | 同名 / 原枚举 | 同名 / 原枚举 | 无 | 默认/专家 DTO 对照 | 无 |
| entries[].url | string | 同名 / 地址投影 string | 同名 / 原 string | 不可当作真实请求地址；相对/未知按 REVIEW-A 标记 | 地址回归 | 隐私投影已授权 |
| entries[].{worker,path} | string | 同名 / 占位 string | 同名 / 原 string | 内容不可恢复；不是原 worker/path | 默认/专家 DTO 差异 | 隐私投影已授权 |
| entries[].headers | object，Record<string,string> | 同名 / 固定 string `[expert only]` | 同名 / 原 object | **对象变 string；Headers 程序遍历/schema 不兼容** | getter 防读取；专家原值 | **C-03 待批准** |
| entries[].body? | open（object/array/number/boolean/string/null 等）或省略 | 同名 / 固定 string，即使原来不存在 | 同名 / 原 open 值或省略 | **类型改变、缺失变存在；正文语义不可从占位推断** | 默认/专家多类型与缺失差异 | **C-03 待批准** |
| entries[].bodyRaw? | string 或省略 | 同名 / 固定 string，即使原来不存在 | 同名 / 原 string 或省略 | **缺失变存在**；占位不是原正文 | getter、缺失差异 | **C-03 待批准** |
| entries[].rawLine | string | 同名 / 占位 string | 同名 / 原 string | 类型保留；不能重放/搜索原始行 | JSON/TXT 专家原文对照 | 隐私投影已授权 |

## 审批单与替代方案

| ID | 具体待批准变化 | 当前状态 | 替代与代价 |
|---|---|---|---|
| C-01 | 默认 NetLog 三个开放代理字段统一替换为字符串，含原 null/对象/数组 | NOT_APPROVED | 新分享 v1 和明确状态 metadata 待批准；不能用 `{}`/null 冒称保留事实 |
| C-02 | 默认 Go id 改为报告顺序别名；不能跨文件或本地 join | REJECTED | 负责人要求保留 parser 原 ID；计数器本地生成，没有私有身份证据。独立解析的 ID 可碰撞，须说明作用域 |
| C-03 | 默认 Go headers/body 改成字符串，以及缺失 body/bodyRaw 变成存在占位 | REJECTED | 新分享 v1 状态契约待批准；专家保持原类型，可选字段不变 |

负责人本轮回复：“三项均暂不建议直接批准，PR #3 应继续保持 Draft，并阻止合并及发布。”C-01～C-03 未获批准，REVIEW-C=blocked。不进一步修改上述格式契约；保留可审阅的现有 Draft PR 并明确阻止 Ready/合并/发布。审批表不是“测试通过即可批准”。没有删除格式、入口或本地字段；**仍有未获批的默认格式兼容损失**，不能报告功能/兼容审批清单为空。

专家导出是现有替代入口，并不能使默认分享自动成为旧数据交换格式。若负责人否决上述差异，需根据选定替代方案继续整改后重新验证；不能恢复默认泄漏，也不能关闭导出入口。
