# 扩展指南

## 新增数据接口时怎么接入

新增工具或接口时，只补充以下信息，不重写主 `SKILL.md`：

1. 工具名称
2. 适用问题
3. 入参字段
4. 返回字段
5. 字段口径
6. 诊断优先级
7. 失败或空数据处理
8. 是否允许横向比较
9. 计划、项目和回传编码范围校验

## 工具设计原则

- 工具保持只读。
- 所有业务数据工具默认要求当前 MCP 会话已通过 `login_ad_user` 登录 RuoYi 用户；新增工具不要引入固定后台 token 作为默认凭据。
- 新工具权限边界必须以 RuoYi 登录用户权限为唯一计划范围来源，不能新增本地计划或项目范围清单来替代后台权限模型。
- 新工具需要按后端 Controller 真实 `@PreAuthorize` 声明依赖的 RuoYi 权限；计划相关只读查询统一复用 `xiaomi:plan:list`，回传数据读取继续使用 `xiaomi:return_data:query` 或 `xiaomi:return_data:list`，不要按接口名称猜新权限。
- 返回内容、日志和错误必须脱敏密码、token、Authorization、账号内部 ID 和余额等敏感字段。
- 入参使用明确字段，不让模型拼 SQL。
- `planId` 精确查，`planName` 模糊查，`productCode` 和 `returnDataCode` 可做横向范围。
- 支持 `queryDate`，避免用户问历史日期时默认今天。
- 如果对外字段名和 RuoYi 实体字段名不同，必须在 MCP 中显式映射并写入工具文档；例如 raw 回传工具的 `queryDate` 会映射为后端 `ReturnData.returnDataDate`。
- 返回原始字段和摘要字段，不删除后端新增字段。
- 后端新增字段先透传，再在 `metrics.md` 补充口径。
- 新工具必须定义权限边界和失败语义。
- 单计划工具依赖 RuoYi 后端权限过滤；如果工具内部会查 `/xiaomi/plan/identity` 校验计划身份，MCP 权限预检查也必须要求 `xiaomi:plan:list`。
- 涉及回传编码绑定、跨计划比较或项目口径时，必须返回足够的计划身份字段用于审查。
- 回传类工具必须确认 `returnDataCode` 与当前计划绑定；用户只给回传编码时，先查关联计划候选，再决定消歧或横向对比。
- 聚合工具应按维度返回 `ok`、`skipped` 或 `failed`，避免某个可选接口失败导致其它维度证据丢失；`skipped` 和 `failed` 都不能解释为 0 值。
- 计划定位工具应支持不依赖当天指标的基础候选兜底，并标记 `PLAN_BASE_ONLY` 或等价来源；基础候选只用于定位，不能当作 0 消耗证据。
- 新工具进入生产前必须有 MCP 编译校验、最小连通性测试和至少一个 Skill 样例问题。

## 诊断优先级接入

新增维度必须挂到一个优先级：

1. ROI
2. 转化/转化成本
3. 回传质量/设备/留存
4. 消耗/时段波动
5. 操作日志解释
6. 素材/广告组
7. 横向对比

如果新增接口无法影响投放动作，只作为辅助证据，不应覆盖 ROI 和转化成本判断。

## 操作上下文接入

任何会改变计划表现或解释指标变化的新增接口，都要说明是否进入 `operationContext` 或独立工具：

- 人工备注、广告备注、调价、启停、时段、人群包、素材绑定变化，优先进入 `operationContext`。
- `operationContext` 必须同时返回 `currentPlan`，至少包含计划 ID、计划名、项目编码、回传编码、状态、预算、时段、人群包、负责人和当前指标摘要。
- `operationContext` 必须支持 `queryDate`，并返回 `planSnapshotSource`，明确当前计划快照是否包含该日期指标。
- 自动监测日志应保留 `changeAction`、`fieldName`、`oldValue`、`newValue`、`snapshotDate` 等可解释字段。
- 综合诊断工具应默认返回近 7 天操作上下文；独立工具可支持最多 30 天窗口。
- 操作上下文属于解释证据，不属于 ROI、成本或转化事实，不得提高到主判断优先级之前。

## 示例：新增上传状态工具

工具名：`get_upload_status`

适用问题：

- 今天 ROI 没有是否异常
- 近几天 ROI 连续为空
- 项目统计或设备数据是否上传

返回字段：

- `date`
- `productCode`
- `roiUploaded`
- `deviceUploaded`
- `returnDataUploaded`
- `lastUploadTime`
- `statusMessage`

诊断规则：

- 当天 `roiUploaded=false` 通常不算异常。
- 近 2-3 天连续未上传，并且设备或回传也未上传，提示排查上传链路。
- 上传状态正常但 ROI 仍为空，提示排查项目统计口径或数据质量。
