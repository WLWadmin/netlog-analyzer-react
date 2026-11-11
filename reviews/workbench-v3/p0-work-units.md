# P0工程工作单元与验收契约

状态：任务依据已整理，未授权生产实施。仅细化既有P0，不重新规划P0–P5。

建议顺序：P0-A优先止住出口风险；P0-F先冻结最小引用契约，可与A并行设计，别名引用需要它的边界；P0-B定义自身终点；P0-C共享操作配对；P0-D独立修复HAR自报语义可并行；P0-E最后消费已验证事实；P0-G基于F的身份契约验证导航恢复。F不要求先建全新实体或统一所有Worker协议。每个单元可拆小PR，是否合并取决于真实共享消费者，不强制七个PR。

下列“失败复现”是应先建立的验收用例，不是本轮已经运行失败的结果。本轮没有写生产测试或修改生产代码。复现及真实样本尚未执行，统一not-run。

## P0-A · F05导出安全与CSV保护

1. 问题/证据：`App.tsx:866–915`的`handleExportJSON`直接带URL、proxyInfo和error detail；`handleExportCSV:909`仅包引号，未转义内嵌引号和保护公式前缀。这是静态确认的出口行为。
2. 范围：盘点App、maskedExport、Expert Evidence、Trace Markdown/JSON、Go exportLogEntries、请求/问题组安全复制与验证记录的真实消费者；只对受影响出口采用明确DTO及CSV编码，预览和下载共用投影。保留完整本地原证据。
3. 不得变更：已有JSON/CSV/Markdown/TXT格式及原本支持的字段访问能力、全部本地查询、Worker/按需正文；不能关导出或以另一格式替代。专家保留字段的授权方案待D04；范围无法等价须单独审批。
4. Feature ID：`X-OUT-001–004`、`N-EXPERT-009`、`T-BASE-004–005`、`L-RAW-007–008`、`H-FIELDS-010–011`、`G-VERIFY-001–002`；实施前检查实际出口，间接消费者补录，不删保护ID。
5. 修改前失败复现：虚构URL query、Authorization/Cookie、错误内路径/标识、代理凭据；CSV含引号/换行/逗号及文本`= + - @`、制表符/回车前缀；别名碰撞/跨来源同对象、0与missing。验证旧出口泄漏类别/CSV错位，不打印泄漏原文。现有maskedExport测试不覆盖全部出口，不能直接当闭环。
6. 正确行为：默认安全分享、专家配置显示保留范围；稳定单报告别名字典；明确字段投影，无对象spread；CSV字符串字段转义/公式保护且数值不误改语义。预览与实际下载一致，unknown保持unknown；原始数据默认不外发。
7. 消费者：App下载函数、ExportSummaryButton/完整报告、TraceResultPage、exportLogEntries、buildHarRequestCopyText/buildHarClusterCopyText及验证导出。列出每个出口是否本单元修改或已有等价保护。
8. 路径验证：小文件对象/普通路径；Worker及Dataset用相同匿名事实投影，查询按需不主线程展开全量；HAR大正文不因导出重复读取。Go/Trace按各自支持路径验证，不虚构Go Dataset。
9. 差异要求：逐格式记录旧/新字段类别、别名、CSV单元格及0/missing；本地完整事实不变。影响专家保留字段的减少不能只称“安全修复成功”，需负责人批准。
10. 回退/阻塞：未通过泄漏/CSV/格式/别名测试或D04未定，不发布受影响改造；回退本补丁且明确旧风险，不自行关闭旧入口。对安全与能力冲突暂停改造、单独审批。

## P0-B · F01自身生命周期与结果差异

