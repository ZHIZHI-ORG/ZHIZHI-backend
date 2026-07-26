# 八字 AI 后端命理架构 V2

> **Status:** ROADMAP
> **Release:** EXPERIMENTAL
> **Verification:** COMMITTED
> **Last verified:** 2026-07-11
> **Sources:** 当前计算/事实工具 + 本文目标架构；完整 V2 尚未实现

生成日期：2026-05-28
适用范围：知之后端、八字档案、命盘资料页、大运流年、每日运势、专题报告、受控追问、反馈校准
状态：架构设计稿，未进入实现

## 1. 产品结论

知之的命理 AI 后端不应该让大模型自由断命，而应该先由确定性命理引擎生成可追溯的结构化判断，再让 AI 负责解释、表达、追问和行动建议。

这对产品、用户体验和业务结果的意义是：

1. 用户看到的断命结果更稳定，同一命盘在资料页、流年页、每日运势和追问里不会互相矛盾。
2. 每个结论都有证据链，可以解释“为什么这么判断”，而不是只给玄学式断语。
3. AI 生成从“自由发挥”变成“基于命理证据的表达层”，能降低幻觉和越界风险。
4. 反馈校准可以逐步提升命盘个性化，但不会反向篡改基础排盘事实。
5. 这会直接影响信任、留存和付费转化，因为用户愿意为“准、稳、能解释、持续懂我”的体验付费。

一句话架构：

```text
出生资料和用户问题
  -> 命理编排器生成结构化证据包
  -> 多个确定性命理模块并行/半并行产出 JSON
  -> AI 基于证据包解释和生成
  -> 输出结果与用户反馈回流校准
```

## 2. 核心原则

### 2.1 确定性优先

确定性指同一输入在同一规则版本下得到同一结果。

排盘、真太阳时、四柱、大运、流年、流月、十神、藏干、合冲刑害、加权五行、格局候选、喜忌用神候选，都应该先由后端规则引擎生成。AI 不能自己重新计算或发明命理事实。

### 2.2 分层判断

不能从五行缺什么直接跳到用神，也不能从一个神煞直接跳到吉凶。

这里的分层是判断责任分层，不代表运行时必须串行。正确关系是：

```text
事实层：给证据
作用层：给关系
结构层：给格局和日主承载
用神层：给解决工具
时空层：给当前触发
AI 层：基于上述 JSON 统一解释
```

### 2.3 证据可追溯

每个对用户可见的重要结论都必须能回到具体证据：

- 哪个四柱、天干、地支、藏干、十神。
- 哪个合冲刑害、三合三会、墓库开合。
- 哪个大运、流年、流月、流日触发。
- 哪条历史事件或用户反馈影响了置信度。

### 2.4 AI 只做表达，不做事实源

LLM 是大语言模型，白话说就是负责把结构化信息写成自然语言的模型。

在知之后端里，LLM 的职责是：

- 把命理判断翻译成用户能理解的解释。
- 根据用户问题选择表达重点。
- 生成报告、建议和受控追问。
- 调整语气、深度和行动建议。

LLM 不负责：

- 独立排盘。
- 独立定格局。
- 独立决定喜忌用神。
- 发明用户没有提供的历史事件。
- 输出医疗、投资、婚恋等现实确定性承诺。

## 3. 当前后端现实

当前知之后端不是从零开始，已有关键底座：

| 能力 | 当前状态 | 主要位置 | V2 角色 |
| --- | --- | --- | --- |
| 档案创建和查询 | 已有 | `api/src/services/baziService.ts` | 输入层、输出合同层 |
| 真太阳时校准 | 已有 | `api/src/services/trueSolarTimeService.ts` | 排盘计算层 |
| 四柱、十神、藏干、大运流年 | 已有 | `api/src/utils/baziCalculator.ts` | 排盘计算层、事实层 |
| 加权五行 | 已有 | `weighted_wuxing_v2_9` | 能量层、日主强弱输入 |
| 神煞 | 已有 | `api/src/utils/shenShaCalculator.ts` | 辅助事实层 |
| 合冲刑害等干支作用 | 已有 | `api/src/utils/mingliInteractionEngine.ts` | 干支作用运算层 |
| 格局候选 | 已有阶段一 | `api/src/utils/patternJudgement.ts` | 子平结构引擎 |
| 大运流年流月展示 | 已有 | `getBaziLuckTimeline` / `getBaziLuckDisplayBundle` | 时空推演引擎 |
| 每日运势 AI 生成 | 已有 | `api/src/utils/geminiClient.ts` | AI 解析生成引擎 |
| 历史记录和追问 | 已有 | `fortuneService` / `history_records` | 输出层、反馈校准底座 |

