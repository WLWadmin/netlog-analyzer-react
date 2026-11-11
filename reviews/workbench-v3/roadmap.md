# E · P0–P5实施路线

全部是待授权计划。P5是横向质量门禁，每个阶段都执行当阶段的正确性、功能完整性、隐私、性能及适用真实样本检查。

| 阶段 | 工作单元与依赖 | 验收 | 回退策略 |
|---|---|---|---|
| P0事实与安全 | 独立补丁F01生命周期、F02共享配对、F03自报指标、F04结构化命题、F05导出；F07位置契约同步。先批准相关语义/字段决策 | 先复现后修复；普通/Worker/Dataset；消费者及黄金差异；共享三个门禁；适用真实故障；现有导出格式/专业字段访问保留 | 暂停未通过的补丁；退到此前已验收版本。不能自行关导出、降级结论功能或删原始字段 |
| P1 C1与导航 | 冻结逐项矩阵、审批C1、设计全入口、会话/返回事务、导入与概览；可并行设计但事实仍取原模型 | Feature Parity设计映射、旧Hash全规则、状态恢复；三尺寸/双主题/键盘；不存在目标及过期响应 | 保留原shell/导航；新布局可撤回，不删除原功能。原型批准不等于生产授权 |
| P2 NetLog/HAR | P0语义与P1交互获批；真实请求/生命周期/Events/source/raw联动，全部专家/状态与HAR筛选/九详情/恢复 | 逐行真实可达；小/大、普通/Dataset、跨chunk多字节、正文按需、取消释放；适用真实样本、性能与安全出口 | 回退UI改动，原入口仍可用；修复需各自证据，不能用preview替代全量 |
| P3 Trace | 复用共享导航，保持公开七类和已有实验链，增解释/选区/能力提示 | 七公开结果、全部flag组合/依赖、缺profile/交互/帧、事实引用及Trace两门禁；适用样本 | 仅撤回本次新增代码，保留既有实验开关/实现/默认；不自行关闭原有实验能力 |
| P4 Combined/A-B | 既有关联/比较器演进；依赖可靠时间/引用/语义；验证记录增量 | 同次/错时/重复URL/重定向/弱关联/冲突；三A/B模式、未匹配、标题语义差异；双方入口及数据槽可用 | 撤回未验收增强，保留原真实匹配/比较；不替换为静态摘要或取消比较 |
| P5发布候选 | 汇总所有本次批准范围及每阶段证据，二次自查 | 全矩阵、真实故障、500/800MB、Edge、三尺寸/双主题、无泄漏、旧Hash、可访问性和理解度 | 有关键failed/blocked/not-run不宣布完成；暂停发布候选，生产回退另获授权，不缩减既有能力绕过门禁 |

## Checkpoint

CP0确认版本、功能清单、审批边界和本次实施授权。CP1确认事实契约与可复现测试。CP2确认全功能映射及C1交互。CP3真实双路径联动与安全出口。CP4来源专属/实验/比较验收。CP5 double-check模型、调用方、注释、测试、导出和功能可达性，提供四态报告后由负责人决定发布。

每个工作单元宜独立分支、范围明确的PR；这不是创建PR/Commit/Push授权。测试失败不得删测试或放宽断言。重大模型变化或功能减少另交决策/审批单，未批准排除相关改动。

## 执行验证命令

实施时先重新核对package/README。当前计划至少包括：

```bash
CI=true npm test -- --watchAll=false --runInBand
REACT_APP_ENABLE_TRACE_ANALYSIS=1 npm run build
git diff --check
```

涉及诊断门槛/黄金/性能时运行共享门禁：

```bash
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/diagnosis/shared/diagnosisReleaseGate.test.ts src/diagnosis/shared/diagnosisGoldenCorpusGate.test.ts src/diagnosis/shared/diagnosisPerformanceBaseline.test.ts
```

Trace相关运行：

```bash
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/diagnosis/trace/traceGoldenCorpus.test.ts src/diagnosis/trace/traceDiagnosisReleaseGate.test.ts
npm run diagnosis:real-sample-gate
```

命令在这里是未来要求，不代表本轮运行。真实门禁材料/人工复核缺失时不得标passed。

## 真实样本与性能

匿名矩阵覆盖DNS、TCP、TLS、PAC/代理、网络切换、CORS/status=0、TTFB/5xx/Server-Timing、QUIC/HTTP2 fallback、HAR+NetLog配对/错时、正常异常A/B、Trace完整/缺能力、损坏HAR和500/800MB。每项记录预期/实际、真实引用、人工复核、限制、状态，不泄露外部样本路径。

同设备记录文件大小、事件数、读入/索引耗时、峰值内存、分页/详情p95、取消确认及释放。先建立基线，再审批预算；绝不以截断事件或主线程全量对象化满足预算。

Edge验收只有确认无凭据/钥匙串访问路径才启动；当前安全路径未建立，因此未启动，也不改用Chrome。测试通过、构建成功及静态映射均不能代替真实诊断或UI验收。
