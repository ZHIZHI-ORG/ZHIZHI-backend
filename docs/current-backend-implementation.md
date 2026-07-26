# ZHIZHI 当前后端实现方案与计划

> **Status:** CURRENT
> **Release:** SHIPPABLE
> **Verification:** WORKTREE
> **Last verified:** 2026-07-11
> **Sources:** `api/api/`, `api/src/`, `supabase/schema.sql`, `supabase/migrations/002..011`, `api/tests/`, `api/vercel.json`

## 1. 文档职责与事实边界

这份文档是当前后端实现的主入口，回答四个问题：系统现在怎么运行、每项能力落在哪段代码、还缺什么、下一阶段如何实施和验收。

事实优先级：

1. `api/api/**/*.ts` 决定仓库内有哪些路由入口和允许的方法。
2. handler、service、repository、model 决定请求字段、权限、业务流程和响应。
3. `supabase/schema.sql` 与 `supabase/migrations/*.sql` 决定预期数据库结构；源码存在不证明远端已经执行迁移。
4. `api/tests/*.ts` 决定当前自动验证覆盖。
5. 领域文档保留算法依据、样例和目标计划；与代码冲突时按上面四类证据重新判定状态。

本轮确认的是 `dev` 工作树，不是生产环境。三个未提交文件 `baziCalculator.ts`、`zipingStructureFacts.ts`、`zipingStructureFacts.test.ts` 正在调整 AI brief 的干支作用输入与测试期望，因此相关结果标记为 `WORKTREE`，不能写成已发布事实。

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
| `api/api/bazi/[id]/chart.ts` | `GET /api/bazi/:id/chart` | Protected | 返回完整命盘计算结果 |
| `api/api/bazi/[id]/luck.ts` | `GET /api/bazi/:id/luck` | Protected | 返回大运、流年、流月、流日时间线 |
| `api/api/bazi/[id]/luck-analysis.ts` | `GET /api/bazi/:id/luck-analysis` | Protected | 返回运势分析结构 |
| `api/api/bazi/[id]/luck-bundle.ts` | `GET /api/bazi/:id/luck-bundle` | Protected | 返回面向展示的组合数据 |
| `api/api/fortune/daily.ts` | `GET /api/fortune/daily?bazi_id=` | Protected | 获取本人/指定档案的当日运势，复用当日历史缓存 |
| `api/api/fortune/drilldown.ts` | `POST /api/fortune/drilldown` | Protected | 只接受服务端生成的受控问题合同，生成下钻答案 |
| `api/api/v2/fortune/daily.ts` | `POST /api/v2/fortune/daily` + `GET ?generation_id=` | Protected | POST 解析/生成完整首页日运；GET 只读轮询，不 claim、不调用 AI |
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

### 4.5 StoreKit、会员和积分

`commerceService.ts` 对商品 ID、交易 ID、original transaction ID、app account token 和 JWS payload 做一致性检查，并以 transaction/idempotency key 防止重复入账。配置 Apple 根证书和 bundle ID 时使用 Apple Server Library 验签；未配置且 `APPLE_IAP_REQUIRE_SIGNED_VERIFICATION` 不是 `true` 时会退回到未验签 payload 解码。生产发布必须通过环境变量强制验签并执行真实交易验收。

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
| `APPLE_IAP_BUNDLE_ID` | StoreKit server verification | 无完整配置时不能创建 verifier |
| `APPLE_IAP_ENVIRONMENT` | Optional | 默认 Sandbox |
| `APPLE_IAP_APP_APPLE_ID` | Optional by Apple environment | 未配置时传 undefined |
| `APPLE_IAP_ROOT_CERTIFICATES_BASE64` | StoreKit server verification | 无证书时走回退或失败 |
| `APPLE_IAP_REQUIRE_SIGNED_VERIFICATION` | Production safety switch | `true` 时缺配置/验签失败直接拒绝 |

不要在文档、日志或测试 fixture 中写真实 key、token、证书或用户数据。

## 7. 外部运行证据

下表刻意把“代码具备能力”和“外部系统已可用”分开。本轮没有执行网络或控制台探测。