1. 问题/证据：`createRequestAccumulator.finish`中`requestAccumulator.ts:633–635`对已解析到请求的END扩展endTime。`requestOutcome.ts`已有明确终态约束，要复用，不将已正确的终态规则一并重写。端点reducer也有独立请求duration，需一致性审查。
2. 范围：requestAccumulator/普通parser/streaming、Endpoint Evidence相关聚合及消费数值的排序/统计/诊断/导出；最小新增自身端点、观察窗口、下界和缺口字段。
3. 不得变更：请求/内部失败/协议尝试/source关系、完整Events/Dataset、原观察窗口、未闭合数据及原字段访问；关联socket END不能伪装自身终点。
4. Feature ID：`N-REQ-007–010`、`N-PERF-001–003`、`N-PLAIN-004`、`N-GRAPH-001–004`、`N-TIME-001–003`、`N-DATA-001–007`、`N-ENDPOINT-001`、`N-EVID-003–005`、`X-OUT-001–003`。
5. 修改前失败复现：自身REQUEST_ALIVE BEGIN=0/END=100、关联socket END=300，期待自身duration=100而关联观察保持300；先BEGIN后URL、仅内部END、缺BEGIN、截断、取消、重试最终成功、乱序。每例用真实source.id/type及依赖，不用eventId替代source。
6. 正确行为：完整自身生命周期独立，未闭合明确观察下界，最终outcome沿明确终点；内部失败不等于请求最终失败；不为兼容保留错误duration。
7. 消费者：parser/streaming的createRequestAccumulator、requestOutcome、netlogEndpointEvidenceReducer、NetLogRequestList、SummaryCards、PerformanceTab、SSLTab/ProtocolTab、fromNetlogLifecycle及App导出。
8. 路径验证：普通parser与Worker小文件；streaming/Dataset用同fixture与完整索引，preview=0亦有事实；源跨chunk/中文/emoji、取消/释放及500/800MB适用测量。
9. 差异要求：旧/新endTime/duration/outcome、慢请求排序/计数、阶段/规则/完整报告及导出；逐项人工审核黄金差异，真实故障结果不由新值自动判正确。
10. 回退/阻塞：自身终态或任一路径/消费者不同、黄金差异无依据、原始范围减少，阻止发布；撤回补丁到已验收版本，保留观测事实和风险说明。

## P0-C · F02共享BEGIN/END配对事实

1. 问题/证据：EventsTab Phase展示及extractErrorInfo仅原duration（详见R1）；requestAccumulator阶段端点与buildRequestLifecycle min/max不是可靠实例配对。本单元新增共享能力，不声称修复已有完整配对器。
2. 范围：共享配对计算及最小事实契约，普通和Worker/Dataset调用，Events/Timeline/阶段解释消费。先查是否可复用现有按源索引，避免重复全量扫描和第二事实来源。
3. 不得变更：Phase、原duration_ms/total_duration_ms、原始BEGIN/END、现有观察窗口、全量查询/筛选；不得丢孤立或歧义事件，不把操作重叠相加。
4. Feature ID：`N-PLAIN-001–003`、`N-EVENT-001–014`、`N-TIME-001–003`、`N-PERF-002`、`N-DATA-001–004`、`X-OUT-001–003`。
5. 修改前失败复现：同source/type事件BEGIN=10 END=30而无params.duration，当前不会提供已配对dt=20；阶段min/max夹入其他操作导致跨度不同。嵌套/重复、额外实例ID、同key异步歧义、孤立END/BEGIN、负时差/乱序、跨chunk、重叠与原duration矛盾。
6. 正确行为：按source.id/source.type/event.type与可靠实例身份配对；无唯一依据则歧义/未配对，不能机械用栈确定所有异步实例；计算dt和原duration分栏，unknown/下界明确，重叠保持起止位置。
7. 消费者：EventsTab、DatasetEventsTab及query、requestAccumulator/buildTimeline、requestLifecycle/fromNetlogLifecycle、Timeline、Performance及报告。接口版本及消费者同步迁移。
8. 路径验证：普通/Worker/Dataset同fixture配对身份、端点、dt与缺口相同；跨chunk保持状态，reset取消释放；全量不能依赖eventsPreview，性能按源查询不每次重建全图。
9. 差异要求：新增dt不覆盖原duration；旧窗口vs新配对区间、阶段/排序/诊断与报告逐项说明；配对缺口不得作为零或被删。
10. 回退/阻塞：歧义被强配、原字段丢失、不同路径不一致、峰值内存/查询明显退化阻止发布；撤回新增消费并保留原Phase/字段/窗口。

## P0-D · F03 HAR Server-Timing

