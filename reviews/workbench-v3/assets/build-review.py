"""Rebuild the offline design review and canonical feature matrix; no production edits."""
from pathlib import Path
from collections import Counter
import csv
import html
import json
import re
import hashlib
import subprocess

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parents[1]
SHA = "5d6f3f1da4931eeff13fb028d069862e8cb86530"
BASE = f"https://github.com/WLWadmin/netlog-analyzer-react/blob/{SHA}/"
ROWS = []


def group(prefix, category, names, source, caller, current, target,
          behavior, risk, acceptance, status="正式（依赖输入数据）", change="保留并整合"):
    for number, name in enumerate(names.split(";"), 1):
        ROWS.append({
            "feature_id": f"{prefix}-{number:03}",
            "category": category,
            "name": name,
            "source": source,
            "caller": caller,
            "source_url": BASE + source,
            "caller_url": BASE + caller,
            "current_status": status,
            "current_entry": current + " → " + name,
            "new_entry": target + " → " + name,
            "change_type": change,
            "data_behavior": behavior,
            "risk": risk,
            "acceptance": name + "：" + acceptance,
            "acceptance_state": "not-run",
            "current_static_review": "passed",
            "removal_approval": "不适用；未提出减少能力",
            "prototype_coverage": "旧原型未逐项实现；仅作合成布局参考",
        })


group("G-IN", "通用", "文件选择;拖拽导入;组件multiple选项;主入口单文件语义",
      "src/components/netlog/UploadZone.tsx", "src/components/upload/UploadEntry.tsx",
      "主上传", "文件与准备",
      "保留选择、拖拽及组件批量处理；主入口multiple=false、App读取首文件，不扩大成任意融合",
      "新UI丢失组件multiple或误宣称任意合并",
      "UploadZone/UploadEntry回归；single/multiple各自测试，主入口契约不变")
group("G-INTAKE", "通用", "格式探测;显式格式确认;推荐解析模式;parser模式选择;质量检测;解析进度;解析取消;错误与重试;reset及资源释放",
      "src/upload/parseUploadedInput.ts", "src/App.tsx",
      "App文件接入与解析", "文件与准备",
      "保留显式解析路径、阶段/错误/取消及已有资源生命周期，格式错误不猜fallback",
      "过期结果覆盖新会话、格式错分、取消不释放",
      "fileFormatGateway/parseUploadedInput及Worker生命周期回归；损坏/不支持/reset/取消")
group("G-GUIDE", "通用", "采集指引;格式推荐说明",
      "src/components/upload/UploadGuideLinks.tsx", "src/components/upload/UploadEntry.tsx",
      "上传页", "文件与准备/帮助",
      "保留各来源采集指引及真实格式边界", "重组后失去可发现帮助",
      "上传页和来源帮助链接可达；指引与当前支持能力一致")
group("G-APP", "通用", "深浅主题;HAR后追加NetLog;NetLog证据链补HAR;同格式来源更新;Go不支持联合追加的边界;分析会话切换",
      "src/App.tsx", "src/App.tsx",
      "全局与追加操作", "文件与准备/来源管理",
      "保留实际配对追加/替换行为与主题，不把追加宣传为任意多文件合并",
      "槽位错配、跨会话响应、隐式丢来源",
      "配对/替换/不支持来源/主题回归；双方独立数据可访问")
group("G-ROUTE", "通用", "历史无前缀Hash;NetLog旧Tab别名;HAR diagnosis别名;NetLog嵌套子Tab;HAR现有Tab;Go现有Tab;Trace七Tab及未知Tab默认",
      "src/utils/hashRouting.ts", "src/App.tsx",
      "URL Hash", "历史Hash适配器/对应工作区",
      "保留parse/build及所有旧映射；新增导航不移除已有合法Hash",
      "新路径导致旧链接失效或落错误数据源",
      "hashRouting现有测试+逐个旧别名和合法子Tab可达")
group("G-VERIFY", "通用", "用户验证记录;验证结果与备注;行动建议及回退说明",
      "src/diagnosis/shared/verificationSession.ts", "src/components/shared/NoviceTroubleshootingFlow.tsx",
      "结论与行动", "行动与交付/验证",
      "保留已有记录与结果语义；新字段增量，不把无变化视为排除原因",
      "验证记录丢失或用户反馈成为机器事实",
      "verificationSession回归；改善/无变化/变差/未执行分别可复核")
group("G-IP", "通用", "主动公网IP归属查询;IP查询隐私说明与用户触发",
      "src/components/shared/IpLookupPanel.tsx", "src/components/shared/DnsAndIpEvidencePanel.tsx",
      "DNS/IP证据面板", "证据复核/地址证据",
      "仅用户主动触发既有IP外发例外；不外发文件或凭据",
      "界面加载自动查询或查询内容扩大",
      "ipLookupClient边界测试及UI主动触发；文件内容不出浏览器")
group("N-TOP", "NetLog", "结论与行动;请求详情;证据链;专家分析;原始事件",
      "src/App.tsx", "src/App.tsx",
      "NetLog主Tab", "NetLog工作区/对应阅读层",
      "全部主Tab实际内容保留，导航可整合但能力/直接入口保持",
      "原型省略误作删减范围",
      "全部主入口真实文件可达；关联数据与原入口等价")
group("N-EXPERT", "NetLog", "Data Loaded;Events;Source Chain;Timeline;安全与协议;网络状态;性能;A/B;完整报告",
      "src/components/netlog/ExpertAnalysisTab.tsx", "src/App.tsx",
      "NetLog专家分析", "专家分析/NetLog",
      "保留九个专家入口及其所有活跃子能力；Dataset条件与fallback保持",
      "一级菜单合并后子功能不可达",
      "九入口逐项真实可达；Dataset就绪/未就绪分别验收")
