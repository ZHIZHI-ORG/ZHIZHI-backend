# 知之 AI 个性化与主动问题规划架构

> **Status:** ROADMAP
> **Release:** EXPERIMENTAL
> **Verification:** COMMITTED
> **Last verified:** 2026-07-11
> **Sources:** 当前 fortune/history/interaction 实现 + 本文目标模块；记忆与规划架构尚未实现

生成日期：2026-05-15
适用范围：知之后端、iOS 首页/知之页、每日推送、受控下钻问题、历史回看
状态：方案评估稿，未进入实现

## 1. 结论

知之要学习主流 AI app 的方向，不是把产品做成开放聊天机器人，而是把 AI 能力拆成四件事：

1. 记忆可控：用户知道知之记住了什么，也能关闭、查看、删除。
2. 上下文精准：每次生成只拿和当前任务相关的命理证据与用户偏好。
3. 结果可评估：prompt 每次改动都能用固定样本评测，不靠主观感觉。
4. 成品可追溯：最终推给用户的问题、解释、证据链、版本都能回放。

对知之最适合的架构是：

```text
确定性命理引擎
  -> 用户记忆系统
  -> 主动问题规划器
  -> Prompt Contract
  -> Eval Gate
  -> Accepted Artifact
```

白话说：命理判断尽量确定，用户偏好持续学习，LLM 负责把判断翻译成用户能理解、愿意行动、不会误解的语言。

## 2. 为什么这对产品重要

用户真正感知到的不是“AI 架构先进”，而是这三个结果：

1. 今天推的问题像是为我生成的。
2. 它能解释为什么今天问这个，而不是泛泛说运势。
3. 它会随着我的点击、追问、反馈变得更懂我。

这直接影响：

- 推送打开率：问题是否击中当天状态。
- 留存：用户是否觉得知之持续理解自己。
- 付费信任：用户是否相信更深度的解释值得付费。
- 品牌差异化：知之不是通用聊天，而是主动式命理陪伴。

## 3. 主流 AI App 的可参考实践

| 主流实践 | 白话解释 | 代表参考 | 对知之的价值 | 是否采用 |
|---|---|---|---|---|
| Memory controls | 用户能控制记忆开关、查看、删除 | ChatGPT Memory、Claude Memory | 建立信任，避免用户觉得被偷偷记住 | 采用 |
| Layered memory | 短期记忆、长期偏好、项目/用户规则分层 | Claude memory、LangGraph persistence | 区分最近兴趣和长期偏好 | 采用 |
| Context pack | 每次只注入相关上下文 | RAG / agent context packing | 降低幻觉，减少无关历史干扰 | 采用 |
| Evals | 用固定测试集衡量 AI 输出好坏 | OpenAI Evals、Prompt Optimizer | prompt 迭代可验证 | 采用 |
| Tracing | 记录一次 AI 运行的每一步 | OpenAI Agents tracing | 方便调试问题生成失败原因 | 后台采用 |
| Accepted artifacts | 生成过程和最终成品分离 | Claude artifacts / agent reports | 历史回看、可复盘、可解释 | 采用 |
| Multi-agent orchestration | 多 agent 协作完成复杂任务 | OpenAI Agents、LangGraph | 长期有用，当前容易过度工程 | 暂缓 |
| Full vector memory | 把大量历史对话向量化检索 | 通用 RAG app | 对知之不应作为第一层记忆 | 暂缓 |

术语说明：

- RAG：检索增强生成。先从数据库取相关资料，再让模型生成。
- Eval：评测集。用固定样本持续测试 prompt 是否变好。
- Trace：运行轨迹。记录 AI 每一步输入、输出、工具调用和错误。
- Artifact：可保存成品。最终被产品展示或推送的稳定结果。

## 4. 知之不应该照搬的部分

### 4.1 不做开放聊天优先

开放聊天会带来三个问题：

1. 用户问题不可控，命理边界和安全边界难守。
2. 记忆会变成大量文本堆积，后续检索噪音大。
3. 产品差异化会从“主动命理洞察”滑向“普通 AI 问答”。

知之已有受控下钻问题链路，方向是对的：问题由后端生成，用户点击后再获得 AI 答案。

### 4.2 不把长期记忆直接做成向量库

向量库适合检索文档，不适合作为第一层用户画像。知之真正需要的不是“找回某句话”，而是判断：

