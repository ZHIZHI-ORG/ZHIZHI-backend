# Vercel 部署指南 - 知之 ZHIZHI 项目

## 🎯 Vercel 是什么？

Vercel 是一个**云部署平台**，专门用于部署前端和 Serverless API。

**类比**：
- Java 项目部署：你需要 Tomcat/Spring Boot + 云服务器（阿里云/腾讯云）
- Vercel 项目部署：只需要 `git push`，自动部署到全球 CDN

**核心优势**：
- ✅ 自动部署（推送代码即部署）
- ✅ 全球 CDN 加速
- ✅ 免费的 HTTPS 证书
- ✅ 环境变量管理
- ✅ 日志查看
- ✅ 每月免费额度（个人项目够用）

---

## 📝 快速上手流程

```
本地开发 → Git 提交 → 推送到 GitHub → Vercel 自动部署 → 获得生产 URL
```

---

## 🚀 第一步：本地开发与测试（必做）

在部署到 Vercel 之前，**必须先在本地跑通**。

### 1.1 确认项目结构

```bash
cd /Users/jason/Library/CloudStorage/OneDrive-个人/2026/2026\ -\ 创业\ -\ 知之ZHIZHI/zhizhi-code/api

# 检查文件结构
ls -la
```

应该看到：
```
api/
├── api/              ← API 端点文件夹
├── src/              ← 源代码
├── package.json      ← 依赖配置
├── tsconfig.json     ← TypeScript 配置
├── vercel.json       ← Vercel 配置（已生成）
├── .env              ← 环境变量（不要提交到 Git）
└── .gitignore        ← Git 忽略文件
```

### 1.2 安装依赖

```bash
npm install
```

**期望输出**：
```
added 150 packages in 30s
```

### 1.3 本地启动测试

```bash
npm run dev
```

**期望输出**：
```
Vercel CLI 33.0.1
> Ready! Available at http://localhost:3000
```

### 1.4 测试健康检查

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
    "database": "connected"
  }
}
```

**如果失败**：
- 检查 Supabase 是否配置成功
- 检查 `.env` 文件是否正确
- 查看终端错误信息

---

## 🔧 第二步：准备 Git 仓库

Vercel 需要从 Git 仓库拉取代码，所以必须先提交代码。

### 2.1 初始化 Git（如果还没有）

```bash
# 进入项目根目录
cd /Users/jason/Library/CloudStorage/OneDrive-个人/2026/2026\ -\ 创业\ -\ 知之ZHIZHI/zhizhi-code

# 初始化 Git
git init

# 添加所有文件
git add .

# 查看将要提交的文件
git status
```

**重要检查**：
确保 `.env` 文件**不在**提交列表中！

```bash
# 应该看到 .env 被忽略
# (use "git add <file>..." to include in what will be committed)
#   .env  ← 这个应该是红色或不显示（被 .gitignore 忽略）
```

### 2.2 提交代码

```bash
# 首次提交
git commit -m "Initial commit: 知之ZHIZHI MVP backend"

