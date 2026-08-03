# 知之 Recommendation V1：事实先行的个性化问题卡片

> **Status:** CURRENT
> **Release:** EXPERIMENTAL
> **Verification:** WORKTREE
> **Last verified:** 2026-08-03
> **Sources:** `DailyFortuneFactPackage`、`mingliInteractionEngine`、`Recommendation.ts`、`recommendationTimeWindows.ts`、`recommendationAi.ts`、`recommendation_batches` / `recommendation_events` / `recommendation_provider_attempts`、迁移 `013` / `014` 与推荐路由。迁移、真实 Gemini、iOS 与线上链路须分别验证，不能由本地代码推断。

## 1. 一句话结论

知之不是先猜用户喜欢什么、再找理由解释。正确顺序是：

```text
原局与已有完整大运、流年、流月时间线里，哪些硬关系真实成立
  -> 服务端只截取适合一次 AI 判断的通用时间窗口，不判断哪件事会发生
  -> 哪些问题有资格被问
  -> AI 在这些事实里判断最值得问的具体问题
  -> AI 一次生成 24 张完整候选，服务端先展示其中 12 张
  -> 用户打开什么，立即影响剩余 12 张的顺序和展示面
  -> 24 张耗尽后，累积行为再进入下一次 AI 生成
```

这能同时满足两个产品结果：

1. 用户看到的问题有“它怎么知道我这个月可能会遇到这件事”的感觉。
2. 用户越使用，下一批越接近他真正关心的领域、角度和时间尺度。

兴趣不能把没有命理依据的题目推上来。兴趣只决定：在已经被命理事实支持的题里，哪一题先出现、用什么角度问、短期题与长期题如何配比。

## 2. 用户实际感受到的链路

假设原局日支为辰，以“下个月丙戌月的戌与辰构成冲”为硬事实输入：

```text
现有完整时间线中的原局 + 大运 + 流年 + 丙戌流月
  -> 服务端复用同一套确定性关系引擎，得到各时间层可追溯的硬关系
  -> 完整时间线留在服务端；time_windows 只带当前/父大运、父流年、当前起最多 12 个流月和最多 1 个远期流年或大运
  -> 全部大运只提供轻量索引；不传全部流年、不传流日；完整证据窗口最多 16 个且整个 time_windows 不超过 96 KB
  -> 一次 AI 调用同时看到这些关系、有效时间、用户现实状态和阅读记忆
  -> AI 判断日支在当前组合中关联哪些生活领域、这项变化是否重要
  -> AI 可生成：
     “下个月感情里，哪些沟通点容易累积成争执？”
     “如果目前单身，丙戌月更可能在哪种关系场景遇到新连接？”
     “这段关系接下来更适合推进，还是先把边界讲清楚？”
  -> AI 一次输出 24 张完整候选，每张都标注它引用了哪些事实、何时失效
  -> 服务端先返回 8 张大卡 + 4 张中心卡
  -> 用户打开“争执”相关卡
  -> 服务端在不改写题目、不增加 AI 调用的前提下，把剩余 12 张中更接近
     感情预测、沟通、关系推进的卡排得更靠前，再返回 8 张大卡 + 4 张中心卡
  -> 24 张全部展示后，下一次 AI 生成同时看到本轮打开和此前长期兴趣
```

这里的“争执风险”“新桃花”“分手风险”是**事件假设**：有命理事实支持的可能题材，不是对用户生活已经发生或必然发生的断言。这个表达强度由 AI 的提示词和人工命理样本评测约束；服务端不会用关键词二次判定“这句话能不能说”。

## 3. MVP 的边界：AI 判断，服务端守住合同

### 3.1 为什么不是纯后端规则引擎

盲派、子平对“一个作用关系在现实里可能落成什么事”的判断有语境，硬编码成大量规则会很快变成难维护的第二套命理系统。V1 不新增盲派确定性规则引擎。

AI 接收完整、已验证的命理事实，负责：

- 判断哪些事实在当前最值得讲；
- 把事实翻译成具体、可打开的问题；
- 在“争执 / 修复 / 新连接 / 推进 / 外部干扰”等现实题材中做语义判断；
- 在长期兴趣、近期兴趣和本次会话行为之间做柔性权衡；
- 保持同一批题目的领域、主题、问题任务和时间尺度多样性。

### 3.2 服务端为什么仍然必须有很少的限制