当前主要缺口不是排盘事实，而是中间判断链：

```text
已有：命盘事实、五行评分、干支作用、格局候选、运势时间线
缺口：格局成败救应、喜忌用神仲裁、盲派事件信号、交叉验证、AI 合约化输入、反馈校准闭环
```

## 4. V2 总架构

V2 不是 11 层串行流水线。真实后端应该是一个命理编排架构：先完成少数硬依赖的基础计算，再把排盘事实、子平结构、盲派事件、时空触发、用户问题、历史反馈组装成同一个 JSON 证据包，最后交给 AI 生成解释。

白话说：

```text
不是：1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11

而是：
基础输入和排盘先稳定
  -> 多个命理判断模块围绕同一命盘并行产出结构化结果
  -> 编排器组装成 AI 可读的证据包
  -> AI 只基于这个证据包输出用户语言
  -> 反馈再回到校准层
```

### 4.1 运行时编排图

```text
┌──────────────────────────────────────────────────────────────┐
│ 输入上下文                                                     │
│ 出生信息 / 地点 / 性别 / 用户问题 / 历史事件 / 用户反馈          │
└───────────────────────────────┬──────────────────────────────┘
                                v
┌──────────────────────────────────────────────────────────────┐
│ 命理编排器 Mingli Orchestrator                                │
│ 选择任务类型、读取档案、决定需要哪些证据模块、组装 JSON 证据包   │
└───────────────┬───────────────────────────────┬──────────────┘
                v                               v
┌──────────────────────────────┐      ┌────────────────────────┐
│ 基础排盘和时空底座             │      │ 用户上下文底座           │
│ 真太阳时 / 四柱 / 大运流年流月  │      │ 问题 / 历史事件 / 反馈    │
└───────────────┬──────────────┘      └────────────┬───────────┘
                v                                  │
┌──────────────────────────────────────────────────┴───────────┐
│ 持久化和记忆底座 Persistence & Memory                         │
│ 命盘档案 / full_chart / 历史 artifact / 用户行为 / 校准档案      │
└───────────────────────────────┬──────────────────────────────┘
                                v
┌──────────────────────────────────────────────────┴───────────┐
│ 确定性命理证据模块，围绕同一命盘并行/半并行产出 JSON            │
│                                                              │
│  命盘事实层        干支作用运算层        五行和日主强弱层        │
│  子平结构引擎      盲派事件引擎          时空推演引擎            │
│  交叉验证引擎      反馈校准读取          安全和置信度检查        │
└───────────────────────────────┬──────────────────────────────┘
                                v
┌──────────────────────────────────────────────────────────────┐
│ AI Interpretation Contract                                    │
│ 把所有确定性模块结果、用户问题、限制条件、输出 schema 合成证据包 │
└───────────────────────────────┬──────────────────────────────┘
                                v
┌──────────────────────────────────────────────────────────────┐
│ AI 解析生成层                                                  │
│ 解释 / 报告 / 策略建议 / 受控追问，不重新排盘、不发明事实         │
└───────────────────────────────┬──────────────────────────────┘
                                v
┌──────────────────────────────────────────────────────────────┐
│ 输出和回流                                                     │
│ 用户可见 artifact / 历史记录 / 反馈事件 / 后续校准               │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 能力域依赖关系

| 能力域 | 运行方式 | 硬依赖 | 输出去向 |
| --- | --- | --- | --- |
| 输入层 | 请求入口 | 用户档案、用户问题 | 编排器 |
| 排盘计算层 | 必须先完成 | 出生信息、地点、性别 | 所有命理模块 |
| 持久化和记忆底座 | 全程读写 | 命盘档案、历史记录、用户行为、反馈 | 编排器、AI 合同、校准层 |
| 命盘事实层 | 排盘后立即生成 | 四柱、大运基础 | 子平、盲派、AI 合同 |
| 干支作用运算层 | 与事实层半并行 | 四柱、大运流年流月 | 子平、盲派、时空、验证 |
| 五行和日主强弱层 | 与事实层半并行 | 四柱、藏干、月令 | 子平、喜忌、AI 合同 |
| 子平结构引擎 | 事实层后运行，可与盲派并行 | 事实、五行、干支作用 | 结构判断、用神仲裁 |
| 盲派事件引擎 | 事实层后运行，可与子平并行 | 事实、宫位、干支作用 | 事件信号、历史匹配 |
| 时空推演引擎 | 排盘和干支作用后运行 | 大运、流年、流月、原局事实 | 当前触发、关键年份 |
| 交叉验证引擎 | 汇总后运行 | 子平、盲派、时空、历史事件 | 置信度、冲突处理 |
| AI 解析生成引擎 | 最后生成用户语言 | AI 合同证据包 | 报告、建议、追问 |
| 输出和反馈校准层 | 输出后回流 | 用户行为、确认否认 | 后续置信度和个性化 |

### 4.3 关键架构判断

- 11 个模块是能力域，不是 11 个同步串行步骤。
- 排盘计算层是硬前置，因为没有四柱就没有事实、结构和时空判断。
- 命盘事实、干支作用、五行能量是确定性证据底座，应该尽量结构化缓存。
- 记忆和持久化是一等基础设施，不是反馈层的附属能力；它同时服务档案读取、AI 上下文、历史回看、评估复盘和个性化校准。
- 子平结构和盲派事件是两条并行判断视角，分别服务结构定性和事件应象。
- 交叉验证不是命理知识层，而是质量控制层，负责冲突、置信度、时辰敏感性和历史事件匹配。
- AI 看到的不是零散字段，而是编排器组装后的 `ai_interpretation_contract`。
- 部分输出可以不经过 AI，例如资料页事实、关系面板、时间轴数据；需要自然语言解释、报告和追问时才进入 AI。

### 4.4 记忆和持久化位置

记忆和持久化不应该只放在最后的反馈校准层。它是贯穿全链路的底座，分成四类。

| 存储 | 保存什么 | 当前基础 | 产品用途 |
| --- | --- | --- | --- |
| 命盘事实存储 | 出生资料、真太阳时、四柱、`full_chart`、规则版本 | `bazi_profiles` | 保证同一档案的资料页、流年页、AI 报告口径一致 |
| Artifact 存储 | 每次生成的报告、每日运势、追问答案、证据引用、模型版本 | `history_records` | 历史回看、去重、复盘、问题追责 |
| 用户记忆存储 | 点击、追问、收藏、跳过、确认、否认、偏好、疲劳 | `user_interactions` 可扩展 | 个性化排序、表达深度、避免重复打扰 |
| Trace/Eval 存储 | prompt 版本、输入证据包、模型、成本、schema 校验、评测结果 | 需要新增 | 调试生成质量、控制成本、防止 prompt 回退 |

运行时关系：

```text
编排器读取：
  命盘事实存储 + 用户记忆存储 + 历史 artifact