# 查看提交记录
git log --oneline
```

### 2.3 推送到 GitHub

**选项 1：创建新仓库（推荐）**

1. 访问 https://github.com/new
2. 填写仓库信息：
   ```
   Repository name: zhizhi-mvp
   Description: 知之ZHIZHI - 内容平台 MVP 版本
   Private: ✅ 勾选（私有仓库）
   ```
3. 点击 "Create repository"

4. 在本地连接到 GitHub：
   ```bash
   # 替换成你的 GitHub 用户名
   git remote add origin https://github.com/你的用户名/zhizhi-mvp.git

   # 推送代码
   git branch -M main
   git push -u origin main
   ```

**选项 2：使用现有仓库**

```bash
git remote add origin https://github.com/你的用户名/现有仓库名.git
git push -u origin main
```

### 2.4 验证推送成功

访问 GitHub 仓库页面，应该能看到所有代码。

---

## 🌐 第三步：在 Vercel 部署

### 3.1 注册 Vercel 账号

1. 访问 https://vercel.com
2. 点击 "Sign Up"
3. **选择 "Continue with GitHub"**（推荐，自动关联仓库）
4. 授权 Vercel 访问 GitHub

### 3.2 导入项目

1. 登录后，点击 "Add New..." → "Project"
2. 选择 "Import Git Repository"
3. 找到你的仓库 `zhizhi-mvp`，点击 "Import"

### 3.3 配置项目

**Build & Development Settings**

```
Framework Preset: Other
Root Directory: api          ← 重要！指定 api 文件夹
Build Command: (留空)
Output Directory: (留空)
Install Command: npm install
```

**为什么 Root Directory 是 `api`？**
因为你的项目结构是：
```
zhizhi-code/          ← Git 仓库根目录
├── api/              ← Vercel 项目根目录（后端）
├── supabase/         ← 数据库脚本（不部署）
└── README.md
```

Vercel 需要知道实际的代码在 `api/` 文件夹中。

### 3.4 配置环境变量

**在部署前，必须先配置环境变量！**

1. 在项目配置页面，找到 **"Environment Variables"** 部分
2. 添加以下变量：

```
Name: SUPABASE_URL
Value: https://你的项目ID.supabase.co
Environment: Production ✅  Preview ✅  Development ✅
```

```
Name: SUPABASE_ANON_KEY
Value: eyJhbGc...你的anon-key
Environment: Production ✅  Preview ✅  Development ✅
```

```
Name: SUPABASE_SERVICE_KEY
Value: eyJhbGc...你的service-role-key
Environment: Production ✅  Preview ✅  Development ✅
```

```
Name: NODE_ENV
Value: production
Environment: Production ✅
```

⚠️ **重要提示**：
- 不要在代码中硬编码这些密钥
- `SUPABASE_SERVICE_KEY` 是敏感信息，不要泄露

### 3.5 开始部署

1. 检查所有配置无误
2. 点击 **"Deploy"** 按钮
3. 等待部署（约 1-3 分钟）

**部署过程**：
```
Building...              (30s)
  ├── Installing dependencies
  ├── Compiling TypeScript
  └── Creating serverless functions

Deploying...             (30s)
  ├── Uploading to global CDN
  └── Configuring routes

Ready!                   (完成)
  ✅ https://zhizhi-mvp-xxx.vercel.app
```

### 3.6 获取生产环境 URL

部署成功后，会显示：
```
🎉 Your project has been deployed!

Production URL:
https://zhizhi-mvp-abc123.vercel.app
```

**复制这个 URL**，这就是你的生产环境 API 地址！

---

## ✅ 第四步：验证部署成功

### 4.1 测试健康检查

在浏览器访问：
```
https://你的项目.vercel.app/api/health
```

**期望响应**：
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "database": "connected"
  }
}
```

### 4.2 测试用户注册

使用 Postman 或 curl：

```bash
curl -X POST https://你的项目.vercel.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "prod-test@example.com",
    "password": "ProdTest1234",
    "username": "produser"
  }'
```

**期望响应**：
```json
{
  "success": true,
  "data": {
    "id": "...",
    "username": "produser",
    "email": "prod-test@example.com"
  },
  "message": "注册成功"
}
```

### 4.3 在 Supabase 验证

回到 Supabase Dashboard：
1. Authentication → Users
2. 应该看到新注册的用户 `prod-test@example.com`

---

## 🔄 后续开发流程

### 每次代码修改后

```bash
# 1. 修改代码（如添加新功能）
# 2. 本地测试
npm run dev

# 3. 提交代码
git add .
git commit -m "feat: 添加评论功能"

# 4. 推送到 GitHub
git push

# 5. Vercel 自动部署（无需手动操作！）
```

**Vercel 会自动**：
- 检测到 GitHub 代码变化
- 自动构建
- 自动部署
- 发送邮件通知你部署结果

### 查看部署状态

1. 访问 https://vercel.com/dashboard
2. 点击你的项目
3. 看到部署历史：
   ```
   Production Deployments
   ├── feat: 添加评论功能        (Building...)
   ├── fix: 修复登录 bug         (Ready)
   └── Initial commit           (Ready)
   ```

---

## 🎛️ Vercel Dashboard 功能介绍

### 核心页面

```
Vercel Dashboard
├── 🏠 Overview              # 项目概览
├── 🚀 Deployments          # 部署历史
├── 📊 Analytics            # 访问统计（需要付费版）
├── 📝 Logs                 # 日志查看
├── ⚙️ Settings              # 项目设置
│   ├── General             # 基本设置
│   ├── Environment Variables  # 环境变量
│   ├── Domains             # 自定义域名
│   └── Git                 # Git 集成
└── 💰 Usage                # 使用量统计
```

### 你会经常用到的功能

#### 1️⃣ Deployments（部署历史）

