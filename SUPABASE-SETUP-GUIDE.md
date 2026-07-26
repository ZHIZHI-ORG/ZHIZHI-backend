# Supabase 配置指南 - 知之 ZHIZHI 项目

> **Status:** SUPERSEDED
> **Release:** HISTORICAL
> **Verification:** COMMITTED
> **Last verified:** 2026-07-11
> **Sources:** 早期初始化教程；当前数据库事实为 `supabase/schema.sql` + `supabase/migrations/002..010`

> 本文仍描述 `profiles/contents/comments/likes`，与当前 `users/bazi_profiles/history_records/commerce_*` 等结构不一致。保留操作细节供追溯，当前迁移顺序和验收见 [当前后端实现方案](docs/current-backend-implementation.md#5-数据库结构与迁移顺序)。

## 🚀 第一步：创建 Supabase 项目

### 1. 注册账号

1. 访问 https://app.supabase.com
2. 点击 "Start your project"
3. 使用 GitHub 账号登录（推荐）或邮箱注册

### 2. 创建新项目

点击 "New Project" 后填写：

```
Organization: 选择你的组织（或创建新的）

Project Settings:
├── Name: zhizhi-mvp                    ← 项目名称
├── Database Password: ********         ← 设置强密码（务必记住！）
└── Region: Northeast Asia (Tokyo)      ← 选择东京（最接近中国）
    或 Southeast Asia (Singapore)       ← 或新加坡
```

**重要提示**：
- ⚠️ 数据库密码只显示一次，请立即保存到安全的地方
- ⚠️ 区域选择后不可更改
- ⏱️ 项目创建需要约 2 分钟

---

## 📊 第二步：初始化数据库结构

### 1. 打开 SQL Editor

1. 项目创建完成后，点击左侧菜单 "SQL Editor"
2. 点击右上角 "+ New query" 按钮

### 2. 执行数据库初始化脚本

**方式 1：复制粘贴（推荐）**

1. 打开你本地的 `supabase/schema.sql` 文件
2. 复制所有内容（约 200+ 行）
3. 粘贴到 Supabase 的 SQL Editor
4. 点击右下角 "Run" 按钮（或按 Cmd/Ctrl + Enter）
5. 等待执行完成（约 3-5 秒）

**方式 2：分段执行（如果报错）**

如果一次执行失败，可以分段执行：

```sql
-- 第一段：创建表
CREATE TABLE IF NOT EXISTS profiles (...);
CREATE TABLE IF NOT EXISTS contents (...);
CREATE TABLE IF NOT EXISTS comments (...);
CREATE TABLE IF NOT EXISTS likes (...);
```

执行后点击 "Run"

```sql
-- 第二段：创建索引
CREATE INDEX IF NOT EXISTS idx_contents_user_id ON contents(user_id);
-- ... 其他索引
```

执行后点击 "Run"

```sql
-- 第三段：启用 RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
-- ... 其他策略
```

执行后点击 "Run"

### 3. 验证表创建成功

1. 点击左侧菜单 "Table Editor"
2. 应该看到以下表：
   - ✅ `profiles`
   - ✅ `contents`
   - ✅ `comments`
   - ✅ `likes`

3. 点击任意表名，查看表结构：
   - 应该能看到所有字段
   - 应该能看到索引
   - 应该能看到关系（Foreign Keys）

**如果看不到表**：
- 检查 SQL 执行是否有错误提示
- 刷新页面
- 重新执行 schema.sql

---

## 🔑 第三步：获取 API 密钥

### 1. 进入项目设置

1. 点击左侧菜单底部的 ⚙️ "Project Settings"
2. 点击左侧子菜单 "API"

### 2. 复制以下三个关键信息

你会看到以下配置（示例）：

```
Project URL
https://abcdefghijklmnop.supabase.co
```
👆 **复制这个 URL**

```
API Keys

anon public
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTcwNjA3NjAwMCwiZXhwIjoyMDIxNjUyMDAwfQ.xxxxxxxxxxxxxxxxxxxxxx
```
👆 **复制这个 Key**（前端和后端都用）

```
service_role secret
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNzA2MDc2MDAwLCJleHAiOjIwMjE2NTIwMDB9.yyyyyyyyyyyyyyyyyyyy
```
👆 **复制这个 Key**（⚠️ 只在后端使用，不要暴露给前端！）

### 3. 保存到本地 `.env` 文件

```bash
cd api
nano .env  # 或用任何文本编辑器打开
```

填入以下内容（替换成你的实际值）：

```env
# Supabase 配置
SUPABASE_URL=https://你的项目ID.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...你的anon-key
SUPABASE_SERVICE_KEY=eyJhbGc...你的service-role-key

# 应用配置
NODE_ENV=development
```

**保存并关闭文件**（nano: Ctrl+X → Y → Enter）

---

## ✅ 第四步：验证配置

### 1. 测试数据库连接

在本地项目目录运行：

```bash
cd api
npm install  # 如果还没安装依赖
npm run dev
```

应该看到：
```
> vercel dev

Vercel CLI 33.0.1
> Ready! Available at http://localhost:3000
```

### 2. 测试健康检查 API

打开浏览器访问：
```
http://localhost:3000/api/health
```

**期望响应**：
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-01-19T...",
    "database": "connected"  ← 这个是关键！
  }
}
```

**如果 `database: "disconnected"`**：
- 检查 `.env` 文件配置是否正确
- 检查 Supabase 项目是否正常运行
- 检查网络连接

### 3. 测试用户注册（完整流程）

使用 Postman 或 curl：

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test1234",
    "username": "testuser"
  }'
```