group("N-META", "NetLog", "加载信息与全量事件计数;constants原始元数据;polledData原始元数据;systemInfo原始元数据;clientInfo原始元数据;netLogInfo原始元数据",
      "src/components/netlog/ExpertAnalysisTab.tsx", "src/App.tsx",
      "Data Loaded", "专家分析/NetLog/Data Loaded",
      "保留可用元数据按需详情与缺失说明；计数区分全量和preview",
      "元数据被摘要替代、preview计数当全量",
      "有/无元数据与大文件按需读取，显示完整来源/范围")
group("N-REQ", "NetLog", "关键词搜索;状态筛选;host筛选;错误码筛选;协议筛选;仅慢请求;开始时间排序;请求瀑布;请求详情;键盘选中",
      "src/components/netlog/NetLogRequestList.tsx", "src/App.tsx",
      "NetLog请求详情", "请求与任务/NetLog请求",
      "保留原条件、排序、列表联动与真实request/source定位；新生命周期排序属增强",
      "筛选丢失、同URL错定位、耗时改动影响排序",
      "请求列表回归+F01数值差异；关闭/返回保持原状态")
group("N-EVENT", "NetLog", "errorOnly;sourceId;sourceChainId;typeId;typeName;sourceTypeName;phase;开始时间;结束时间;全文搜索;页码;页大小;会话筛选存储;Raw Event Detail",
      "src/components/netlog/DatasetEventsTab.tsx", "src/components/netlog/ExpertAnalysisTab.tsx",
      "专家Events/Dataset", "证据复核/全量Events",
      "保留全部过滤/分页/存储及Worker按需原始详情；真实eventId与字节定位",
      "失去条件、目标定位清空状态、byte单位错误",
      "DatasetEventsTab/filterState/indexer/query回归；跨chunk多字节及全量页")
group("N-PLAIN", "NetLog", "普通Events查询与展示;BEGIN/END Phase展示（配对dt尚未实现）;原始duration参数;普通Source Chain",
      "src/components/netlog/EventsTab.tsx", "src/components/netlog/ExpertAnalysisTab.tsx",
      "专家Events/Source Chain普通路径", "证据复核/普通事件与Source",
      "保留普通路径及原始字段；配对修复不能取消查询；Source Chain使用既有组件",
      "共享配对改变原字段或普通fallback丢失",
      "普通与Dataset同fixture；dt歧义/孤立/重叠，SourceChainViewer回归")
group("N-GRAPH", "NetLog", "Dataset Source Graph;source依赖查询;链路跳转;Source事件范围",
      "src/components/netlog/DatasetSourceChainViewer.tsx", "src/components/netlog/ExpertAnalysisTab.tsx",
      "专家Source Chain", "证据复核/Source Chain",
      "保留完整Dataset source关系和事件范围，不从preview构图",
      "source.id与eventId混用或图被截断",
      "全量source索引、循环/缺失依赖、真实source/type及事件定位")
for prefix, label, reducer in [
    ("DNS", "DNS", "Dns"), ("PROXY", "代理/PAC", "Proxy"),
    ("SOCKET", "Sockets", "Sockets"), ("HTTP2", "HTTP/2", "Http2"),
    ("QUIC", "QUIC", "Quic"), ("CACHE", "Cache", "Cache"),
    ("ALTSVC", "Alt-Svc", "AltSvc"), ("POOL", "Stream Pool", "StreamPool"),
    ("REPORT", "Reporting", "Reporting"), ("MODULE", "Modules", "Modules"),
    ("PRERENDER", "Prerender", "Prerender"),
]:
    group("N-S-" + prefix, "NetLog",
          label + "状态与汇总;" + label + "明细及分页;" + label + "source/event证据跳转",
          "src/components/netlog/ExpertAnalysisTab.tsx", "src/App.tsx",
          "网络状态/" + label, "专家分析/NetLog/网络状态/" + label,
          "保留该模块所有现有行、字段、计数、分页及已支持跳转；使用netlog" + reducer + "StateReducer",
          "状态仅剩计数、明细缩水或协议内部失败误报请求终态",
          "该reducer+statePaging+UI回归；按模块实际可用跳转验证，不新增未有的跳转",
          status="正式（Dataset就绪且相关事件存在）")
group("N-DNS", "NetLog", "DNS server证据;DNS answer证据;DoH candidate;Host Resolver Cache;DNS任务明细;CIP/SIP/socket peer分层",
      "src/components/netlog/ExpertAnalysisTab.tsx", "src/App.tsx",
      "网络状态/DNS及地址证据", "专家分析/NetLog/DNS与端点",
      "不同地址语义独立保留；地址证据同时复用DnsAndIpEvidencePanel",
      "不同IP角色合并为同一证据，错误跨层归因",
      "DNS reducer与IP证据语义测试；server/answer/DoH/peer分别定位")
group("N-EVID", "NetLog", "代理证据;失败域名;双来源证据跳转;联合覆盖与限制;完整联合报告",
      "src/components/netlog/EvidenceChainTab.tsx", "src/App.tsx",
      "NetLog证据链", "证据复核/NetLog及Combined",
      "保留NetlogProxyEvidencePanel、DNS/IP面板与双方真实对象定位",
      "联合线索被当根因或缺原始来源入口",
      "配对/弱关联/冲突/未匹配，双方ID定位及主动IP边界")
group("N-PROTO", "NetLog", "SSL/TLS分析;Protocol分析;协议统计与错误事实",
      "src/components/netlog/SSLTab.tsx", "src/components/netlog/ExpertAnalysisTab.tsx",
      "专家安全与协议", "专家分析/NetLog/安全与协议",
      "同时保留SSLTab与ProtocolTab全部现有内容，状态面板不能替代",
      "旧协议分析被新State卡片覆盖",
      "SSLTab/ProtocolTab真实可达；内部尝试与最终结果区分")
group("N-PERF", "NetLog", "性能统计与图表;请求耗时分析;指标解释",
      "src/components/netlog/PerformanceTab.tsx", "src/components/netlog/ExpertAnalysisTab.tsx",
      "专家性能", "专家分析/NetLog/性能",
      "保留现有统计和图表，NetlogMetricExplainPanel解释仍可访问",
      "F01/F02改值影响统计而未迁移",
      "新旧指标及排序差异、黄金结果复核，统计仍可回查请求")
