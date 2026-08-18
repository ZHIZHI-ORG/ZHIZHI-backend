# ZHIZHI 当前后端实现方案与计划

> **Status:** CURRENT
> **Release:** EXPERIMENTAL
> **Verification:** WORKTREE
> **Last verified:** 2026-08-05
> **Sources:** `api/api/`, `api/src/`, `supabase/schema.sql`, `supabase/migrations/002..015`, `api/tests/`, `api/vercel.json`

## 1. 文档职责与事实边界

这份文档是当前后端实现的主入口，回答四个问题：系统现在怎么运行、每项能力落在哪段代码、还缺什么、下一阶段如何实施和验收。

事实优先级：

1. `api/api/**/*.ts` 决定仓库内有哪些路由入口和允许的方法。
2. handler、service、repository、model 决定请求字段、权限、业务流程和响应。
3. `supabase/schema.sql` 与 `supabase/migrations/*.sql` 决定预期数据库结构；源码存在不证明远端已经执行迁移。
4. `api/tests/*.ts` 决定当前自动验证覆盖。
5. 领域文档保留算法依据、样例和目标计划；与代码冲突时按上面四类证据重新判定状态。

本轮确认的是 `dev` 的本地工作树，不是生产环境。Recommendation V1 后端已包含事实引用合同、30 张候选池、三批 10 张大卡编排、批次/事件迁移、路由和 AI 结构化输出；相邻 iOS 工作树已按该合同接入并通过本地测试/模拟器构建，真实 API 端到端仍需部署后验证。因此结果是 `WORKTREE`，不能写成已提交、已发布或线上已验证事实。

## 2. 当前运行架构

```text
HTTP request
  -> api/api/index.ts
  -> api/api/[...path].ts（CORS、OPTIONS、精确/动态路由）
  -> api/api/** route handler（方法、字段、身份校验）
  -> api/src/services/**（业务编排）
  -> api/src/database/repositories/**（数据访问）
  -> api/src/database/supabase.ts（Service Role / user-context client）
  -> Supabase Auth + PostgreSQL

八字创建/查询
  -> baziService
  -> baziCalculator + 事实/关系/格局工具
  -> bazi_profiles.full_chart 等持久化字段

每日运势/洞察/受控追问
  -> fortuneService
  -> 当日 history_records 缓存
  -> Gemini（有 GEMINI_API_KEY）或示例回退数据（无 key）
  -> history_records + user_interactions

首页日运 V2
  -> dailyFortuneService
  -> 同一档案快照的原局 + 大运/流年/流月/流日事实
  -> daily_fortune_artifacts 数据库 single-flight
  -> 一次 Gemini Structured Output 请求生成总体 + Top 2 场景
  -> READY 完整内容不可变；失败不保存正文且没有示例回退

个性化问题卡 Recommendation V1
  -> 完整时间线只留服务端；AI 接收最多 16 个完整大运/流年/流月证据窗口、96 KB + 全大运轻量索引
  -> 推荐不接收流日；日级内容仍由首页日运负责
  -> 一次 Gemini Structured Output 生成 30 张完整、未绑定批次的候选
  -> 每批展示 10 张上方大卡，共 3 批；center_cards 固定为空
  -> exposure/open 进入大卡行为记忆；open 重排候选池尚未展示的卡
  -> 第二、第三批只消费同一候选池，不再调用 Gemini
  -> 30 张耗尽后，累积行为进入下一次新的 AI 调用
  -> recommendation_batches single-flight、不可变 READY 候选池与展示批次
  -> AI 不可用时明确不可用，不注入 mock 或 fallback

知识页下方逐项展开
  -> 独立读取 /api/insights/analysis
  -> 点击读取 /api/insights/detail/:category
  -> 不消费推荐候选，不写 recommendation exposure/open

StoreKit 交易
  -> commerceService
  -> Apple Server Library（配置证书时）
  -> 受控的本地 JWS payload 解码回退（未强制签名校验时）
  -> commerce_* 与积分流水
```

关键约束：服务端主 Supabase client 使用 Service Role Key，会绕过 RLS（Row Level Security，数据库按用户隔离行数据的规则）。因此 API handler 的 Bearer Token 校验和 repository 的 `user_id/owner_user_id` 条件属于真实授权边界，不能只依赖数据库策略。

## 3. 路由与实现清单

统一响应主要由 `api/src/utils/response.ts` 和 `api/src/utils/errors.ts` 生成。`Protected` 表示 handler 会读取 Bearer Token；`Conditional` 表示不同方法的权限不同。

