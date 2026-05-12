# MCP 工具契约

## 通用规则

- 所有工具只读。
- 业务分析工具要求当前 MCP 会话先登录广告后台账号。先调用 `get_ad_auth_status`；使用本机代理时会自动尝试读取本地加密凭据登录；仍未登录时调用 `login_ad_user`，不要要求用户粘贴 RuoYi token。
- 用户可分析范围由 RuoYi 后台登录账号权限决定；MCP 不维护本地计划或项目范围清单。
- `AUTH_REQUIRED` 表示未登录、登录态失效或自动重登失败；需要重新登录后再分析。`PERMISSION_DENIED` 表示当前账号缺少只读权限，不能绕过。
- 服务支持 `mcp-session-id` 会话复用、会话 TTL 清理和浏览器 CORS 预检；客户端应复用会话，不要为每个工具调用重复初始化。
- 入参必须可扩展：新增筛选字段不能破坏旧字段。
- 返回数据应保留后端原始字段，同时提供常用摘要字段，方便后续新增接口透传。
- 重型工具可传 `responseMode` 控制返回量：`detail` 为兼容旧行为，`summary` 走轻量返回路径，默认不返回完整 rows 或完整日志。Skill 默认优先用 `summary`，只有用户明确要求深度分析时再取 `detail`。
- 批量同构 rows 可传 `format="toon"` 获取紧凑文本；TOON 只允许配合 `responseMode="summary"` 使用，`detail+toon` 会被拒绝。TOON 只用于计划、趋势、素材等同字段列表，不用于复杂操作日志。默认 `format="json"`。
- summary 尽量保留可用的 `planId`、`planName`、`queryDate`、`roi`、`cost`、`conversionCost`、`bucket`、`riskSignal`；`bucket` 默认按 `ROI=1`、`消耗=50` 分层。
- MCP 对外返回前会剔除账号 ID、系统用户 ID、内部主键、余额、token、authorization、密码等敏感字段；通用 `remark`、`planRemark`、`operationNotes`、`planRemarkLogContent` 可作为计划定位或操作解释证据。
- 后端无数据时不要编造，返回空数组或空对象后由 Skill 输出“暂无足够数据”。
- 工具失败时，回答必须标记失败工具和缺失维度；不能用该维度支撑结论。
- 任何 token、密钥、用户账号敏感字段都不能写入最终分析。
- 远程 MCP 只在当前会话内存中保存 RuoYi token 和用于重登的密码，不落盘。本机代理会在用户未传 `remember=false` 时，把账号密码加密保存到用户电脑的 `~/.codex/ad-data-analyst/credentials.json`，用于后续对话自动登录；该文件不能作为分析证据，回答中不能复述账号密码。
- `nextDayRetention`、`newRetentionRate`、`returnRetentionRate`、`returnRate` 是次留/留存/回传质量指标，不是 ROI。
- `activationCount`、`returnCount`、`activeCount`、`activeDeviceCount` 是可能结算/事件设备线索；`sent*` 是实际回传给厂商的量；`requestCounterExt` 是扣量控制上下文。它们都不是 ROI。
- 参数边界由 MCP schema 和 RuoYiClient 双层执行：`planId`、`returnDataCode`、`days`、`pageNum`、`pageSize` 必须是正整数，`days` 最大 30，常规列表 `pageSize` 最大 20，`get_return_data_raw_context.pageSize` 最大 100；超过上限会拒绝而不是静默截断；`queryDate` 只能是有效日历日期 `YYYY-MM-DD`，如 `2026-99-99` 会被拒绝；文本筛选会 trim，最长 128 字符。`search_ad_plans.extraFilters` 可用于新增筛选字段，但 key 只能用字母开头的字母数字下划线，最长 64 字符，值只能是字符串、数字、布尔或空值，且不能使用已有顶层参数名如 `pageSize`、`queryDate`、`planId`。`INVALID_ARGUMENT` 表示参数无效，不能改写后强行分析。

## 登录工具

### get_ad_auth_status

用途：查询当前 `mcp-session-id` 是否已经绑定 RuoYi 用户登录态。

返回重点：

- `authenticated`：是否已登录。
- `username`：脱敏用户名。
- `rolesSummary`、`permissionSummary`：当前账号的角色数量和权限摘要，不返回完整后台角色名或权限清单。
- `missingRequiredPermissions`：分析工具可能缺失的权限。
- `sessionExpiresInMs`：MCP 会话剩余时间。