AI 生成后写入：
  artifact 存储 + trace/eval 存储

用户反馈后写入：
  用户记忆存储 + 校准档案

下一次生成再读取：
  更新后的记忆、校准和历史 artifact
```

边界：

- 命盘事实存储保存客观排盘结果，不能被用户反馈直接改写。
- 用户记忆存储保存偏好和反馈，只影响排序、置信度和表达策略。
- Artifact 存储保存“已经展示给用户的成品”，用于历史回看和复盘。
- Trace/Eval 存储保存“这次 AI 为什么这么生成”，用于工程调试和质量评估，不一定直接展示给用户。

## 5. 分层设计

### 5.1 输入层

职责：

- 接收出生年、月、日、时、分钟、出生地、经纬度、时区、性别、是否农历。
- 接收用户问题，例如事业、财运、婚恋、健康、关键年份。
- 接收历史事件，例如升学、换工作、分手、结婚、生病、搬迁。
- 接收用户反馈，例如准、不准、有共鸣、无感、事件发生年份。

产品边界：

- 出生资料是排盘事实源。
- 用户问题只影响解释重点，不改变命盘。
- 历史事件和反馈只影响校准和置信度，不直接改写四柱。

建议输入结构：

```yaml
mingli_request:
  profile_id: string
  birth_input:
    birth_year: number
    birth_month: number
    birth_day: number
    birth_hour: number | null
    birth_minute: number | null
    is_lunar: boolean
    birth_timezone: string
    birth_longitude: number | null
    birth_latitude: number | null
    gender: male | female
  user_question:
    domain: overall | career | wealth | love | health | study
    text: string
    time_range: current | year | decade | lifetime | custom
  historical_events: []
  feedback_context: []