**期望响应**：
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "testuser",
    "email": "test@example.com",
    "created_at": "2025-01-19T10:00:00.000Z"
  },
  "message": "注册成功"
}
```

### 4. 在 Supabase 后台验证

回到 Supabase Dashboard：

**验证 1：检查认证用户**
1. 点击左侧 "Authentication" → "Users"
2. 应该看到刚才注册的用户
3. 邮箱：`test@example.com`
4. 状态：`Confirmed`（或 `Waiting for confirmation`，如果启用了邮件验证）

**验证 2：检查用户资料**
1. 点击左侧 "Table Editor" → `profiles` 表
2. 应该看到一条记录
3. `username`: `testuser`
4. `email`: `test@example.com`
5. `id`: 与 Authentication 中的用户 ID 相同

---

## 📖 Supabase 后台功能介绍

### 核心功能模块

```
Supabase Dashboard
├── 🏠 Home                     # 项目概览、快速开始
├── 📊 Table Editor             # 数据库表管理（类似 phpMyAdmin）
├── 🔐 Authentication           # 用户管理
├── 📁 Storage                  # 文件存储（图片、视频等）
├── 💻 SQL Editor              # 执行 SQL 查询
├── 📊 Database                # 数据库管理
│   ├── Tables                 # 表列表
│   ├── Roles                  # 数据库角色
│   ├── Extensions             # PostgreSQL 扩展
│   ├── Replication            # 数据复制
│   └── Webhooks              # 数据库钩子
├── 🔌 API Docs                # 自动生成的 API 文档
├── 📈 Logs                    # 日志查看
└── ⚙️ Project Settings         # 项目配置
    ├── General                # 基本设置
    ├── Database               # 数据库配置
    ├── API                    # API 密钥（重要！）
    └── Billing                # 账单
```

### 你会经常用到的功能

#### 1️⃣ Table Editor（表编辑器）

**用途**：可视化管理数据

操作示例：
1. 点击 `contents` 表
2. 点击 "+ Insert row" 手动添加测试数据
3. 点击任意行可以编辑
4. 点击列头可以筛选、排序

**何时使用**：
- 添加测试数据
- 查看用户创建的内容
- 调试数据问题
- 手动修改/删除数据

#### 2️⃣ Authentication（认证管理）

**用途**：管理用户账号

操作示例：
1. 查看所有注册用户
2. 手动创建用户
3. 重置用户密码
4. 删除用户账号
5. 查看用户登录历史

**何时使用**：
- 查看注册用户数量
- 帮助用户重置密码
- 删除测试账号
- 调试认证问题

#### 3️⃣ SQL Editor（SQL 编辑器）

**用途**：执行自定义 SQL 查询

操作示例：
```sql
-- 查询最近注册的 10 个用户
SELECT * FROM profiles
ORDER BY created_at DESC
LIMIT 10;

-- 查询发布的文章数量
SELECT COUNT(*) FROM contents
WHERE status = 'published';

-- 删除所有测试数据
DELETE FROM contents
WHERE title LIKE '%测试%';
```

**何时使用**：
- 复杂查询
- 批量操作
- 数据统计
- 调试问题

#### 4️⃣ API Docs（API 文档）

**用途**：查看 Supabase 自动生成的 API 文档

操作示例：
1. 点击 "API Docs"
2. 选择 "Tables and Views" → `contents`
3. 看到 Supabase 提供的 JavaScript/TypeScript 代码示例
4. 可以直接在前端使用（但我们用的是自己的后端 API）

**何时使用**：
- 前端需要直接访问数据库时（绕过你的后端）
- 学习 Supabase 的查询语法
- 快速原型开发

---

## 🔒 Row Level Security (RLS) 说明

### 什么是 RLS？

RLS（行级安全）是 PostgreSQL 的功能，让你可以控制**谁可以访问哪些数据**。

### 你项目中的 RLS 策略

已在 `schema.sql` 中配置：

```sql
-- Profiles 表策略
CREATE POLICY "用户可以查看所有公开资料" ON profiles
  FOR SELECT USING (true);  -- 所有人都能查看

