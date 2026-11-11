# C · 技术架构与可靠性修订

本稿替代旧架构中“所有原始偏移都是UTF-8字节”“未迁移规则只能输出候选解释”及自动停止导出的表述。所有修改均为待授权方案，当前代码保持原样。

## 演进原则

接入、解析事实、诊断推理、证据关联、产品交互、验证交付是六种职责，不要求六套新模块。复用现有format intake、各parser、Worker/Dataset、DiagnosticCard、evidenceNavigation、verificationSession和maskedExport。没有统一时间轴、数据库、后端、新状态管理库或解析器重写计划。

一套事实供所有阅读层使用。UI不配对事件、不重新推导协议耗时、不按标题判断根因。AnalysisSession只映射已有analysisId/session/revision与资源句柄；DiagnosticCase可从现有问题ID起步；Claim增量扩展现有诊断类型；EvidenceRef承载来源及位置；VerificationRecord和ComparisonResult扩展现有模型，不重复建立事实源。

## F01–F07改造契约

| 风险 | 当前已核对行为与目标 | 消费者与影响 | 必须先有的复现和双路径验证 | 结果差异与回退 |
|---|---|---|---|---|
| F01 生命周期 | requestAccumulator存在END更新请求窗口的路径；自身终点与关联活动尚需严格分开。目标保留REQUEST_ALIVE起终点、最终outcome、观察窗口、关联窗口及未闭合下界 | 普通parser、流式请求聚合、Dataset摘要、请求排序、统计、诊断、瀑布及导出 | 自身END后socket END、先BEGIN后URL、重试内部失败后成功、取消、截断、缺BEGIN、乱序；同一fixture普通与Worker/Dataset逐字段对照 | 记录旧/新duration、排序、受影响claim、导出字段和黄金差异；观察窗口仍可查看。回退受影响补丁至已验收版本，未证实修复不发布 |
| F02 dt | EventsTab只展示Phase，并从params读取原始duration；未实现可靠BEGIN/END配对。目标让同source.id/source.type/event.type配对成为共享事实，原始duration独立保留，未配对及歧义显式标注 | Events、Dataset查询、Timeline、阶段解释、统计及导出 | 嵌套/重复/重试、同key异步歧义、孤立END/BEGIN、跨chunk、多字节、重叠；普通与Dataset一致 | 有额外实例ID才唯一配对；否则显式歧义，不机械采用栈证明异步嵌套。重叠不串行相加。差异报告列配对证据；保留原字段 |
| F03 Server-Timing | fromHar仍有reduce求和路径；目标逐指标保留dur缺失、描述和原始头，不默认宣称服务端总耗时 | HAR诊断、摘要、Timing、Combined、报告及黄金基线 | 父子包含、并行、未知关系、缺dur、重复名、多个header；普通与Worker解析后同输入诊断一致 | 浏览器wait不等于服务CPU；修复可能改变“服务端瓶颈”结论。报告旧和新依据、未知信息；不删除指标或原始头 |
| F04 结论等级 | finalSummaryBuilder仍有文案关键词/正则路径；目标predicate、kind、必要证据、支持/反证/冲突、缺失、范围与确认条件结构化 | 所有格式诊断、FinalSummary、Combined/A-B、行动及导出 | 同事实改标题/翻译等级不变；同类别语义变化被A/B发现；弱关联和反证不能升级根因；双路径事实一致 | 未迁移规则保持原有可证实观察和功能，只禁止凭措辞升级因果命题。任何等级变化要逐规则解释，不自动整体降级 |
| F05 导出 | App存在直接JSON/CSV序列化出口；目标统一允许字段投影、配置预览及下载，保持实际已有格式 | App JSON/CSV、完整报告、Trace Markdown/JSON、Go TXT/JSON、安全复制、验证记录 | Query/headers/cookie/token/path/body/错误详情、IPv4/IPv6/域名别名、跨来源关联、Unicode、CSV引号换行及公式注入；普通与Dataset输出等价DTO | 默认安全分享与专家证据配置待D04批准；原始本地视图保持。风险无法兼容时暂停受影响改造并请求决策，不自行停用旧出口 |
| F06 导航 | 当前部分证据定位会重置筛选；目标以事务保存状态再临时定位 | NavigationContext、evidenceNavigation、请求列表、Dataset Events、HAR、Trace、历史Hash | 被过滤目标、目标不存在、释放会话、同URL不同ID、关闭/Esc/返回、连续跳转、reset、迟到响应；Worker与普通路径 | 不存在明确提示，不回退第一条或猜同URL；回退UI补丁保持旧入口，保留可验证的状态恢复能力 |
| F07 坐标 | HAR恢复是UTF-16 code unit，NetLog文件索引是字节，当前区别正确；旧设计统一字节错误 | 恢复面板、Raw gateway、Dataset Event detail、导出引用、跨来源导航 | 中文/emoji、跨chunk、末端不含、原文件vs修复文本、revision变化、错误单位拒绝；两种来源各自验证 | 不重命名charStart为byteStart，不猜换算。只新增判别信息，原字段/调用方同步兼容，坐标与时间分开 |

