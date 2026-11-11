# A · 当前功能完整性复核

日期：2026-11-11。阶段：方案复核与实施准备。尚未授权生产代码、实施PR、合并或部署。本文与新版功能矩阵替代旧评审包中较粗的兼容描述；原型仅供交互评审，不是生产能力清单。

Review收口说明：本文中的“本轮155项”指上一轮V3调查记录。本次只定向整改R1–R5及准备P0，未重跑这15套生产测试；本次实际证据见review-checks.json及review-closure.md。

## 当前版本证据

重新通过GitHub API确认默认分支为master，远端最新与本地HEAD均为 `5d6f3f1da4931eeff13fb028d069862e8cb86530`。提交日期2026-11-06，标题 `fix(har): distinguish file, transfer and resource size evidence`。

lockfile实际版本：React19.2.7、TypeScript4.9.5、Ant Design6.4.3、Recharts3.8.1、react-scripts5.0.1、Jest27.5.1、Testing Library16.3.2。package.json已有lint/typecheck脚本。本轮不迁移技术栈、不新增依赖。

开始时生产文件无diff；旧评审目录与`.trae-html-share-packages/`为已有untracked内容，不将后者归为本轮新增或修改。`docs/`继续保持忽略。

## 调查口径

沿菜单→组件→parser/Worker/诊断→详情/导出及测试核对。静态入口已确认不等于真实文件运行验收。缺数据、开关或Dataset前置应单列，不把带条件能力写成普遍可用；没有调用证据的组件不当作已公开功能。

矩阵将功能按稳定ID拆分，记录源码、当前入口、C1目标、行为、风险、验收及审批。子功能也受保护，不只保护一级菜单。新发现的活跃功能必须追加记录，不能把矩阵视为删减白名单。

## 当前真实入口

### 通用

主上传页 `UploadEntry → UploadZone` 当前传入 `multiple=false`；App主路径读取files[0]。UploadZone组件保留multiple选项和批量选取处理。App的追加路径支持已加载HAR后追加NetLog、NetLog证据链内补HAR；不支持追加Go日志联合诊断。同格式追加更新当前来源，不能宣传为任意数量文件合并会话。

保护文件选择/拖拽、格式探测/明确确认、推荐parser模式、采集指引、质量检测、进度/取消、reset/释放、主题、旧Hash、验证记录、主动IP查询。新增UI不得改掉已有multi选项或配对追加路径。

### NetLog

主入口：结论与行动、请求详情、证据链、专家分析、原始事件。

专家九入口：Data Loaded、Events、Source Chain、Timeline、安全与协议、网络状态、性能、A/B、完整报告。

网络状态十一模块：DNS、代理/PAC、Sockets、HTTP/2、QUIC、Cache、Alt-Svc、Stream Pool、Reporting、Modules、Prerender。Timeline单列。各模块的计数、状态行、分页、source/chain跳转与可用的Raw Event Detail均须保留。

Dataset就绪时走完整索引与Worker查询；未就绪保留现有摘要/普通解析路径及“启动Dataset索引”入口，不得用eventsPreview替代全量能力。

Events现有过滤：errorOnly、sourceId、sourceChainId、typeId、typeName、sourceTypeName、phase、开始/结束时间、全文；页码/页大小和会话筛选存储。请求现有过滤：关键词、状态、host、错误码、协议、仅慢；开始时间排序、瀑布/详情和键盘选中。

证据链包括代理、DNS/CIP/SIP/peer分层、失败域名、主动IP查询、联合覆盖/完整报告及双源证据跳转。安全页仍含SSL/TLS与Protocol分析，不得仅保留新的State卡片。

### HAR

主入口：网络问题定位、请求详情、原始证据。请求表除普通过滤外，还有资源类别、主问题筛选、Method、Domain、x-tt-logid存在性、Server-Timing存在性、屏蔽域名、相关请求ID、时间选区；瀑布5种排序、页面marker、扩展列、调整列宽、连续滚动和详情开关。

详情九页：Headers、条件Payload、Preview、Response、Initiator、Timing、Cookies、Network、诊断。保留Query、postData、响应解码/按需读取、缓存来源、Server-Timing、重定向、连接/地址、请求/问题组安全复制及完整本地字段。

恢复链保留正常请求、隔离记录、未恢复片段、原始记录序号/未知标识、质量与覆盖下界。RawEvidenceExplorer保护JSON路径搜索、结构探索、展开/复制和Worker/fallback边界，不误称其有限预览为完整原始文件索引。

### Trace

正式七入口逐项保护：结论、概览、网络、主线程、渲染、交互、全部证据；保留Markdown/JSON、质量、fact/evidence导航和能力缺失提示。