```

### 5.2 排盘计算层

职责：

- 农历、公历转换。
- 真太阳时校正。
- 节气边界确认。
- 四柱生成。
- 大运顺逆和起运。
- 流年、流月、流日生成。

当前可复用：

- `normalizeBirthTimeForBazi(...)`
- `calculateFullChart(...)`
- `majorCycles`
- `annualLuck`
- `monthlyLuck`
- `buildDailyLuckData(...)`

关键规则：

- 有经纬度时按真太阳时排盘。
- 无经纬度时按标准时间排盘，并在置信度里保留限制。
- 流月必须按节气起点，不按自然月简单切分。
- 性别影响大运顺逆和起运，不改变原局四柱。

输出合同：

```yaml
chart_calculation:
  method_version: bazi_chart_v2
  time_basis: true_solar_time | standard_time
  true_solar_correction_minutes: number | null
  pillars:
    year: {}
    month: {}
    day: {}
    hour: {}
  luck:
    start_age: number
    start_date: string
    is_forward: boolean
    major_cycles: []
```

### 5.3 命盘事实层

职责：

- 输出命盘中客观出现的事实。
- 给后续判断层提供证据。
- 不直接下吉凶结论。

事实包括：

- 四柱干支。
- 天干五行、地支五行。
- 天干十神、藏干十神。
- 地支藏干。
- 十二长生、自坐十二长生。
- 纳音、空亡。
- 神煞辅助。
- 五行加权分。
- 日主强弱事实。

当前可复用：

- `docs/mingli-fact-layer-rules.md`
- `docs/weighted-wuxing-v2-9-algorithm.md`
- `docs/day-master-wangshuai-fact-layer-rules.md`

边界：

- 神煞只做辅助证据，不单独定吉凶。
- 五行强弱只提供能量结构，不直接等于喜忌。
- 日主强弱提供扶抑方向，不直接等于最终用神。

### 5.4 干支作用运算层

职责：

- 识别原局内部的天干、地支作用。
- 识别大运、流年、流月、流日对原局的引动。
- 为格局成败、喜忌仲裁、事件触发提供关系证据。

核心规则：

- 天干生克。
- 天干五合与合化条件。
- 地支六合、六冲、三刑、六害、六破。
- 三合、三会、半合、拱合、拱会。
- 伏吟、反吟、暗合。
- 墓库开合。
- 合化是否成立。
- 作用后力量重估。

当前可复用：

- `MINGLI_INTERACTION_RULE_VERSION`
- `buildNatalMingliInteractions(...)`
- `buildTimingMingliInteractions(...)`
- `buildMingliFactPanel(...)`

V2 需要补强：

- 合化成立条件要区分命中、可成、不可成。
- 墓库开合要服务事件和用神判断，而不只是展示关系。
- 力量重估要输出“关系影响了哪个五行、十神、宫位、格局候选”。

输出合同：

```yaml
mingli_interactions:
  rule_version: mingli_interactions_v2
  natal_interactions: []
  timing_interactions: []
  transformed_power:
    affected_elements: []
    affected_ten_gods: []
    affected_patterns: []
  fact_panel: {}