| Source | HTTP contract | Auth | Implementation |
|---|---|---|---|
| `api/api/index.ts` | `/api/*` adapter | N/A | 将 Vercel 入口导出到 catch-all router |
| `api/api/[...path].ts` | `OPTIONS` + route dispatch | Public adapter | CORS、精确路由、bazi/history/insights/content 动态参数 |
| `api/api/health.ts` | `GET /api/health` | Public | 查询 `users` 表并返回 database connected/disconnected |
| `api/api/auth/check-invite-code.ts` | `POST /api/auth/check-invite-code` | Public | 只校验 `invitationCode`，不消耗次数 |
| `api/api/auth/send-code.ts` | `POST /api/auth/send-code` | Public | 校验 email 并通过 Supabase Auth 发送 OTP |
| `api/api/auth/register.ts` | `POST /api/auth/register` | Public | camelCase 请求映射到 auth service；门禁由 `INVITE_CODE_REQUIRED` 控制 |
| `api/api/auth/login.ts` | `POST /api/auth/login` | Public | `password` 或 `verificationCode` 二选一 |
| `api/api/auth/social-login.ts` | `POST /api/auth/social-login` | Public | Apple/Google identity token；Google 额外要求 nonce；新用户可能返回 202 `need_info` |
| `api/api/auth/refresh-token.ts` | `POST /api/auth/refresh-token` | Public | 使用 `refreshToken` 换取新 token 对 |
| `api/api/auth/logout.ts` | `POST /api/auth/logout` | Protected | 提取 Bearer Token 并使 Supabase session 失效 |
| `api/api/auth/reset-password.ts` | `POST /api/auth/reset-password` | Public | `email + verificationCode + newPassword` |
| `api/api/auth/delete-account.ts` | `POST /api/auth/delete-account` | Protected | 业务数据处理 + Auth 用户删除，具体语义由 auth service 实现 |
| `api/api/user/profile.ts` | `GET/PUT /api/user/profile` | Protected | 读取资料；更新 `display_name/avatar_url` |
| `api/api/user/profile/extended.ts` | `PUT /api/user/profile/extended` | Protected | 更新 bio/location/career/school/mbti/notes |
| `api/api/user/invite-code.ts` | `GET /api/user/invite-code` | Protected | 获取或生成当前香港自然周邀请码并返回额度合同 |
| `api/api/user/invitations.ts` | `GET /api/user/invitations` | Protected | 返回当前用户邀请记录 |
| `api/api/bazi/create.ts` | `POST /api/bazi/create` | Protected | 校验出生信息、真太阳时输入并计算/保存完整命盘 |
| `api/api/bazi/list.ts` | `GET /api/bazi/list` | Protected | 按 owner、分页等条件列出当前用户档案 |
| `api/api/bazi/[id].ts` | `GET/PUT/DELETE /api/bazi/:id` | Protected | 仅操作当前用户拥有的档案 |
| `api/api/bazi/[id]/context.ts` | `PUT /api/bazi/:id/context` | Protected | 仅更新本人档案的现实语境与知之理解上下文，供日运和推荐 AI 作为参考而非命理事实 |
| `api/api/bazi/[id]/chart.ts` | `GET /api/bazi/:id/chart` | Protected | 返回完整命盘计算结果 |
| `api/api/bazi/[id]/luck.ts` | `GET /api/bazi/:id/luck` | Protected | 返回大运、流年、流月、流日时间线 |
| `api/api/bazi/[id]/luck-analysis.ts` | `GET /api/bazi/:id/luck-analysis` | Protected | 返回运势分析结构 |
| `api/api/bazi/[id]/luck-bundle.ts` | `GET /api/bazi/:id/luck-bundle` | Protected | 返回面向展示的组合数据 |
| `api/api/fortune/daily.ts` | `GET /api/fortune/daily?bazi_id=` | Protected | 获取本人/指定档案的当日运势，复用当日历史缓存 |
| `api/api/fortune/drilldown.ts` | `POST /api/fortune/drilldown` | Protected | 只接受服务端生成的受控问题合同，生成下钻答案 |
| `api/api/v2/fortune/daily.ts` | `POST /api/v2/fortune/daily` + `GET ?generation_id=` | Protected | POST 解析/生成完整首页日运；GET 只读轮询，不 claim、不调用 AI |
| `api/api/v2/recommendations/next.ts` + `api/api/[...path].ts` + `api/server.ts` | `POST /api/v2/recommendations/next` | Protected | 按本人八字档案、时区、会话和前批次读取/claim 下一批；只有 owner 调一次 AI，返回或轮询 `ready/generating/retry_wait` |
| `api/api/v2/recommendations/[batchId].ts` + `api/api/[...path].ts` + `api/server.ts` | `GET /api/v2/recommendations/:batch_id` | Protected | 只读回本人批次并供客户端轮询；绝不因为 GET 触发新的 AI 调用 |
| `api/api/v2/recommendations/events.ts` + `api/api/[...path].ts` + `api/server.ts` | `POST /api/v2/recommendations/events` | Protected | 幂等记录 `exposure/open`；数据库从已保存卡片派生领域、主题、位置和展示面，客户端不能伪造标签 |
| `api/api/v2/recommendations/routeUtils.ts` | Shared route utility | N/A | 推荐三条接口共用的请求解析、错误合同、UUID/IANA 时区校验与 private/no-store 响应头 |
| `api/api/insights/cards.ts` | `GET /api/insights/cards?bazi_id=` | Protected | 返回五维轮播卡片 |
| `api/api/insights/analysis.ts` | `GET /api/insights/analysis?bazi_id=` | Protected | 返回五维概览 |
| `api/api/insights/detail/[category].ts` | `GET /api/insights/detail/:category?bazi_id=` | Protected | 返回指定维度详情并异步记录 `view_card` |
| `api/api/history.ts` | `/api/history` adapter | N/A | 兼容导出 `history/index.ts` |
| `api/api/history/index.ts` | `GET/POST /api/history` | Protected | 分页查询或创建用户历史记录 |
| `api/api/history/[id].ts` | `GET/DELETE /api/history/:id` | Protected | 查看或删除用户自己的记录 |
| `api/api/history/[id]/favorite.ts` | `PUT /api/history/:id/favorite` | Protected | 要求 `is_favorited` 为布尔值 |
| `api/api/commerce/status.ts` | `GET /api/commerce/status` | Protected | 返回会员、积分余额和 app account token |
| `api/api/commerce/transactions/sync.ts` | `POST /api/commerce/transactions/sync` | Protected | 幂等同步 StoreKit JWS 交易并更新会员/积分 |
| `api/api/commerce/points/ledger.ts` | `GET /api/commerce/points/ledger` | Protected | 分页返回积分流水，page_size 最大 50 |
| `api/api/commerce/points/consume.ts` | `POST /api/commerce/points/consume` | Protected | 正整数扣点 + `idempotency_key`，余额不足返回业务错误 |
| `api/api/content/list.ts` | `GET /api/content/list` | Public | 按作者、类型、状态、标签和分页筛选内容 |
| `api/api/content/create.ts` | `POST /api/content/create` | Protected | 校验并创建内容 |
| `api/api/content/[id].ts` | `GET/PUT/DELETE /api/content/:id` | Conditional | GET 可匿名；PUT/DELETE 需要作者身份 |

