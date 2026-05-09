# 指标口径

## ROI

- 只有 `yesterdayQualityScore` 和 `cycleQualityScore` 表示 ROI。
- `yesterdayQualityScore`：昨日 ROI，通常依赖用户上传或项目统计数据，可能 T+1 或更晚出现。
- `cycleQualityScore`：周期 ROI，用于观察更稳定的阶段性质量。
- ROI = 1 表示盈亏平衡；大于 1 倾向盈利，小于 1 倾向亏损。
- 当天通常没有 ROI。当天 ROI 为空时，默认先判断为数据尚未上传或尚未产出，不直接判定投放异常。
- 判断 ROI 空值原因时优先看 `get_upload_status`：区分投放指标缺失、项目统计缺失、ROI 未产出、回传数据缺失和 sent 实发缺失。
- 若近 2-3 天 ROI 连续为空，同时设备数、回传数、上传链路、项目统计或历史同期也异常，才升级为链路排查风险。

## 留存与回传

- `nextDayRetention` 是次留/次流质量指标，来自回传数据或计划历史快照，通常用于观察次日质量趋势。
- `newRetentionRate` 是新设备次留率。
- `returnRetentionRate` 是回流设备次留率。
- `returnRate` 是回传率，通常按厂商回传总量 / 点击数计算，用于判断点击到厂商回传链路效率。
- 次留、留存率、回传率都是质量或链路指标，不是 ROI，不能替代盈利判断。
- `deviceCount = newDevice + returnDevice`，优先用于真实结算和设备规模判断。
- 厂商回传字段如 `sentActivationCount`、`sentReturnCount`、`sentActiveDeviceCount` 只作参考，要和真实结算设备对比。
- `source=PROJECT_STATS_FALLBACK` 表示用项目统计兜底，不包含厂商回传激活/回流数。
- 回传率异常要同时看 `clickNum`、`sentActivationCount`、`sentActiveCount`、`sentActiveDeviceCount`、`sentReturnCount` 和真实设备数，避免只因点击过低或样本太小误判。

## 扣量与回传控制

- `activationCount`、`returnCount`、`activeCount`、`activeDeviceCount` 是回传原始事件量，可作为今日可能结算设备线索；它们不是最终结算设备，也不是 ROI。
- `nextDayRetention`、`reNextDayRetention` 是次留/回流次留事件或质量线索，纳入 raw 事件完整性审查，但不是 ROI，也不能直接当最终结算设备。
- 当天通常还没有后续上传设备数或项目统计结算结果，只能用原始事件量和 sent 实发判断消耗/成本风险，不能下最终盈利结论。
- 实发厂商设备优先用 `sentTotalCount`；没有该字段时按 `sentActivationCount + sentReturnCount + sentActiveCount + sentActiveDeviceCount` 汇总，并说明是估算口径。
- `get_return_data_raw_context.summary.totals.sentTotal` 已按上述 sent 字段汇总，优先使用该汇总，避免手算错误。
- `summary.ratios.sentToRequestCounterRate` 只能解释 sent 相对扣量计数的比例；当分母缺失为 `null` 时，不能编造比例。
- 不要用 `sentTotal / possibleSettlementEventTotal` 当作扣量率。原始事件量和 sent 实发量不是同一分母口径，该比值可能大于 1，只能分别作为事件线索和实发线索审查。
- `requestCounterExt` 是请求/扣量控制上下文，如 `requestCounterExt.returnCount`、`requestCounterExt.activationCount`、`requestCounter`；只有工具实际返回时才能引用。
- `requestCounterExt` 与 `businessConfig` 是后端 Map 字段，只能引用真实返回的 key；未返回时必须写“暂无扣量配置证据”，不能补造配置。
- 不要把“扣量”固定为 `deviceCount - sentTotalCount`。应比较可能结算事件量、`requestCounterExt` 配置/计数和 sent 实发量之间的差额或比例。
- 例如 `returnCount=141`、`requestCounterExt.returnCount=80`、`sentReturnCount=28` 时，应解释为经过扣量控制后只向厂商实发部分回流设备，不能说 141 个都回传给厂商。
- ROI 高且稳定时，减少扣量、提高 sent 比例可能加快消耗和放量；ROI 低或成本恶化时，增加扣量、降低 sent 比例可用于控制厂商侧消耗和成本。

## 投放效果

- 消耗升高必须结合曝光、点击、CTR、CPC、转化成本、转化率、出价和时段看。
- 点击上涨但转化成本恶化，优先排查转化质量、回传率、回传质量和低效时段。
- 消耗上涨且 CTR/CPC 正常，但 ROI、设备质量、次留或回传率下降，优先判断质量或回传问题。
- 消耗下降但 ROI 改善，可能是控量后质量提升；不要简单判定为投放变差。
- 出价变化要和 `convCostCreative`、转化成本、消耗节奏一起看。

## 时段

- `timeSlot` 取值 0-47，每个 slot 表示 30 分钟窗口。
- 半小时消耗趋势用于判断提前跑量、低效高峰、预算消耗集中和异常突增。
- 发现低效时段时，建议动作应绑定观察指标，如 ROI、转化成本、设备数、次留、留存率、回传率，而不是只说“关闭时段”。

## 横向对比

- 只在口径一致时横向比较：同 `productCode`、同 `returnDataCode`、同人群包、同负责人、同查询日期或同投放目标。
- 比较时必须说明口径，例如“以下只比较同 productCode 的计划，不代表全账户排名”。
- 多计划比较优先看 ROI、转化成本、消耗规模、设备质量、次留、回传率和回传偏差。