服务端不判断“丙戌月是否一定导致分手”，也不扫描文案关键词、更不做第二次 AI 审稿。它只做机械完整性检查，防止模型或客户端破坏产品合同：

| 服务端做什么 | 白话解释 | 服务端不做什么 |
|---|---|---|
| 检查 JSON 结构、枚举、张数、文本长度 | 保证 iOS 能稳定显示 | 判断文案是否“像命理师” |
| 检查每张卡引用的 `fact_ref` 真在本次原局或时间窗口里，且引用窗口有交集 | 防止模型引用不存在的作用关系 ID | 判断这一事实关联什么领域或是否足够支持“争执” |
| 服务端生成卡片 ID、位置、展示面、目标事实窗口和语义键 | 保证事件可记、卡片可回放、重复可控 | 改写 AI 的问题和正文 |
| 记录真实 exposure/open | 确保长期记忆是产品事实 | 把划走或未打开当成“不喜欢” |
| 限制批次/重试/项目总 provider 调用量 | 把 Gemini 成本限制在可预期预算内 | 判断哪张卡命理上更重要 |

这不是把 AI 限死，而是让它能自由判断的同时，输出仍然能被产品、数据库和客户端安全使用。

## 4. `mechanism` 的正确含义：证据链，不是一个过粗的枚举

旧设计把 `mechanism` 想成 `natal_structure / cycle / trigger` 之类的单选标签。这不足以回答“为什么现在要问这题”。V1 将它落成每张卡嵌套的 `event_hypothesis.fact_refs`。

每个事实引用都来自服务端现有事实层，例如：

```text
natal:pillar:day
natal:interaction:{interaction_id}
time:liunian:2026:timing
time:liuyue:2026-10-08:interaction:{interaction_id}
```

每个引用带 `valid_from` 和 `valid_until`。一张卡同时引用原局、流年和流月时，`CardCandidate.validity` 是这些事实共同描述的**事件目标窗口**。它既能回答“依据来自哪里”，也能回答“这件事指向哪段时间”。

这与页面展示期限是两件事：`recommendation_batches.valid_until` 表示这批页面卡今天能用到本地子初几点；`CardCandidate.validity` 表示它讲的是哪段命理时间。于是用户今天可以看到“丙戌月的感情会有什么变化”，该卡引用丙戌月窗口的事实，目标窗口是对应月份；它不是把未来事实伪装成今天已经发生。

命理解释的语义全部在 AI 端。推荐专用事实投影只传 `relation`、无方向的 `members`、`scope`、`time_horizon`、`full_match` 等可复算硬事实；不传重复的五行映射，也不传 `source`、`targets`、`fact_label`、`activated_palaces`、`domain_candidates`、`intensity` 或 `evidence`。`members` 只表示共同构成关系的对象，数组顺序不代表谁作用谁；`full_match` 只表示规则成员齐全，不代表更强或更可能发生。AI 自行判断领域、宫位含义、相对重要性、跨时间背景和事件假设。服务端只确认被引用的 ID 存在且时间窗口没有冲突。

## 5. 候选卡与展示卡分开，24 张才真正可重排

`RecommendationCandidate` 是 AI 生成的完整问题候选。它还没有被分到大卡或中心卡，因此用户打开后，剩余候选仍可重新排序和分配展示面。`CardCandidate` 是候选被选入某一展示批次后的只读投影，也是推荐与长期记忆之间的稳定桥梁。

```text
RecommendationCandidate
  candidate_id       服务端唯一 ID
  pool_position      AI 给出的原始优先顺序
  semantic_key       防止近期同题反复出现的稳定语义键
  primary_time_window_key
                     AI 指定这张卡主要在讲哪个大运、流年或流月；原局卡为空
  referenced_window_keys
                     服务端从 fact_refs 机械推导的全部时间窗口
  content_profile    用户关心什么、想知道什么、看哪个时间尺度
  selection_role     本次为什么优先推它
  event_hypothesis   可能发生什么 + 条件强度 + 事实引用
  validity           这张卡所描述的事实/事件目标窗口
  question/preview/body
                     用户看到的问题、摘要和同一份详情正文

CardCandidate（进入展示批次后增加）
  surface            deck（大卡）或 center（中心卡）
  position           所在展示面内的位置
```