### login_ad_user

用途：用用户输入的广告后台账号密码登录当前 MCP 会话。

入参：

```json
{
  "username": "后台账号",
  "password": "后台密码",
  "remember": true,
  "code": "可选验证码",
  "uuid": "可选验证码uuid"
}
```

规则：

- 生产默认验证码关闭；若返回 `CAPTCHA_REQUIRED`，说明后台开启了验证码，需要补充验证码流程后再登录。
- 工具返回不包含 RuoYi token 和密码。
- 通过本机代理调用时，`remember` 默认为 `true`，登录成功后会加密保存到本地凭据文件；用户要求临时登录或不要保存时传 `remember=false`。
- 登录成功后，所有计划查询都使用该用户权限。

### logout_ad_user

用途：清除当前 MCP 会话的 RuoYi token 和内存密码缓存；通过本机代理调用时，也会删除 `~/.codex/ad-data-analyst/credentials.json`。

## search_ad_plans

用途：根据用户线索定位计划，或做同项目、同回传编码、同负责人、同日期的横向候选查询。

建议入参：

```json
{
  "planId": 400388971,
  "planName": "模糊计划名",
  "productCode": "项目统计编码",
  "returnDataCode": 1592,
  "queryDate": "2026-05-08",
  "status": 1,
  "manager": "负责人",
  "crowdPack": "人群包",
  "externalCrowdPack": "外部人群包",
  "extraFilters": {
    "platform": "xiaomi"
  },
  "pageNum": 1,
  "pageSize": 10,
  "responseMode": "summary"
}
```

返回候选计划至少包含：

- `total`：后端总命中数，不等同于当前页行数。
- `returnedCount`：当前页去重后的 `rows` 数量。
- `rawReturnedCount`：后端当前页原始行数。
- `dedupeApplied`：是否因重复 `planId` 被 MCP 去重；为 `true` 时不要把 `total` 和 `returnedCount` 的差异直接解释为分页缺失。
- `source`：`PLAN_LIST` 表示带指标计划列表；`PLAN_CANDIDATE_FALLBACK` 表示基础计划候选兜底，只能定位和消歧。
- `planId`
- `planName`
- `productCode`
- `returnDataCode`
- `status`
- `budget`
- `timeSlot`
- `manager`
- `queryDate`
- `updateTime`
- `adMetrics.totalCost`
- `adMetrics.exposeNum`
- `adMetrics.clickNum`
- `adMetrics.ctr`
- `adMetrics.cpc`
- `adMetrics.conversionCost`
- `todayConversionCost`
- `todayConversionRate`
- `yesterdayConversionRate`
- `nextDayRetention`
- `newRetentionRate`
- `returnRetentionRate`
- `returnRate`
- 其他后端新增字段原样透传

兜底行为：

- 首选 `/xiaomi/plan/list` 的带指标候选；只有该接口 `total=0` 时，MCP 才可改查计划基础候选。
- 如果 `total>0` 但 `returnedCount=0`，通常是当前页码或分页条件未返回行，应调整 `pageNum` 或筛选条件，不要改用基础候选替代。
- 基础候选不依赖当天 `ad_metrics`，用于当天无消耗、历史日期无指标或数据延迟时的计划定位。
- 基础候选必须带 `planSnapshotSource=PLAN_BASE_ONLY` 或等价说明；只能用于定位和消歧，不能按 0 消耗、0 点击判断效果。

消歧规则：

- `total=0`：输出未找到。
- `returnedCount=0` 且 `total>0`：说明当前页没有行，先调整分页或缩小筛选。
- `total=1` 且 `returnedCount=1`：继续分析。
- `total>1` 或 `returnedCount>1`：除非用户要求批量对比，否则列候选并要求确认。
- `source=PLAN_CANDIDATE_FALLBACK`：只能定位和消歧；必须补趋势、诊断或上传工具后才能评价效果。
- `responseMode="summary"` 只返回定位字段、ROI、消耗、转化成本、`bucket`、`riskSignal` 和 bucket 计数；不返回完整后端 rows。

## get_plan_diagnosis_context