路由文件覆盖由 `npm run test:docs` 自动检查；请求/响应语义仍需以 handler、service 和 model 评审为准。

## 4. 关键实现方案

### 4.1 认证和邀请码

实现链路：handler 接收 iOS camelCase 字段 → `authService.ts` 调用 Supabase Auth → `UserRepository` 维护业务用户 → `inviteCodeService.ts` 校验/消费邀请关系。`INVITE_CODE_REQUIRED` 默认示例值为 `false`，代码允许通过环境变量恢复强制门禁。

社交登录已经有后端 token 接口，不代表 Apple、Google 和 Supabase Provider 已完成配置。当前配置方案、iOS 剩余工作和真实验收用例保留在 [Auth Provider Configuration](../CONTRACT-V2/auth_provider_configuration.md)。旧的 [Authentication Requirements V4.1](../CONTRACT-V2/authentication_requirements.md) 使用了与当前 handler 不一致的字段与路径，只能作为需求追溯。

### 4.2 八字计算和命理事实

`baziService.ts` 负责档案权限与持久化，`baziCalculator.ts` 负责排盘、五行、神煞、大运和结构化结果。详细算法不在这里复制：

- 五行能量当前合同：[weighted_wuxing_v2_9](weighted-wuxing-v2-9-algorithm.md)。
- 神煞当前合同：[神煞总表](../神煞总表.md)。
- 命理事实和干支关系：[命理事实层规则](mingli-fact-layer-rules.md)。
- 格局候选与后续判断：[格局判断规则](mingli-pattern-judgement-rules.md)。

当前工作树正在让 `zipingAiBrief.gan_zhi_effects` 接受统一干支作用引擎的覆盖值，并更新对应测试顺序/文案。这是本地事实，提交和发布状态尚未确认。

### 4.3 每日运势、洞察和历史缓存

`fortuneService.ts` 先确认档案归属，再用 `daily_fortune:{baziProfileId}:{date}` 查询 `history_records`。命中后直接返回同日结果；未命中时读取用户行为权重、调用 `generateDailyFortune`、补全稳定问题 ID，再尝试写入历史记录。历史写入失败会记录错误并继续返回生成结果。

