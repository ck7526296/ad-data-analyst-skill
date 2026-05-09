# 最小诊断示例

## 只定位，不深度诊断

用户：帮我找一下“5月回流-安卓”是哪几个计划。

处理：

- 先调用 `get_ad_auth_status`。
- 调用 `search_ad_plans({ "planName": "5月回流-安卓" })`。
- 如果多候选，只输出候选表和消歧要求，不调用趋势、回传、素材或操作日志工具。
- 如果 `total>0` 但 `returnedCount=0`，先调整分页或筛选，不要直接说未找到。
- 回答重点：用户线索、候选 `planId`、`planName`、`productCode`、`returnDataCode`、负责人和查询日期。

## 多候选消歧

用户：看下负责人张三昨天那个回传 2611 的计划。

处理：

- 将“昨天”换算为明确 `queryDate`。
- 调用 `search_ad_plans({ "manager": "张三", "returnDataCode": 2611, "queryDate": "YYYY-MM-DD" })`。
- 命中多条时要求用户确认 `planId`，除非用户明确要求同回传编码横向对比。
- 若 `source=PLAN_CANDIDATE_FALLBACK`，只能把结果用于定位，不要据此判断当天无消耗或效果差。
- 不要任选第一条做诊断。

## 当天 ROI 为空

用户：今天这个计划 ROI 怎么没了，是不是异常？

处理：

- 定位计划后调用 `get_upload_status`，必要时补 `get_plan_trend` 和 `get_quality_diagnosis_context`。
- 当天 ROI 为空先按上传延迟或尚未产出口径解释，不直接判亏损或暂停。
- 只有近 2-3 天连续为空，并且设备、回传、项目统计或上传链路同步异常时，才升级为链路排查风险。
- 建议动作通常是继续观察或暂不放量，并写明下一步观察上传状态、设备数、回传率和 ROI。

## 回传编码错配

用户：用计划 400388971 和回传 2611 看回传率。

处理：

- 调用 `get_return_rate_trend` 或 `get_return_data_trend` 时同时传 `planId` 和 `returnDataCode`，让 MCP 校验绑定关系。
- 如果返回 `returnDataCode ... is not bound to planId ...`，停止该计划结论。
- 回答应要求重新确认计划或改做 `search_ad_plans({ "returnDataCode": 2611 })` 查关联计划。
- 不要把未绑定回传编码的数据用于当前计划诊断。

## 扣量和 sent 实发

用户：今天 2611 是不是扣太狠，厂商实发多少？

处理：

- 先定位计划；如果有 `planId`，调用 `get_return_data_raw_context({ "planId": ..., "returnDataCode": 2611, "queryDate": "YYYY-MM-DD", "maxSummaryRows": 1000 })`。
- 优先引用 `summary.summaryScope=TOTAL`，不要用 `pageSummary` 代表整体；若 `summary.isTruncated=true`，只能按截断样本描述，不能说是完整总量。
- 有 `requestCounterExt` 时可解释 sent 相对扣量计数比例；没有时必须写“暂无扣量配置证据”。
- 不要把 `sentTotal / possibleSettlementEventTotal` 当扣量率，也不要把 sent、原始事件量或 `activationCount` 写成 ROI。

## 动作复盘

用户：昨天换包后这个计划有没有变好？

处理：

- 定位计划和“昨天”的明确日期。
- 调用 `get_plan_action_review_context({ "planId": ..., "queryDate": "YYYY-MM-DD", "days": 7, "actionDate": "YYYY-MM-DD", "actionType": "换包" })`；若只知道大致时间，可省略 `actionDate` 让工具自动取最近操作/变更日期。
- 先看 `operationLogs/changeLogs` 是否确有换包或相关变化；没有日志时不能写“换包导致”。
- 再看 `beforeAfterMetrics`、`returnDataImpact`、`timeSlotImpact`、`creativeImpact`。
- 结论只写“有效 / 疑似无效 / 继续观察”；维度失败或样本不足时写继续观察。

## 素材疲劳

用户：这个计划是不是素材跑疲劳了？

处理：

- 先确认整体 ROI、转化成本和回传质量；只有素材问题或整体异常无法解释时调用素材工具。
- 调用 `get_creative_diagnosis_context`。
- 引用 `fatigueSignals`、`declineSignals`、`concentrationRisk` 和 `recommendedCreativeActions`。
- 高消耗低 CTR/高 CPC 才建议降权或替换；唯一高贡献素材不能只因消耗高就暂停。

## 人群包巡检

用户：看下外部人群包 A 今天哪些计划要处理。

处理：

- 调用 `get_external_crowd_pack_plan_comparison({ "externalCrowdPack": "A", "queryDate": "YYYY-MM-DD" })`。
- 若 `groupedByProductCode` 或 `groupedByReturnDataCode` 有多个分组，先按分组解释。
- 使用 `packHealth` 和 `declineSignals` 找包内拖累计划。
- 输出待放量、待降本、待暂停观察、数据缺口四类清单。