CREATE POLICY "用户可以更新自己的资料" ON profiles
  FOR UPDATE USING (auth.uid() = id);  -- 只能改自己的

-- Contents 表策略
CREATE POLICY "所有人可以查看已发布的内容" ON contents
  FOR SELECT USING (status = 'published' OR user_id = auth.uid());
  -- 已发布的所有人可看，草稿只有作者可看

CREATE POLICY "用户可以创建自己的内容" ON contents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "用户可以更新自己的内容" ON contents
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "用户可以删除自己的内容" ON contents
  FOR DELETE USING (auth.uid() = user_id);
```

### 如何验证 RLS 是否生效？

1. **在 Table Editor 中测试**
   - 点击 `contents` 表
   - 点击右上角 "RLS Disabled/Enabled" 切换
   - 如果 RLS Enabled，你会发现某些数据看不到

2. **通过 API 测试**
   ```bash
   # 创建用户 A 的文章（草稿）
   # 用用户 B 的 Token 尝试访问
   # 应该返回 403 或看不到数据
   ```

---

## 🎓 常用操作速查

### 查看项目统计
```
Home → 可以看到：
- 数据库大小
- API 请求数
- 存储使用量
- 活跃用户数
```

### 导出数据库
```
Database → Backups → Download backup
```

### 查看 API 日志
```
Logs → API Logs
可以看到所有 API 请求记录
```

### 重置数据库密码
```
Project Settings → Database → Reset database password
```

---

## 🚨 常见问题

### Q1: 忘记数据库密码怎么办？
**A**: 可以重置，但会导致所有现有连接失效。
1. Project Settings → Database → Reset password
2. 更新 `.env` 文件（如果你用的是直连）
3. 注意：使用 `SUPABASE_SERVICE_KEY` 不需要数据库密码

### Q2: 表创建失败怎么办？
**A**:
1. 检查 SQL 语法错误
2. 查看 SQL Editor 底部的错误信息
3. 可能是权限问题，尝试刷新页面重新执行

### Q3: API 连接不上怎么办？
**A**:
1. 检查 `.env` 中的 `SUPABASE_URL` 是否正确
2. 检查 `SUPABASE_SERVICE_KEY` 是否正确（不要用 anon key）
3. 检查网络连接
4. 查看 Supabase 项目状态（是否暂停）

### Q4: RLS 导致数据访问失败？
**A**:
1. 检查是否使用了 `SUPABASE_SERVICE_KEY`（可以绕过 RLS）
2. 检查 RLS 策略是否正确
3. 临时禁用 RLS 测试：
   ```sql
   ALTER TABLE contents DISABLE ROW LEVEL SECURITY;
   ```

---

## 📚 下一步学习

### 1. 文件存储（Storage）
当需要上传图片、视频时：
1. 点击 "Storage"
2. 创建 Bucket（如 `avatars`、`content-images`）
3. 配置访问策略

### 2. 实时订阅（Realtime）
当需要实时更新（如聊天、通知）时：
1. Database → Replication
2. 启用表的 Realtime
3. 前端使用 Supabase SDK 订阅

### 3. Edge Functions（边缘函数）
当需要运行服务端代码时：
1. Functions → New function
2. 类似 Vercel Functions，但在 Supabase 平台

---

## ✅ 验证清单

完成以下所有项，说明 Supabase 配置成功：

- [ ] 项目创建成功
- [ ] 数据库密码已保存
- [ ] `schema.sql` 执行成功
- [ ] Table Editor 中能看到 4 个表（profiles, contents, comments, likes）
- [ ] API 密钥已复制到 `.env` 文件
- [ ] 本地 `npm run dev` 启动成功
- [ ] `/api/health` 返回 `"database": "connected"`
- [ ] 注册接口测试成功
- [ ] Supabase Authentication 中能看到新用户
- [ ] Table Editor 的 `profiles` 表中能看到新记录

全部打勾后，你的 Supabase 环境就完全配置好了！🎉

---

## 🆘 获取帮助

如果遇到问题：
1. 查看本文档的"常见问题"部分
2. 查看 Supabase 官方文档：https://supabase.com/docs
3. 查看项目的 `IMPLEMENTATION-CHECKLIST.md`
4. 随时问我！😊