静态风险不证明所有解析路径都出错。本轮没有重新运行F01–F04历史合成失败探针，也没有真实故障复现；未来先写可复现测试再改代码。

## Review R1：F02源码事实纠正

固定源码基线仍为`5d6f3f1da4931eeff13fb028d069862e8cb86530`。

- `EventsTab.tsx:17–45`的`extractErrorInfo`读取`params.total_duration_ms`或`params.duration_ms`；`:246`显示Phase Tag，`:271–272`显示原始耗时。Phase展示不是配对，原始duration也不是本工具计算的dt。
- `requestAccumulator.ts:312`的`buildTimeline`消费阶段端点，`:663–695`按阶段写入BEGIN/END时间，`:713`调用；`createRequestAccumulator`由`parser.ts:347`和`streamingAnalyzer.ts:551`使用。现有`requestAccumulator.test.ts`、`requestOutcome.test.ts`覆盖聚合/终态部分条件，不能称为通用配对测试。
- `requestLifecycle.ts:147`的`buildRequestLifecycle`按阶段收集min/max并在`:194–199`计算跨度；`fromNetlogLifecycle.ts:179–180`调用，compact路径优先消费`lifecycleStageDurations`。这是观察窗口，不是同事件类型的实例配对；当前没有专用`requestLifecycle.test`文件。
- 本次检索未找到能够证明完整处理嵌套、同key异步歧义、孤立事件及跨chunk的通用配对函数/调用方/专用测试。不能据此断言仓库每处都没有任何端点计算，也不能把这些局部计算升级为可靠共享配对。

P0-C新增共享配对事实是增强现有能力；保留Phase、原始duration、当前观察窗口，并逐项解释迁移后的数据差异。未配对事件有端点/原因，歧义保留候选，不强配成确定dt。

## EvidenceRef位置契约

复合身份使用文件来源ID、分析会话/数据版本、objectKind和原对象ID。文件来源ID与NetLog source.id分别命名，eventId也不能代替source.id。

| locator种类 | unit | basis | 端点/寻址语义 |
|---|---|---|---|
| NetLog文件区间 | byte | 原始File字节流 | 从0开始，start含/end不含，保留byteStart/byteEnd |
| HAR恢复区间 | utf16-code-unit | 解析器所读原始文本；显式记录文本版本 | 从0开始，charStart含/charEnd不含；不能当作File.slice参数 |
| HAR结构字段 | json-path | 指定来源的解析对象版本 | 保留原记录索引/请求ID；隔离记录未知索引保持未知 |
| Trace事件/事实 | event-id / fact-id | 当前session/revision | 时间另含clock/unit/origin，不冒充原文件字节索引 |

建议判别联合locator，而非一个没有单位的offset。若需要转换，只允许在掌握原文本和字节编码并完成映射验证后转换，不能按字符数估算。修复文本与原文不得共用未经证明的位置。

导航先校验session/revision，按真实ID查询，再临时显示目标；保存来源、问题、时钟、窗口、筛选、排序、选中项、滚动及焦点。关闭只移除详情层，返回恢复快照。返回栈有界，过期响应按现有生命周期协议拒绝。旧Hash通过别名适配到同一目标，不删除旧解析规则。

## 大文件、协议及跨来源边界

Worker dataset + analysisId + compact index + reducers保持主路径；全量Events、Source Graph和状态不依赖20,000条preview。UI只消费分页、聚合和按需详情。已有摘要/普通fallback及启动Dataset入口均保留，容量和质量限制显式展示。

只在实际重复调用且参数、时钟、revision一致时复用有界缓存。500/800MB性能必须同设备同样本比较读入/索引、峰值内存、查询p95、取消/释放；未测量不承诺上限。

HAR、NetLog、Trace时钟独立。Combined保存原始时刻与有误差的映射、匹配依据、双方证据、未匹配与冲突。弱匹配不增加根因确定性。A/B保留三种现有模式和数据槽，先可比性再差异；missing不是0，差异不是根因。

## 导出兼容与安全

默认分享和专家配置采用同一白名单DTO管线。配置明确列出将保留的字段类别及风险，预览与下载消费同一个不可变投影。所有既有格式保留；不能以新增Markdown替代CSV或Go TXT。

单报告使用稳定别名字典，按字段语义统一跨来源request/source/host/IP引用，碰撞受控；字典只在本地，别名不能承诺外部读者还原原证据。默认不带原始正文、敏感头、query或本地路径。专家保留范围须明确批准和用户触发，不能由“专家模式”自动外发。公网IP查询继续使用既有主动入口及独立边界。

完整本地证据浏览、脱敏分享、授权后的专家证据导出是不同操作。若安全修复必须削弱既有能力，先提交十项审批单，不静默清除字段或关闭功能。

## 实施前影响清单

每个补丁列类型/生产消费者/Worker协议/测试/统计/排序/诊断/导出/UI引用，逐项核对。黄金差异包含旧值、新值、原事件引用、变化理由、预期影响和人工复核结论；不自动接受所有新结果。普通路径和Dataset路径分开记录验收，恢复与缺失语义不被“统一”抹平。