`GEMINI_API_KEY` 未配置时，`geminiClient.ts` 会返回示例数据。这能支持前端开发，不能作为 AI 已联通或生产内容质量达标的证据。

### 4.4 首页日运 V2

首页日运 V2 与旧 `/api/fortune/daily` 分离。`dailyFortuneService.ts` 按客户端 IANA 时区执行当地 23:00 子初换日，一次读取 owned 档案与可选账户上下文后构建三柱或四柱原局事实、当前大运、流年、流月、流日和完整作用关系。三柱只向 AI 发送年/月/日；关系计算会先移除内部 fallback 时柱，原局与流运关系均不含该实现细节。所有真实地支柱必须带非空藏干（天干、相对日主十神、五行）；缺失时在 claim 和 AI 前失败，不写 artifact。

同一 `user/profile/effective_date/profile_revision_hash` 通过 `daily_fortune_artifacts` 和数据库 RPC 原子 claim。缓存身份还包含规范化的 MBTI、人生阶段、职业/学业、关系状态和知之理解快照，以及事实/Prompt/生成版本；本人档案可回退账户职业/学校/MBTI，亲友档案不会混入主账户资料。owner 只调用一次 `dailyFortuneAi.ts`；AI 在一次响应中生成完整总体判断、五场景中的两个主要场景和每场景两条完整事项。格局候选、用神、AI brief、fact panel、证据和 fallback 不进入日运 AI 输入或输出。结构或 provider 失败时进入 `retry_wait`，不写正文、不用 fallback。READY 由 lease token 与 epoch fenced finalize，之后不可修改。

完整合同、请求流程、缓存身份和上线顺序见 [首页日运 V2](designs/home-daily-fortune-v2.md)。当前仓库测试和 iOS Simulator build 已通过；迁移、环境变量、真实 Gemini 和线上 HTTP 链路仍未验证。

### 4.5 个性化问题卡 Recommendation V1

Recommendation V1 与下方 `/api/insights/*` 独立并存。它不新增盲派确定性规则引擎：现有 `full_chart` 时间线与 `mingliInteractionEngine` 仍是唯一的确定性事实来源。完整时间线只留在服务端；`fortune_facts` 传稳定原局，`time_windows` 传全部大运的轻量索引、当前起目标 12 个流月及其父流年/父大运完整硬事实，并在预算允许时加入最多 1 个远期流年或大运。完整证据窗口最多 16 个，整个 `time_windows` 最多 96 KB，不传全部流年或流日；超限时整窗移除远期和最远月份，至少保护当前起 6 个流月。流年按立春切换、流月按节气切换、大运按精确起运日切换，不以公历 1 月 1 日或月份编号代替。服务端只做时间覆盖、成本和事实完整性控制，不判断领域、吉凶或事件。AI 在一次结构化调用中同时看到这些硬事实、可引用事实 ID、用户现实状态、90 天/14 天/本会话打开、语义历史及所选时间窗口的曝光/打开历史，固定生成一个按优先级排列的 30 张完整候选池。AI 不决定页面展示位置。

每张候选必须包含 `content_profile`（领域、主题、问题任务、时间尺度）、`selection_role`（本次为何优先出现）、`event_hypothesis`（可能现实题材、条件强度、1–6 条事实引用）、主要时间窗口、事实/事件目标窗口和完整正文。AI 可以判断“该流月的作用更适合问争执、推进、新连接还是边界”，服务端不把这层命理语义硬编码；服务端只检查 JSON 合同、枚举/张数、事实引用存在性、AI 指定的主要时间窗口确实属于其引用且与时间尺度匹配、引用时间是否相交、ID 和所有权。服务端再从引用机械派生全部 `referenced_window_keys`。关系只以无方向的 `members` 传入，删除重复五行字段和容易暗示因果的 `source/targets`；`full_match` 只代表规则成员齐全。卡可在今天展示、同时明确预测某个未来流月；页面批次的本地子初过期时间与卡的事件目标窗口分开保存。

推荐大卡的 `content_horizon` 只有原局、阶段、流年和流月，不接收流日。流日继续属于首页日运。若以后验证需要未来 30 天逐日提醒，可以在同一个 `time_windows` 合同中增加有数量上限的日级窗口，不需要重做事实层或推荐引擎。

