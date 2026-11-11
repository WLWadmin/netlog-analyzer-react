# V3 Review R1–R5定向整改对照

范围：只修明确Review问题并整理P0，不重做总体规划。基线SHA仍为`5d6f3f1da4931eeff13fb028d069862e8cb86530`，生产文件无改动；历史原型HTML/CSS/JS为设计交付，不属于生产应用。

| Review | 原问题 | 定向整改 | 证据/验收边界 |
|---|---|---|---|
| R1 | 把EventsTab阶段展示称为已有配对逻辑 | 技术架构改为Phase/原duration/无可靠配对；N-PLAIN-002保留ID纠正名称；列真实局部算法、调用及测试边界 | EventsTab extractErrorInfo/Phase；requestAccumulator端点/buildTimeline；requestLifecycle min/max与fromNetlogLifecycle调用。共享配对仍待P0-C |
| R2 | 311项同一变化分类、都像菜单 | 保留全部ID，新增五类classification、target_kind和acceptance_method；变化类型按原样/重组/增强/修复/内部兼容分别标记，无拟删除 | 固定ID集合hash、311行及CSV/JSON一致；每行可检索分类，内部能力/兼容契约不要求独立菜单 |
| R3 | 缺ID回第一条、占位边界、耗时无起点/重叠/未知 | req不fallback，选择/跳转/raw均校验缺目标且保留原状态；全页历史演示/矩阵提示；条形按start/end/origin定位，重叠独立行，未知斜纹 | JSDOM定向交互/几何数值检查；只证明合成原型DOM，不证明真实UI/浏览器像素 |
| R4 | 静态覆盖与运行时Gate混用 | 独立Design/Implementation/Release Gate，五分类方法和每PR影响ID/验证/回退契约 | 新C1运行时Gate=not-run；311映射/源码存在/历史155测试/build不能赋予passed |
| R5 | 可复现文件及验证脚本不足 | 保留原JSON/CSV/route/assets/build脚本，补可重跑验证脚本与本轮实际检查记录 | 命令/真实路径/状态见reproducibility.md与review-checks.json；历史155不计本轮外部独立复验 |

## 交付入口

- [定向修订完整阅读包](index.html)、[分类矩阵](feature-matrix.html)、[技术架构](architecture.md)。
- [P0工作单元](p0-work-units.md)、[分类Parity Gate](parity-gate.md)、[决策/阻塞](p0-decisions.md)。
- [历史原型定向修订](prototype/index.html)、[可复现交付记录](reproducibility.md)。

已接受C/C1、当前技术栈/Worker/Dataset及功能保护原则保持，不重新生成总体方案。顾问方案A推荐不改D01–D07的PENDING_APPROVAL。

## 收口状态

- REVIEW_CLOSURE_STATUS: CLOSED（R1–R5定向整改及本地检查完成；不代表外部独立复验）。
- FEATURE_MATRIX_CLASSIFICATION_STATUS: passed（311项ID不变，五类方法与变化类型已补齐）。
- F02_FACT_CORRECTION_STATUS: passed。
- PROTOTYPE_ISSUES_STATUS: passed（68项离线断言含原型/矩阵；浏览器视觉not-run）。
- P0_READINESS: READY_FOR_APPROVAL。
- APPROVAL_REQUIRED: D01–D07及明确P0实施范围；涉及实际降级/破坏性兼容另单审批。
- NOT_RUN: 生产失败复现/修复、真实样本、大文件、生产build/门禁、C1运行时Parity、外部独立复验。
- BLOCKED: P0生产实施授权、Edge安全自动化路径。