用途：获取单计划综合诊断上下文。适合“这个计划怎么样”“是否放量/降本/暂停”等综合问题。

入参：

```json
{
  "planId": 400388971,
  "queryDate": "2026-05-08",
  "days": 7,
  "responseMode": "summary"
}
```

返回应包含计划基础信息、计划趋势、回传趋势、半小时消耗、素材/广告组消耗趋势、操作上下文和字段说明。

关键字段：

- `operationContext.currentPlan`：日志对应的当前计划快照，包含 `planId`、`planName`、`productCode`、`returnDataCode`、`status`、`budget`、`timeSlot`、`timeSlotDesc`、`manager`、`crowdPack`、`externalCrowdPack`、ROI 摘要、转化摘要和 `adMetrics` 当日指标摘要。
- `operationContext.currentPlanRemark`：计划当前广告备注。
- `operationContext.currentOperationNotes`：计划当前操作备注。
- `operationContext.operationLogs`：近 7 天每天最新人工操作备注。
- `operationContext.remarkLogs`：近 7 天每天最新广告备注。
- `operationContext.changeLogs`：近 7 天自动监测到的计划字段、人群包、素材等变化记录。

规则：

- 只要综合诊断涉及 ROI、成本、消耗、转化、回传变化，就要检查 `operationContext`。
- `queryDate` 统一作为窗口基准日；窗口为包含基准日的 `[queryDate - days + 1, queryDate]`。历史问题必须把同一 `queryDate` 传给后续工具。
- 使用日志解释变化时，先引用 `currentPlan` 确认日志对应的计划、项目编码、回传编码、人群包、预算和时段。
- 若需要超过 7 天日志或综合上下文缺少 `operationContext`，补调用 `get_plan_operation_context`。
- 操作日志只能解释变化，不得替代 ROI、转化成本和回传数据下结论。
- `responseMode="summary"` 是有界文本摘要，用于控制综合诊断文本长度；它不是默认轻量首轮路径。首轮默认用 `search_ad_plans(summary)` 和 `get_plan_trend(summary)`，需要完整综合证据时再用 `detail`。

## get_plan_trend

用途：分析 ROI、消耗、曝光、点击、出价、转化成本、转化率、次留和回传率趋势。

入参：

```json
{
  "planId": 400388971,
  "days": 7,
  "queryDate": "2026-05-08",
  "responseMode": "summary",
  "format": "json"
}
```

规则：

- `days` 默认 7，最大 30。
- `queryDate` 默认今天；窗口为包含基准日的 `[queryDate - days + 1, queryDate]`。
- ROI 只读 `yesterdayQualityScore`、`cycleQualityScore`。
- 当天 ROI 为空要结合日期解释为正常延迟可能。
- `nextDayRetention` 是次留/次流质量指标，`returnRate` 是回传率，不能写成 ROI。
- summary 会返回四象限 `bucket` 和 `riskSignal`；ROI<1 的 bucket 只表示轻量风险，不自动要求深挖。

## get_plan_action_review_context

用途：动作复盘闭环。适合判断调价、换人群包、启停、改时段、换素材、备注事项或自动变化后是否有效。

入参：

```json
{
  "planId": 400388971,
  "queryDate": "2026-05-08",
  "days": 7,
  "actionDate": "2026-05-07",
  "actionType": "换包",
  "fieldName": "externalCrowdPack",
  "responseMode": "summary"
}
```

返回字段：

- `currentPlan`：复盘对应计划快照。
- `operationLogs`、`remarkLogs`、`changeLogs`：调整和变化证据。
- `beforeAfterMetrics`：优先按显式 `actionDate` 或最近操作/变更日期切分调整前后窗口；没有动作日期时才按窗口前后半段兜底。包含 `comparableMetricFields` 和 `metricComparabilityStatus`，空值或无可比关键指标表示缺证据。
- `returnDataImpact`：回传和设备趋势维度，`status=ok|skipped|failed`。
- `timeSlotImpact`：半小时时段趋势维度，`status=ok|failed`。
- `creativeImpact`：素材诊断维度，含素材派生信号，`status=ok|failed`。
- `reviewConclusionEvidence`：证据强度、失败维度、数据缺口、前后窗口状态、动作证据来源计数和关键指标变化；`metricWindowStatus=insufficient|spend_only` 或 `dataGaps` 非空时不能给强复盘结论。

