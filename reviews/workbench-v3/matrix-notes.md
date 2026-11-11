# B · 新旧功能映射矩阵

当前登记311项保护单元：通用 42项、NetLog 113项、HAR 75项、Trace 39项、Combined 9项、A/B 8项、Go日志 25项。单元按菜单、条件、字段组、数据及交互拆分，数量不是产品功能总数，也不是删减白名单。复合字段组中的全部原选项均受保护；新发现的实际能力继续追加。

[打开可检索完整矩阵](feature-matrix.html) · [JSON机器清单](feature-matrix.json) · [CSV审阅版](feature-matrix.csv) · [历史路由与开关完整基线](route-and-flags.md)

每行记录稳定ID、名称、实现/调用入口及固定SHA链接、现有状态/入口、C1目标、变化类型、数据行为、风险、验收、四态、删除审批及原型覆盖。ID后续只追加，不按排序重编号。

current_static_review=passed只表示本轮完成静态核对。acceptance_state=not-run是未来新入口/行为验收，不将现有155项测试平均赋给所有功能。旧原型未逐项实现，其省略不是批准删除。

Feature Parity设计映射已建立；运行时Gate=not-run，因为生产改造尚未授权实施。任何正式入口、实验开关、查询/排序、导出格式、全量数据或历史Hash未经批准减少，Gate=failed。原本只有有限预览的Raw入口保留实际范围，不虚称完整索引；完整Dataset不能被preview替代。

source是功能主要实现位置，caller为直接使用组件或上层集成入口；多文件能力在行为说明列出协作者。状态模块只保护原本已支持的动作，不因通用描述宣称每行都有相同跳转。

Review分类：user-facing 52项、compatibility-contract 28项、expert-facing 197项、internal-capability 9项、experimental 25项。每行新增classification、acceptance_method、target_kind；内部能力与契约没有独立菜单要求。变化类型是拟定实施性质，不是已经执行的改动；没有拟删除/降级项。311项ID集合SHA256：bd5e351b64e584eef0260f078d436280bf9bf4bca06a52eb0c69f47bbe86dfd0，修改名称事实不重编号。