```

### 5.5 子平结构引擎

子平结构引擎负责判断命盘结构。白话说，它决定这张命盘先从哪个结构入口看，而不是看到五行缺什么就直接补什么。

职责：

- 判断月令司令。
- 判断调候需求。
- 判断日主承载力。
- 判断普通格局和特殊格局。
- 判断成格、败格、破格、救应。
- 仲裁用神：格局、调候、扶抑、病药、通关。

当前可复用：

- `docs/mingli-pattern-judgement-rules.md`
- `docs/mingli-xiji-yongshen-tiaohou-rules.md`
- `buildPatternCandidates(...)`
- `weightedWuxing.dayMasterStrength`

执行顺序：

```text
1. 读取月令、日主、藏干、透干。
2. 判断月令司令和季节气候。
3. 判断日主强弱和承载力。
4. 生成格局候选。
5. 判断成格、败格、破格、救应。
6. 检查从格、专旺格、化气格等特殊结构。
7. 输出主格局、辅助格局和冲突项。
8. 生成调候、扶抑、通关、病药用神候选。
9. 合并排序，输出主用神、辅用神、喜神、忌神。
10. 输出置信度和证据链。
```

输出合同：

```yaml
pattern_judgement:
  method_version: pattern_judgement_v1
  primary_pattern:
    id: string
    name: string
    family: regular | mixed_qi | special | lu_ren
    status: candidate | probable | confirmed | rescued | mixed | broken | rejected
    confidence: high | medium | low
    evidence: []
    success_hits: []
    failure_hits: []
    rescue_hits: []
    unresolved_conflicts: []
  secondary_patterns: []
  special_patterns: []
  rejected_patterns: []

mingli_judgement_analysis:
  method_version: mingli_judgement_v1
  climate_adjustment:
    status: balanced | cold | hot | dry | damp | mixed
    primary_need: string
    favorable_elements: []
    unfavorable_elements: []
    evidence: []
  day_master_strategy:
    strength_label: string
    strategy: support | drain | balance | transform | uncertain
    favorable_ten_gods: []
    unfavorable_ten_gods: []
    evidence: []
  structural_imbalance:
    disease_points: []
    medicine_candidates: []
    evidence: []
  use_god_candidates:
    primary: []
    secondary: []
    alternatives: []
    confidence: high | medium | low
    reasons: []
  favorable:
    elements: []
    ten_gods: []
  unfavorable:
    elements: []
    ten_gods: []
  cautions:
    limitations: []
    special_pattern_risks: []
```

### 5.6 盲派事件引擎

盲派事件引擎负责从宫位、十神、干支取象和做功关系中提取事件信号。白话说，它不是先讲格局高低，而是看“哪些位置、哪些象、哪些年份容易应事”。

职责：

- 宫位定位：年、月、日、时、夫妻宫、父母宫、子女宫、事业环境等。
- 十神取象：财、官、印、食伤、比劫对应的人事物。
- 干支取象：天干外显，地支内藏，藏干为暗线。
- 宾主关系：谁是我方，谁是外部，谁来作用谁。
- 做功应象：哪个字参与冲合刑害、被引动、被打开、被制化。

产品边界：

- 盲派事件信号适合做“历史事件匹配”和“应期提示”。
- 子平结构决定主判断框架，盲派事件引擎提供事件验证和场景化解释。
- 两者冲突时，不直接覆盖，进入交叉验证引擎。

输出合同：

```yaml
blind_event_signals:
  method_version: blind_event_signals_v1
  palace_signals:
    - palace: spouse | career | wealth | parents | children | self
      symbol: string
      evidence: []
      risk_or_theme: string
  ten_god_images: []
  host_guest_relations: []
  working_effects:
    - actor: string
      target: string
      action: combine | clash | punish | harm | break | reveal | open_storage
      event_hint: string
      confidence: high | medium | low
```

### 5.7 时空推演引擎

时空推演引擎负责把原局、大运、流年、流月、流日放在同一张时间图上。白话说，原局说明底层结构，大运说明十年环境，流年流月说明当前触发。

职责：

- 判断当前大运阶段。
- 判断流年触发。
- 判断流月应期。
- 判断流日是否适合做短期提示。
- 计算原局-大运-流年三层互动。
- 用子平看扶格破格，用盲派看引动应象。

当前可复用：

- `getBaziLuckTimeline(...)`
- `getBaziLuckDisplayBundle(...)`
- `buildTimingMingliInteractions(...)`

关键边界：

- 大运流年可以改变短期体感，不改变原局基础喜忌。
- 流月适合做应期和提醒，不适合输出重大终身判断。
- 流日适合做轻量行动建议，不适合重断人生大事。

输出合同：

```yaml
timing_trigger_analysis:
  method_version: timing_trigger_v1
  source_date: string
  active_context:
    dayun: {}
    liunian: {}
    liuyue: {}
    liuri: {}
  triggered_facts: []
  pattern_impact:
    support_primary_pattern: []
    damage_primary_pattern: []
    rescue_signals: []
  useful_god_impact:
    supports: []
    harms: []
    neutral: []
  domain_impacts:
    overall: {}
    career: {}
    wealth: {}
    love: {}
    health: {}
    study: {}
  key_years: []
  confidence: high | medium | low