规则：

- 本工具只读，只做复盘证据聚合，不执行调价、暂停、换包或素材操作。
- 用户明确问某次动作时，优先传 `actionDate`；若能对应具体变更字段，可传 `actionType` 或 `fieldName` 辅助锚定。`actionType` 支持“换包、调价、启停、预算、时段、素材”等常见中文动作别名，但只做保守字段匹配；字段明确时仍优先传 `fieldName`。
- `reviewConclusionEvidence.evidenceStrength=incomplete` 时，只能写复盘不完整或继续观察。
- 日志和变更日期必须与指标变化窗口匹配，才能说“有效”或“疑似无效”。
- `beforeAfterMetrics` 只是窗口前后对比，不能替代 ROI、转化成本、回传和设备质量的完整判断。
- 只有消耗或点击可比时，只能说明量级变化，不能说明效果改善；需等 ROI、成本、CTR、CPC、回传或留存等质量指标补齐。
- 任一维度 `failed` 或 `skipped` 时，说明缺口，不把该维度当作 0。
- `responseMode="summary"` 只返回日志计数、最新证据、前后窗口摘要、维度状态和数据缺口；不返回完整 `operationLogs`、`changeLogs`、`remarkLogs` 或嵌套 detail。

## get_quality_diagnosis_context

用途：单计划质量综合审查。适合一次核对计划身份、回传趋势、设备、次留、回传率和项目留存率，避免模型遗漏某个质量维度。

入参：

```json
{
  "planId": 400388971,
  "days": 7,
  "queryDate": "2026-05-08",
  "responseMode": "summary"
}
```

返回结构：

- `planIdentity`：计划身份，至少用于确认 `planId`、`planName`、`productCode`、`returnDataCode`。
- `dimensions.returnDataTrend`：回传、设备、次留、留存率趋势。
- `dimensions.returnRateTrend`：回传率趋势。
- `dimensions.retentionRateTrend`：项目维度新设备/回流设备留存率。
- `metricSemantics.roiFields`：ROI 字段，只能是 `yesterdayQualityScore`、`cycleQualityScore`。
- `metricSemantics.nonRoiQualityFields`：质量字段，如 `nextDayRetention`、`newRetentionRate`、`returnRetentionRate`、`returnRate`。

维度状态：

- `status=ok`：该维度可用。
- `status=skipped`：计划身份缺少 `returnDataCode` 或 `productCode`，只能说明缺绑定字段，不能按 0 判断。
- `status=failed`：该维度接口失败或权限不足；必须在回答中说明诊断缺口，不能用失败维度下结论。

规则：

- 质量综合审查优先用这个工具，再根据失败维度补调用单项工具。
- `returnRate`、`nextDayRetention`、`newRetentionRate`、`returnRetentionRate` 都不是 ROI。
- 当天 ROI 为空时，结合此工具看近几天设备、回传率和留存是否同步异常。
- `responseMode="summary"` 只返回计划身份、维度状态、行数、最新质量证据和数据缺口，不返回完整趋势 rows。ROI<1 默认不自动调用本工具，除非用户明确要求质量/回传/设备/留存分析。

## get_return_data_raw_context

用途：查询 RuoYi 回传数据列表原始行，适合解释某个回传编码当天原始事件量、扣量配置和 sent 实发量。

入参：

```json
{
  "planId": 400388971,
  "returnDataCode": 2611,
  "queryDate": "2026-05-08",
  "pageNum": 1,
  "pageSize": 5,
  "responseMode": "summary"
}
```

轻量规则：

- 默认只在用户问 sent、可能结算设备、原始回传事件、扣量配置或 `requestCounterExt` 时调用。
- 上下文敏感场景传 `responseMode="summary"`、`pageSize=5`；不需要逐行事件时不要读取 `rows`。
- `format="toon"` 只适合 rows 明细确实需要展示时使用。

日期口径：

- 对外优先使用统一字段 `queryDate`。
- MCP 调 RuoYi `/xiaomi/return_data/list` 时会把 `queryDate` 映射为后端实体字段 `ReturnData.returnDataDate`。
- 兼容直接传 `returnDataDate`；若 `queryDate` 与 `returnDataDate` 同时存在且不一致，工具会返回 `INVALID_ARGUMENT`。

关键字段：