- 用户近期更关心哪个领域。
- 用户对哪类问题更愿意追问。
- 哪些内容被跳过或反馈不准。
- 哪种表达方式更有效。

这些应优先做成结构化记忆，再在后期补充向量检索。

### 4.3 不先上重型多 Agent

多 Agent 架构适合长任务、多工具、多角色协作。知之当前核心目标是提升每日推送问题精准度，不需要一开始引入完整 agent runtime。

当前更高收益的路径是：轻 orchestration，重因子、重记忆、重评估。

## 5. 当前后端现实

当前知之后端已经具备一些关键底座：

1. `bazi_profiles.full_chart` 已能保存完整命盘结果，包括十神、藏干、神煞、大运等。
2. `fortuneService` 已经把每日内容写入 `history_records`，有 accepted artifact 的基础。
3. `fortune/drilldown` 已经是后端生成候选问题，用户点击后回答，不是自由聊天。
4. `user_interactions` 已有行为表，但目前主要是分类点击次数，没有时间衰减、负反馈和问题级记忆。
5. `geminiClient` 当前 prompt 主要拼接四柱、日主、五行、流年流月和简单兴趣权重，缺少命理判断中间层。

因此问题不是从零开始，而是把现有底座升级成：

```text
命盘事实
  -> 命理因子
  -> 用户记忆
  -> 候选问题
  -> 稳定 prompt contract
  -> 评估通过后保存
```

## 6. 推荐目标架构

```text
用户出生资料 + 历史行为 + 反馈
        |
        v
Chart Engine
确定性命盘事实：四柱、真太阳时、五行、十神、神煞、大运流年
        |
        v
Fate Factor Engine
命理判断因子：日主强弱、格局候选、用忌神、流年流月触发、领域影响
        |
        v
Memory Fabric
用户记忆层：短期兴趣、长期偏好、负反馈、疲劳控制、表达偏好
        |
        v
Question Planner
候选问题池：生成 10-20 个问题，排序出今日最值得推的 1-2 个
        |
        v
Prompt Contract Engine
把命理因子和用户记忆转换成稳定系统语言
        |
        v
LLM Generation
只负责表达、解释、场景化建议，不独立发明命理结论
        |
        v
Eval Gate
结构校验、命理证据校验、安全边界、表达质量检查
        |
        v
Accepted Artifact Store
保存最终推送问题、解释、证据链、模型版本、prompt 版本
```

## 7. 核心模块设计

### 7.1 Chart Engine：命盘事实层

职责：

- 计算四柱、真太阳时、五行、十神、神煞、大运、流年、流月。
- 保证同一出生信息得到稳定结果。
- 不负责生成用户文案。

当前可复用：

- `api/src/utils/baziCalculator.ts`
- `api/src/services/baziService.ts`
- `bazi_profiles.full_chart`

需要补强：

- 明确当前日、流年、流月、流日的统一日历源。
- 不再使用仅供 prompt 的简化 `getTodayGanZhi()` 作为关键判断依据。

### 7.2 Fate Factor Engine：命理判断层

职责：

- 把 raw chart 转成专业命理师判断会用的结构化因子。
- 输出可解释证据，而不是直接输出文案。

建议 v1 因子：

```ts
type FateFactorSnapshot = {
  version: number;
  profile_id: string;
  source_date: string;
  day_master: string;
  day_master_strength: "weak" | "balanced" | "strong" | "unknown";
  useful_god_candidates: string[];
  avoid_elements: string[];
  dominant_ten_gods: string[];
  current_cycle: {
    major_cycle?: string;
    annual_luck?: string;
    monthly_luck?: string;
  };
  domain_scores: {
    overall: number;
    career: number;
    love: number;
    health: number;
    study: number;
  };
  triggers: Array<{
    domain: string;
    type: string;
    strength: number;
    evidence: string;
  }>;
};
```

设计原则：

- 先覆盖 8-12 个最影响推送的问题因子，不追求一次建完整命理体系。
- 每个因子必须有 evidence，方便后续解释和评估。
- 用户偏好不能覆盖命理事实，只能影响排序和表达重点。

### 7.3 Memory Fabric：用户记忆层

职责：

- 把用户行为和反馈转成可计算偏好。
- 区分短期兴趣和长期稳定偏好。
- 支持用户控制记忆。

建议记忆分层：