一次 AI 调用固定生成一个不可变的 24 张候选池，不让 AI 直接输出 `deck_cards` 或 `center_cards`。服务端把它分成两个客户端兼容的展示批次，每批固定为 8 张大卡 + 4 张中心卡：首批保持 AI 的候选优先顺序；次批必须且只能消费首批未展示的 12 张，并使用首批打开行为重排。两类卡不是两套内容系统，都复用同一套事实引用、有效期、正文、行为事件和记忆闭环；差别只在展示位置与阅读方式。

`24` 是一次 AI 生成量，`8+4` 是一次 API 展示量，二者不能再混为一个合同。当前 iOS 每次接受 6–10 张大卡和 3–5 张中心卡，因此 8+4 不需要修改客户端，并能用两批恰好展示完 24 张。

## 6. 用四个独立维度学习兴趣，不把偏好做成一团标签

每张卡的 `content_profile` 固定为：

| 字段 | 回答的问题 | V1 值 |
|---|---|---|
| `domain` | 用户关心哪个人生领域 | `love`、`career`、`wealth`、`health`、`study` |
| `topic_key` | 该领域里具体关心哪类事 | 固定、可版本化目录；感情目录更细 |
| `question_job` | 用户想从这张卡得到什么 | `describe`、`explain`、`forecast`、`compare`、`act` |
| `content_horizon` | 内容属于哪个时间尺度 | `baseline`、`phase`、`year`、`month` |

这四个维度单独累积，而不是把“感情 + 新桃花 + 预测 + 流月”做成一个永远学不满的组合标签。

例如用户连续打开：

```text
love / conflict_and_repair / forecast / month
love / relationship_progress / forecast / month
```

下一批 AI 能理解为：用户最近偏好感情、预测、月度变化，且对冲突修复和关系推进更敏感。它不需要把用户永久写成“只爱看分手”，更不会因此把本月明显的工作变化藏起来。

### 6.1 V1 `topic_key` 目录

感情：`love_overview`、`emotional_pattern`、`attraction_preference`、`partner_fit`、`new_connection`、`relationship_progress`、`conflict_and_repair`、`commitment`、`separation_risk`、`external_interference`。

事业：`career_overview`、`career_direction`、`opportunity_and_change`、`workplace_relationships`、`decision_and_pressure`。

财富：`wealth_overview`、`income_opportunity`、`spending_and_risk`、`resource_allocation`、`money_decision`。

健康：`health_overview`、`energy_and_rhythm`、`sleep_and_stress`、`habit_adjustment`、`recovery_and_balance`。

学习：`study_overview`、`learning_strengths`、`focus_and_efficiency`、`exam_and_performance`、`skill_growth`。

`overall` 只可作为界面展示概览，不能作为可学习的兴趣领域；否则所有内容都会被塞进一个无法解释的桶。

## 7. 推荐逻辑：事实优先，AI 在事实范围内编排

AI 每次收到以下上下文，并在一次 Structured Output 调用中直接产出一个按优先级排列的 24 张完整候选池：

```text
recommendation_input
  fortune_facts               稳定原局事实 + 原局硬作用关系
  time_windows
    dayun_index               全部大运的干支与起止年份轻量索引，不带藏干和作用关系
    current_or_parent_dayun   当前起近期流月涉及的大运完整硬事实
    parent_liunian            近期流月涉及的父流年完整硬事实
    recent_12_liuyue          从当前流月开始、目标最多 12 个流月完整硬事实
    future_exploration        预算允许时最多 1 个远期流年或大运完整硬事实
  available_fact_refs         原局与所选时间窗口可引用事实的 ID、命名空间与有效期
  reality_context             用户明确保存的人生阶段、工作学业、关系状态和当前关注点
  preference_context
    long_term_90d             90 天缓慢累积的打开/展示统计
    recent_14d                最近 14 天的兴趣变化
    current_session_opens     本轮浏览刚刚打开的卡
  content_history             已展示/已打开过的语义键和时间
  time_window_history         本次所选窗口过去作为卡片主题的展示/打开次数和最近时间
```

时间检索先于 AI、只做成本和覆盖控制，不判断感情、事业、吉凶或事件。当前流月起的近期窗口始终优先；若 12 个流月跨越大运边界，对应的两个父大运和父流年都会带入。完整证据窗口硬上限为 16 个，`time_windows` 序列化后硬上限为 96 KB；超过预算时先删除远期探索，再从最远的近期流月开始整窗删除，至少保护当前起 6 个流月。一个窗口内的硬作用关系不会被截断。