group("N-TIME", "NetLog", "Dataset Timeline;时间桶与事件范围;Timeline事件定位",
      "src/components/netlog/ExpertAnalysisTab.tsx", "src/App.tsx",
      "专家Timeline", "专家分析/NetLog/Timeline",
      "保留已有时间桶/范围/查询及事件定位，原时钟不转换为虚构共轴",
      "用演示时间线替代全量索引",
      "Dataset timeline查询与范围、缺事件/跨桶、原始ID回查")
group("N-DATA", "NetLog", "全量事件索引;Worker分页查询;原始字节详情;Dataset存储与释放;启动Dataset索引;streaming摘要fallback;eventsPreview范围说明",
      "src/workers/netlogDatasetIndexer.ts", "src/App.tsx",
      "Dataset及解析生命周期", "文件与准备/索引管理及证据查询",
      "复用Dataset store/query/protocol和已有启动索引路径；preview仅摘要fallback",
      "主线程全量对象化、preview冒充完整、重复读文件",
      "indexer/store/query/lifecycle+500/800MB实测；跨chunk多字节、取消/释放")
group("H-TOP", "HAR", "网络问题定位;请求详情入口;原始证据入口;问题组与相关请求联动;概览与质量",
      "src/components/har/HarResultPage.tsx", "src/App.tsx",
      "HAR主Tab", "HAR工作区/概览、请求、证据",
      "保留实际页面、HarIssueClusterList、来源质量及请求联动",
      "主问题摘要替代完整列表或原证据",
      "HarResultPage/IssueCluster回归；原三入口真实可达")
group("H-FILTER", "HAR", "关键词;资源类别;状态全部/失败/慢;主问题全部/慢/TTFB/Queueing/DNS/TLS/status=0/netError/5xx/4xx;Method;Domain;x-tt-logid存在性;Server-Timing存在性;屏蔽域名;相关请求ID;时间选区;条件标签逐项清除",
      "src/components/har/HarRequestTable.tsx", "src/components/har/HarResultPage.tsx",
      "HAR请求表工具栏", "请求与任务/HAR/完整筛选",
      "保留每一条件原选项、组合及状态，不用统一搜索替代",
      "次级条件丢失或证据跳转永久清空",
      "HarRequestTable/filterState回归；每选项与组合逐个对照，返回恢复")
group("H-SORT", "HAR", "Waterfall Start Time排序;Waterfall Response Time排序;Waterfall End Time排序;Waterfall Total Duration排序;Waterfall Latency排序;表格现有列排序",
      "src/components/har/HarRequestTable.tsx", "src/components/har/HarResultPage.tsx",
      "HAR请求表排序", "请求与任务/HAR/排序",
      "全部原排序保留，missing数值语义不变，不能只留下总耗时",
      "新控件合并丢排序或Latency含义被改",
      "五瀑布排序及现有sorter逐项对照；相同/缺失值稳定")
group("H-COL", "HAR", "Request #列;Method列;Path列;URL列;Scheme列;Remote Address列;Initiator列;Priority列;Connection列;Request Cookies列;Set-Cookies列;Cache Source列;Resource Size列;原有默认列;列宽调整;扩展列选择",
      "src/components/har/HarRequestTable.tsx", "src/components/har/HarResultPage.tsx",
      "HAR列设置", "请求与任务/HAR/列设置",
      "保留所有扩展/默认字段与调整列宽能力；长字段完整本地访问",
      "新布局固定列、大小语义混淆或字段不可达",
      "每列显示与选项、ResizableHarHeaderCell回归；文件/传输/资源大小分别")
group("H-TABLE", "HAR", "连续滚动与加载;瀑布单元格;页面marker;详情开关;时间概览联动",
      "src/components/har/HarRequestTable.tsx", "src/components/har/HarResultPage.tsx",
      "HAR请求表", "请求与任务/HAR",
      "保留列表/瀑布/时间概览/详情及原加载策略",
      "静态请求数组替代真实查询",
      "大请求数量、滚动/时间选区/关闭恢复，HarTimelineOverview回归")
group("H-DETAIL", "HAR", "Headers;条件Payload;Preview;Response;Initiator;Timing;Cookies;Network;诊断",
      "src/components/har/HarRequestDetail.tsx", "src/components/har/HarRequestTable.tsx",
      "HAR请求详情Tab", "请求与任务/HAR/详情",
      "保留九类详情及各自数据前置；Payload无数据条件保持",
      "精简详情删字段或把缺失显示零",
      "HarRequestDetail回归；九类有/无数据及完整本地字段")
group("H-FIELDS", "HAR", "Query参数;postData;HTTP状态;浏览器非标准错误/netError;缓存来源;Server-Timing;重定向;连接与地址;原始HAR请求字段;请求安全复制;问题组安全复制",
      "src/components/har/HarRequestDetail.tsx", "src/components/har/HarRequestTable.tsx",
      "HAR详情及复制", "请求与任务/HAR/详情及交付",
      "保留本地完整专业字段与buildHarRequestCopyText/buildHarClusterCopyText；分享投影另审",
      "status=0伪归因、Server-Timing求和、复制与下载不一致",
      "parseHarInput/fromHar/copyText回归；缺dur、失败扩展字段及敏感字段")
group("H-BODY", "HAR", "响应解码;大响应体按需读取;响应读取状态与失败说明",
      "src/components/har/harResponseBodyGateway.ts", "src/components/har/HarRequestDetail.tsx",
      "HAR Preview/Response", "请求与任务/HAR/响应内容",
      "保留decodeHarResponseBody、按需gateway和Worker/fallback边界，过滤后不错位",
      "正文与请求索引错位或提前读完整正文",
      "harResponseBodyGateway/decode回归；损坏/过滤/过期/reset/大正文")