服务端把 30 张候选分成三个不可变展示批次，每批 10 张上方大卡。首批保持 AI 的原始优先级；第二、第三批必须且只能使用同一根池尚未展示的候选，并根据当前会话已经打开卡片的主题、领域、问题任务和时间尺度重排，不新增 AI 调用、不改写命理内容。每批创建完成后顺序固定；30 张耗尽后的下一次 `/next` 才 claim 新的 AI 生成，并把此前 open、14 天和 90 天兴趣全部传入。

`recommendation_batches` 的 AI 根批次保存不可变的 30 张候选池、首批 10 张和成功调用的模型/token/字节/延迟摘要，两个池续批各保存实际展示的 10 张与当时的兴趣编排快照；`recommendation_events` 保存 exposure/open，并由数据库从冻结卡片反查内容标签和主要/引用时间窗口。另有一张不含 user、profile、命理或卡片内容的 `recommendation_provider_attempts` 成本账本，池续批不写这张表。`open` 是弱正向兴趣，`exposure` 是真实展示分母，划走和未打开不被当作 dislike。90/14 天内容兴趣与 90 天主要时间窗口历史由一个 RPC 在同一数据库快照中返回；两个聚合都只读取大卡 `surface=deck`，历史中心卡事件保留审计但不再进入推荐记忆。当前会话信号最多回看 12 小时，当前和近期命理窗口不会因曝光过而被删除。资料在 AI 生成中被修改时，旧 worker 不能 READY；被拦截的已 claim 行会转为 `retry_wait` 留存；同一 AI 槽位最多尝试 3 次。当前每用户滚动 24 小时的默认上限仍按 `recommendation_batches` 新建行计数，完整消费时一个 30 张池会占三个展示批次名额，因此默认 6 个批次名额等价于最多 2 个完整候选池、60 张大卡；项目总 provider 尝试默认最多 100 次。这个用户上限是保守的产品/滥用边界，provider 成本仍只按实际 AI 调用计数。详见 [Recommendation V1 架构](designs/zhizhi-ai-personalization-question-planning-architecture.md)。

本地测试可证明结构与并发合同，不能证明真实 Gemini 对命理事件题材的语义判断；上线前仍须用固定人工命理样本审读，并在 staging 读取 migration/RPC/RLS 状态。

### 4.6 StoreKit、会员和积分

`commerceService.ts` 对商品 ID、交易 ID、original transaction ID、app account token、购买时间和 JWS payload 做一致性检查。生产运行时即使漏配开关也会强制 Apple Server Library 验签；开发/测试环境只有在未要求严格验签时才允许未验签 payload 解码。`020_commerce_transaction_atomicity.sql` 把交易记录与会员/积分交付收进同一数据库事务，重复请求会幂等返回或修复旧的半完成交付，积分退款会按当前余额幂等扣回。两个 `SECURITY DEFINER` 商业 RPC 都只授权 service role，不能由 anon/authenticated 直接加减积分。

## 5. 数据库结构与迁移顺序

`supabase/schema.sql` 是基础结构，当前包含 `users`、`bazi_profiles`、`tiangan_dizhi_lookup`、索引、触发器和 RLS。增量迁移必须按编号执行：

| Migration | Concrete change | Dependent code |
|---|---|---|
| `supabase/migrations/002_ai_interests.sql` | 兴趣、类别模板、每日问题种子、交互记录 | 早期问题个性化数据模型 |
| `supabase/migrations/003_invite_codes.sql` | `invite_codes`、`invite_usages`、RLS | auth/invite services |
| `supabase/migrations/004_bazi_extended.sql` | `bazi_profiles` 完整命盘 JSONB、出生地/MBTI、索引 | bazi service/repository |
| `supabase/migrations/005_user_interactions.sql` | 当前 `user_interactions` 行为记录与 RLS | fortune/insights personalization |
| `supabase/migrations/006_user_extended.sql` | users 扩展资料字段 | user profile extended |
| `supabase/migrations/007_history_records.sql` | 历史记录、去重索引、RLS | history/fortune services |
| `supabase/migrations/008_commerce.sql` | 商业账号、交易、会员、积分余额/流水及函数 | commerce service/repository |
| `supabase/migrations/009_bazi_true_solar_time.sql` | 经纬度、时区、真太阳时结果 | trueSolarTimeService/bazi profile |
| `supabase/migrations/010_invite_weekly_ownership.sql` | 香港自然周邀请码归属、唯一性与原子计数 | inviteCodeService |
| `supabase/migrations/011_daily_fortune_artifacts.sql` | 首页日运 artifact、状态约束、single-flight RPC、READY 不可变 | dailyFortuneService/repository |
| `supabase/migrations/012_daily_fortune_user_context.sql` | 每档案日运现实上下文与知之理解快照 | BaziProfile/dailyFortuneService |
| `supabase/migrations/013_recommendation_engine.sql` | `recommendation_batches`、`recommendation_events`、无内容的 provider-attempt ledger、single-flight/complete/release/event/preference-snapshot RPC、revision/时区槽位、RLS 与不可变 READY 约束 | RecommendationRepository/recommendation service/iOS Insights V1 |
| `supabase/migrations/014_recommendation_candidate_pool.sql` | 兼容旧 6+3 READY，新增 24 张不可变候选池、8+4 展示合同、池续批、成功调用 metrics、卡片时间窗口事件派生及 90 天窗口记忆 RPC | RecommendationRepository/recommendation service/iOS Insights V1 |
| `supabase/migrations/015_recommendation_deck_only_pool.sql` | 保留旧 6+3/8+4 可审计数据，新增 30 张根池、10+0 三批父子链、V3 finalize/续批 RPC，并从两类推荐记忆中排除历史 center 事件 | RecommendationRepository/recommendation service/iOS Insights V1 |
| `supabase/migrations/020_commerce_transaction_atomicity.sql` | StoreKit 交易与权益原子交付、积分退款幂等处理、商业 RPC service-role 限权 | commerce service/repository |