```

### 5.8 交叉验证引擎

交叉验证引擎负责处理冲突、校准和置信度。白话说，它判断“这个结论有多稳，有哪些反证，需不需要降级或提示不确定”。

职责：

- 历史事件匹配。
- 时辰敏感性检测。
- 多规则冲突检测。
- 置信度评分。
- 判断路径修正。

必须降置信度的情况：

- 出生时间未知。
- 出生地经纬度缺失且存在跨时辰风险。
- 真太阳时校正后接近时辰边界。
- 日主强弱接近临界值。
- 五行分数和十神结构方向冲突。
- 格局候选混杂，破救并见。
- 疑似从格、化格、专旺格但证据不足。
- 历史事件反馈与当前时辰不匹配。

输出合同：

```yaml
cross_validation:
  method_version: cross_validation_v1
  confidence_score: number
  confidence_label: high | medium | low
  matched_events: []
  unmatched_events: []
  hour_sensitivity:
    status: stable | sensitive | unknown
    alternative_hours: []
    changed_outputs: []
  rule_conflicts:
    - conflict: string
      affected_conclusion: string
      resolution: keep | downgrade | split | ask_user
      reason: string
  correction_suggestions: []
```

### 5.9 AI 解析生成引擎

AI 解析生成引擎负责把结构化结论变成用户语言。它不直接断命，只解释确定性引擎已经输出的结论。

职责：

- 匹配用户问题。
- 生成命局画像。
- 生成事业、财运、婚恋、健康等专题报告。
- 生成大运流年时间轴解释。
- 生成行动建议。
- 生成受控追问。

当前问题：

`geminiClient` 当前主要拼接四柱、五行、今日流年流月和简单兴趣权重，容易让 AI 在缺少中间判断层时自由发挥。

V2 改造方向：

```text
旧方式：profile + 简单五行 + prompt -> LLM 输出
新方式：chart facts + judgement + timing + validation + user question -> AI contract -> LLM 输出
```

AI 输入合同：

```yaml
ai_interpretation_contract:
  contract_version: ai_mingli_contract_v1
  task:
    output_type: chart_profile | topic_report | yearly_timeline | daily_advice | followup_answer
    domain: overall | career | wealth | love | health | study
    user_question: string
  evidence_pack:
    chart_facts: {}
    mingli_interactions: {}
    pattern_judgement: {}
    mingli_judgement_analysis: {}
    timing_trigger_analysis: {}
    cross_validation: {}
  user_context:
    memory_summary: {}
    feedback_summary: {}
    style_preference: {}
  safety_policy:
    forbidden_claims:
      - medical certainty
      - investment certainty
      - marriage certainty
      - death or disaster certainty
      - fabricated evidence
    required_disclaimers: []
  output_schema:
    conclusion: string
    evidence: []
    explanation: string
    advice: []
    follow_up_questions: []
```

### 5.10 输出层

输出层负责把后端判断变成产品可展示内容。

主要输出：

- 命局画像。
- 事业专题。
- 财运专题。
- 婚恋专题。
- 健康专题。
- 学习专题。
- 大运流年时间轴。
- 关键年份。
- 今日行动建议。
- 受控追问。

输出原则：

- 用户看到的是结论和建议。
- 高级用户可以展开证据链。
- 每个结论要能回溯到规则版本和证据。
- 低置信度结论要明确表达限制，不强行断言。

建议统一 artifact：

```yaml
mingli_artifact:
  artifact_id: string
  profile_id: string
  source_date: string
  artifact_type: chart_profile | topic_report | timeline | daily_fortune | drilldown
  rule_versions:
    chart: string
    interactions: string
    pattern: string
    judgement: string
    timing: string
    ai_contract: string
  conclusion_blocks: []
  evidence_refs: []
  confidence: {}
  ai_output: {}
  created_at: string