| Dependency | Verification | Checked on | Evidence | Current conclusion | Required next action |
|---|---|---|---|---|---|
| Vercel production deployment | EXTERNAL_UNVERIFIED | 2026-07-11 | Not probed in this documentation pass | 只确认 `api/vercel.json` 和 deploy script 存在 | 记录 deployment URL、commit、health 响应和日志 |
| Supabase schema/migrations/RLS | EXTERNAL_UNVERIFIED | 2026-07-23 | Not probed in this implementation pass | 只确认本地 SQL 002-011 | 在 staging 执行 011 并读取 table/function/RLS 状态 |
| Supabase Auth email/Apple/Google providers | EXTERNAL_UNVERIFIED | 2026-07-11 | Not probed in this documentation pass | 后端调用路径存在，Provider 状态未知 | 分别用有效/无效 token 验证登录合同 |
| Gemini generation | EXTERNAL_UNVERIFIED | 2026-07-23 | V2 transport/Prompt/schema unit tests only | V2 没有 fallback；真实模型尚未调用 | 在 staging 配置固定模型，验证内容质量和失败路径 |
| Apple StoreKit server verification | EXTERNAL_UNVERIFIED | 2026-07-11 | Not probed in this documentation pass | 代码允许严格验签或未验签解码 | 生产强制验签并执行沙盒/生产交易回放 |
| iOS end-to-end flows | EXTERNAL_UNVERIFIED | 2026-07-23 | iOS Simulator build succeeded; no live API run | V2 DTO、缓存和首页点击链路可编译，未证明线上可用 | 部署 staging 后用真实账号、三柱和四柱档案验收 |

## 8. 验证方案

本地静态与文档验证：

```bash
cd api
npm ci
npm run type-check
npm run test:docs
```

业务测试按能力运行：`test:auth-infra`、`test:invite`、`test:bazi-basic-info`、`test:true-solar-time`、`test:wuxing`、`test:shensha`、`test:mingli-ai-context`、`test:patterns`、`test:ziping-facts`、`test:mingli-interactions`、`test:daily-fortune`、`test:history`、`test:commerce`。

验收分三层：

1. **仓库合同：** type-check 和全部当前测试通过；文档列出每个路由和迁移。
2. **部署合同：** 目标 commit 部署成功，health 返回数据库 connected，迁移与环境变量核对完成。
3. **产品合同：** iOS 使用真实账号和档案跑通认证、排盘、运势、历史、付费主路径；示例回退不能计为 AI 联通。

## 9. 实施计划

### Phase 0 — 文档事实基线（本次）

- **改动：** 建立文档地图和当前实现指南；旧文档标注权威级别；加入清单、链接、路由、迁移和状态检查。
- **代码落点：** `docs/README.md`、本文、旧 Markdown 顶部状态、`api/scripts/verify-docs.js`、`api/tests/docsIntegrity.test.ts`、CI workflow。
- **验收：** 两份新仓库文档上限；39 个路由文件与 9 个迁移全部覆盖；无本机绝对链接；用户已有三处代码改动哈希不变。

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

### Phase 3 — 命理 AI 架构分段落地

具体理论、模块和五阶段顺序保留在 [八字 AI 后端命理架构 V2](designs/bazi-ai-mingli-architecture-v2.md)；个性化、记忆、问题规划和评估顺序保留在 [AI 个性化与主动问题规划架构](designs/zhizhi-ai-personalization-question-planning-architecture.md)。实施时必须继续遵守：确定性事实先于 AI 表达、事实/候选/判断分层、持久化与 eval 有明确证据、每阶段有代码落点和自动测试。两个设计稿仍是 `ROADMAP`，不能从本节推断已经上线。

## 10. 已知风险与决策边界

- Service Role 绕过 RLS：handler/repository 所有权过滤是高风险边界。
- Gemini 无 key 时回退示例：开发可用不等于真实 AI 可用。
- 首页日运 V2 不使用 Gemini 示例回退；缺 key、缺固定模型、超时或结构错误都会返回无正文状态。
- StoreKit 允许未验签解码：生产必须打开严格验签。
- 远端迁移未知：源码和 SQL 文件不能替代数据库 readback。
- 文档检查只能证明结构化覆盖，不能自动证明业务描述完全正确。
- 当前命理工作树未提交：整理文档不得吸收、改写或发布这些用户改动。