**用途**：查看所有部署记录

**功能**：
- 查看每次部署的状态（成功/失败）
- 查看构建日志
- 回滚到之前的版本
- 查看预览环境

**使用场景**：
```
新部署失败了？
→ 点击失败的部署
→ 查看 "Building" 日志
→ 找到错误信息
→ 修复后重新推送
```

#### 2️⃣ Logs（实时日志）

**用途**：查看 API 运行时日志

**功能**：
- 查看 API 请求日志
- 查看错误日志
- 实时监控

**使用场景**：
```
用户报告登录失败？
→ 打开 Logs
→ 筛选 /api/auth/login
→ 查看错误信息
→ 定位问题
```

#### 3️⃣ Environment Variables（环境变量）

**用途**：管理配置

**功能**：
- 添加/修改/删除环境变量
- 区分 Production/Preview/Development

**使用场景**：
```
Supabase 密钥泄露需要更换？
→ Settings → Environment Variables
→ 编辑 SUPABASE_SERVICE_KEY
→ 输入新值
→ Redeploy（重新部署）
```

#### 4️⃣ Domains（自定义域名）

**用途**：绑定你自己的域名

**功能**：
- 添加自定义域名（如 api.zhizhi.com）
- 自动配置 HTTPS
- DNS 配置指引

**使用场景**：
```
默认域名: zhizhi-mvp-abc123.vercel.app
自定义后: api.zhizhi.com
```

---

## 🔍 常用 Vercel CLI 命令

### 安装 Vercel CLI

```bash
npm install -g vercel
```

### 登录

```bash
vercel login
```

### 本地开发（代替 npm run dev）

```bash
vercel dev
```

**优势**：
- 完全模拟生产环境
- 支持环境变量
- 支持动态路由

### 手动部署

```bash
# 部署到预览环境
vercel

# 部署到生产环境
vercel --prod
```

### 查看部署列表

```bash
vercel ls
```

### 查看日志

```bash
vercel logs <deployment-url>
```

### 拉取环境变量到本地

```bash
vercel env pull .env.local
```

---

## 🌍 环境类型说明

Vercel 有三种环境：

### 1️⃣ Production（生产环境）

- **触发条件**：推送到 `main` 或 `master` 分支
- **URL**：`https://你的项目.vercel.app`
- **用途**：给真实用户使用
- **环境变量**：使用 Production 配置

### 2️⃣ Preview（预览环境）

- **触发条件**：推送到其他分支（如 `develop`）或创建 Pull Request
- **URL**：`https://你的项目-git-分支名.vercel.app`
- **用途**：测试新功能
- **环境变量**：使用 Preview 配置

### 3️⃣ Development（开发环境）

- **触发条件**：本地运行 `vercel dev`
- **URL**：`http://localhost:3000`
- **用途**：本地开发
- **环境变量**：使用 Development 配置或 `.env`

---

## 🎯 最佳实践

### ✅ 推荐做法

#### 1. 使用分支开发新功能

```bash
# 创建新分支
git checkout -b feature/comments

# 开发、提交、推送
git add .
git commit -m "feat: 添加评论功能"
git push -u origin feature/comments

# Vercel 自动创建预览环境
# URL: https://zhizhi-mvp-git-feature-comments.vercel.app

# 测试通过后，合并到 main
git checkout main
git merge feature/comments
git push  # 自动部署到生产环境
```

#### 2. 使用环境变量区分环境

```typescript
// 在代码中判断环境
const isDev = process.env.NODE_ENV === 'development';
const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  // 生产环境启用日志
  console.log('Running in production');
}
```

#### 3. 定期查看日志

- 每天查看一次 Logs，了解 API 使用情况
- 监控错误率

#### 4. 备份环境变量

```bash
# 导出环境变量到本地文件（不要提交到 Git）
vercel env pull .env.backup
```

### ❌ 避免的错误

#### 1. 不要在代码中硬编码密钥

```typescript
// ❌ 错误
const apiKey = "sk-1234567890abcdef";

// ✅ 正确
const apiKey = process.env.SUPABASE_SERVICE_KEY;
```

#### 2. 不要忘记配置环境变量

```
部署失败？
→ 检查是否配置了所有必需的环境变量
```

#### 3. 不要直接在生产环境测试

```
有新功能想测试？
→ 推送到 feature 分支
→ 使用预览环境测试
→ 测试通过后再合并到 main
```

---

## 📊 免费额度说明

