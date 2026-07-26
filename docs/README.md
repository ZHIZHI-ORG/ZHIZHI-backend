# ZHIZHI 后端文档地图

> **Status:** CURRENT
> **Release:** SHIPPABLE
> **Verification:** WORKTREE
> **Last verified:** 2026-07-11
> **Sources:** repository Markdown inventory, `api/api/`, `supabase/migrations/`, `api/tests/`

## 如何使用

产品和工程判断从 [当前后端实现方案](current-backend-implementation.md) 开始。它负责当前系统边界、具体实现、依赖、实施阶段和验收证据；领域规则文档继续保留完整算法、理论、反例和测试样例，不在总览里重复。

状态含义：

- `CURRENT`：当前权威说明。
- `PARTIAL`：有可用内容，混有尚未实现或未同步部分，使用时必须核对来源。
- `ROADMAP`：目标方案或后续计划，不代表已经实现。
- `HISTORICAL`：历史需求、日志、样例或第三方资料，只用于追溯。
- `SUPERSEDED`：已经被新文档或代码合同取代。

发布状态含义：`SHIPPABLE` 表示仓库实现具备提交/部署形态，不等于线上已经验证；`EXPERIMENTAL` 表示工作树或规划能力；`HISTORICAL` 表示不参与当前发布判断。验证状态含义：`COMMITTED` 只确认提交内证据，`WORKTREE` 包含本地未提交实现，`LIVE_VERIFIED` 需要线上探测，`EXTERNAL_UNVERIFIED` 表示依赖外部系统且本轮没有确认。

## 文档清单

每份仓库 Markdown 文档只在下表出现一次。`Sources` 给出判断依据，不代表已经完成线上验证。