时间边界使用命理时间，不使用公历年/月替代：流年从当年立春到下一年立春前一天，流月从本月节气到下一节气前一天，小寒月的结束点取下一公历年的立春；大运从命盘计算出的精确起运日切换。立春前仍属于上一流年，换运年也不会在 1 月 1 日提前切换。

远期探索只在预算剩余时加入一个窗口：近三年优先用流年，更远使用大运。选择顺序是“作为卡片主时间窗口曝光更少 → 更久未曝光 → 更近”；当前/近期窗口不会因曝光过就消失。若某个远期窗口传给 AI 但没有成为任何实际展示卡的主时间窗口，它不会被记为已曝光，下一次仍可能再次被检索。这是 MVP 的明确边界。

AI 的编排顺序固定为：

1. `p1_mingli_change`：当前有效且重要的命理变化。它的目标是“不漏掉真正此刻值得用户知道的变化”。
2. `p2_interest_match`：命理支持且命中长期、近期或会话兴趣的题。
3. `p2_baseline`：原局长期模式、偏好、适配或稳定能力，满足用户想理解“总体上我是怎样”的需求。
4. `p3_diversity`：仍有事实支持的相邻问题，防止卡组只剩一种题。

`selection_role` 记录“为什么这次推它”，它不是 UI 类型，也不是命理结论。

服务端不再做一次命理判断。它只执行两个可回放的展示动作：首批按 AI 的 `pool_position` 取前 12 张；展示面分配优先把更适合解释、描述、比较和长期理解的卡放入中心卡，其余进入大卡。次批包含全部剩余 12 张，先保持 `p1_mingli_change > p2_interest_match > p2_baseline > p3_diversity` 的命理优先层级，再在同一层内按当前会话打开的 `topic_key > domain > question_job > content_horizon` 依次加权重排，最后执行同样的展示面分配。这个轻量规则只改变顺序和位置，不增加、删除或改写 AI 已生成的命理内容，兴趣也不能把 P3 内容压到 P1 变化之前。

### 7.1 兴趣强度的轻量计算

服务端只把事件日志压缩成可读上下文，不训练模型，也不建向量库。每个维度分别按时间衰减：

```text
weight = 0.5 ^ (距离现在的天数 / 30)
smoothed_open_rate = (1 + 加权打开数) / (4 + max(加权曝光数, 加权打开数))
```

这让一次打开只是一点弱信号，反复打开才会形成偏好；曝光但没打开只是“给过机会”，不是负反馈。当前 MVP 没有收藏与“不感兴趣”按钮，未来增加时只要新增事件类型和权重，不需要改卡片合同或重建数据库。

14 天、90 天的兴趣扫描和四个内容维度聚合在 PostgreSQL 内完成，再把每个兴趣窗口最多 40 条信号、当前会话最近 20 次打开、最近 60 个语义历史交给 AI。内容兴趣与时间窗口记忆由一个 RPC 在同一数据库快照中返回，避免 open 恰好写入时出现两个记忆版本。当前会话另有 12 小时服务端上限，防止客户端重复使用旧 `session_id`。时间窗口记忆单独按 `primary_time_window_key` 聚合最近 90 天的 exposure/open，最多保留 100 个窗口；它解决“哪个时间段已经作为主题讲过”，不混进“用户喜欢什么内容”，也不参与同一候选池第二批的兴趣加分。未来问题只可引用 `time_windows` 内、带明确前缀的真实事实；服务端检查引用存在、主时间窗口属于实际引用窗口且时间尺度匹配，并检查引用时间相交。

推荐大卡和中心卡不接收流日，也不生成 `day` 时间尺度的问题。日级内容继续由首页日运承担，避免知识页被一天即失效的题目淹没。未来若产品验证需要“未来 30 天逐日提醒”，只需在 `time_windows` 增加可选日级窗口和独立数量上限，不需要新增第二套命理事实或推荐架构。

### 7.2 当前会话如何影响下一批

```text
用户打开卡 A
  -> 客户端上报 open（只含 batch/card/event ID）
  -> 数据库从已保存的卡片反查真实标签
  -> 用户请求首批之后的下一批
  -> 服务端读取 current_session_opens
  -> 只重排同一 24 张池里尚未展示的 12 张，不调用 AI
  -> 第二展示批次返回后，24 张候选池耗尽
  -> 再请求下一批时才调用 AI；新 AI 输入包含刚才的 open、14 天/90 天兴趣、语义历史和时间窗口历史
```