group("H-REC", "HAR", "损坏HAR局部恢复;正常恢复请求;隔离记录;未恢复片段;原始记录序号及未知标识;恢复质量;解析覆盖下界;UTF-16原文位置",
      "src/utils/harRepair.ts", "src/components/har/HarRecoveryPanel.tsx",
      "HAR恢复面板", "文件质量/HAR恢复与证据",
      "保留恢复结果、覆盖下界与原始位置；charEnd末端不含，未知不伪造",
      "修复后索引错位、恢复范围隐藏、字符当字节",
      "harRepair/HarRecoveryPanel回归；emoji、多字节、隔离与未恢复片段")
group("RAW", "通用", "JSON路径搜索;原始结构探索;展开与字段复制;Raw Worker/fallback边界;原始预览范围说明",
      "src/components/raw/RawEvidenceExplorer.tsx", "src/App.tsx",
      "原始证据", "证据复核/Raw",
      "保留Raw与DatasetRawEvidenceExplorer/gateway现有行为；有限预览如实说明",
      "误称完整原文件索引或用预览替代Dataset Events",
      "rawEvidenceGateway回归；路径/展开/复制、大小边界与来源身份")
for index, (name, filename) in enumerate([
    ("结论", "Conclusion"), ("概览", "Overview"), ("网络", "Network"),
    ("主线程", "MainThread"), ("渲染", "Rendering"),
    ("交互", "Interactions"), ("全部证据", "Evidence"),
], 1):
    group(f"T-PUB{index}", "Trace", name,
          f"src/components/trace/tabs/Trace{filename}Tab.tsx", "src/components/trace/TraceResultPage.tsx",
          "Trace正式结果", "Trace工作区/正式七视图",
          "保持当前公开视图全部结果、聚合、选择和fact/evidence跳转",
          "实验工作台取代正式结果或缺能力写成0",
          "TraceResultPage及facts/Tab回归；有/缺事件能力及真实引用",
          status="正式（Trace分析开关未显式关闭且数据支持）")
group("T-BASE", "Trace", "Trace解析与Worker;质量及能力缺失提示;fact/evidence导航;Markdown导出;JSON导出",
      "src/components/trace/TraceResultPage.tsx", "src/App.tsx",
      "Trace结果页", "Trace工作区/文件质量、证据、交付",
      "保留已有Worker事实与导出两格式；公开分析开关与内部flag分开",
      "缺profile/帧/交互误展示0、导出格式被替换",
      "TraceResultPage/traceUploadFeature+两Trace门禁及缺能力真实样本")
group("T-FLAG", "Trace", "Workbench开关;Timeline开关;Expert Analysis开关;Cross-source开关;Stage5开关;Stage6开关",
      "src/workbench/featureFlag.ts", "src/components/trace/TraceWorkbenchInternalPanel.tsx",
      "REACT_APP_ENABLE_TRACE_*", "原有实验flag链/内部工作台",
      "Workbench→Timeline→Expert→Cross→Stage5→Stage6逐层依赖，均需值1；保持原默认与实现",
      "上级关闭而下级误开放、原flag失效、实验误当公开",
      "featureFlag全部依赖组合+内部/Timeline组件条件路径",
      status="实验（保持原构建开关）")
group("T-WB", "Trace", "内部会话加载与状态;视口操作;时间线轨道;截图轨;时间选区;事件详情",
      "src/components/trace/workbench/TraceTimelineWorkbench.tsx", "src/components/trace/TraceWorkbenchInternalPanel.tsx",
      "内部Workbench/Timeline", "专家分析/Trace/原内部Timeline",
      "保留session/revision/查询、截图与交互；Workbench基础状态在InternalPanel，Timeline需W+T",
      "关闭详情清选区、过期响应、原内部路径消失",
      "Workbench/Timeline回归；会话切换、视口、选区、关闭/Esc",
      status="实验（Workbench；Timeline细项另需Timeline）")
group("T-CPU", "Trace", "CPU FlameChart;CPU CallTree;CPU BottomUp",
      "src/components/trace/workbench/ExpertAnalysisDrawer.tsx", "src/components/trace/workbench/TraceTimelineWorkbench.tsx",
      "内部Expert Analysis", "专家分析/Trace/CPU",
      "保持当前采样分析与缺profile边界；不等同精确执行时间",
      "高级CPU分析被简化主线程卡片替代",
      "ExpertAnalysisDrawer/Timeline回归；采样窗口、缺profile及原三分析",
      status="实验（Workbench+Timeline+Expert）")
group("T-CROSS", "Trace", "Cross-source加载与证据;Cross-source证据图",
      "src/components/trace/workbench/CrossSourcePanel.tsx", "src/components/trace/workbench/TraceTimelineWorkbench.tsx",
      "内部Cross-source", "专家分析/Trace/原双源工作区",
      "保留CrossSourcePanel及CrossSourceEvidenceGraph原能力与开关，不任意融时间轴",
      "暂缓公开被误作删除内部双源实现",
      "Cross-source客户端/图/Timeline回归；来源时钟、缺失及弱关联",
      status="实验（Workbench+Timeline+Expert+Cross-source）")
group("T-ST5", "Trace", "Insight洞察导航;Trace比较",
      "src/components/trace/workbench/InsightNavigator.tsx", "src/components/trace/workbench/TraceTimelineWorkbench.tsx",
      "内部Stage5", "专家分析/Trace/洞察与比较",
      "保留InsightNavigator和TraceComparisonPanel原查询/加载能力",
      "真实比较被静态卡片替代",
      "洞察/比较与Stage5依赖、同类操作窗口和真实对象",
      status="实验（原flag链至Stage5）")