| 层 | 保存什么 | 用途 | 生命周期 |
|---|---|---|---|
| Event Log | 点击、追问、收藏、跳过、反馈 | 原始事实 | 长期 |
| Short-term Memory | 最近 7-14 天兴趣 | 今日推送排序 | 滚动更新 |
| Long-term Preference | 稳定领域偏好、表达偏好 | 个性化基础 | 长期 |
| Negative Memory | 不感兴趣、反馈不准、疲劳 | 避免重复打扰 | 带衰减 |
| Explicit Controls | 用户主动设置/关闭/删除 | 信任与合规 | 用户控制 |

建议事件：

```ts
type UserMemoryEvent = {
  user_id: string;
  bazi_profile_id?: string;
  source_date?: string;
  event_type:
    | "view_question"
    | "open_push"
    | "click_followup"
    | "favorite"
    | "dismiss"
    | "feedback_helpful"
    | "feedback_not_helpful"
    | "feedback_accurate"
    | "feedback_inaccurate";
  domain: "overall" | "career" | "love" | "health" | "study";
  question_type?: string;
  artifact_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};
```

建议偏好快照：

```ts
type UserMemorySnapshot = {
  user_id: string;
  version: number;
  updated_at: string;
  preferred_domains: Array<{ domain: string; score: number }>;
  avoided_domains: Array<{ domain: string; score: number }>;
  preferred_question_types: Array<{ type: string; score: number }>;
  fatigue: Array<{ key: string; score: number; reason: string }>;
  style_preference: {
    directness?: number;
    actionability?: number;
    explanation_depth?: number;
  };
};
```

### 7.4 Question Planner：主动问题规划层

职责：

- 每天生成候选问题池。
- 按命理触发、用户记忆、新鲜度、安全边界排序。
- 选择最值得推给用户的问题。

候选问题结构：

```ts
type PlannedQuestion = {
  id: string;
  source_date: string;
  domain: "overall" | "career" | "love" | "health" | "study";
  question_type: string;
  question: string;
  priority_score: number;
  fate_reason: string;
  memory_reason?: string;
  evidence_refs: string[];
  push_window: "morning" | "afternoon" | "evening" | "none";
  risk_level: "safe" | "sensitive" | "blocked";
};
```

排序建议：

```text
priority_score =
  fate_trigger_score * 0.45
  + memory_interest_score * 0.25
  + novelty_score * 0.15
  + timing_score * 0.10
  - fatigue_penalty * 0.20
  - safety_penalty
```

这不是最终算法，只是 v1 可解释权重。早期应保持显式规则，方便调试和产品判断。

### 7.5 Prompt Contract Engine：系统语言层

职责：

- 把命理因子、用户记忆、候选问题转换成稳定 prompt。
- 控制 LLM 的角色、边界、输出格式、语气和禁止项。

Prompt 不应再是大段角色扮演，而应是 contract：

```text
SYSTEM_POLICY
- 不做绝对预测。
- 不提供医疗、财务、法律确定性建议。
- 不引用未提供的命理证据。

FATE_EVIDENCE
- 今日触发领域：career
- 触发原因：流月沟通/选择主题增强
- 证据：...

USER_MEMORY
- 近期多次追问事业沟通类问题。
- 最近跳过健康类推送。

TASK
- 生成一个适合今日推送的问题。
- 生成 80-120 字解释。
- 解释必须连接命理证据和用户当前关注点。

OUTPUT_SCHEMA
{ ... }
```

### 7.6 Eval Gate：评估门

职责：

- 生成后先评估，不通过不进入 accepted artifact。
- 把 AI 失败变成可见、可复盘、可降级。

检查项：

| 检查项 | 失败例子 | 处理 |
|---|---|---|
| JSON schema | 字段缺失、类型错误 | 重试或降级 |
| 命理证据 | 引用了不存在的十神/流年结论 | 拒绝 |
| 安全边界 | 医疗/财务/法律确定建议 | 拒绝 |
| 断言强度 | “一定会分手/破财” | 改写或拒绝 |
| 一致性 | 同一天结果互相矛盾 | 拒绝 |
| 重复度 | 连续多天推同类问题 | 降权 |
| 用户疲劳 | 用户多次跳过同领域 | 降权 |

### 7.7 Accepted Artifact Store：最终结果层

职责：