已经返回或正在生成的展示批次不取消、不重写。第一次展示后、第二次 `/next` 开始前收到的 open 会影响第二批排序；第二批已经创建后收到的 open 会进入下一次 24 张 AI 生成。这样用户正在看的内容不会闪变，并发重试也不会生成不同的排序。

## 8. 行为、记忆和安全边界

V1 只有两类行为：

| 事件 | 代表什么 | 不代表什么 |
|---|---|---|
| `exposure` | 卡确实被展示给用户，构成打开率分母 | 用户不喜欢 |
| `open` | 用户主动打开，构成弱正向兴趣 | 永久偏好、内容一定准确 |

划卡是浏览动作，不等于 dislike。若未来加收藏、不感兴趣、内容准确/不准确，事件表和偏好聚合能扩展；当前不提前假装已有负反馈。

行为写入不接受客户端自报的 `domain`、`topic_key`、`position` 或事实标签。客户端只提交不可重放的 `event_id`、`batch_id`、`candidate_id` 和事件类型；数据库从 READY 的不可变批次中派生真实标签，以及卡片冻结的 `primary_time_window_key` / `referenced_window_keys`。这避免客户端伪造兴趣或时间窗口。同一用户对同一批、同一张卡、同一种事件全局只记一次；换一个 `session_id` 不能把同一张卡的打开无限放大。`session_id` 让次批知道“这轮刚打开了什么”，时间窗口 exposure/open 则进入下一次新 AI 的检索与上下文。

## 9. 数据与并发：两张产品表 + 一张无内容成本账本

| 表 | 保存什么 | 为什么需要 |
|---|---|---|
| `recommendation_batches` | AI 根批次保存输入快照、不可变 24 张候选池、首批 8+4 和成功调用的模型/token/字节/延迟摘要；池续批只保存剩余 8+4 及其编排兴趣快照 | 能回放“AI 当时生成了什么、用户实际看到了什么、为何这样排序”，并量化成功调用成本 |
| `recommendation_events` | exposure/open 的不可伪造事件，以及从冻结卡片派生的内容和时间窗口标签 | 能形成短期、长期、会话和时间窗口记忆 |
| `recommendation_provider_attempts` | 无用户、命理或卡片正文的 provider 调用时间戳 | 独立于账户删除保留项目成本上限；不参与推荐或记忆 |

批次状态为 `generating`、`retry_wait`、`ready`。AI 根批次由一个 owner 通过 lease + epoch 生成，保存 24 张候选池和首批展示；第二批是 `generation_kind=pool` 的 READY 续批，通过数据库事务确认它恰好是候选池未展示的 12 张，不新增 provider attempt。相同首批的并发 `/next` 只能得到同一个续批 ID 和同一顺序。第二批耗尽后，才把它作为 `after_batch_id` claim 新的 AI 根批次。

READY 批次不可变。批次过期按用户 IANA 时区的本地 23:00 子初换日；单卡 `validity` 是其事实引用共同指向的目标窗口。原局长期题可没有结束日，流月题不会跨越其对应事实窗口；未来流月题可以今天展示、但必须明确指向具体年份或月份。用户旅行而切换时区时，系统不会把旧时区生成的卡和新时区的换日时间混用，而是使用新的时区槽位。

如果资料在 AI 生成中被修改，旧 worker 即使已经拿到正文也不能将它标为 READY，下一次请求会从新 revision 重新生成。被拦截或不可用的已 claim 批次会留在 `retry_wait`，不会被删除，因此仍可审计并继续计入成本保护。为避免同一个槽位因反复编辑资料无限重跑，单个槽位最多尝试 3 次；这仍不是对命理内容的判断。另有两个与命理无关的成本边界：每个用户在滚动 24 小时内最多新建 6 个批次，整个项目在滚动 24 小时内最多发起 100 次 provider 尝试。已有批次的读取和并发 join 不消耗新额度；任何会再调用 provider 的首次生成或重试都会受项目上限保护。项目上限命中时回退旧知识页，不凭空降级某个用户的命理内容。

数据库启用 RLS，但后端 service role 会绕过 RLS。因此 RPC 和 repository 仍要按 `user_id + bazi_profile_id` 做所有权过滤；所有事件必须确认批次属于当前用户且处于 READY。