1. 问题/证据：`fromHar.ts:1175–1209`对指标`dur || 0`求和并以合计阈值产生卡片；缺dur与关系未知被掩盖，不能当作服务总时间。
2. 范围：这条规则及其事实/摘要/行动/Combined/导出消费者；保留解析器原指标与原头。阈值只用于有语义的单指标事实或经证实的关系，不另猜总时间。
3. 不得变更：Headers/Timing/Server-Timing指标和缺失字段、原请求筛选、HAR wait、缓存/响应/恢复能力。
4. Feature ID：`H-FILTER-008`、`H-DETAIL-001`、`H-DETAIL-006`、`H-DETAIL-009`、`H-FIELDS-006`、`H-TOP-001`、`C-PAIR-001`、`C-PAIR-006–008`、`X-OUT-003`。
5. 修改前失败复现：阈值T，父指标0.75T与子指标0.5T或两个并行指标相加>T但没有可证实的总时长；缺dur、重复名、多个header、单指标真实>T、wait与自报不同。
6. 正确行为：逐指标值/来源/未知、关系未知提示，不默认求和；浏览器wait与自报独立。单指标异常仍可提示可复核现象，不删原分析能力。
7. 消费者：fromHar、HarRequestDetail/HarTimingChart、诊断首屏/FinalSummary、Combined及报告，parser输出保持专业字段。
8. 路径验证：普通HAR与Worker parse-har同事实/诊断；大HAR按需正文与恢复记录索引不受影响；HAR没有NetLog Dataset，涉及联合Dataset只核对关联消费者。
9. 差异要求：旧卡片触发/请求数/文案与新单指标事实、缺失/关系说明；黄金及Combined等级变化人工复核，不以卡片数量减少自动判断成功。
10. 回退/阻塞：丢指标/原头、wait映射错误、missing变0、弱关联升级因果均阻止发布；撤回规则补丁，不关HAR Timing或Server-Timing入口。

## P0-E · F04结构化命题与confirmed

1. 问题/证据：`finalSummaryBuilder.ts`的`canBeConfirmedRootCause`及`determineConclusionKind:260–290`基于文本线索及强Combined条件决定confirmed；需要把事实确定性与因果确认分开，不能泛称所有结论错误。
2. 范围：优先高风险规则的predicate/kind/必要证据/支持/反证/缺失/确认条件及FinalSummary投影，增量迁移；其余可证实观察原功能保留。
3. 不得变更：普通/专家共享事实、原规则观察与专业引用、反证/限制、全部来源、现有行动/导出；不将未迁移规则一律降候选。
4. Feature ID：`N-TOP-001`、`H-TOP-001`、`T-PUB1-001`、`G-VERIFY-001–003`、`C-PAIR-001`、`C-PAIR-006–008`、`AB-006–007`、`X-OUT-003–004`。
5. 修改前失败复现：相同事实改标题/描述/翻译或evidence字符串，确认等级不应变化；最终连接重置不能确认责任方；高confidence/双源线索但弱匹配、反证/缺失、同类别标题语义变化。
6. 正确行为：观察确认只确认predicate；根因确认要满足该因果命题必要证据/排他条件；文本不决定等级。未迁移观察保持真实语义，但不凭措辞升级因果。
7. 消费者：各来源规则、DiagnosticCard/FinalSummary、Combined/A-B、行动、报告及黄金门禁；先盘点全部confirmed调用，不只改UI文案。
8. 路径验证：同事实普通/Worker/Dataset规则一致；各来源条件分别覆盖，Trace flags及公开七视图不变；错时/弱Combined和A/B语义回归。
9. 差异要求：逐规则旧/新predicate/kind/等级/证据/限制/行动；同一命题本地与分享保持一致，不自动接受降级后的黄金结果。
10. 回退/阻塞：文案仍能升级、反证忽略、引用不可解、未迁移能力缩水、黄金差异无解释阻止发布；撤回本单元补丁并保留原能力，未证明的因果风险明确说明。

## P0-F · F07 EvidenceRef坐标与兼容