- 只保存通过评估的结果。
- App 只消费 accepted artifact，不消费 agent 临时上下文。
- 支持历史回看、问题复盘、prompt 版本评估。

建议 artifact：

```ts
type AcceptedQuestionArtifact = {
  id: string;
  user_id: string;
  bazi_profile_id: string;
  source_date: string;
  question: PlannedQuestion;
  answer_preview: string;
  fate_factor_snapshot: FateFactorSnapshot;
  memory_snapshot: UserMemorySnapshot;
  prompt_version: string;
  model: string;
  eval_result: {
    passed: boolean;
    checks: Record<string, boolean>;
  };
  created_at: string;
};
```

## 8. 与现有系统的关系

| 目标能力 | 当前基础 | 推荐改造 |
|---|---|---|
| 命盘事实 | `full_chart`、四柱、五行、大运 | 增加 `FateFactorService` |
| 用户行为 | `user_interactions` 分类计数 | 升级为事件日志 + 偏好快照 |
| 每日内容稳定 | `history_records` dedupe | 扩展 artifact payload |
| 下钻问题 | 后端生成候选问题 | 引入 planner 和 evidence refs |
| prompt | `buildBaziContext()` 拼接文本 | `PromptContractBuilder` |
| 失败兜底 | mock fallback | Eval gate + 结构化降级 |

## 9. 推荐实施阶段

### Phase 1：Prompt Contract + Eval Gate

目标：先提升结果稳定性。

范围：

- 新增 `PromptContractBuilder`。
- 新增 `GenerationEvalService`。
- 现有 `generateDailyFortune` 改为读取 contract，而不是直接拼 prompt。
- 生成结果保存 `prompt_version`、`model`、`eval_result`。

价值：

- prompt 改动可以版本化。
- 低质量 AI 输出不直接进入用户体验。
- 为后续评测集打基础。

风险：

- 需要定义第一版 schema。
- 初期 eval 规则会偏保守。

### Phase 2：Fate Factor Engine

目标：提升命理精准度。

范围：

- 新增 `FateFactorService`。
- 从 `full_chart` 生成结构化命理因子。
- 每个 factor 带 evidence。
- 每日运势、洞察卡、下钻问题统一使用 factor snapshot。

价值：

- LLM 不再凭 prompt 自由推命理结论。
- 前后内容更一致。
- 后续可以逐步增加命理规则。

风险：

- 命理因子定义需要持续校准。
- 不能一次追求完整命理体系。

### Phase 3：Memory Fabric

目标：提升记忆精准度。

范围：

- 新增 `user_memory_events`。
- 新增 `user_memory_snapshots`。
- 记录问题级行为和反馈。
- 增加时间衰减、负反馈、疲劳控制。

价值：

- 推送越来越懂用户。
- 能区分“最近关心”和“长期偏好”。
- 用户反馈能真正改变后续推荐。

风险：

- 隐私与信任要求更高。
- 需要提供记忆控制入口。

### Phase 4：Question Planner

目标：提升主动推送精准度。

范围：

- 新增 `QuestionPlannerService`。
- 每天生成候选问题池。
- 基于命理触发、用户记忆、新鲜度、疲劳度排序。
- 保存 accepted question artifact。

价值：

- 推送从“生成一条内容”升级为“选择最值得问的问题”。
- 可以做 A/B test 和效果归因。
- 未来支持会员深度推送。

风险：

- 需要控制推送频率和重复感。
- 排序权重需要根据数据持续调整。

### Phase 5：Tracing + Evals 数据飞轮

目标：让系统越用越准。

范围：

- 记录每次生成 trace。
- 建立 prompt/eval 样本集。
- 统计通过率、点击率、反馈准确率、下钻率。
- 用评测结果优化 prompt contract。

价值：

- prompt 工程不再靠感觉。
- 能判断每次改动是否真的提升。
- 为未来多模型路由和 agent orchestration 做准备。

风险：

- 需要控制日志中的敏感信息。
- 指标设计错误会误导产品判断。

## 10. 推荐数据表草案

### 10.1 `user_memory_events`