| Document | Status | Release | Verification | Last verified | Primary purpose | Product criticality | Sources |
|---|---|---|---|---|---|---|---|
| [0219-req-docs/simple.md](../0219-req-docs/simple.md) | HISTORICAL | HISTORICAL | COMMITTED | 2026-07-11 | 2026-02 产品/API 需求基线 | Medium | 文件原文；当前 handler 对照 |
| [API-CONTRACT.md](../API-CONTRACT.md) | SUPERSEDED | HISTORICAL | COMMITTED | 2026-07-11 | 早期 v1 API 示例 | Low | `api/api/` 已扩展并改变合同 |
| [API流程图.md](../API流程图.md) | PARTIAL | SHIPPABLE | COMMITTED | 2026-07-11 | 基础请求分层与错误流 | Medium | `api/api/[...path].ts`；services；repositories |
| [CONTRACT-V2/auth_provider_configuration.md](../CONTRACT-V2/auth_provider_configuration.md) | PARTIAL | EXPERIMENTAL | EXTERNAL_UNVERIFIED | 2026-07-11 | Apple/Google/Supabase 配置与验收计划 | High | 后端源码；外部 Provider 未复验 |
| [CONTRACT-V2/authentication_requirements.md](../CONTRACT-V2/authentication_requirements.md) | SUPERSEDED | HISTORICAL | COMMITTED | 2026-07-11 | 认证 V4.1 需求草案 | Medium | 与当前 camelCase handler 合同存在差异 |
| [IMPLEMENTATION-CHECKLIST.md](../IMPLEMENTATION-CHECKLIST.md) | HISTORICAL | HISTORICAL | COMMITTED | 2026-07-11 | 2025 MVP 启动清单 | Low | 大量阶段已经过期 |
| [README.md](../README.md) | CURRENT | SHIPPABLE | WORKTREE | 2026-07-11 | 仓库入口与本地启动 | High | 当前代码、配置和测试脚本 |
| [SUPABASE-SETUP-GUIDE.md](../SUPABASE-SETUP-GUIDE.md) | SUPERSEDED | HISTORICAL | COMMITTED | 2026-07-11 | 早期 Supabase 操作教程 | Low | 仍描述 `profiles/contents/comments/likes` |
| [VERCEL-DEPLOYMENT-GUIDE.md](../VERCEL-DEPLOYMENT-GUIDE.md) | HISTORICAL | HISTORICAL | COMMITTED | 2026-07-11 | 早期 Vercel 入门教程 | Low | 固定本机路径和旧项目描述 |
| [docs/README.md](README.md) | CURRENT | SHIPPABLE | WORKTREE | 2026-07-11 | 文档权威、发布与证据导航 | High | 全仓 Markdown 清单 |
| [docs/current-backend-implementation.md](current-backend-implementation.md) | CURRENT | SHIPPABLE | WORKTREE | 2026-07-11 | 当前实现、依赖、阶段计划和验收 | Critical | routes、handlers、services、migrations、tests |
| [docs/day-master-wangshuai-fact-layer-rules.md](day-master-wangshuai-fact-layer-rules.md) | ROADMAP | EXPERIMENTAL | COMMITTED | 2026-07-11 | 旺衰事实层规则与校准计划 | Medium | 现有 `dayMasterStrength` + 文档规划 |
| [docs/designs/bazi-ai-mingli-architecture-v2.md](designs/bazi-ai-mingli-architecture-v2.md) | ROADMAP | EXPERIMENTAL | COMMITTED | 2026-07-11 | 命理 AI 目标架构和分期 | High | 文档已明确未进入完整实现 |
| [docs/designs/home-daily-fortune-v2.md](designs/home-daily-fortune-v2.md) | CURRENT | SHIPPABLE | WORKTREE | 2026-07-23 | 首页日运 V2 的产品合同、流程、缓存和上线顺序 | Critical | V2 handler、service、artifact migration、专项测试、iOS build |
| [docs/designs/zhizhi-ai-personalization-question-planning-architecture.md](designs/zhizhi-ai-personalization-question-planning-architecture.md) | ROADMAP | EXPERIMENTAL | COMMITTED | 2026-07-11 | 个性化、记忆、问题规划目标架构 | High | 文档已明确未进入实现 |
| [docs/mingli-classical-structure-facts.md](mingli-classical-structure-facts.md) | SUPERSEDED | HISTORICAL | COMMITTED | 2026-07-11 | 早期月令结构事实规划 | Medium | 当前 `zipingStructureFacts.ts` 合同更完整 |
| [docs/mingli-fact-layer-rules.md](mingli-fact-layer-rules.md) | PARTIAL | EXPERIMENTAL | WORKTREE | 2026-07-11 | 命理事实层规则、边界和展示方案 | High | calculators、interaction engine、tests |
| [docs/mingli-pattern-judgement-rules.md](mingli-pattern-judgement-rules.md) | PARTIAL | EXPERIMENTAL | COMMITTED | 2026-07-11 | 格局候选与判断阶段 | High | `patternJudgement.ts`、相关测试 |
| [docs/mingli-xiji-yongshen-tiaohou-rules.md](mingli-xiji-yongshen-tiaohou-rules.md) | ROADMAP | EXPERIMENTAL | COMMITTED | 2026-07-11 | 喜忌、用神、调候规则索引 | Medium | 文档中的 v1 规划边界 |
| [docs/weighted-wuxing-v2-9-algorithm.md](weighted-wuxing-v2-9-algorithm.md) | CURRENT | SHIPPABLE | COMMITTED | 2026-07-11 | 当前五行能量算法合同与案例 | High | `baziCalculator.ts`、`weightedWuxing.test.ts` |
| [开发日志.md](../开发日志.md) | PARTIAL | HISTORICAL | COMMITTED | 2026-07-11 | 已完成模块的时间线记录 | Low | 只记录部分阶段，不是当前总览 |
| [排盘相关/8Char-Uni-App-master/README.md](../排盘相关/8Char-Uni-App-master/README.md) | HISTORICAL | HISTORICAL | COMMITTED | 2026-07-11 | 引入的第三方排盘项目说明 | Low | 第三方原始资料 |
| [排盘相关/排盘结果-1995年11月05日22点30分-男.md](../排盘相关/排盘结果-1995年11月05日22点30分-男.md) | HISTORICAL | HISTORICAL | COMMITTED | 2026-07-11 | 固定命盘样例结果 | Low | 样例数据，不是系统合同 |
| [神煞总表.md](../神煞总表.md) | CURRENT | SHIPPABLE | COMMITTED | 2026-07-11 | 当前神煞算法唯一总表 | High | `shenShaCalculator.ts`、相关测试 |

## 维护规则

1. 新增或删除 Markdown 文件时同步更新本表。
2. 当前实现变化先改 [当前后端实现方案](current-backend-implementation.md) 的对应合同，再更新详细领域文档。
3. 路线图必须写清当前实现、目标实现、代码落点、依赖、测试和验收，不能把计划写成已上线事实。
4. 外部系统只有在留下日期、环境和证据后才能标记 `LIVE_VERIFIED`。
5. `npm run test:docs` 只保证清单、链接、路由/迁移覆盖和结构化状态不漂移；规则语义仍需代码与测试评审。
