# 知之 ZHIZHI - MVP 项目

基于 SwiftUI + Vercel API + Supabase 架构的内容平台。

## 📂 项目结构

```
zhizhi-code/
├── api/                    # 后端 API（Vercel Serverless Functions）
│   ├── src/               # 源代码
│   │   ├── database/      # 数据库连接和 Repository
│   │   ├── models/        # 数据模型定义
│   │   ├── services/      # 业务逻辑层
│   │   └── utils/         # 工具函数
│   ├── api/               # API 端点（自动映射为路由）
│   └── package.json       # 依赖配置
│
├── supabase/              # 数据库相关
│   ├── schema.sql         # 数据库表结构
│   └── seed.sql           # 测试数据
│
└── ios-app/               # iOS 客户端（待创建）
```

## 🏗️ 技术栈

- **后端**: TypeScript + Vercel Serverless Functions
- **数据库**: Supabase (PostgreSQL)
- **认证**: Supabase Auth
- **前端**: SwiftUI (iOS)

## 🚀 快速开始

### 1. 环境准备

确保已安装：
- Node.js (v18+)
- npm 或 yarn
- Vercel CLI

```bash
npm install -g vercel
```

### 2. 配置 Supabase

1. 访问 [Supabase 控制台](https://app.supabase.com)
2. 创建新项目
3. 在 SQL Editor 中执行 `supabase/schema.sql`
4. 获取以下配置信息：
   - Project URL
   - Anon Key
   - Service Role Key

### 3. 配置环境变量

```bash
cd api
cp .env.example .env
```

编辑 `.env` 文件，填入 Supabase 配置：

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
```

### 4. 安装依赖

```bash
cd api
npm install
```

### 5. 本地开发

```bash
npm run dev
```

服务将在 `http://localhost:3000` 启动。

### 6. 部署到 Vercel

```bash
npm run deploy
```

部署成功后，你会得到一个生产环境的 URL，如：
```
https://your-project.vercel.app
```

## 📡 API 接口文档

### 基础 URL

- 开发环境: `http://localhost:3000/api`
- 生产环境: `https://your-project.vercel.app/api`

### 认证相关

#### 用户注册
```
POST /api/auth/register

Request:
{
  "email": "user@example.com",
  "password": "password123",
  "username": "zhangsan",
  "avatar_url": "https://...",  // 可选
  "bio": "个人简介"               // 可选
}

Response:
{
  "success": true,
  "data": {
    "id": "uuid",
    "username": "zhangsan",
    "email": "user@example.com",
    "avatar_url": "https://...",
    "bio": "个人简介",
    "created_at": "2025-01-01T00:00:00Z"
  },
  "message": "注册成功"
}
```

#### 用户登录
```
POST /api/auth/login

Request:
{
  "email": "user@example.com",
  "password": "password123"
}

Response:
{
  "success": true,
  "data": {
    "user": { /* 用户信息 */ },
    "access_token": "eyJhbGc...",
    "refresh_token": "eyJhbGc..."
  },
  "message": "登录成功"
}
```

### 用户相关

#### 获取当前用户资料
```
GET /api/user/profile
Headers:
  Authorization: Bearer <access_token>

Response:
{
  "success": true,
  "data": { /* 用户信息 */ }
}
```

#### 更新用户资料
```
PUT /api/user/profile
Headers:
  Authorization: Bearer <access_token>

Request:
{
  "username": "newname",      // 可选
  "avatar_url": "https://...", // 可选
  "bio": "新的个人简介"         // 可选
}

Response:
{
  "success": true,
  "data": { /* 更新后的用户信息 */ },
  "message": "更新成功"
}
```

### 内容相关

#### 创建内容
```
POST /api/content/create
Headers:
  Authorization: Bearer <access_token>

Request:
{
  "title": "文章标题",
  "body": "文章正文...",
  "content_type": "article",  // article | video | audio | image
  "tags": ["标签1", "标签2"],  // 可选
  "status": "draft"           // draft | published | archived (可选，默认 draft)
}

Response:
{
  "success": true,
  "data": { /* 内容对象 */ },
  "message": "创建成功"
}
```

#### 获取内容列表
```
GET /api/content/list?page=1&page_size=20&status=published

Query Parameters:
  - user_id: 按作者筛选
  - content_type: 按类型筛选 (article|video|audio|image)
  - status: 按状态筛选 (draft|published|archived)
  - tag: 按标签筛选
  - page: 页码（默认 1）
  - page_size: 每页数量（默认 20）
  - sort_by: 排序字段 (created_at|view_count|like_count)
  - order: 排序方向 (asc|desc，默认 desc)

Response:
{
  "success": true,
  "data": {
    "items": [ /* 内容列表 */ ],
    "total": 100,
    "page": 1,
    "page_size": 20,
    "total_pages": 5
  }
}
```

#### 获取内容详情
```
GET /api/content/{id}

Response:
{
  "success": true,
  "data": { /* 内容对象 */ }
}
```

#### 更新内容
```
PUT /api/content/{id}
Headers:
  Authorization: Bearer <access_token>

Request:
{
  "title": "新标题",         // 可选
  "body": "新正文",          // 可选
  "tags": ["新标签"],        // 可选
  "status": "published"     // 可选
}

Response:
{
  "success": true,
  "data": { /* 更新后的内容 */ },
  "message": "更新成功"
}
```

#### 删除内容
```
DELETE /api/content/{id}
Headers:
  Authorization: Bearer <access_token>

Response: 204 No Content
```

### 健康检查
```
GET /api/health

Response:
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-01-01T00:00:00Z",
    "database": "connected"
  }
}
```

## 🔐 认证说明

所有需要认证的接口都需要在请求头中携带 JWT Token：

```
Authorization: Bearer <access_token>
```

Token 通过登录接口获取，有效期默认为 1 小时。

## 🤝 前后端协作

### SwiftUI 端如何调用 API

1. **配置基础 URL**
   ```swift
   let baseURL = "https://your-project.vercel.app/api"
   ```

2. **配置 Supabase**（用于前端直接访问数据库，可选）
   ```swift
   // 使用 SUPABASE_ANON_KEY（非 SERVICE_KEY）
   ```

3. **调用 API 示例**
   ```swift
   // 参考前面文档中的 Swift 代码示例
   ```

### 数据模型对齐

后端 TypeScript 模型需要与前端 Swift 模型保持一致：

**TypeScript** (`api/src/models/User.ts`)
```typescript
interface User {
  id: string;
  username: string;
  email: string;
  avatar_url?: string | null;
  bio?: string | null;
  created_at: string;
}
```

**Swift** (iOS 端)
```swift
struct User: Codable {
    let id: String
    let username: String
    let email: String
    let avatarUrl: String?
    let bio: String?
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, username, email, bio
        case avatarUrl = "avatar_url"
        case createdAt = "created_at"
    }
}
```

## 📝 开发流程

### 后端开发者（你）

1. **开发新功能**
   - 在 `src/services/` 添加业务逻辑
   - 在 `api/` 添加新的端点
   - 更新 API 文档

2. **测试**
   - 使用 Postman 或 Hoppscotch 测试接口
   - 确保所有接口返回正确的数据格式

3. **部署**
   ```bash
   npm run deploy
   ```

4. **通知前端**
   - 提供新的 API 端点文档
   - 提供示例请求/响应

### 前端开发者

1. **集成 API**
   - 根据文档调用后端接口
   - 处理响应数据并更新 UI

2. **测试**
   - 测试所有功能流程
   - 报告 Bug 或 API 问题

## 🛠️ 常用命令

```bash
# 安装依赖
npm install

# 本地开发
npm run dev

# 类型检查
npm run type-check

# 构建
npm run build

# 部署到生产环境
npm run deploy
```

## 📌 注意事项

1. **环境变量**: 永远不要提交 `.env` 文件到 Git
2. **Service Key**: `SUPABASE_SERVICE_KEY` 仅在后端使用，不要暴露给前端
3. **RLS 策略**: Supabase 的 Row Level Security 提供了数据安全保障
4. **错误处理**: 所有接口都返回统一的错误格式

## 📚 扩展功能建议

后续可以添加的功能：

- [ ] 评论系统
- [ ] 关注/粉丝
- [ ] 搜索功能
- [ ] 推荐算法
- [ ] 文件上传（使用 Supabase Storage）
- [ ] 实时通知（使用 Supabase Realtime）
- [ ] 数据分析和统计

## 🔗 相关链接

- [Vercel 文档](https://vercel.com/docs)
- [Supabase 文档](https://supabase.com/docs)
- [SwiftUI 文档](https://developer.apple.com/documentation/swiftui)

## 📄 License

MIT