for prefix, name, filename in [
    ("LAYOUT", "布局偏移", "LayoutShiftPanel"), ("ANIM", "动画合成", "AnimationCompositionPanel"),
    ("MEM", "内存趋势", "MemoryTrendPanel"), ("GPU", "GPU/Raster", "GpuRasterPanel"),
    ("QUERY", "自定义查询", "CustomQueryPanel"), ("TRACK", "临时轨道", "TrackPluginPanel"),
]:
    group("T-ST6-" + prefix, "Trace", name,
          f"src/components/trace/workbench/{filename}.tsx", "src/components/trace/workbench/TraceTimelineWorkbench.tsx",
          "内部Stage6", "专家分析/Trace/高级主题",
          "保留原Panel的所有查询、条件、数据与操作，不因原型未展示停用",
          "菜单合并丢高级主题或原开关",
          "各Panel回归+Stage6链+有/缺相关事件，临时资源释放",
          status="实验（原flag链至Stage6）")
group("C-PAIR", "Combined", "HAR+NetLog联合诊断;双方独立原始来源;时间校准;匹配依据;覆盖与未匹配;支持证据;冲突与限制;完整报告;双方请求/source/event定位",
      "src/components/netlog/EvidenceChainTab.tsx", "src/App.tsx",
      "NetLog证据链/追加配对", "联合与比较/Combined",
      "保留真实关联诊断及双方独立对象；弱/错时/冲突不升级根因",
      "独立证据被融合摘要覆盖、原数据槽丢失",
      "Combined规则/导航真实配对、错时、重复URL、重定向及未匹配")
group("AB", "A/B", "HAR对比模式;NetLog对比模式;Combined对比模式;基线与当前文件加载;各模式数据槽;真实差异诊断;差异证据回查;加载错误及状态",
      "src/components/shared/BaselineCompareTab.tsx", "src/components/netlog/ExpertAnalysisTab.tsx",
      "NetLog专家baseline", "联合与比较/A-B",
      "保留三个模式与真实比较器；不是HAR独立页已有专属顶层A/B",
      "用两张卡片替代真实比较、模式丢失、差异当根因",
      "baselineHar/NetlogUpload及combinedBaselineComparator回归；标题语义与类别变化")
group("L-TOP", "Go日志", "概览;流程;统计;原始日志;解析覆盖说明;Top预览到完整流程",
      "src/components/log/LogResultPage.tsx", "src/App.tsx",
      "Go四Tab", "Go工作区/原四类内容",
      "保留专用识别/完整流程与统计，不只留下Top预览",
      "统一shell丢原专用能力",
      "四Tab及覆盖面板真实日志回归；Top能进入完整流程")
group("L-FLOW", "Go日志", "流程分组;流程关键词;worker筛选;level筛选;status筛选;仅失败;失败/重试/网络错误;流程排序;加载更多",
      "src/components/log/LogFlowGroups.tsx", "src/components/log/LogResultPage.tsx",
      "Go流程", "请求与任务/Go流程",
      "保留原流程、条件、错误与分页加载",
      "通用请求模型替代服务流程或丢失败字段",
      "流程各条件/组合、重试与错误、排序、更多记录")
group("L-PERF", "Go日志", "流程性能统计;日志统计图表",
      "src/components/log/LogPerformanceTab.tsx", "src/components/log/LogResultPage.tsx",
      "Go统计", "专家分析/Go统计",
      "同时保留LogPerformanceTab/LogStatsCharts实际统计与图表",
      "仅保留汇总卡片",
      "完整统计可达，样本计数/耗时与流程一致")
group("L-RAW", "Go日志", "原日志关键词;域名筛选;level筛选;status筛选;时间筛选;原始日志上下文;TXT导出;JSON导出",
      "src/components/log/LogRawList.tsx", "src/components/log/LogResultPage.tsx",
      "Go原始日志", "证据复核/Go原日志及交付",
      "保留原检索、LogRawContextModal及exportLogEntries两格式",
      "统一Raw删日志专属条件/上下文或出口",
      "每条件/上下文/TXT与JSON回归；安全策略变更另审")
group("X-OUT", "通用", "App JSON导出;App CSV导出;完整诊断报告出口;摘要导出及安全分享",
      "src/App.tsx", "src/App.tsx",
      "App与报告操作", "行动与交付/全部既有格式",
      "保留现有格式与完整本地证据；统一DTO/预览/下载方案待授权",
      "安全修复静默移除格式或字段能力",
      "逐出口消费者、CSV转义/公式、允许字段及稳定跨来源别名")
group("N-ENDPOINT", "NetLog", "Endpoint Evidence端点来源与角色",
      "src/components/shared/DnsAndIpEvidencePanel.tsx", "src/components/netlog/EvidenceChainTab.tsx",
      "NetLog证据链/DNS与IP", "证据复核/端点证据",
      "保留现有端点来源、DNS与连接地址角色及原证据引用，不因同为IP混并",
      "peer/CIP/SIP与DNS server/answer错归同类",
      "端点模型、证据导航及真实source字段对应，主动查询仍独立")
group("T-INTAKE", "Trace", "公开分析开关与接受扩展名;压缩Trace输入",
      "src/upload/traceUploadFeature.ts", "src/components/upload/UploadEntry.tsx",
      "上传Trace格式控制", "文件与准备/Trace",
      "公开开关REACT_APP_ENABLE_TRACE_ANALYSIS仅值0关闭；保留trace/json2及已有gz入口，内部flag独立",
      "实验flag替代公开开关或接受扩展名丢失",
      "traceUploadFeature及压缩解析回归；公开未关闭时保持全部既有扩展名")

# Cite the concrete subcomponent when a grouped capability has its own implementation.
SOURCE_OVERRIDES = {
    "G-GUIDE-002": "src/components/upload/FormatRecommendation.tsx",
    "G-INTAKE-004": "src/components/upload/ParserModeSelect.tsx",
    "G-INTAKE-006": "src/components/upload/AnalysisProgressPanel.tsx",
    "N-PLAIN-004": "src/components/netlog/SourceChainViewer.tsx",
    "N-PROTO-002": "src/components/netlog/ProtocolTab.tsx",
    "N-PROTO-003": "src/components/netlog/ProtocolTab.tsx",
    "T-CPU-001": "src/components/trace/workbench/FlameChartCanvas.tsx",
    "T-ST5-002": "src/components/trace/workbench/TraceComparisonPanel.tsx",
    "L-PERF-002": "src/components/log/LogStatsCharts.tsx",
}
for row in ROWS:
    if row["feature_id"] in SOURCE_OVERRIDES:
        row["source"] = SOURCE_OVERRIDES[row["feature_id"]]
        row["source_url"] = BASE + row["source"]