```sql
CREATE TABLE user_memory_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bazi_profile_id UUID REFERENCES bazi_profiles(id) ON DELETE SET NULL,
  source_date DATE,
  artifact_id UUID,
  event_type TEXT NOT NULL,
  domain TEXT,
  question_type TEXT,
  value NUMERIC DEFAULT 1,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 10.2 `user_memory_snapshots`

```sql
CREATE TABLE user_memory_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  short_term JSONB NOT NULL DEFAULT '{}'::jsonb,
  long_term JSONB NOT NULL DEFAULT '{}'::jsonb,
  negative_signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, snapshot_date, version)
);
```

### 10.3 `planned_questions`

```sql
CREATE TABLE planned_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bazi_profile_id UUID REFERENCES bazi_profiles(id) ON DELETE CASCADE,
  source_date DATE NOT NULL,
  question TEXT NOT NULL,
  domain TEXT NOT NULL,
  question_type TEXT,
  priority_score NUMERIC NOT NULL,
  fate_reason TEXT,
  memory_reason TEXT,
  evidence_refs JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 10.4 `ai_generation_artifacts`

```sql
CREATE TABLE ai_generation_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bazi_profile_id UUID REFERENCES bazi_profiles(id) ON DELETE SET NULL,
  source_date DATE NOT NULL,
  artifact_type TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT,
  input_snapshot JSONB NOT NULL,
  output_payload JSONB NOT NULL,
  eval_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'accepted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 11. 质量指标

### 11.1 用户结果指标

- 推送打开率。
- 推送后下钻率。
- 收藏率。
- 反馈“准/有帮助”的比例。
- 跳过率。
- 连续 7 天回访率。

### 11.2 AI 质量指标

- Eval gate 通过率。
- JSON schema 失败率。
- 安全边界失败率。
- 命理证据不一致率。
- 同日内容冲突率。
- fallback 使用率。

### 11.3 记忆质量指标

- 个性化命中率：推送领域与用户后续点击是否一致。
- 负反馈尊重率：用户跳过/不感兴趣后是否减少同类内容。
- 新鲜度：连续重复问题比例。
- 长短期偏好冲突率。

## 12. 风险与防护

| 风险 | 影响 | 防护 |
|---|---|---|
| 命理因子太粗 | 内容仍然像泛泛运势 | 先定义少量高质量因子，持续评测 |
| 记忆过度使用 | 用户觉得被窥探 | 提供记忆开关、查看、删除 |
| 用户反馈误导命理 | 为迎合用户牺牲专业性 | 用户偏好只影响排序和表达，不覆盖命理事实 |
| Prompt 越改越乱 | 内容质量漂移 | prompt version + eval dataset |
| 生成失败影响推送 | 用户体验不稳定 | Eval gate + accepted artifact + fallback |
| 多表复杂度上升 | 实现慢、调试难 | 分阶段上线，先复用 `history_records` 能力 |

## 13. 不在当前范围

当前不建议做：

- 开放式自由聊天。
- 完整多 Agent runtime。
- 全量历史对话向量库。
- 紫微/六爻等多术数融合。
- 自动模型微调。
- 复杂实时推送调度平台。

这些可以作为长期方向，但不是提升知之当前主动问题精准度的最短路径。

## 14. 推荐决策

推荐选择：**轻 Agent、重评估、重记忆、重命理因子**。

优先顺序：

1. `PromptContractBuilder` + `GenerationEvalService`
2. `FateFactorService`
3. `user_memory_events` + `user_memory_snapshots`
4. `QuestionPlannerService`
5. trace / eval 数据飞轮

这条路径的好处是：

- 复用当前后端已有命盘、历史、下钻基础。
- 不盲目扩大技术边界。
- 每一阶段都能独立提升产品体验。
- 未来要接入更复杂 agent 或多模型时，不会推翻现有架构。

## 15. 参考资料

- OpenAI Memory FAQ: https://help.openai.com/en/articles/8590148-persistent-memory-in-chatgpt
- OpenAI Reference Saved Memories: https://help.openai.com/en/articles/11146739-how-does-reference-saved-memories-work
- OpenAI Agent Evals: https://platform.openai.com/docs/guides/agent-evals
- OpenAI Prompt Optimizer: https://platform.openai.com/docs/guides/prompt-optimizer/
- OpenAI Agents SDK Tracing: https://openai.github.io/openai-agents-python/tracing/
- Anthropic Memory Tool: https://docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool
- LangGraph Persistence: https://docs.langchain.com/oss/python/langgraph/persistence
- LlamaIndex Docs: https://docs.llamaindex.ai/