## 10. API 合同与客户端行为

| API | 作用 | 成功状态 |
|---|---|---|
| `POST /api/v2/recommendations/next` | 读取现有 READY 批次或 claim 一次下一批生成 | `200 ready`、`202 generating`、`503 unavailable` |
| `GET /api/v2/recommendations/:batch_id` | 轮询或回读本人某一批，绝不触发新 AI 调用 | `200 ready/missing`、`202 generating/retry_wait`；不存在或非本人批次为 `404` |
| `POST /api/v2/recommendations/events` | 幂等写入 `exposure` 或 `open` | `200 accepted` 或重复事件确认 |

`POST /next` 必须提供 `bazi_profile_id`、IANA `timezone`、`session_id`，可选 `after_batch_id`。`POST /events` 必须提供 `event_id`、`batch_id`、`candidate_id`、`event_type` 和 `session_id`。响应包含 `deck_cards` 与 `center_cards`，详情页直接使用该卡的 `body`，不能再用旧洞察接口重新拼一篇泛化正文。

客户端约束：

1. 第一张实际显示时上报 exposure；不要在网络收到整批后把所有卡都算曝光。
2. 用户点击才上报 open；事件 ID 在重试时保持不变。同一批同一张卡的同类事件已经记过时，服务端返回 duplicate，不把换会话后的重复上报计入偏好。
3. 剩 2 张时预取下一批。首批后的预取只编排同池剩余 12 张，不调用 AI；第二批后的预取才可能生成新的 24 张。某一批次开始创建之后才发生的打开不会改写该 READY 批次，而进入下一次尚未开始的 AI 生成，因此预取后才打开的最后两张不会影响紧邻批次。
4. V1 feature flag 关闭、AI 不可用或批次处于 `retry_wait` 时，保留旧 `/api/insights/*` 作为可观察的回退，不把示例内容伪装成新推荐结果。
5. 当前客户端没有跨进程保存 `after_batch_id`；App 重启或页面状态重建后会再次读取当天首批。若 MVP 要求跨会话接着浏览，需要由 iOS 保存当前批次游标，或后端增加“当前展示批次”游标合同。

## 11. 失败时的产品行为

| 情况 | 后端动作 | 用户侧结果 |
|---|---|---|
| Gemini 超时或结构错误 | 批次进入 `retry_wait`，不保存半成品 | 继续看已有卡或使用旧洞察回退；不展示编造卡 |
| 模型或 AI 配置缺失 | 释放本次 lease 并保留为可立即重试的 `retry_wait`，不保存正文 | 直接使用旧洞察回退；配置修复后可重新发起 next，最多受单槽位尝试上限保护 |
| AI 引用不存在的事实 ID | 机械拒绝整个输出，记录错误原因 | 不把无法追溯的题目展示给用户 |
| 同时多个 next 请求 | 只有 owner 调 AI，其余请求轮询 | 不会因快速划卡生成多套相互矛盾的批次 |
| 24 小时内已经达到用户批次上限 | 不再开启新的 AI 调用；已有展示批次仍可回读 | 使用当前卡或旧洞察回退，不把成本限制伪装成命理结论 |
| 同一批次已尝试 3 次 | 不再重复调用 AI | 使用旧洞察回退；新的事实 revision 仍走新的受配额保护的槽位 |
| 项目 24 小时 provider 预算已满 | 不再开启新的 AI 调用 | 统一回退旧洞察；这不是用户内容质量或兴趣的负面判断 |
| 资料在 AI 生成中被编辑 | finalize 被并发资料版本拦截，旧正文不落库 | 下一次从新资料 revision 生成，不展示旧盘解释 |
| 用户时辰未知 | 事实包只含三柱，AI 看到三柱事实 | 不补午时、不暗示时柱、不把缺失时柱当已知 |
| 关系状态未知 | `reality_context.relationship.status=unknown` | 用“若单身 / 若已有伴侣”的条件句，不猜生活状态 |

## 12. 评测与上线门槛

离线结构评测不调用真实 Gemini，覆盖至少 100 个固定组合：五个领域、五种问题任务、四种时间尺度，以及三柱/四柱、关系状态、近期/长期/会话兴趣、时间事实有效期和虚构事实引用等边界。它证明：