- `summary.summaryScope=TOTAL`：按完整筛选条件跨页汇总，不限于当前返回页。
- `summary.isTruncated`：若为 `true`，说明只汇总了前 N 行，`summary.totals` 只能当截断样本，不能当完整总量。
- `summary.summarizedRows`、`summary.totalRows`、`summary.maxSummaryRows`：分别表示已汇总行数、后端总行数和本次 MCP 汇总行数上限；`responseMode="summary"` 默认 `maxSummaryRows=100`，用户显式要求扩大样本时才传更大值，最大 1000。
- `pageSummary.summaryScope=PAGE`：只汇总当前 `rows`，用于解释分页明细，不用于整体判断。
- `summary.totals.possibleSettlementEventTotal`：完整筛选条件下原始可能结算事件量汇总。
- `summary.totals.retentionEventTotal`：完整筛选条件下 `nextDayRetention + reNextDayRetention` 次留/回流次留事件量汇总。
- `summary.totals.rawEventTotal`：完整筛选条件下原始事件总量，等于可能结算事件量加次留/回流次留事件量；仍不是最终结算设备。
- `summary.totals.sentTotal`：完整筛选条件下 sent 实发厂商量汇总，按 `sentActivationCount + sentReturnCount + sentActiveCount + sentActiveDeviceCount` 计算。
- `summary.totals.requestCounter`：完整筛选条件下 `requestCounterExt.requestCounter` 汇总。
- `summary.ratios.sentToRequestCounterRate`：sent 实发量 / requestCounter，分母缺失时为 `null`。
- `summary.ratios.sentActivationToRequestCounterActivationRate`：实发激活 / `requestCounterExt.activationCount`，分母缺失时为 `null`。
- `summary.ratios.sentReturnToRequestCounterReturnRate`：实发回流 / `requestCounterExt.returnCount`，分母缺失时为 `null`。
- `summary.evidenceAvailability`：标记是否有原始事件、sent、`requestCounterExt` 和 `businessConfig` 证据。
- `activationCount`：激活事件量，可作为今日可能结算线索。
- `returnCount`：回流事件量，可作为今日可能结算线索。
- `activeCount`：活跃事件量，可作为今日可能结算线索。
- `activeDeviceCount`：活跃设备事件量，可作为今日可能结算线索。
- `nextDayRetention`：次留/次流质量或事件线索，不是 ROI。
- `reNextDayRetention`：回流次留/次流质量或事件线索，不是 ROI。
- `requestCounterExt`：请求/扣量控制上下文，可能包含 `internalKey`、`requestCounter`、`activationCount`、`returnCount` 等。
- `sentActivationCount`、`sentActiveCount`、`sentActiveDeviceCount`、`sentReturnCount`：实际回传给厂商的设备/事件量。
- `sentNextDayRetention`、`sentReNextDayRetention`：实发给厂商的次留/回流次留量，不是 ROI。
- `requestCounterExt` 与 `businessConfig` 是后端 Map 字段，只能引用工具真实返回的 key；未返回时不能假设存在某个扣量配置。
- `businessConfig.filter`、`businessConfig.businessType`：若返回，可作为业务过滤或业务类型配置线索，只能辅助解释回传控制。
- `projectStats.yesterdayQualityScore`、`projectStats.cycleQualityScore`：项目统计 ROI 字段；当天常为空。
- `projectStats.deviceCount`、`projectStats.newDevice`、`projectStats.returnDevice`、`projectStats.newRetentionRate`、`projectStats.returnRetentionRate`：项目统计设备和留存字段，不是 raw 事件字段。

规则：

