# 知之 ZHIZHI MVP 项目实施清单

> **Status:** HISTORICAL
> **Release:** HISTORICAL
> **Verification:** COMMITTED
> **Last verified:** 2026-07-11
> **Sources:** 2025 MVP 启动计划；多数后端模块已实现或合同已变化

> 本文保留原始任务细节和检查项，不再表示当前总体进度。新的实施顺序与验收条件见 [当前后端实现方案](docs/current-backend-implementation.md#9-实施计划)。

**项目状态**: 🚀 准备启动
**预计完成时间**: 2-3 周
**最后更新**: 2025-01-19

---

## 📋 总体进度

- [ ] **阶段 1**: 后端环境搭建（1-2天）
- [ ] **阶段 2**: 后端功能开发与测试（3-5天）
- [ ] **阶段 3**: 前端环境搭建（1-2天）
- [ ] **阶段 4**: 前端功能开发（5-7天）
- [ ] **阶段 5**: 前后端联调（2-3天）
- [ ] **阶段 6**: 测试与部署（1-2天）

---

## 🔧 阶段 1: 后端环境搭建（你负责）

### 1.1 本地开发环境准备

- [ ] **安装必要软件**
  - [ ] Node.js (v18+) - [下载地址](https://nodejs.org/)
  - [ ] npm 或 yarn
  - [ ] Git
  - [ ] VS Code 或其他编辑器
  - [ ] Postman 或 Hoppscotch（API 测试工具）

- [ ] **克隆/初始化项目**
  ```bash
  cd /path/to/zhizhi-code/api
  npm install
  ```

### 1.2 Supabase 配置

- [ ] **创建 Supabase 项目**
  - [ ] 访问 https://app.supabase.com
  - [ ] 点击 "New Project"
  - [ ] 填写项目信息：
    - 项目名称: `zhizhi-mvp`
    - 数据库密码: （请记住！）
    - 区域: 选择 `Northeast Asia (Tokyo)` 或最近的区域
  - [ ] 等待项目创建完成（约 2 分钟）

- [ ] **执行数据库初始化**
  - [ ] 在 Supabase Dashboard 左侧点击 "SQL Editor"
  - [ ] 点击 "New query"
  - [ ] 复制 `supabase/schema.sql` 的完整内容
  - [ ] 粘贴到编辑器并点击 "Run"
  - [ ] 确认执行成功（无错误提示）

- [ ] **获取 API 密钥**
  - [ ] 在 Supabase Dashboard 点击 "Settings" → "API"
  - [ ] 复制以下三个值：
    - [ ] `Project URL` (如 `https://xxxxx.supabase.co`)
    - [ ] `anon` `public` key
    - [ ] `service_role` `secret` key

- [ ] **验证数据库连接**
  - [ ] 在 Supabase Dashboard 点击 "Table Editor"
  - [ ] 确认可以看到以下表：
    - [ ] `profiles`
    - [ ] `contents`
    - [ ] `comments`
    - [ ] `likes`

### 1.3 环境变量配置

- [ ] **创建本地环境变量文件**
  ```bash
  cd api
  cp .env.example .env
  ```

- [ ] **编辑 `.env` 文件**
  ```env
  SUPABASE_URL=https://你的项目ID.supabase.co
  SUPABASE_ANON_KEY=你的anon-key
  SUPABASE_SERVICE_KEY=你的service-role-key
  NODE_ENV=development
  ```

- [ ] **验证配置**
  - [ ] 确认没有语法错误
  - [ ] 确认没有多余的空格
  - [ ] 确认 `.env` 在 `.gitignore` 中（已配置）

### 1.4 本地启动测试

- [ ] **启动开发服务器**
  ```bash
  npm run dev
  ```

- [ ] **验证服务运行**
  - [ ] 确认控制台无报错
  - [ ] 浏览器访问 `http://localhost:3000/api/health`
  - [ ] 应该看到类似这样的响应：
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

- [ ] **如果失败，检查**：
  - [ ] 端口 3000 是否被占用
  - [ ] 环境变量是否正确配置
  - [ ] Supabase 项目是否正常运行
  - [ ] 查看控制台错误信息

---

## 🚀 阶段 2: 后端功能开发与测试（你负责）

### 2.1 API 功能测试

使用 Postman 或 Hoppscotch 测试每个接口：

#### 测试 1: 健康检查

- [ ] **测试健康检查 API**
  ```
  GET http://localhost:3000/api/health
  ```
  - [ ] 状态码: 200
  - [ ] 响应包含 `"database": "connected"`

#### 测试 2: 用户注册

- [ ] **测试用户注册 API**
  ```
  POST http://localhost:3000/api/auth/register
  Content-Type: application/json

  {
    "email": "test@example.com",
    "password": "Test1234",
    "username": "testuser"
  }
  ```
  - [ ] 状态码: 201
  - [ ] 响应包含用户信息和 ID
  - [ ] 在 Supabase Dashboard → Authentication → Users 中可以看到新用户
  - [ ] 在 Table Editor → profiles 表中可以看到用户资料

- [ ] **测试重复注册（应该失败）**
  ```
  POST http://localhost:3000/api/auth/register
  （使用相同的邮箱）
  ```
  - [ ] 状态码: 400
  - [ ] 错误信息: "邮箱已被注册"

- [ ] **测试参数验证**
  ```
  POST http://localhost:3000/api/auth/register
  {
    "email": "invalid-email",  // 无效邮箱
    "password": "123",         // 密码太短
    "username": "ab"           // 用户名太短
  }
  ```
  - [ ] 应该返回相应的验证错误

#### 测试 3: 用户登录

- [ ] **测试用户登录 API**
  ```
  POST http://localhost:3000/api/auth/login
  Content-Type: application/json

  {
    "email": "test@example.com",
    "password": "Test1234"
  }
  ```
  - [ ] 状态码: 200
  - [ ] 响应包含 `access_token` 和 `refresh_token`
  - [ ] 响应包含完整的用户信息
  - [ ] **复制 `access_token`（后续测试需要）**

- [ ] **测试错误密码**
  ```
  POST http://localhost:3000/api/auth/login
  （使用错误的密码）
  ```
  - [ ] 状态码: 400
  - [ ] 包含错误信息

#### 测试 4: 获取用户资料

- [ ] **测试获取当前用户资料**
  ```
  GET http://localhost:3000/api/user/profile
  Authorization: Bearer <你的access_token>
  ```
  - [ ] 状态码: 200
  - [ ] 返回当前用户的完整信息

- [ ] **测试无 Token 访问（应该失败）**
  ```
  GET http://localhost:3000/api/user/profile
  （不带 Authorization 头）
  ```
  - [ ] 状态码: 401
  - [ ] 错误信息: "缺少认证令牌"

#### 测试 5: 更新用户资料

- [ ] **测试更新用户资料**
  ```
  PUT http://localhost:3000/api/user/profile
  Authorization: Bearer <你的access_token>
  Content-Type: application/json

  {
    "bio": "这是我的个人简介",
    "avatar_url": "https://example.com/avatar.jpg"
  }
  ```
  - [ ] 状态码: 200
  - [ ] 返回更新后的用户信息
  - [ ] 在数据库中验证更新成功

#### 测试 6: 创建内容

- [ ] **测试创建文章**
  ```
  POST http://localhost:3000/api/content/create
  Authorization: Bearer <你的access_token>
  Content-Type: application/json

  {
    "title": "我的第一篇文章",
    "body": "这是文章的正文内容...",
    "content_type": "article",
    "tags": ["测试", "示例"],
    "status": "draft"
  }
  ```
  - [ ] 状态码: 201
  - [ ] 返回内容对象，包含生成的 ID
  - [ ] **复制内容 ID（后续测试需要）**

- [ ] **测试创建已发布的内容**
  ```
  （同上，但 status 设为 "published"）
  ```
  - [ ] 验证 `published_at` 字段有值

#### 测试 7: 获取内容列表

- [ ] **测试获取所有已发布内容**
  ```
  GET http://localhost:3000/api/content/list?status=published
  ```
  - [ ] 状态码: 200
  - [ ] 返回分页数据结构
  - [ ] 包含 `items`, `total`, `page`, `page_size`, `total_pages`

- [ ] **测试分页**
  ```
  GET http://localhost:3000/api/content/list?page=1&page_size=5
  ```
  - [ ] 验证返回 5 条数据（如果有）

- [ ] **测试筛选**
  ```
  GET http://localhost:3000/api/content/list?user_id=<你的用户ID>
  ```
  - [ ] 只返回该用户的内容

#### 测试 8: 获取内容详情

- [ ] **测试获取内容详情**
  ```
  GET http://localhost:3000/api/content/<内容ID>
  ```
  - [ ] 状态码: 200
  - [ ] 返回完整的内容对象
  - [ ] `view_count` 应该增加 1

#### 测试 9: 更新内容

- [ ] **测试更新自己的内容**
  ```
  PUT http://localhost:3000/api/content/<内容ID>
  Authorization: Bearer <你的access_token>
  Content-Type: application/json

  {
    "title": "更新后的标题",
    "status": "published"
  }
  ```
  - [ ] 状态码: 200
  - [ ] 返回更新后的内容
  - [ ] `updated_at` 应该是新的时间戳

- [ ] **测试更新他人内容（应该失败）**
  - [ ] 创建另一个用户
  - [ ] 用新用户的 token 尝试更新第一个用户的内容
  - [ ] 应该返回 403 或错误信息

#### 测试 10: 删除内容

- [ ] **测试删除自己的内容**
  ```
  DELETE http://localhost:3000/api/content/<内容ID>
  Authorization: Bearer <你的access_token>
  ```
  - [ ] 状态码: 204
  - [ ] 在数据库中验证内容已删除

### 2.2 边界情况测试

- [ ] **测试 SQL 注入防护**
  ```
  POST /api/auth/login
  {
    "email": "test@example.com' OR '1'='1",
    "password": "anything"
  }
  ```
  - [ ] 应该安全处理，不会登录成功

- [ ] **测试 XSS 防护**
  ```
  POST /api/content/create
  {
    "title": "<script>alert('xss')</script>",
    "body": "test"
  }
  ```
  - [ ] 应该正常保存（Supabase 会处理）

- [ ] **测试超长输入**
  ```
  创建一篇 body 超过 10000 字符的内容
  ```
  - [ ] 验证是否正常处理

### 2.3 性能测试（可选）

- [ ] **测试并发请求**
  - [ ] 使用 Postman 的 Collection Runner 或 Apache Bench
  - [ ] 发送 100 个并发的列表查询请求
  - [ ] 验证无错误，响应时间合理（< 1 秒）

---

## 🎨 阶段 3: 前端环境搭建（前端负责，你提供支持）

### 3.1 前端需要的信息

- [ ] **提供给前端的配置**
  - [ ] Supabase URL: `https://xxxxx.supabase.co`
  - [ ] Supabase Anon Key: `eyJhbGc...`（公开密钥，可以给前端）
  - [ ] API 基础 URL（开发环境）: `http://localhost:3000/api`
  - [ ] API 文档: `API-CONTRACT.md`

### 3.2 前端开发环境检查

协助前端确认：

- [ ] **Xcode 环境**
  - [ ] Xcode 版本 15+ (支持 iOS 17+)
  - [ ] 模拟器已安装
  - [ ] 真机测试证书（如需要）

- [ ] **SwiftUI 项目创建**
  - [ ] 在 `zhizhi-code/` 目录下创建 iOS 项目
  - [ ] 项目名称: `ZhiZhi` 或 `ZhiZhiApp`
  - [ ] Bundle Identifier: `com.zhizhi.app`

- [ ] **依赖安装**（前端决定）
  - [ ] Supabase Swift SDK (推荐)
  - [ ] Alamofire (可选，用于网络请求)
  - [ ] Kingfisher (可选，用于图片加载)

### 3.3 前端数据模型创建

- [ ] **前端根据 API-CONTRACT.md 创建 Swift 模型**
  - [ ] `User.swift`
  - [ ] `Content.swift`
  - [ ] `APIResponse.swift`
  - [ ] `APIError.swift`

- [ ] **前端创建 API 服务层**
  - [ ] `APIService.swift` 或 `NetworkManager.swift`
  - [ ] 实现基础请求方法（GET, POST, PUT, DELETE）
  - [ ] 实现 Token 管理

---

## 📱 阶段 4: 前端功能开发（前端负责）

### 4.1 认证功能

- [ ] **注册页面**
  - [ ] UI: 邮箱、密码、用户名输入框
  - [ ] 调用 `POST /api/auth/register`
  - [ ] 错误处理和提示
  - [ ] 成功后跳转到登录或主页

- [ ] **登录页面**
  - [ ] UI: 邮箱、密码输入框
  - [ ] 调用 `POST /api/auth/login`
  - [ ] 保存 `access_token` 到 Keychain
  - [ ] 保存 `refresh_token`
  - [ ] 登录成功后跳转到主页

- [ ] **Token 管理**
  - [ ] 实现 Token 持久化存储
  - [ ] 在每个需要认证的请求中自动添加 Token
  - [ ] Token 过期处理（自动刷新或跳转登录）

### 4.2 用户功能

- [ ] **个人资料页面**
  - [ ] 调用 `GET /api/user/profile` 获取数据
  - [ ] 显示用户名、邮箱、头像、简介
  - [ ] "编辑资料" 按钮

- [ ] **编辑资料页面**
  - [ ] UI: 用户名、头像 URL、简介输入框
  - [ ] 调用 `PUT /api/user/profile`
  - [ ] 更新成功后返回个人资料页面

### 4.3 内容功能

- [ ] **内容列表页面（首页）**
  - [ ] 调用 `GET /api/content/list?status=published`
  - [ ] 显示内容卡片（标题、预览、作者、时间）
  - [ ] 实现下拉刷新
  - [ ] 实现分页加载（滚动到底部加载更多）
  - [ ] 点击卡片进入详情页

- [ ] **内容详情页面**
  - [ ] 调用 `GET /api/content/{id}`
  - [ ] 显示完整内容（标题、正文、作者、时间、标签）
  - [ ] 显示浏览数、点赞数
  - [ ] "编辑" 按钮（仅作者可见）
  - [ ] "删除" 按钮（仅作者可见）

- [ ] **创建内容页面**
  - [ ] UI: 标题、正文、标签输入
  - [ ] 内容类型选择器
  - [ ] "保存草稿" 按钮
  - [ ] "发布" 按钮
  - [ ] 调用 `POST /api/content/create`

- [ ] **编辑内容页面**
  - [ ] 预填充现有内容
  - [ ] 调用 `PUT /api/content/{id}`
  - [ ] "删除" 功能确认对话框

### 4.4 UI/UX 优化

- [ ] **加载状态**
  - [ ] 所有网络请求显示加载指示器
  - [ ] 骨架屏（可选）

- [ ] **错误处理**
  - [ ] 网络错误提示
  - [ ] API 错误提示（显示服务器返回的错误信息）
  - [ ] 401 错误自动跳转登录

- [ ] **空状态**
  - [ ] 内容列表为空时的提示
  - [ ] 首次使用引导

---

## 🔗 阶段 5: 前后端联调（双方协作）

### 5.1 本地联调

- [ ] **后端保持运行**
  ```bash
  cd api
  npm run dev  # 运行在 localhost:3000
  ```

- [ ] **前端连接本地 API**
  - [ ] 前端配置 API 基础 URL: `http://localhost:3000/api`
  - [ ] 注意：iOS 模拟器需要使用 `http://` 而非 `https://`
  - [ ] 在 Info.plist 中配置 App Transport Security (允许 HTTP)

### 5.2 功能联调测试

- [ ] **注册流程**
  - [ ] 前端提交注册表单
  - [ ] 后端返回成功
  - [ ] 前端显示成功提示
  - [ ] 自动登录或跳转到登录页

- [ ] **登录流程**
  - [ ] 前端提交登录表单
  - [ ] 后端验证成功返回 Token
  - [ ] 前端保存 Token
  - [ ] 跳转到主页

- [ ] **查看内容列表**
  - [ ] 前端请求内容列表
  - [ ] 后端返回数据
  - [ ] 前端正确渲染

- [ ] **创建内容**
  - [ ] 前端提交新内容
  - [ ] 后端保存成功
  - [ ] 前端刷新列表，新内容出现

- [ ] **编辑内容**
  - [ ] 前端修改内容
  - [ ] 后端更新成功
  - [ ] 前端显示更新后的内容

- [ ] **删除内容**
  - [ ] 前端发送删除请求
  - [ ] 后端删除成功
  - [ ] 前端从列表中移除

### 5.3 问题调试

遇到问题时的调试步骤：

- [ ] **前端无法连接后端**
  - [ ] 检查后端是否运行（`npm run dev`）
  - [ ] 检查 URL 是否正确
  - [ ] 检查防火墙设置
  - [ ] 查看浏览器/Xcode 控制台的网络请求

- [ ] **401 认证错误**
  - [ ] 检查 Token 是否正确传递
  - [ ] 检查 Token 格式（`Bearer <token>`）
  - [ ] 检查 Token 是否过期

- [ ] **数据格式错误**
  - [ ] 对比 API-CONTRACT.md
  - [ ] 检查 JSON 字段名大小写
  - [ ] 检查日期格式（ISO 8601）

- [ ] **使用工具辅助调试**
  - [ ] 后端：查看控制台日志
  - [ ] 前端：使用 Xcode 的网络调试工具
  - [ ] Postman：先用 Postman 验证接口正常

---

## 🚀 阶段 6: 部署到生产环境

### 6.1 后端部署到 Vercel（你负责）

- [ ] **准备部署**
  - [ ] 确认所有代码已提交到 Git
  - [ ] 确认 `.env` 文件已在 `.gitignore` 中
  - [ ] 确认 TypeScript 编译无错误
    ```bash
    npm run type-check
    ```

- [ ] **部署到 Vercel**
  ```bash
  # 首次部署
  npm run deploy

  # 或使用 Vercel CLI
  vercel --prod
  ```

- [ ] **配置生产环境变量**
  - [ ] 登录 Vercel Dashboard
  - [ ] 进入项目 → Settings → Environment Variables
  - [ ] 添加以下变量（选择 Production）：
    - [ ] `SUPABASE_URL`
    - [ ] `SUPABASE_ANON_KEY`
    - [ ] `SUPABASE_SERVICE_KEY`
    - [ ] `NODE_ENV=production`
  - [ ] 保存后重新部署

- [ ] **获取生产环境 URL**
  - [ ] 复制 Vercel 提供的域名（如 `https://zhizhi-api.vercel.app`）
  - [ ] **提供给前端**

- [ ] **测试生产环境 API**
  - [ ] 使用 Postman 测试所有接口（替换为生产 URL）
  - [ ] 测试健康检查: `GET https://your-domain.vercel.app/api/health`
  - [ ] 测试注册和登录

### 6.2 前端部署到 TestFlight（前端负责）

- [ ] **准备发布**
  - [ ] 更新 API 基础 URL 为生产环境地址
  - [ ] 配置 App 图标
  - [ ] 配置启动页面
  - [ ] 设置版本号（如 1.0.0）

- [ ] **创建 Archive**
  - [ ] Xcode → Product → Archive
  - [ ] 等待打包完成

- [ ] **上传到 App Store Connect**
  - [ ] Window → Organizer
  - [ ] 选择 Archive → Distribute App
  - [ ] 选择 TestFlight & App Store
  - [ ] 上传

- [ ] **配置 TestFlight**
  - [ ] 登录 App Store Connect
  - [ ] 添加测试用户
  - [ ] 填写测试信息

- [ ] **邀请测试**
  - [ ] 发送 TestFlight 邀请链接
  - [ ] 收集测试反馈

### 6.3 生产环境测试

- [ ] **完整流程测试（在真实 iOS 设备上）**
  - [ ] 注册新用户
  - [ ] 登录
  - [ ] 浏览内容列表
  - [ ] 创建新内容
  - [ ] 编辑内容
  - [ ] 删除内容
  - [ ] 登出并重新登录

- [ ] **性能测试**
  - [ ] 列表滚动流畅度
  - [ ] 图片加载速度
  - [ ] API 响应时间

- [ ] **兼容性测试**
  - [ ] 在不同 iOS 版本测试（至少 iOS 16 和 17）
  - [ ] 在不同设备测试（iPhone、iPad）

---

## 🐛 阶段 7: Bug 修复与优化

### 7.1 收集问题

- [ ] **创建问题跟踪表**（可以用 GitHub Issues、Notion 或 Trello）
  - [ ] Bug 列表
  - [ ] 功能优化建议
  - [ ] 性能问题

### 7.2 优先级分类

- [ ] **P0 - 阻断性问题**（立即修复）
  - 示例：无法登录、数据丢失、崩溃

- [ ] **P1 - 重要问题**（本周修复）
  - 示例：功能异常、严重 UI 问题

- [ ] **P2 - 一般问题**（有时间修复）
  - 示例：小的 UI 调整、性能优化

- [ ] **P3 - 优化建议**（下个版本）
  - 示例：新功能、用户体验改进

### 7.3 后端优化（可选）

- [ ] **性能优化**
  - [ ] 添加数据库索引（已在 schema.sql 中配置）
  - [ ] 实现 API 缓存（如使用 Redis）
  - [ ] 优化查询语句

- [ ] **监控与日志**
  - [ ] 添加 Sentry 错误追踪
  - [ ] 配置 Vercel Analytics
  - [ ] 添加 API 访问日志

- [ ] **安全加固**
  - [ ] 实现 Rate Limiting（限流）
  - [ ] 添加 CORS 配置
  - [ ] 定期审计依赖包漏洞

---

## 📊 最终检查清单

### 后端检查（你负责）

- [ ] **代码质量**
  - [ ] 所有 TypeScript 类型定义完整
  - [ ] 没有 `any` 类型（除非必要）
  - [ ] 代码有适当注释
  - [ ] 遵循一致的代码风格

- [ ] **API 完整性**
  - [ ] 所有端点都有错误处理
  - [ ] 所有端点都返回统一格式
  - [ ] API-CONTRACT.md 文档是最新的

- [ ] **安全性**
  - [ ] 敏感数据不在代码中硬编码
  - [ ] `.env` 文件不在 Git 仓库中
  - [ ] RLS 策略正确配置
  - [ ] JWT Token 验证正常

- [ ] **数据库**
  - [ ] 所有表都有索引
  - [ ] RLS 策略测试通过
  - [ ] 备份策略已配置（Supabase 自动备份）

- [ ] **部署**
  - [ ] Vercel 环境变量已配置
  - [ ] 生产环境可访问
  - [ ] 健康检查接口正常

### 前端检查（前端负责）

- [ ] **功能完整性**
  - [ ] 所有核心功能正常工作
  - [ ] 边界情况处理妥当
  - [ ] 错误提示清晰

- [ ] **用户体验**
  - [ ] 加载状态明确
  - [ ] 操作反馈及时
  - [ ] 无明显卡顿

- [ ] **测试**
  - [ ] 在真机测试通过
  - [ ] 在模拟器测试通过
  - [ ] 网络异常情况处理

### 文档检查（双方协作）

- [ ] **README.md 完整**
  - [ ] 项目介绍
  - [ ] 安装步骤
  - [ ] 使用说明

- [ ] **API-CONTRACT.md 最新**
  - [ ] 所有接口已记录
  - [ ] 示例代码正确

- [ ] **技术文档**（可选）
  - [ ] 架构设计文档
  - [ ] 数据库设计文档
  - [ ] 部署文档

---

## 🎉 项目交付标准

当以下所有条件满足时，MVP 项目即可交付：

- [ ] **后端**
  - [ ] 所有 API 接口正常工作
  - [ ] 部署到 Vercel 生产环境
  - [ ] 数据库正常运行
  - [ ] 文档完整

- [ ] **前端**
  - [ ] 所有核心功能实现
  - [ ] 发布到 TestFlight
  - [ ] 至少 5 个测试用户完成测试
  - [ ] 重大 Bug 已修复

- [ ] **协作**
  - [ ] 前后端对接流畅
  - [ ] API 契约文档双方确认
  - [ ] 问题跟踪机制建立

- [ ] **测试**
  - [ ] 端到端测试通过
  - [ ] 性能达标（API 响应 < 1s，列表滚动流畅）
  - [ ] 无阻断性 Bug

---

## 📞 遇到问题怎么办？

### 后端问题（你负责）

1. **检查日志**: 查看 Vercel 控制台或本地终端输出
2. **验证配置**: 确认环境变量和数据库连接
3. **使用 Postman**: 隔离问题，确认是 API 问题还是前端问题
4. **查看文档**:
   - [Vercel 文档](https://vercel.com/docs)
   - [Supabase 文档](https://supabase.com/docs)
   - [TypeScript 文档](https://www.typescriptlang.org/docs/)

### 前端问题（前端负责）

1. **检查控制台**: 查看 Xcode 控制台输出
2. **断点调试**: 使用 Xcode 调试器
3. **网络抓包**: 使用 Charles 或 Proxyman
4. **查看文档**:
   - [SwiftUI 文档](https://developer.apple.com/documentation/swiftui)
   - [Swift 文档](https://docs.swift.org)

### 协作问题

1. **对比 API 契约**: 确保双方理解一致
2. **使用共同工具测试**: 用 Postman 验证接口
3. **记录问题**: 创建详细的问题报告（包括请求、响应、错误信息）

---

## 🎯 下一步行动

### 立即开始（今天）

1. [ ] 安装 Node.js 和 npm
2. [ ] 在项目 `api` 目录下运行 `npm install`
3. [ ] 注册 Supabase 账号并创建项目
4. [ ] 配置 `.env` 文件
5. [ ] 运行 `npm run dev` 测试本地环境

### 本周完成

1. [ ] 完成所有 API 测试（使用 Postman）
2. [ ] 部署到 Vercel
3. [ ] 提供生产环境 URL 给前端

### 下周完成

1. [ ] 与前端进行首次联调
2. [ ] 修复发现的问题
3. [ ] 优化 API 性能

---

**祝你开发顺利！有任何问题随时提问。** 🚀