- AI 输入包含但不补齐三柱事实；
- 卡片必须引用本次可用事实；
- 事实有效期正确交集到卡片有效期；
- 时间证据最多 16 个、总输入不超过 96 KB、无流日，超限时只删除完整窗口；
- 卡片主时间窗口必须来自其事实引用，并与阶段/流年/流月尺度匹配；
- topic/domain、枚举、24 张候选池、两次 8+4 展示、surface、位置和 ID 合同稳定；
- 第二展示批次只含首批未展示的 12 张，且不增加 AI/provider 调用；
- 伪造事实引用、重复 ID、无效窗口等结构错误会被拒绝；
- exposure/open 与内容标签、时间窗口标签的闭环可以被稳定记录。

它**不能**证明真实模型对“争执、分手、新桃花”等语义判断总是准确。上线前仍需用固定的人工命理样本审读实际模型输出，重点看：事实是否被误读、条件表达是否过强、P1 变化有没有被兴趣淹没、三柱/关系未知场景是否越界。该验收属于外部内容质量证据，当前状态为 `EXTERNAL_UNVERIFIED`。

## 13. 明确不在 MVP 做的事

- 不新增盲派确定性规则引擎；盲派解释首先通过 prompt 和事实包完成。
- 不做向量数据库、embedding 检索、ML 两阶段召回/排序、特征仓库或用户画像表。
- 不做服务端关键词黑名单、事件家族硬匹配或第二个 AI 裁判。
- 不把未打开/划走解释为负反馈。
- 不做收藏、不感兴趣、主动 push、自由聊天记忆或跨产品数据画像。
- 不因“填满卡组”制造没有事实依据的事件。

这些不是永久拒绝，而是 V1 先把“事实、24 张候选池、展示编排、行为、下一次生成”这一条闭环做对。后续任何一项扩展都应先复用 `RecommendationCandidate` / `CardCandidate`、不可变 batch 和事件日志，而不是另起一条推荐链路。

## 14. 实现落点与验证状态

| 层 | 本地实现落点 | 当前可证实的内容 | 仍待外部验证 |
|---|---|---|---|
| 命理事实与检索 | `DailyFortuneFactPackage`、`mingliInteractionEngine`、`recommendationTimeWindows.ts` | 完整时间线留在服务端；AI 只收最多 16 个完整证据窗口、96 KB、全大运轻索引、无流日 | 真实用户档案下 96 KB 触发率与命理覆盖质量 |
| AI 合同 | `api/src/models/Recommendation.ts`、`api/src/utils/recommendationAi.ts` | 一次 Structured Output、固定 24 张 surface-neutral 候选、严格 schema、事实/主时间窗口校验、成功调用 metrics | 固定模型能否在时限和输出上限内稳定生成 24 张完整卡 |
| 展示编排 | `api/src/services/recommendationService.ts` | 首批 8+4、打开后同池剩余 12 张重排、池耗尽后才再次调用 AI | 真实用户浏览节奏与排序效果 |
| 持久化 | `supabase/migrations/013_recommendation_engine.sql`、`014_recommendation_candidate_pool.sql`、repository | 旧 6+3 兼容、24 张根候选池、8+4 实际展示、幂等续批、内容/时间窗口聚合记忆、所有权与 RLS 合同 | 迁移是否已在 staging/production 执行 |
| HTTP | `api/api/[...path].ts`、`api/server.ts`、recommendation service | next / poll / events 路由合同 | 部署后真实 Bearer、并发和错误响应 |
| iOS | Insights DTO、service、view model、卡片详情 | 两个展示面和 exposure/open/prefetch 连接 | 真机/真实账号端到端体验 |
| Eval | `api/evals/recommendationStructuralCorpus.ts`、`api/tests/recommendationEval.test.ts` | 100 例离线结构边界 | 人工命理审读与线上指标 |

运行本地验收：

```bash
cd api
npm run type-check
npm run test:recommendations
npm run test:docs
```

仅当迁移 readback、RLS/RPC、真实 Gemini、iOS 真实账号链路和人工命理审读都留下日期与证据后，才可将该能力标为 `LIVE_VERIFIED` 或线上发布完成。上线前还要确认 `INVITE_CODE_REQUIRED=true`，停用历史无限邀请码，并在 Gemini/云账单侧设置独立的项目日预算；服务端项目上限是应用内保险，云账单上限才是最终花费保险。