- MCP 调用 `/xiaomi/return_data/list`，需要 `xiaomi:return_data:list` 权限，默认 `pageSize=40`，最大 100；`summary` 默认最多汇总 100 行，`detail` 兼容旧行为最多汇总 1000 行，显式 `maxSummaryRows=1000` 才扩大。
- 有 `planId` 时，MCP 先校验 `returnDataCode` 与计划绑定。
- 优先引用 `summary` 做总体判断；但 `summary.isTruncated=true` 时只能写“前 N 行样本显示”，不能当完整总体结论。只在需要举例时引用 `pageSummary` 和 `rows` 解释具体日期、平台和配置。
- 若工具未返回 `requestCounterExt` 或原始可能结算字段，回答必须写“暂无扣量配置证据”或“暂无原始回传事件证据”，不能编造扣量比例。
- `requestCounterExt` 只能解释扣量控制上下文，不能替代 ROI、转化成本或后续上传设备数。
- 不要计算 `sentTotal / possibleSettlementEventTotal` 作为扣量率：原始事件量和 sent 实发量不是同一分母口径，该比值可能大于 1，容易误导。
- 当天无法根据这些字段确认最终结算设备，只能判断 sent 实发、扣量策略、消耗速度和成本风险。
- 示例：`returnCount=141`、`requestCounterExt.returnCount=80`、`sentReturnCount=28` 表示回流事件经过扣量控制后只向厂商实发部分设备，不能把 `returnCount=141` 当作全部厂商回传。

## get_return_data_trend

用途：分析回传编码、设备数、次留、留存率、厂商回传和项目统计兜底。

入参：

```json
{
  "planId": 400388971,
  "returnDataCode": 1592,
  "days": 7,
  "queryDate": "2026-05-08"
}
```

规则：

- 有 `planId` 时必须限制在当前计划绑定或同项目允许的回传编码。
- 有 `planId` 时，MCP 先用计划身份校验 `returnDataCode` 与当前计划绑定关系，再拉回传趋势。
- 如果用户只给回传编码，应先用 `search_ad_plans({ returnDataCode })` 查关联计划；命中多个计划时先消歧或按用户要求做同回传编码横向对比。
- 缺回传编码时不要直接调用本工具；先用 `search_ad_plans` 或 `get_quality_diagnosis_context` 获取计划绑定的 `returnDataCode`，如后端未来支持 productCode 兜底，再在工具契约中补充新入参和口径。
- 重点字段：`deviceCount`、`newDevice`、`returnDevice`、`newRetentionRate`、`returnRetentionRate`、`sentActivationCount`、`sentReturnCount`、`sentActiveDeviceCount`、`source`、`hasVendorReturnData`。
- `newRetentionRate`、`returnRetentionRate` 是留存率，不是 ROI。
- 如果本工具只返回趋势聚合、不返回 `requestCounterExt`、`activationCount`、`returnCount`、`activeCount`、`activeDeviceCount`，不能用它下扣量配置结论；只能判断 sent 和后续项目统计/上传设备的趋势关系。

## get_return_rate_trend

用途：查询指定回传编码近 7 日回传率，用于判断点击到厂商回传链路效率。

入参：

```json
{
  "planId": 400388971,
  "returnDataCode": 1592,
  "days": 7,
  "queryDate": "2026-05-08"
}
```

返回字段：

- `date`
- `returnDataCode`
- `sentActivationCount`
- `sentActiveCount`
- `sentActiveDeviceCount`
- `sentReturnCount`
- `sentTotalCount`
- `clickNum`
- `returnRate`

规则：

- `returnRate` 通常按 `sentTotalCount / clickNum * 100` 计算，是回传率，不是 ROI。
- 有 `planId` 时必须校验 `returnDataCode` 与计划绑定，避免错配计划结论。
- 回传率下降要结合点击数、厂商回传分项、真实设备数和项目统计判断；点击数很低时不要强判异常。
- 本工具只适合判断点击到 sent 实发厂商的比例，不能单独解释 `requestCounterExt` 扣量策略。

## get_retention_rate_trend

用途：查询项目编码近 10 日新设备留存率和回流设备留存率，用于项目维度质量审查。

入参：

```json
{
  "productCode": "项目统计编码",
  "days": 7,
  "queryDate": "2026-05-08"
}
```

返回字段：

- `date`
- `newRetentionRate`
- `returnRetentionRate`
- `dailyTotalCost`
- `yesterdayQualityScore`
- `cycleQualityScore`

规则：

- `newRetentionRate`、`returnRetentionRate` 是留存率，不是 ROI。
- `yesterdayQualityScore`、`cycleQualityScore` 仍然是该返回中的 ROI 字段，可以和留存率一起判断质量变化。
- 项目维度留存率适合 productCode 横向或趋势审查；不要直接用于未绑定该项目的计划结论。

## get_cost_half_hour_trend

用途：分析半小时消耗、提前跑量、高峰低谷、异常 slot。

入参：