```

### 5.11 反馈校准层

反馈校准层负责把用户反馈变成可计算校准信号。

职责：

- 用户确认或否认。
- 用户补充关键事件。
- 时辰校准。
- 个性化命盘档案。
- 表达偏好学习。

关键边界：

- 用户反馈不能改写出生事实。
- 用户反馈不能直接改写四柱。
- 用户反馈可以改变时辰候选的置信度。
- 用户反馈可以改变专题排序、解释深度和表达方式。
- 用户反馈可以让交叉验证引擎要求重新评估部分判断。

输出合同：

```yaml
calibration_profile:
  profile_id: string
  version: number
  known_events:
    - event_type: string
      year: number
      month: number | null
      confidence: high | medium | low
      user_confirmed: boolean
  feedback_summary:
    accurate_patterns: []
    inaccurate_patterns: []
    preferred_domains: []
    avoided_domains: []
  hour_calibration:
    status: not_needed | needs_more_events | likely_adjusted | unresolved
    candidate_hours: []
    evidence: []
  personalization:
    directness: number
    explanation_depth: number
    actionability: number
```

## 6. 判断链路

完整断命不是单线串行链路，而是一个“基础计算 + 并行证据模块 + 汇总验证 + AI 生成”的运行图。

```text
阶段 A：基础计算
  出生资料 -> 真太阳时 -> 四柱 -> 大运/流年/流月/流日

阶段 B：确定性证据模块
  命盘事实
  干支作用
  五行能量与日主强弱
  子平格局和喜忌用神
  盲派事件信号
  时空触发分析

阶段 C：质量控制
  历史事件匹配
  时辰敏感性检测
  子平/盲派/时空冲突检测
  置信度评分

阶段 D：AI 生成和输出
  ai_interpretation_contract
  -> 用户可见解释、报告、建议、受控追问
  -> artifact 保存
  -> 反馈校准
```

最重要的因果链：

```text
事实稳定
  -> 多模块证据一致
  -> 判断可追溯且可验证
  -> AI 不乱编
  -> 用户信任提高
  -> 历史反馈可校准
  -> 长期个性化更准
