# 知之 ZHIZHI 后端

> **Status:** CURRENT
> **Release:** SHIPPABLE
> **Verification:** WORKTREE
> **Last verified:** 2026-07-11
> **Sources:** `api/api/`, `api/src/`, `supabase/`, `api/tests/`, `api/package.json`

知之当前后端是 TypeScript + Vercel Serverless Functions + Supabase 的八字命理 API。仓库已经覆盖认证、用户资料、八字档案、每日运势与洞察、历史记录、邀请码、内容和 StoreKit 交易/积分能力。

这份 README 只负责开发入口。具体实现、接口清单、数据库迁移、环境变量、部署约束和后续计划统一维护在 [当前后端实现方案](docs/current-backend-implementation.md)，所有文档的权威级别与适用范围见 [文档地图](docs/README.md)。

## 当前系统边界

```text
iOS / API consumer
  -> Vercel route adapter (`api/api/[...path].ts`)
  -> route handler (`api/api/**`)
  -> service (`api/src/services/**`)
  -> repository / Supabase Auth (`api/src/database/**`)
  -> Supabase PostgreSQL

fortune / insights
  -> Gemini（配置 `GEMINI_API_KEY` 时）
  -> 示例回退数据（未配置时，仅用于开发）
```

- 路由事实：`api/api/**/*.ts`，当前共 39 个 TypeScript 路由/适配文件。
- 数据事实：`supabase/schema.sql` + `supabase/migrations/002_*.sql` 至 `010_*.sql`。
- 行为事实：handler、service、repository、model 和 `api/tests/`。
- 生产状态：本轮未探测 Vercel、Supabase、Gemini、Apple/Google Provider 或 iOS 端到端链路，不以源码状态替代线上可用性结论。

## 本地启动

要求：Node.js 18+、npm、可用的 Supabase 项目配置。

```bash
cd api
npm ci
cp .env.example .env
# 填写 SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_KEY
npm run doctor
npm run dev:node
```

默认 Node 本地服务入口由 `api/server.ts` 提供；Vercel 路由行为使用：

```bash
cd api
npm run dev
```

健康检查：`GET /api/health`。它会真实查询 `users` 表；`database: connected` 才表示这次请求的数据库检查成功。

## 验证

```bash
cd api
npm run type-check
npm run test:docs
```

业务回归测试仍按 `api/package.json` 中的 `test:*` 脚本分别运行。文档完整性检查只验证结构化事实覆盖和链接，不声称自动证明自然语言语义正确。

## 部署

部署根目录是 `api/`，Vercel 配置在 `api/vercel.json`：

```bash
cd api
npm run deploy
```

部署前至少需要在目标环境配置 Supabase 三项变量。Gemini 和 StoreKit 服务端签名校验变量是否配置，决定对应能力走真实外部服务、开发回退或降级校验；完整约束见 [当前后端实现方案](docs/current-backend-implementation.md#环境变量与外部依赖)。

## 文档入口

- [文档地图：每份文档的状态、用途和证据](docs/README.md)
- [当前后端实现方案：系统、API、数据库、部署和实施计划](docs/current-backend-implementation.md)
- [神煞总表](神煞总表.md)
- [五行能量算法](docs/weighted-wuxing-v2-9-algorithm.md)

早期 API 合同、实施清单、Supabase/Vercel 教程仍保留供追溯，不再作为当前实现入口。