实验链：Workbench→Timeline→Expert Analysis→Cross-source→Stage5→Stage6逐层依赖，所有开关默认仍按原代码。内部能力涵盖会话/视口/事件详情、截图轨、时间选区、CPU FlameChart/CallTree/BottomUp、双源证据、洞察、比较、布局偏移/动画、内存/GPU、自定义查询和临时轨道。原型未展示不能成为停用理由。

### Combined / A-B / Go

Combined是真实双源诊断，不是静态摘要：追加文件、独立观察、时间校准、匹配/覆盖、限制/冲突、完整报告和双方定位。

A/B位于NetLog专家baseline，通过HAR、NetLog、Combined三模式真实加载基线和当前文件、构建差异诊断。不能误称HAR独立页已有专属顶层A/B，也不能因移出专家菜单失去模式或数据槽。

Go四入口：概览、流程、统计、原始日志。流程关键词/worker/level/status及失败过滤，排序和加载更多；原始日志关键词/域名/level/status/时间、上下文与TXT/JSON导出。概览Top预览有完整流程入口，不能只保留Top。

## 新发现：F07是旧方案表述错误

`src/utils/harRepair.ts` 明确声明HarSourcePosition为从0开始的UTF-16字符偏移、charEnd末端不含、不是文件字节；HarRecoveryPanel已向用户标明。NetLog compact index用原始文件byteStart/byteEnd，File.slice按字节读取。

因此不能把HAR charStart重命名成byteStart；统一引用须显式保留unit、basis、区间端点和版本。当前源码保留不同单位是正确行为，旧架构“所有原始偏移必须UTF-8字节”才需要纠正。本轮未发现或宣称HAR坐标现有实现错误。

## 上轮 V3 验证记录（历史，本轮未重跑）

15套、155项通过（4.061s）：hashRouting、featureFlag、traceUploadFeature、harRepair、HarRecoveryPanel、harResponseBodyGateway、rawEvidenceGateway、netlogDatasetIndexer、TraceResultPage、TraceResultPage.facts、combinedBaselineComparator、baselineNetlogUpload、UploadZone、NavigationContext、ipLookupClient。

命令：

```bash
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/utils/hashRouting.test.ts src/workbench/featureFlag.test.ts src/upload/traceUploadFeature.test.ts src/utils/harRepair.test.ts src/components/har/HarRecoveryPanel.test.tsx src/components/har/harResponseBodyGateway.test.ts src/components/raw/rawEvidenceGateway.test.ts src/workers/netlogDatasetIndexer.test.ts src/components/trace/TraceResultPage.test.tsx src/components/trace/TraceResultPage.facts.test.tsx src/diagnosis/shared/combinedBaselineComparator.test.ts src/diagnosis/shared/baselineNetlogUpload.test.ts src/components/netlog/UploadZone.test.tsx src/contexts/NavigationContext.test.ts src/diagnosis/ipEvidence/ipLookupClient.test.ts
```

旧74项源码测试和41项原型检查是历史证据，不计入本轮155项。真实样本、500/800MB性能、真实浏览器UI和新入口可达性未执行，不标PASS。

## 源码证据索引

所有链接固定上述SHA；矩阵逐项指向实现及调用入口。

- [App/来源与导出](https://github.com/WLWadmin/netlog-analyzer-react/blob/5d6f3f1da4931eeff13fb028d069862e8cb86530/src/App.tsx)
- [专家九入口与状态模块](https://github.com/WLWadmin/netlog-analyzer-react/blob/5d6f3f1da4931eeff13fb028d069862e8cb86530/src/components/netlog/ExpertAnalysisTab.tsx)
- [HAR表格](https://github.com/WLWadmin/netlog-analyzer-react/blob/5d6f3f1da4931eeff13fb028d069862e8cb86530/src/components/har/HarRequestTable.tsx)
- [HAR详情](https://github.com/WLWadmin/netlog-analyzer-react/blob/5d6f3f1da4931eeff13fb028d069862e8cb86530/src/components/har/HarRequestDetail.tsx)
- [Trace七入口](https://github.com/WLWadmin/netlog-analyzer-react/blob/5d6f3f1da4931eeff13fb028d069862e8cb86530/src/components/trace/TraceResultPage.tsx)
- [实验阶段开关](https://github.com/WLWadmin/netlog-analyzer-react/blob/5d6f3f1da4931eeff13fb028d069862e8cb86530/src/workbench/featureFlag.ts)
- [旧路由映射](https://github.com/WLWadmin/netlog-analyzer-react/blob/5d6f3f1da4931eeff13fb028d069862e8cb86530/src/utils/hashRouting.ts)
- [HAR坐标类型](https://github.com/WLWadmin/netlog-analyzer-react/blob/5d6f3f1da4931eeff13fb028d069862e8cb86530/src/utils/harRepair.ts)
- [NetLog字节索引](https://github.com/WLWadmin/netlog-analyzer-react/blob/5d6f3f1da4931eeff13fb028d069862e8cb86530/src/workers/netlogDatasetIndexer.ts)