Vercel 个人版（Hobby Plan）免费额度：

```
✅ 无限部署
✅ 无限请求（有带宽限制）
✅ 100 GB 带宽/月
✅ 100 小时 Serverless 函数执行时间/月
✅ 自动 HTTPS
✅ 全球 CDN
```

**对于你的 MVP 项目**：
- 完全够用
- 日活 1000 用户没问题
- 超出后可以升级到 Pro（$20/月）

---

## 🚨 常见问题

### Q1: 部署失败，显示 "Build Error"

**A**:
1. 点击失败的部署 → View Build Logs
2. 查看错误信息（通常是 TypeScript 编译错误）
3. 修复后重新推送

常见错误：
```typescript
// 错误：类型不匹配
const user: User = { name: 'test' };  // 缺少必需字段

// 修复
const user: User = { id: '1', name: 'test', email: 'test@example.com' };
```

### Q2: API 返回 500 错误

**A**:
1. Vercel Dashboard → Logs
2. 查看运行时错误
3. 常见原因：
   - 环境变量未配置
   - Supabase 连接失败
   - 代码逻辑错误

### Q3: 如何回滚到之前的版本？

**A**:
1. Deployments → 找到稳定的部署
2. 点击右侧三个点 → "Promote to Production"
3. 确认

### Q4: 如何添加自定义域名？

**A**:
1. Settings → Domains
2. 输入你的域名（如 `api.zhizhi.com`）
3. 在你的 DNS 提供商添加 CNAME 记录：
   ```
   Type: CNAME
   Name: api
   Value: cname.vercel-dns.com
   ```
4. 等待 DNS 生效（几分钟到几小时）

### Q5: 本地能跑，部署后报错？

**A**:
检查环境变量：
1. 确认 Vercel 上配置了所有变量
2. 确认变量值正确（没有多余空格）
3. 重新部署

---

## 📚 进阶功能

### 1. Vercel Analytics（访问统计）

```bash
# 安装
npm install @vercel/analytics

# 在代码中使用（可选）
import { Analytics } from '@vercel/analytics/react';
```

### 2. Edge Functions（边缘函数）

在全球边缘节点运行代码，降低延迟：

```typescript
// api/api/edge-example.ts
export const config = {
  runtime: 'edge',  // 使用边缘运行时
};

export default async function handler(req: Request) {
  return new Response('Hello from Edge!');
}
```

### 3. 自动预览评论

在 GitHub Pull Request 中自动添加预览链接：
- Vercel 会自动评论预览 URL
- 方便团队成员测试

---

## ✅ 完整部署检查清单

部署前确认：

- [ ] 本地 `npm run dev` 可以正常运行
- [ ] `/api/health` 返回 `"database": "connected"`
- [ ] 代码已提交到 Git
- [ ] `.env` 文件已在 `.gitignore` 中
- [ ] 代码已推送到 GitHub

Vercel 配置：

- [ ] Root Directory 设置为 `api`
- [ ] 环境变量 `SUPABASE_URL` 已配置
- [ ] 环境变量 `SUPABASE_ANON_KEY` 已配置
- [ ] 环境变量 `SUPABASE_SERVICE_KEY` 已配置
- [ ] 环境变量 `NODE_ENV=production` 已配置

部署后验证：

- [ ] 生产环境 `/api/health` 可访问
- [ ] 注册接口测试成功
- [ ] Supabase 中可以看到新用户
- [ ] 日志中无明显错误

全部打勾后，你的 API 就成功部署到全球了！🎉

---

## 🆘 获取帮助

如果遇到问题：

1. **查看本文档的"常见问题"部分**
2. **查看 Vercel 日志**：Dashboard → Logs
3. **查看构建日志**：Deployments → 点击部署 → Build Logs
4. **Vercel 官方文档**：https://vercel.com/docs
5. **随时问我**！😊

---

## 🎓 总结

```
Vercel 的核心价值：

传统部署：
  编写代码 → 手动构建 → 上传到服务器 → 配置 Nginx → 申请 HTTPS
  ↓ 每次修改都要重复

Vercel 部署：
  编写代码 → git push
  ↓ 其他都是自动的！
```

**你只需要**：
1. 写代码
2. `git push`
3. 等待几分钟

**Vercel 自动帮你**：
- 构建
- 部署到全球 CDN
- 配置 HTTPS
- 生成预览环境
- 发送部署通知

这就是现代化的开发流程！🚀