# Stable protection IDs are frozen independently of labels and classification.
ID_SET_SHA256 = "bd5e351b64e584eef0260f078d436280bf9bf4bca06a52eb0c69f47bbe86dfd0"
assert hashlib.sha256("\n".join(sorted(r["feature_id"] for r in ROWS)).encode()).hexdigest() == ID_SET_SHA256
METHODS = {
    "user-facing": "端到端操作：旧/新入口执行同一任务，核对实际结果、错误/取消/返回状态；可见按钮不等于任务完成",
    "expert-facing": "专家操作：对同一真实对象执行查询/筛选/排序/定位/详情，核对全量范围、专业字段与原始证据；非所有内部细项都变菜单",
    "internal-capability": "数据及契约：fixture字段对照、普通/Worker/Dataset适用路径、协议/索引/生命周期回归；不要求可见菜单",
    "experimental": "Flag验收：默认值、上级依赖、开/关组合、原入口/查询行为、资源释放；未满足flag不算功能丢失，原flag失效算回退",
    "compatibility-contract": "兼容验收：旧文件/格式/Hash/状态/导出消费者与新路径对照，合法旧输入及缺失/错误语义保留；破坏性变更单独审批",
}
INTERNAL_PREFIXES = ("N-DATA-001", "N-DATA-002", "N-DATA-003", "N-DATA-004", "N-DATA-006", "H-BODY-001", "H-BODY-002", "H-REC-001", "T-BASE-001")
CONTRACT_IDS = {
    "G-IN-003", "G-IN-004", "G-APP-004", "G-APP-005", "G-APP-006",
    "G-INTAKE-001", "G-INTAKE-009", "G-IP-002", "N-EVENT-013",
    "H-REC-005", "H-REC-008", "T-BASE-004", "T-BASE-005",
    "L-RAW-007", "L-RAW-008", "T-INTAKE-001", "T-INTAKE-002",
}
FIX_IDS = {"X-OUT-001", "X-OUT-002", "H-FIELDS-006", "N-REQ-008", "N-REQ-009",
           "N-PERF-002", "N-EVENT-013", "N-EVENT-014"}
ENHANCE_IDS = {"N-PLAIN-002", "G-VERIFY-001", "G-VERIFY-003",
               "C-PAIR-003", "C-PAIR-004", "C-PAIR-006", "C-PAIR-007", "AB-006", "AB-007"}
UNCHANGED_IDS = {"G-IN-001", "G-IN-002", "G-GUIDE-001", "G-GUIDE-002", "G-APP-001", "G-IP-001"}
for row in ROWS:
    fid = row["feature_id"]
    if row["current_status"].startswith("实验"):
        kind = "experimental"
    elif fid.startswith(("G-ROUTE-", "X-OUT-")) or fid in CONTRACT_IDS:
        kind = "compatibility-contract"
    elif fid.startswith(INTERNAL_PREFIXES):
        kind = "internal-capability"
    elif fid.startswith(("N-", "H-", "RAW-", "AB-", "C-PAIR-", "L-RAW-", "L-PERF-")) and not fid.startswith(("N-TOP-", "H-TOP-")):
        kind = "expert-facing"
    else:
        kind = "user-facing"
    row["classification"] = kind
    row["acceptance_method"] = METHODS[kind]
    if fid in FIX_IDS:
        row["change_type"] = "错误修复"
    elif fid in ENHANCE_IDS:
        row["change_type"] = "增强"
    elif kind in ("internal-capability", "compatibility-contract"):
        row["change_type"] = "内部兼容"
    elif kind == "experimental" or fid in UNCHANGED_IDS:
        row["change_type"] = "原样保留"
    else:
        row["change_type"] = "菜单重组"
    row["target_kind"] = (
        "内部服务（无独立菜单要求）" if kind == "internal-capability" else
        "兼容契约（无独立菜单要求；保留已有可见操作入口）" if kind == "compatibility-contract" else
        "保持原条件的操作入口"
    )
    if kind == "internal-capability":
        row["new_entry"] = "C1复用原内部实现/兼容适配 → " + row["name"]
    elif kind == "compatibility-contract":
        row["new_entry"] = "原有操作/适配器履行兼容契约 → " + row["name"]
    if fid == "N-PLAIN-002":
        row["data_behavior"] = "现有仅Phase展示，无可靠配对dt；保留Phase与原始duration，计划增强共享配对、未配对与歧义事实"
        row["acceptance"] = "Phase/原始duration不变；新增共享配对逐实例及歧义fixture、跨chunk普通/Worker/Dataset一致"

DOCS = [
    ("closure", "review-closure.md", "Review R1–R5整改"),
    ("p0", "p0-work-units.md", "P0工作单元与验收契约"),
    ("gate", "parity-gate.md", "分类功能完整性Gate"),
    ("readiness", "p0-decisions.md", "负责人决策与阻塞"),
    ("reproduce", "reproducibility.md", "可复现交付与检查"),
    ("audit", "current-review.md", "A · 当前完整性清单"),
    ("matrix", "matrix-notes.md", "B · 新旧功能映射"),
    ("architecture", "architecture.md", "C · 技术可靠性"),
    ("prd", "prd-ui.md", "D · PRD与UI/UX"),
    ("roadmap", "roadmap.md", "E · P0–P5路线"),
    ("approvals", "approvals.md", "F · 审批与决策"),
    ("validation", "validation.md", "G · 风险与验收"),
]


def inline(text):
    text = html.escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    return re.sub(r"\[([^\]]+)\]\(([^)]+)\)",
                  lambda m: f'<a href="{m[2]}">{m[1]}</a>', text)