```json
{
  "planId": 400388971,
  "days": 7,
  "queryDate": "2026-05-08",
  "responseMode": "summary"
}
```

规则：

- 输出 `{日期: {slot或时间点: 消耗}}`。
- 只根据时段消耗不能判断盈利，要结合 ROI、转化成本或回传质量。

## get_plan_operation_context

用途：获取计划人工操作备注、广告备注和自动变更日志，用于判断计划表现变化是否受到人为操作、备注事项、人群包/字段变化影响。

入参：

```json
{
  "planId": 400388971,
  "days": 7,
  "queryDate": "2026-05-08"
}
```

返回字段：

- `queryDate`：本次日志和计划快照基准日期。
- `planSnapshotSource`：`PLAN_WITH_AD_METRICS` 表示该日期有计划指标，`PLAN_BASE_ONLY` 表示该日期无计划指标、仅返回基础计划配置。
- `currentPlan`：日志对应的当前计划快照，包含计划配置和当日指标摘要。
- `currentPlanRemark`：计划当前广告备注。
- `currentOperationNotes`：计划当前操作备注。
- `operationLogs`：近 N 天每天最新人工操作备注，`planRemarkLogType=0`。
- `remarkLogs`：近 N 天每天最新广告备注，`planRemarkLogType=1`。
- `changeLogs`：自动监测到的计划字段、人群包、素材等变化记录。

规则：

- 分析“为什么变化”“是否人为调整导致”“备注是否影响计划”时必须调用。
- 日志判断必须绑定 `currentPlan`，不能只根据日志文字脱离计划口径下结论。
- 历史日期分析必须传 `queryDate`；如果 `planSnapshotSource=PLAN_BASE_ONLY`，说明该日期没有指标证据，不能按 0 消耗、0 点击判断。
- `responseMode="summary"` 只返回计划快照摘要、日志计数和最新操作/变更/备注证据；不返回完整日志数组。
- 日志只作为解释线索，不能替代 ROI、转化成本、设备和回传数据。
- 如果日志显示调出价、换人群包、暂停/恢复、备注异常事项，应在风险判断中说明。
- 如果日志缺失，不能据此说明没有操作，只能写“暂无足够操作日志证据”。

## get_plan_history_context

用途：查询计划历史快照，专门回答“昨天/某天为什么变了”“某天配置或指标是否发生变化”。

入参：

```json
{
  "planId": 400388971,
  "queryDate": "2026-05-08",
  "days": 7
}
```

规则：

- 必须和 `get_plan_operation_context`、趋势、回传、半小时工具使用同一个 `queryDate`。
- 返回历史计划配置、投放指标、ROI、设备/留存、回传率、备注和自动变更日志。
- 历史快照只能解释窗口内变化，不能替代 raw 回传或素材诊断。

## get_upload_status

用途：判断 ROI、项目统计、回传数据、sent 实发和投放指标是否在日期窗口内产出或上传。

入参：

```json
{
  "planId": 400388971,
  "queryDate": "2026-05-08",
  "days": 7
}
```

规则：

- ROI 为空时优先调用本工具，不要直接判异常。
- `roiUploaded=true` 只表示 `yesterdayQualityScore` 或 `cycleQualityScore` 有值。
- `projectStatsUploaded=true` 但 `roiUploaded=false` 表示项目统计可能存在但 ROI 未产出。
- `returnDataUploaded` 和 `vendorSentUploaded` 只能说明回传/sent 证据存在，不代表 ROI。

## get_creative_diagnosis_context

用途：按计划批量聚合素材和广告组表现，避免逐素材查询。

入参：

```json
{
  "planId": 400388971,
  "queryDate": "2026-05-08",
  "days": 7,
  "platform": 1,
  "topN": 5,
  "responseMode": "summary"
}
```

返回重点：

- `creatives`：素材粒度消耗、点击、曝光、CPC、CTR、ECPM、活跃天数。
- `groups`：广告组粒度汇总。
- `fatigueSignals`：连续活跃且高消耗的疲劳候选。
- `declineSignals`：高消耗低 CTR、高消耗高 CPC 等拖累信号。
- `concentrationRisk`：单素材或单广告组消耗集中风险。
- `recommendedCreativeActions`：保留、放大、降权、替换或暂停观察的诊断建议。

规则：