1. 问题/证据：`harRepair.ts`的HarSourcePosition为UTF-16字符区间，NetLog index/File.slice为原字节；当前区别正确。问题是统一引用尚需显式单位/基准/端点/版本，不能虚构现有HAR坐标bug。
2. 范围：基于现有引用最小判别联合与可选增量适配；fileSourceId与NetLog source.id分开，request/event/fact身份和session/revision保留。不要机械统一Worker协议或新建数据库。
3. 不得变更：charStart/charEnd、byteStart/byteEnd、JSON路径、原记录序号/未知、旧引用/Hash、全量raw/按需正文、原时钟。
4. Feature ID：`H-REC-005`、`H-REC-008`、`N-DATA-003`、`N-EVENT-014`、`N-GRAPH-003–004`、`RAW-001–005`、`T-BASE-003`、`C-PAIR-009`、`G-ROUTE-001–007`。
5. 修改前失败复现：在拟新增统一接口上，emoji/中文的char offset若作为File.slice byte offset会取错；旧文本/修复文本、版本过期、单位错误、end含/不含、同URL不同ID。这是防止新接口回归的负例；现有HAR正确读取的测试应保持通过，不要求制造当前bug。
6. 正确行为：locator判别bytes/utf16-code-unit/json-path/event/fact，记录0基/末端不含/原文本或File基准/revision；未知保持未知；仅有验证映射才转换。时间clock/unit/origin另立，不能猜统一时间。
7. 消费者：harRepair/HarRecoveryPanel、rawEvidenceGateway/DatasetRawEvidenceExplorer、netlogDatasetIndexer/query、evidenceNavigation/NavigationContext、Trace facts及稳定导出别名。
8. 路径验证：各来源普通/Worker按原支持路径；NetLog Dataset跨chunk多字节File.slice；HAR恢复字符位置与大正文请求映射；旧引用缺新字段按已明确来源适配，无法判定时提示而非猜。
9. 差异要求：原始事实数值不变；引用序列化新字段与旧消费者版本兼容清单；别名保持同报告稳定，不输出原路径/凭据。破坏性接口必须审批。
10. 回退/阻塞：字符/字节混用、猜版本、旧Hash/引用失效、缺目标回第一条、未知转0均阻止发布；撤回适配补丁保留原坐标能力。

## P0-G · F06证据导航与状态恢复

1. 问题/证据：`NavigationContext.tsx`、`evidenceNavigation.ts` 与 NetLogRequestList/DatasetEventsTab 的定位消费者存在筛选切换路径；架构 F06 已记录状态恢复风险。必须沿具体消费者确认哪些跳转清空条件，不能泛称所有入口都错误。
2. 范围：复用已有导航与生命周期状态；在受影响路径保存来源、问题、选中对象、时间窗口、筛选排序、滚动及焦点，再临时定位。与 P0-F 共享身份校验，避免另建路由或事实模型。
3. 不得变更：原请求/事件筛选与排序、真实对象 ID、Source Chain、全部旧 Hash、普通/Worker/Dataset 入口、跨来源独立证据；不得通过永久清空条件实现跳转。
4. Feature ID：`G-ROUTE-001–007`、`N-REQ-001–010`、`N-EVENT-001–014`、`N-GRAPH-003–004`、`N-EVID-003`、`H-FILTER-009–011`、`T-BASE-003`、`C-PAIR-009`。实施前核对具体 HAR 条件消费者，补录间接影响。
5. 修改前失败复现：目标被筛选排除，跳转后关闭/Esc/返回应恢复原条件及选中项；不存在 ID、同 URL 不同请求、连续跨来源跳转、reset/unmount 后迟到响应。记录实际失败路径，未重现的路径保留通过证据。
6. 正确行为：会话/版本校验后按真实 ID 定位；缺目标明确提示并保持当前状态；关闭详情恢复快照，连续跳转遵循有界返回规则；旧响应不覆盖新会话。
7. 消费者：NavigationContext/evidenceNavigation、NetLogRequestList、DatasetEventsTab、HAR 请求与问题组、Trace fact/evidence、Combined 双来源跳转、hashRouting/App；逐项记录是否受影响及使用同一恢复契约。
8. 路径验证：普通小文件与 Worker/Dataset 同目标身份和恢复结果；大文件分页目标按索引查询，不能扫描 preview 替代全量定位；释放/取消/迟到响应覆盖。HAR/Trace 按其实际支持路径分别验证。
9. 差异要求：诊断与导出事实不变；记录旧/新定位目标、过滤条件、选中项、返回状态、失败提示和查询次数。真实脱敏样本需验证重复 URL 与跨来源目标，不能以合成原型通过替代生产行为。
10. 回退/阻塞：错对象、缺目标回第一条、旧 Hash 失效、原条件不可恢复、过期响应覆盖或大文件查询退化均阻止发布；撤回受影响导航补丁，保留原入口和数据能力，不隐藏功能。

## 共用实施前后验证

先按相关模块执行最小充分测试，跨模块运行全量测试与Trace flag build、git diff --check；诊断规则/黄金/性能门槛适用时执行README共享三个及Trace两个门禁。每个工作单元列真实命令和结果，不把本计划命令写成已通过。

发布证据包含测试fixture、匿名真实样本人工复核、数据/诊断/导出差异及分类Parity。缺真实样本、Edge安全路径或大文件测量时按适用范围标not-run/blocked，不能承诺实际诊断已经准确。