def markdown(text):
    lines, out, index = text.splitlines(), [], 0
    while index < len(lines):
        line = lines[index]
        if line.startswith("```"):
            block = []
            index += 1
            while index < len(lines) and not lines[index].startswith("```"):
                block.append(lines[index])
                index += 1
            out.append("<pre><code>" + html.escape("\n".join(block)) + "</code></pre>")
        elif line.startswith("|"):
            table = []
            while index < len(lines) and lines[index].startswith("|"):
                cells = lines[index].strip("|").split("|")
                if not all(re.fullmatch(r"\s*:?-+:?\s*", c) for c in cells):
                    table.append(cells)
                index += 1
            out.append('<div class="table-wrap"><table><thead><tr>' +
                       "".join("<th>" + inline(c.strip()) + "</th>" for c in table[0]) +
                       "</tr></thead><tbody>" +
                       "".join("<tr>" + "".join("<td>" + inline(c.strip()) + "</td>" for c in row) +
                               "</tr>" for row in table[1:]) + "</tbody></table></div>")
            continue
        elif re.match(r"^#{1,6} ", line):
            level = min(6, len(line.split(" ")[0]) + 1)
            if level > 2:
                out.append(f"<h{level}>" + inline(line.lstrip("# ")) + f"</h{level}>")
        elif re.match(r"^(- |\d+\. )", line):
            out.append('<p class="list-line">' + inline(line) + "</p>")
        elif line.strip():
            out.append("<p>" + inline(line) + "</p>")
        index += 1
    return "\n".join(out)


def head(title):
    return ('<!-- Generated by Trae Work -->\n<!doctype html><html lang="zh-CN" data-theme="light">'
            '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{title}</title><link rel="stylesheet" href="assets/report.css"></head><body>')


def footer():
    return (''
            '<script src="assets/report.js"></script></body></html>\n')