源码不能判断远端迁移是否完成。部署验收必须读取目标项目的 migration/table/function 状态，并对 RLS 与 service-role 行为分别验证。

## 6. 环境变量与外部依赖

| Variable | Required by code | Behavior when absent |
|---|---|---|
| `SUPABASE_URL` | Backend startup | 模块加载失败 |
| `SUPABASE_SERVICE_KEY` | Backend startup/data access | 模块加载失败 |
| `SUPABASE_ANON_KEY` | Auth/user-context client | auth 请求会回退使用 service key；生产仍应显式配置 |
| `SUPABASE_REQUEST_TIMEOUT_MS` | Optional | 默认 5000ms |
| `INVITE_CODE_REQUIRED` | Optional | 只有字符串 `true` 开启注册门禁 |
| `GEMINI_API_KEY` | Optional | fortune/insights 使用示例回退数据 |
| `DAILY_FORTUNE_V2_GENERATION_ENABLED` | Optional | 默认开启；关闭后不新生成，仍可读取 READY |
| `DAILY_FORTUNE_AI_MODEL` | Daily fortune V2 generation | 未配置时 V2 生成失败且不产出内容 |
| `DAILY_FORTUNE_AI_TIMEOUT_MS` | Optional | V2 AI 请求默认 15000ms |
| `DAILY_FORTUNE_MAX_ACTIVE_GENERATIONS` | Optional | V2 数据库生成并发上限默认 20 |
| `RECOMMENDATIONS_V1_ENABLED` | Optional | 只有字符串 `true` 开启新的推荐批次生成；关闭时上方推荐明确不可用，不注入 mock/fallback |
| `RECOMMENDATION_AI_MODEL` | Recommendation V1 generation | 未配置时可读取 `DAILY_FORTUNE_AI_MODEL`；两者都无时新批次直接不可用，不生成替代内容 |
| `RECOMMENDATION_AI_TIMEOUT_MS` | Optional | 未配置时可回退 `DAILY_FORTUNE_AI_TIMEOUT_MS`，默认 90000ms，范围 1–100000ms，预留落库时间 |
| `RECOMMENDATION_MAX_ACTIVE_GENERATIONS` | Optional | Recommendation 数据库生成并发上限；未配置使用服务端默认值 |
| `RECOMMENDATION_MAX_NEW_BATCHES_PER_24H` | Optional | 每用户滚动 24 小时新建批次上限，默认 6，范围 1–50；不限制同一批的 join/retry |
| `RECOMMENDATION_MAX_ATTEMPTS_PER_BATCH` | Optional | 同一批次槽位的 provider 尝试上限，默认 3，范围 1–10；防止重试或资料编辑无限重复调用 |
| `RECOMMENDATION_MAX_PROVIDER_ATTEMPTS_GLOBAL_PER_24H` | Optional | 全项目滚动 24 小时 provider 尝试上限，默认 100，范围 1–1000000；上线前必须按预算明确设置 |
| `APPLE_IAP_BUNDLE_ID` | StoreKit server verification | 无完整配置时不能创建 verifier |
| `APPLE_IAP_ENVIRONMENT` | Optional | 默认 Sandbox |
| `APPLE_IAP_APP_APPLE_ID` | Optional by Apple environment | 未配置时传 undefined |
| `APPLE_IAP_ROOT_CERTIFICATES_BASE64` | StoreKit server verification | 无证书时走回退或失败 |
| `APPLE_IAP_REQUIRE_SIGNED_VERIFICATION` | Optional outside production | `true` 时缺配置/验签失败直接拒绝；production/production Vercel 环境无条件严格验签 |

