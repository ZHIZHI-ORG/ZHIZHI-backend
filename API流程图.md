# 知之 ZHIZHI — API 调用流程图

> **Status:** PARTIAL
> **Release:** SHIPPABLE
> **Verification:** COMMITTED
> **Last verified:** 2026-07-11
> **Sources:** `api/api/[...path].ts`、`api/src/services/`、`api/src/database/repositories/`

> 本文的 Handler → Service → Repository → Supabase 分层仍适用，只覆盖基础流程。完整路由、AI/历史缓存、StoreKit 和实施计划见 [当前后端实现方案](docs/current-backend-implementation.md)。

---

## 整体架构

```
iOS App
  │
  │  HTTP 请求（Bearer Token）
  ▼
Vercel Serverless Functions（api/ 目录）
  │
  ├── Handler 层（路由入口，校验参数）
  │     │
  │     ▼
  ├── Service 层（业务逻辑）
  │     │
  │     ▼
  ├── Repository 层（数据库操作）
  │     │
  │     ▼
  └── Supabase（PostgreSQL + Auth）
```

---

## 用户认证流程

```
用户输入邮箱密码
  │
  ▼
POST /api/auth/login
  │
  ├── loginHandler
  │     │
  │     ▼
  │   authService.loginWithPassword()
  │     │
  │     ├── supabase.auth.signInWithPassword()  ← Supabase Auth 验证密码
  │     │     └── 返回 access_token / refresh_token
  │     │
  │     └── userRepository.findById()           ← 查业务 users 表
  │           └── 确认账号存在且未被禁用
  │
  ▼
返回 { user, access_token, refresh_token }
  │
  └── iOS 存入本地，后续所有请求带上 Authorization: Bearer <token>
```

---

## 每个需要登录的接口的鉴权流程

```
iOS 发起任意请求（带 Authorization: Bearer <token>）
  │
  ▼
Handler 调用 getCurrentUser(req)
  │
  ▼
auth.ts → verifyToken(token)
  │
  ├── supabase.auth.getUser(token)   ← 验证 JWT 签名
  │
  └── userRepository.findById()      ← 确认用户存在且 is_active=true
        │
        ├── 通过 → 返回 user 对象，继续执行业务逻辑
        └── 失败 → 返回 401 Unauthorized
```

---

## 创建八字档案流程

```
POST /api/bazi/create  { name, birth_year, ... }
  │
  ▼
baziCreateHandler
  │
  ├── getCurrentUser()               ← 鉴权
  │
  ▼
baziService.createBaziProfile()
  │
  ├── baziCalculator.calculate()     ← 纯本地计算，不调外部 API
  │     │
  │     ├── lunar-javascript         ← 计算四柱天干地支
  │     ├── 计算十神、藏干、纳音、空亡
  │     ├── shenShaCalculator        ← 查表得 18 个神煞
  │     └── 计算大运、五行分布
  │
  └── baziProfileRepository.create() ← 写入 bazi_profiles 表
        │
        └── 返回完整档案（含 full_chart JSONB）
```

---

## 每日运势流程（模块5 + 模块6 共用）

```
GET /api/fortune/daily
GET /api/insights/cards
GET /api/insights/analysis
GET /api/insights/detail/:category
         │
         ▼（四个接口内部逻辑相同，只是最后返回字段不同）
         │
  ├── getCurrentUser()               ← 鉴权
  │
  ▼
fortuneService.getDailyFortuneData()
  │
  ├── baziProfileRepository.findByOwner()            ← 取用户本人八字档案
  │
  ├── userInteractionRepository.getCategoryWeights() ← 取用户历史行为权重
  │
  └── geminiClient.generateDailyFortune()
        │
        ├── GEMINI_API_KEY 有值 → 调用 Gemini API 生成真实内容
        │     └── 解析返回的 JSON
        │
        └── GEMINI_API_KEY 为空 → 直接返回 buildMockData() 示例数据
              │
              └── 基于用户真实八字（日主/五行）填充内容

         │
         ▼（各接口按需截取字段）
         │
  ├── fortune/daily              → day_master_card + scenes
  ├── insights/cards             → insight_cards
  ├── insights/analysis          → analysis（无 bullets）
  └── insights/detail/:category  → analysis[category]（含 bullets）
              │
              └── 同时异步写入 user_interactions 表（记录 view_card 行为）
```

---

## 推荐权重累积流程

```
用户点击某个洞察维度（如 career）
  │
  ▼
GET /api/insights/detail/career
  │
  ├── 返回数据给前端（主流程）
  │
  └── 异步写入 user_interactions
        { user_id, category: 'career', action: 'view_card' }

下次用户请求运势时
  │
  ▼
getCategoryWeights() 统计点击次数
  └── career(12次) > health(8次) > love(3次)
        │
        └── 注入 Gemini prompt：
            "用户最感兴趣：事业(12次) > 健康(8次)，请增加这些方向的深度"
```

---

## 数据库表关系

```
auth.users（Supabase 内置）
  │ 1:1
  ▼
users（业务表）
  │ 1:N
  ├── bazi_profiles（八字档案）
  │
  ├── user_interactions（行为记录）
  │
  └── invite_code_usages（通过 invite_codes 关联）
```