def build():
    for row in ROWS:
        for field in ("source", "caller"):
            assert (REPO / row[field]).is_file(), row[field]
    assert len({row["feature_id"] for row in ROWS}) == len(ROWS)
    counts = Counter(row["category"] for row in ROWS)
    payload = {"schema_version": 2, "baseline_sha": SHA, "phase": "review-closure",
               "id_set_sha256": ID_SET_SHA256,
               "proposed_removals": "NONE", "runtime_parity_gate": "not-run",
               "features": ROWS}
    (ROOT / "feature-matrix.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    with (ROOT / "feature-matrix.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(ROWS[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(ROWS)
    def baseline_source(path):
        return subprocess.run(["git", "show", f"{SHA}:{path}"], cwd=REPO,
                              check=True, capture_output=True, text=True).stdout
    hash_source = baseline_source("src/utils/hashRouting.ts")
    flag_source = baseline_source("src/workbench/featureFlag.ts")
    upload_flag_source = baseline_source("src/upload/traceUploadFeature.ts")
    (ROOT / "route-and-flags.md").write_text(
        "# 历史路由与实验开关基线\n\n固定SHA：" + SHA +
        "\n\n以下完整摘录本轮核对的现有适配规则，所有已支持Hash保持兼容。"
        "新UI通过适配器转到矩阵对应阅读层，不能删除旧别名。空/未知处理继续原语义。"
        "实验开关逐层依赖不变，公开Trace入口另由traceUploadFeature控制。\n\n"
        "## hashRouting完整规则\n\n```typescript\n" + hash_source +
        "\n```\n\n## featureFlag完整规则\n\n```typescript\n" + flag_source +
        "\n```\n\n## 公开Trace上传开关\n\n```typescript\n" + upload_flag_source + "\n```\n")
    notes = (
        "# B · 新旧功能映射矩阵\n\n" + f"当前登记{len(ROWS)}项保护单元："
        + "、".join(f"{k} {v}项" for k, v in counts.items()) +
        "。单元按菜单、条件、字段组、数据及交互拆分，数量不是产品功能总数，也不是删减白名单。"
        "复合字段组中的全部原选项均受保护；新发现的实际能力继续追加。\n\n"
        "[打开可检索完整矩阵](feature-matrix.html) · [JSON机器清单](feature-matrix.json) · "
        "[CSV审阅版](feature-matrix.csv) · [历史路由与开关完整基线](route-and-flags.md)\n\n"
        "每行记录稳定ID、名称、实现/调用入口及固定SHA链接、现有状态/入口、C1目标、变化类型、"
        "数据行为、风险、验收、四态、删除审批及原型覆盖。ID后续只追加，不按排序重编号。\n\n"
        "current_static_review=passed只表示本轮完成静态核对。acceptance_state=not-run是未来新入口/行为验收，"
        "不将现有155项测试平均赋给所有功能。旧原型未逐项实现，其省略不是批准删除。\n\n"
        "Feature Parity设计映射已建立；运行时Gate=not-run，因为生产改造尚未授权实施。"
        "任何正式入口、实验开关、查询/排序、导出格式、全量数据或历史Hash未经批准减少，Gate=failed。"
        "原本只有有限预览的Raw入口保留实际范围，不虚称完整索引；完整Dataset不能被preview替代。\n\n"
        "source是功能主要实现位置，caller为直接使用组件或上层集成入口；多文件能力在行为说明列出协作者。"
        "状态模块只保护原本已支持的动作，不因通用描述宣称每行都有相同跳转。\n\n"
        "Review分类："+ "、".join(f"{k} {v}项" for k,v in Counter(r["classification"] for r in ROWS).items()) +
        "。每行新增classification、acceptance_method、target_kind；内部能力与契约没有独立菜单要求。"
        "变化类型是拟定实施性质，不是已经执行的改动；没有拟删除/降级项。"
        "311项ID集合SHA256："+ID_SET_SHA256+"，修改名称事实不重编号。\n")
    (ROOT / "matrix-notes.md").write_text(notes)
    table_rows = []
    detail_fields = [
        ("classification", "保护分类"), ("acceptance_method", "分类验收方法"),
        ("target_kind", "入口性质"),
        ("current_status", "当前状态"), ("current_entry", "当前入口"),
        ("new_entry", "C1新入口"), ("change_type", "变化类型"),
        ("data_behavior", "数据与行为"), ("risk", "风险"),
        ("acceptance", "验收要求"), ("acceptance_state", "新入口验收"),
        ("current_static_review", "当前静态复核"), ("removal_approval", "删除审批"),
        ("prototype_coverage", "原型覆盖"),
    ]
    for row in ROWS:
        details = "".join("<dt>" + label + "</dt><dd>" + html.escape(row[key]) + "</dd>"
                          for key, label in detail_fields)
        details += (f'<dt>实现</dt><dd><a href="{row["source_url"]}">{row["source"]}</a></dd>'
                    f'<dt>调用/集成</dt><dd><a href="{row["caller_url"]}">{row["caller"]}</a></dd>')
        search = html.escape(" ".join(str(v) for v in row.values()), quote=True)
        table_rows.append(
            f'<tr data-category="{html.escape(row["category"])}" data-kind="{row["classification"]}" data-search="{search}">'
            f'<td>{row["feature_id"]}</td><td>{row["category"]}</td>'
            f'<td><details><summary>{html.escape(row["name"])}</summary><dl>{details}</dl></details></td>'
            f'<td>{html.escape(row["new_entry"])}</td><td><span class="status">not-run</span></td></tr>')
    options = "".join(f'<option>{html.escape(c)}</option>' for c in counts)
    matrix = (
        head("功能完整性 · 新旧映射矩阵") +
        '<main><p><a href="index.html">← 完整评审包</a></p>'
        f'<h1>新旧功能映射 · {len(ROWS)}项保护单元</h1>'
        '<p>静态设计覆盖不等于运行时验收。展开每行查看源码、入口、行为、风险与审批。</p>'
        '<p><strong>PROPOSED_REMOVALS: NONE · Runtime Feature Parity Gate: not-run</strong></p>'
        '<div class="filters"><label>检索 <input id="matrix-search" type="search" placeholder="名称、ID、源码、字段或风险"></label>'
        f'<label>来源 <select id="matrix-category"><option value="">全部来源</option>{options}</select></label>'
        '<label>保护分类 <select id="matrix-kind"><option value="">全部分类</option>' +
        "".join(f"<option>{kind}</option>" for kind in METHODS) + '</select></label>'
        '<label>排序 <select id="matrix-sort"><option value="id">Feature ID</option><option value="name">功能名称</option>'
        '<option value="category">来源</option></select></label><button id="matrix-reset">清除</button>'
        '<button class="theme-toggle">切换主题</button><output id="matrix-count" aria-live="polite"></output></div>'
        '<p><a href="feature-matrix.csv">CSV</a> · <a href="feature-matrix.json">JSON</a> · '
        '<a href="route-and-flags.md">历史路由与开关</a></p>'
        '<div class="table-wrap"><table id="matrix-table"><thead><tr><th>Feature ID</th><th>来源</th>'
        '<th>功能与详情</th><th>C1入口</th><th>新验收</th></tr></thead><tbody>' +
        "".join(table_rows) + '</tbody></table></div><p id="matrix-empty" hidden>没有匹配项，可清除条件。</p>'
        '<p>每个现有专业细项仍受保护；不要将矩阵登记粒度当作删减范围。</p></main>' + footer())
    (ROOT / "feature-matrix.html").write_text(matrix)
    nav = "".join(f'<a href="#{key}">{label}</a>' for key, _, label in DOCS)
    sections = "".join(
        f'<section id="{key}"><h2>{label}</h2>{markdown((ROOT / file).read_text())}</section>'
        for key, file, label in DOCS)
    report = (
        head("浏览器诊断工作台 · 功能完整性与升级复核") +
        '<div class="layout"><aside><strong>V3 Review · 定向收口</strong><p>2026-11-11 · P0准备</p>' + nav +
        '<a href="feature-matrix.html">检索完整功能矩阵 ↗</a><button class="theme-toggle">切换主题</button></aside>'
        '<article><header><p class="kicker">NETLOG ANALYZER REACT / REVIEW</p>'
        '<h1>功能完整保留，诊断事实优先</h1>'
        '<p>方向C · C1推荐基线 · 全入口映射 · 分阶段证据门禁</p>'
        f'<p class="muted">master · {SHA} · 当前技术栈保留 · 原始文件本地解析</p></header>'
        '<div class="callout"><strong>本轮决策依据</strong><p>'
        f'{len(ROWS)}项保护单元保留并分类；15套155项是上轮记录，不是本轮独立复验。'
        '真实诊断、500/800MB、新UI运行时功能完整性和Edge验收尚未完成。</p>'
        '<p>没有建议删除或降级功能。生产代码、实施PR、合并和部署均未获授权。</p></div>'
        '<div class="cards"><a href="feature-matrix.html"><strong>逐项功能矩阵</strong><span>入口 · 行为 · 风险 · 验收</span></a>'
        '<a href="#architecture"><strong>F01–F07契约</strong><span>双路径 · 结果差异 · 坐标</span></a>'
        '<a href="#approvals"><strong>负责人决策</strong><span>D01–D07 · 无删除提案</span></a></div>' +
        sections + '<section><h2>历史路由及实验开关完整记录</h2>' +
        markdown((ROOT / "route-and-flags.md").read_text()) +
        '</section><footer><p><a href="https://github.com/WLWadmin/netlog-analyzer-react/tree/' + SHA +
        '">固定版本源码</a> · <a href="feature-matrix.json">机器清单</a> · '
        '<a href="feature-matrix.csv">CSV</a></p>'
        '<p>本包整合原评审成果并修订偏移单位、功能保护及原型范围表述。历史验证单列；以本次兼容约束为准。</p>'
        '</footer></article></div>' + footer())
    (ROOT / "index.html").write_text(report)
    print(json.dumps({"features": len(ROWS), "categories": dict(counts),
                      "source_paths_exist": True, "unique_ids": True}, ensure_ascii=False))


if __name__ == "__main__":
    build()