不要在文档、日志或测试 fixture 中写真实 key、token、证书或用户数据。

## 7. 外部运行证据

下表刻意把“代码具备能力”和“外部系统已可用”分开。本轮没有执行网络或控制台探测。

| Dependency | Verification | Checked on | Evidence | Current conclusion | Required next action |
|---|---|---|---|---|---|
| Vercel production deployment | EXTERNAL_UNVERIFIED | 2026-07-11 | Not probed in this documentation pass | 只确认 `api/vercel.json` 和 deploy script 存在 | 记录 deployment URL、commit、health 响应和日志 |
| Supabase schema/migrations/RLS | EXTERNAL_UNVERIFIED | 2026-08-05 | Not probed in this implementation pass | 只确认本地 SQL 002-015，Recommendation RPC/RLS 尚未 readback | 在 staging 依序执行 013、014、015 并读取 table/function/RLS 状态 |
| Supabase Auth email/Apple/Google providers | EXTERNAL_UNVERIFIED | 2026-07-11 | Not probed in this documentation pass | 后端调用路径存在，Provider 状态未知 | 分别用有效/无效 token 验证登录合同 |
| Gemini generation | EXTERNAL_UNVERIFIED | 2026-07-23 | V2 transport/Prompt/schema unit tests only | V2 没有 fallback；真实模型尚未调用 | 在 staging 配置固定模型，验证内容质量和失败路径 |
| Recommendation V1 Gemini / behavioral loop | EXTERNAL_UNVERIFIED | 2026-08-05 | 本地 16-window/96-KB 检索、30 张 Structured Output、10+10+10 编排、机械事实/时间窗口引用和离线结构评测 | 未调用真实模型；未证明 30 张输出的延迟/截断、命理事件题材质量或 exposure/open 线上闭环 | 固定模型与匿名测试档案跑三批展示及下一候选池；人工审读样本、输入预算、token、延迟和下一次 AI 输入 |
| Apple StoreKit server verification | EXTERNAL_UNVERIFIED | 2026-07-11 | Not probed in this documentation pass | 代码允许严格验签或未验签解码 | 生产强制验签并执行沙盒/生产交易回放 |
| iOS end-to-end flows | EXTERNAL_UNVERIFIED | 2026-08-05 | 10+0 合同、剩 5 张预取边界和逐项展开隔离测试通过；Simulator build passed; no live API run | 上方推荐与下方真实 analysis/detail 链路已在源码解耦，未证明线上可用 | 部署 staging 后用真实账号、三柱和四柱档案验收三批大卡与独立逐项展开 |

## 8. 验证方案

本地静态与文档验证：

```bash
cd api
npm ci
npm run type-check
npm run test:docs
```

业务测试按能力运行：`test:auth-infra`、`test:invite`、`test:bazi-basic-info`、`test:true-solar-time`、`test:wuxing`、`test:shensha`、`test:mingli-ai-context`、`test:patterns`、`test:ziping-facts`、`test:mingli-interactions`、`test:daily-fortune`、`test:recommendations`、`test:history`、`test:commerce`。

验收分三层：

1. **仓库合同：** type-check、Recommendation AI/service/route/migration/eval 测试和全部当前测试通过；文档列出每个路由和迁移。
2. **部署合同：** 目标 commit 部署成功，health 返回数据库 connected，013/014/015 的 table/function/RLS 已 readback，推荐 feature flag 与固定模型核对完成。
3. **产品合同：** iOS 使用真实账号和三柱/四柱档案跑通 10+10+10、open 后同池续批重排、30 张耗尽后的新 AI、大卡详情、exposure/open 和剩 5 张预取；逐项展开单独跑通 analysis/detail 且不产生推荐事件；固定人工命理样本审读实际题目。任何示例或 fallback 不能计为 AI 联通。

## 9. 实施计划

### Phase 0 — 文档事实基线（本次）

- **改动：** 建立文档地图和当前实现指南；旧文档标注权威级别；加入清单、链接、路由、迁移和状态检查。
- **代码落点：** `docs/README.md`、本文、旧 Markdown 顶部状态、`api/scripts/verify-docs.js`、`api/tests/docsIntegrity.test.ts`、CI workflow。
- **验收：** 两份新仓库文档上限；当前 45 个路由文件与 14 个迁移全部覆盖；无本机绝对链接；用户已有改动不被文档工作覆盖。

### Phase 1 — 独立线上就绪审计