```

## 7. 规则冲突处理

命理判断一定会遇到冲突，V2 必须显式处理，而不是让 AI 自己调和。

| 冲突 | 处理方式 |
| --- | --- |
| 五行分数强，但结构上不一定忌 | 以结构判断层仲裁，五行只做证据 |
| 调候用神和扶抑用神不同 | 输出主次，不强行合并 |
| 子平结构和盲派事件信号不同 | 进入交叉验证，引导为“结构判断”和“事件信号”两类 |
| 原局喜忌和当前流年体感不同 | 区分原局基础喜忌和短期触发 |
| 历史事件不匹配 | 降置信度，提示可能是时辰或事件类型需要补充 |
| 神煞与格局判断冲突 | 神煞降为辅助，不覆盖格局 |

## 8. 分期路线

### 阶段一：架构和合同锁定

目标：

- 完成本文档。
- 明确 11 层架构。
- 明确各层边界和输出合同。
- 不动现有线上功能。

验收：

- 文档能指导后续实现。
- 每个新增输出都有上游证据来源。
- 没有把 AI 放在事实源位置。

### 阶段二：子平结构和喜忌用神最小闭环

目标：

- 从现有 `pattern_candidates` 升级到 `pattern_judgement`。
- 实现 `mingli_judgement_analysis` 最小版本。
- 先覆盖调候、扶抑、通关、病药候选。

验收：

- 可以解释“为什么喜某五行或十神”。
- 可以解释“为什么忌某五行或十神”。
- 每个候选都有证据和置信度。

### 阶段三：时空推演和事件信号

目标：

- 实现 `timing_trigger_analysis`。
- 实现 `blind_event_signals` 的 v1。
- 把大运、流年、流月与产品专题关联。

验收：

- 可以输出关键年份。
- 可以解释某年某月为什么被触发。
- 可以把事业、财运、婚恋、健康等专题和命理触发关联。

### 阶段四：AI 合同化生成

目标：

- 让 `generateDailyFortune` 读取 `ai_interpretation_contract`。
- 把 prompt 从大段自由描述改为结构化证据输入。
- 增加输出 schema 校验。

验收：

- AI 输出不引用不存在的命理证据。
- AI 输出能回溯证据链。
- API Key 缺失时仍能用确定性 mock 或降级内容支持前端。

### 阶段五：反馈校准闭环

目标：

- 保存用户确认、否认和历史事件。
- 支持时辰敏感性检测。
- 生成个性化校准档案。

验收：

- 反馈只影响置信度、排序和表达偏好。
- 反馈不会篡改原始命盘。
- 同一用户长期使用后，专题排序和解释重点可以变得更贴近。

## 9. 测试方案

### 9.1 排盘计算测试

- 公历输入。
- 农历输入。
- 真太阳时跨时辰。
- 真太阳时跨日期。
- 无经纬度降级到标准时间。
- 大运顺逆。
- 起运年龄和起运日期。
- 流月节气起点。

### 9.2 事实层测试

- 十神计算。
- 藏干和藏干十神。
- 十二长生。
- 空亡。
- 神煞。
- 加权五行。
- 日主强弱。
- 合冲刑害。
- 三合三会。
- 暗合、伏吟、墓库。

### 9.3 结构判断测试

- 身强。
- 身弱。
- 接近平衡。
- 寒重。
- 火炎土燥。
- 财旺身弱。
- 官杀重。
- 食伤过泄。
- 印旺身强。
- 比劫重财弱。
- 疑似从格。
- 疑似化气格。
- 格局破而有救。

### 9.4 时空推演测试

- 原局被大运引动。
- 原局被流年冲合。
- 大运和流年形成三层互动。
- 流月触发但不改写原局喜忌。
- 关键年份排序稳定。

### 9.5 AI 合同测试

- 不允许 AI 发明四柱和十神。
- 不允许 AI 发明历史事件。
- 不允许 AI 把低置信度结论写成绝对断言。
- 不允许 AI 输出医疗、投资、婚恋确定性承诺。
- 必须引用合同里的证据。
- 必须符合输出 schema。

### 9.6 反馈校准测试

- 用户确认事件提高相关时辰候选置信度。
- 用户否认事件降低相关判断置信度。
- 多次反馈不准触发降级。
- 表达偏好影响文案深度，不影响命盘事实。

## 10. 主要风险

| 风险 | 影响 | 控制方式 |
| --- | --- | --- |
| 命理规则过早做满 | 实现慢，难验证 | 先做高频主链路，保留版本号 |
| AI 自由发挥 | 结论不稳，信任下降 | AI contract + schema 校验 + 证据引用 |
| 事实层和判断层混在一起 | 后续难维护 | 强制分层输出 |
| 反馈反向污染命盘 | 用户档案失真 | 反馈只影响置信度和校准，不改四柱 |
| 盲派和子平冲突 | 输出互相打架 | 交叉验证层显式拆分结构判断和事件信号 |
| 低置信度仍强断 | 用户体验受损 | 输出层必须显示限制和不确定性 |

## 11. 不在当前阶段做

当前阶段不做：

- 开放聊天机器人。
- 完整多 Agent runtime。
- 向量数据库记忆。
- 所有古籍外格全集。
- 医疗、投资、婚恋确定性预测。
- 用用户反馈自动改生日或改四柱。
- 一次性重写现有 `baziCalculator`。

当前阶段要做的是：把断命架构和层间合同锁定，让后续每次实现都知道自己属于哪一层、读取什么输入、输出什么证据、不能越过什么边界。

## 12. 最小实现路径

推荐最小路径：

```text
1. 保持现有排盘、加权五行、事实层不动。
2. 新增 Mingli Orchestrator，负责按任务组装证据包，不负责命理判断。
3. 在现有 pattern_candidates 之后新增 pattern_judgement。
4. 在 pattern_judgement 旁边新增 mingli_judgement_analysis。
5. 在 luck timeline 旁边新增 timing_trigger_analysis。
6. 让子平结构、盲派事件、时空触发都进入同一个 ai_interpretation_contract。
7. 把 AI prompt 改成读取 ai_interpretation_contract。
8. 把最终输出保存为 mingli_artifact。
9. 最后接入 feedback calibration。
```

这样收益最大、风险最小：

- 不推翻现有前后端合同。
- 不破坏当前资料页和流年页。
- 先补齐最影响“准不准”的判断层和编排层。
- 允许事实、子平、盲派、时空等模块并行产出 JSON，避免误建成 11 层串行链路。
- 再让 AI 输出变得可控。
- 最后用反馈做长期个性化。