- 素材问题或整体异常无法由 ROI、回传、时段解释时调用。
- ROI<1 默认不自动调用本工具；只有用户要求深度分析或明确问素材/广告组时调用。
- 不能只按素材消耗排名定优劣；要结合 CTR、CPC、ECPM、计划 ROI/转化和回传证据。
- 派生字段是诊断建议，不是自动执行；必须结合计划 ROI、转化成本和回传质量后再给动作。
- `concentrationRisk=high` 时不要直接暂停唯一高消耗素材，先判断它是否也是主要有效素材。

## get_project_plan_comparison

用途：同 `productCode` 下横向比较计划，找低效计划或异常计划。

入参：

```json
{
  "productCode": "项目统计编码",
  "queryDate": "2026-05-08",
  "days": 7,
  "pageSize": 20,
  "responseMode": "summary"
}
```

规则：

- 只比较同项目编码和同日期口径计划。
- 排序/判断优先看 ROI、转化成本、消耗规模、设备质量、留存和回传率。
- ROI<1 默认只作为轻量风险清单，不自动逐计划深挖。

## get_return_code_plan_comparison

用途：同 `returnDataCode` 下横向比较计划，判断是否某个计划拖累整体回传或消耗。

入参：

```json
{
  "returnDataCode": 1592,
  "queryDate": "2026-05-08",
  "days": 7,
  "pageSize": 20,
  "responseMode": "summary"
}
```

规则：

- 只比较同回传编码和同日期口径计划。
- 适合解释同一回传编码下 sent、回传率、消耗或成本差异。

## get_manager_plan_comparison

用途：同负责人下横向比较当前用户可见计划，适合做负责人维度风险盘点或待处理计划筛选。

入参：

```json
{
  "manager": "负责人",
  "queryDate": "2026-05-08",
  "days": 7,
  "pageSize": 20,
  "responseMode": "summary"
}
```

规则：

- 只比较同负责人和同日期口径计划。
- 只输出需要处理的计划，不做无意义全量复述。
- 负责人维度通常不是业务同质口径，若计划属于不同项目或回传编码，必须按 `productCode` 或 `returnDataCode` 分组解释，不能直接全量排名。

## get_crowd_pack_plan_comparison

用途：同内部人群包下横向比较当前用户可见计划，判断是否某个人群包下计划普遍异常或个别计划拖累。

入参：

```json
{
  "crowdPack": "人群包",
  "queryDate": "2026-05-08",
  "days": 7,
  "pageSize": 20,
  "responseMode": "summary"
}
```

规则：

- 只比较同人群包和同日期口径计划。
- 如果同人群包下跨项目或跨回传编码，应先分组，再比较 ROI、转化成本、设备质量和回传率。
- 返回可包含 `packHealth`、`groupedByProductCode`、`groupedByReturnDataCode`、`declineSignals`、`recommendedPackActions`；这些字段用于判断包健康、分组口径和待处理计划。
- `recommendedPackActions` 是诊断建议，不代表自动换包、拆包或扩包。

## get_external_crowd_pack_plan_comparison

用途：同外部人群包下横向比较当前用户可见计划，适合检查外部人群包变更或同包计划整体风险。

入参：

```json
{
  "externalCrowdPack": "外部人群包",
  "queryDate": "2026-05-08",
  "days": 7,
  "pageSize": 20,
  "responseMode": "summary"
}
```

规则：

- 只比较同外部人群包和同日期口径计划。
- 外部人群包只作为比较口径，不能替代 ROI、转化成本、回传和设备证据。
- 返回可包含 `packHealth`、`groupedByProductCode`、`groupedByReturnDataCode`、`declineSignals`、`recommendedPackActions`；跨项目或跨回传编码时必须先分组解释。

## 生产错误处理

- 401/403：说明 MCP 或后端权限不足，不输出业务诊断。
- 404：说明计划或回传编码不存在。
- 429/5xx/timeout：说明数据源暂时不可用，并明确哪些维度未完成审查。
- `RuoYi returned invalid JSON`：说明后端响应格式异常，不输出业务诊断，不复述原始响应体。
- 空数据：输出“暂无足够数据”，不要视作 0 值。
- `returnDataCode ... is not bound to planId ...`：说明回传编码与当前计划不匹配，必须重新定位计划或改做回传编码维度候选查询。