- **前置依赖：** 生产/预览环境访问权限、Supabase/Apple/Google/Gemini 权限、可用 iOS build。
- **执行：** 按第 7 节逐项采集带日期、环境、commit 和脱敏结果的证据；故障按 Vercel、数据库、Auth Provider、AI、StoreKit、客户端分类。
- **验收：** 每项依赖标记 `LIVE_VERIFIED`、`FAILED` 或 `BLOCKED`，任何失败都有负责人和恢复动作。
- **边界：** 这是独立运维任务，本次文档整理不宣称已经完成。

### Phase 2 — 机器可读 API 合同

- **前置依赖：** 先在 handler 边界统一 method、request、response、auth 和 error metadata；当前文件名不足以推导完整 API 语义。
- **执行：** 只对元数据完整的 endpoint 生成/校验 OpenAPI，未覆盖 endpoint 必须显式报告，不能猜测。
- **验收：** 生成操作可追溯到 typed source metadata；handler 测试与 spec 一致；CI 阻止已覆盖接口漂移。
- **边界：** 本次不新增 OpenAPI 文件或生成器。

### Phase 3 — Recommendation V1 工作树实现与外部验收

Recommendation V1 已在本地工作树按“完整事实时间线 → 服务端截取最多 16 个/96 KB 证据窗口 → AI 一次生成 30 张候选 → 10+10+10 三批上方大卡 → open 重排同池尚未冻结的候选 → 池耗尽后内容兴趣与时间窗口记忆进入下一次 AI”的最小闭环实现。下方逐项展开继续使用独立 analysis/detail 链路，不消费候选也不写推荐事件。完整合同见 [Recommendation V1 架构](designs/zhizhi-ai-personalization-question-planning-architecture.md)。它仍是 `EXPERIMENTAL / WORKTREE`：提交、迁移、真实 Gemini、真实账号端到端、人工命理质量审读和线上指标未验证前，不能从本节推断已经上线。

后续扩展必须复用现有 `RecommendationCandidate` / `CardCandidate`、事实引用、候选池、batch 和事件日志。不要在 V1 外另建向量记忆、第二套候选引擎或未验证的负反馈模型。

## 10. 已知风险与决策边界

- Service Role 绕过 RLS：handler/repository 所有权过滤是高风险边界。
- Gemini 无 key 时回退示例：开发可用不等于真实 AI 可用。
- 首页日运 V2 不使用 Gemini 示例回退；缺 key、缺固定模型、超时或结构错误都会返回无正文状态。
- StoreKit 只在非生产开发/测试环境允许未验签解码；生产缺证书、bundle ID、App Apple ID 或验签失败会直接拒绝交易。
- 远端迁移未知：源码和 SQL 文件不能替代数据库 readback。
- 文档检查只能证明结构化覆盖，不能自动证明业务描述完全正确。
- 当前命理工作树未提交：整理文档不得吸收、改写或发布这些用户改动。
- Recommendation V1 的事实引用存在性不是语义正确性证明：真实 AI 输出仍须经固定命理样本人工审读。
- Recommendation 迁移/RPC 尚未对远端项目 readback：本地 SQL 文件不等于线上表、索引、RLS 或函数已生效。
- `time_windows` 的 16 个证据/96 KB 是硬成本边界；关系密集命盘可能从最远月份开始缩减到最少 6 个近期月，必须用真实档案统计触发率与覆盖损失。
- 远期窗口只有实际成为展示卡的主要窗口后才计 exposure；AI 若连续不使用该窗口，它可能在后续检索重复出现，MVP 暂不新增 retrieval ledger。
- 成功调用会保存 token/字节/延迟摘要，失败尝试目前只保留无内容 attempt 记录；真实失败调用的精确 token 与延迟仍需后续 telemetry 扩展。
- 30 张完整卡沿用 16384 tokens / 128 KB 输出上限；真实固定 Gemini 模型的输出上限和平均延迟尚未验证。相较旧 24 张合同，输出量预计约增加 25%；必须用真实模型验证 finish reason、字节、token、P95 和客户端等待合同。
- 当前用户 24 小时上限按展示批次行计数；默认 6 个名额可完整消费 2 个候选池、60 张大卡。若产品要把它解释为“每天 6 次 AI 生成”，需要在后续迁移中把配额改为只统计 `generation_kind=ai`。
- iOS 在大卡剩 5 张时冻结预取结果；第 6 张触发前已 flush 的行为可影响紧邻批次，第 7–10 张后来发生的 open 只能影响再下一批尚未开始的编排或 AI 生成，不能承诺每次打开都改变紧邻展示批次。
- iOS 当前未持久化推荐 `after_batch_id`；App 重启或页面重建会重新读取当天首批。跨会话续看仍需客户端游标或新的后端游标合同。
