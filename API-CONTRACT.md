# API 接口契约文档

> **Status:** SUPERSEDED
> **Release:** HISTORICAL
> **Verification:** COMMITTED
> **Last verified:** 2026-07-11
> **Sources:** 2025 v1 合同；当前合同由 `api/api/`、handler/service/model 和 `docs/current-backend-implementation.md` 接管

> 本文保留早期请求/响应细节供追溯。它没有覆盖当前 39 个路由文件，部分字段已经变化，不能直接用于新客户端联调。

**项目**: 知之ZHIZHI - 八字命理应用
**版本**: v1.0
**更新时间**: 2025-01-19

---

## 📋 通用规范

### 请求格式

- Content-Type: `application/json`
- 认证方式: `Authorization: Bearer <access_token>`

### 响应格式

#### 成功响应
```json
{
  "success": true,
  "data": { /* 响应数据 */ },
  "message": "操作成功"  // 可选
}
```

#### 错误响应
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误信息",
    "details": { /* 详细信息，可选 */ }
  }
}
```

### HTTP 状态码

- `200` OK - 成功
- `201` Created - 创建成功
- `204` No Content - 删除成功
- `400` Bad Request - 请求参数错误
- `401` Unauthorized - 未授权
- `403` Forbidden - 无权限
- `404` Not Found - 资源不存在
- `500` Internal Server Error - 服务器错误

---

## 🔐 认证接口

### 1. 用户注册

**端点**: `POST /api/auth/register`

**请求**:
```json
{
  "email": "user@example.com",
  "password": "Password123!",
  "display_name": "张三"  // 可选
}
```

**响应** (201):
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "display_name": "张三",
      "is_email_verified": false,
      "bazi_profile_count": 0,
      "created_at": "2025-01-19T10:00:00.000Z"
    },
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  "message": "注册成功"
}
```

**错误示例**:
```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_EMAIL",
    "message": "该邮箱已被注册"
  }
}
```

---

### 2. 用户登录

**端点**: `POST /api/auth/login`

**请求**:
```json
{
  "email": "user@example.com",
  "password": "Password123!"
}
```

**响应** (200):
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "user@example.com",
      "display_name": "张三",
      "avatar_url": "https://example.com/avatar.jpg",
      "is_email_verified": true,
      "bazi_profile_count": 3,
      "created_at": "2025-01-19T10:00:00.000Z"
    },
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  "message": "登录成功"
}
```

---

## 👤 用户接口

### 3. 获取当前用户资料

**端点**: `GET /api/user/profile`

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (200):
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "display_name": "张三",
    "avatar_url": "https://example.com/avatar.jpg",
    "is_email_verified": true,
    "bazi_profile_count": 3,
    "created_at": "2025-01-19T10:00:00.000Z"
  }
}
```

---

### 4. 更新用户资料

**端点**: `PUT /api/user/profile`

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求**:
```json
{
  "display_name": "李四",  // 可选
  "avatar_url": "https://example.com/new-avatar.jpg"  // 可选
}
```

**响应** (200):
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "display_name": "李四",
    "avatar_url": "https://example.com/new-avatar.jpg",
    "is_email_verified": true,
    "bazi_profile_count": 3,
    "created_at": "2025-01-19T10:00:00.000Z"
  },
  "message": "资料更新成功"
}
```

---

## 📅 八字档案接口

### 5. 创建八字档案

**端点**: `POST /api/bazi/create`

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求**:
```json
{
  "is_owner": true,           // true=本人, false=亲友
  "name": "张三",
  "relation_to_owner": "本人", // 亲友时必填（"父亲"、"母亲"、"配偶"、"子女"等）
  "gender": "male",           // male | female | unknown (可选)
  "birth_year": 1990,
  "birth_month": 3,
  "birth_day": 15,
  "birth_hour": 10,          // 可选，0-23
  "birth_minute": 30,        // 可选，0-59
  "is_lunar": false,         // true=农历, false=公历 (默认false)
  "birth_timezone": "Asia/Shanghai",  // IANA时区 (默认 Asia/Shanghai)
  "notes": "备注信息"         // 可选
}
```

**响应** (201):
```json
{
  "success": true,
  "data": {
    "id": "660e8400-e29b-41d4-a716-446655440000",
    "owner_user_id": "550e8400-e29b-41d4-a716-446655440000",
    "is_owner": true,
    "name": "张三",
    "relation_to_owner": "本人",
    "gender": "male",
    "birth_year": 1990,
    "birth_month": 3,
    "birth_day": 15,
    "birth_hour": 10,
    "birth_minute": 30,
    "is_lunar": false,
    "birth_timezone": "Asia/Shanghai",
    "bazi_year_stem": "庚",
    "bazi_year_branch": "午",
    "bazi_month_stem": "己",
    "bazi_month_branch": "卯",
    "bazi_day_stem": "辛",
    "bazi_day_branch": "巳",
    "bazi_hour_stem": "癸",
    "bazi_hour_branch": "巳",
    "wuxing_analysis": {
      "metal": 2,
      "wood": 1,
      "water": 1,
      "fire": 2,
      "earth": 2,
      "dominant": "火",
      "lacking": []
    },
    "notes": "备注信息",
    "created_at": "2025-01-19T10:00:00.000Z",
    "updated_at": "2025-01-19T10:00:00.000Z"
  },
  "message": "八字档案创建成功"
}
```

**错误示例**:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "您已经创建过本人档案，无法重复创建"
  }
}
```

---

### 6. 获取八字档案列表

**端点**: `GET /api/bazi/list`

**请求头**:
```
Authorization: Bearer <access_token>
```

**查询参数**:
- `is_owner` (可选): true=只看本人, false=只看亲友
- `relation` (可选): 按关系筛选（"父亲"、"母亲"等）
- `page` (可选): 页码，默认 1
- `page_size` (可选): 每页数量，默认 20

**请求示例**:
```
GET /api/bazi/list?page=1&page_size=10
```

**响应** (200):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "660e8400-e29b-41d4-a716-446655440000",
        "owner_user_id": "550e8400-e29b-41d4-a716-446655440000",
        "is_owner": true,
        "name": "张三",
        "relation_to_owner": "本人",
        "gender": "male",
        "birth_year": 1990,
        "birth_month": 3,
        "birth_day": 15,
        "bazi_year_stem": "庚",
        "bazi_year_branch": "午",
        "wuxing_analysis": {
          "metal": 2,
          "wood": 1,
          "water": 1,
          "fire": 2,
          "earth": 2
        },
        "created_at": "2025-01-19T10:00:00.000Z"
      }
    ],
    "total": 3,
    "page": 1,
    "page_size": 10,
    "total_pages": 1
  }
}
```

---

### 7. 获取八字档案详情

**端点**: `GET /api/bazi/{id}`

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求示例**:
```
GET /api/bazi/660e8400-e29b-41d4-a716-446655440000
```

**响应** (200):
```json
{
  "success": true,
  "data": {
    "id": "660e8400-e29b-41d4-a716-446655440000",
    "owner_user_id": "550e8400-e29b-41d4-a716-446655440000",
    "is_owner": true,
    "name": "张三",
    "relation_to_owner": "本人",
    "gender": "male",
    "birth_year": 1990,
    "birth_month": 3,
    "birth_day": 15,
    "birth_hour": 10,
    "birth_minute": 30,
    "is_lunar": false,
    "birth_timezone": "Asia/Shanghai",
    "bazi_year_stem": "庚",
    "bazi_year_branch": "午",
    "bazi_month_stem": "己",
    "bazi_month_branch": "卯",
    "bazi_day_stem": "辛",
    "bazi_day_branch": "巳",
    "bazi_hour_stem": "癸",
    "bazi_hour_branch": "巳",
    "wuxing_analysis": {
      "metal": 2,
      "wood": 1,
      "water": 1,
      "fire": 2,
      "earth": 2,
      "dominant": "火",
      "lacking": []
    },
    "notes": "备注信息",
    "created_at": "2025-01-19T10:00:00.000Z",
    "updated_at": "2025-01-19T10:00:00.000Z"
  }
}
```

---

### 8. 更新八字档案

**端点**: `PUT /api/bazi/{id}`

**请求头**:
```
Authorization: Bearer <access_token>
```

**请求**:
```json
{
  "name": "张三(修改后)",    // 可选
  "relation_to_owner": "父亲",  // 可选
  "gender": "male",          // 可选
  "notes": "更新的备注"       // 可选
}
```

**注意**: 生辰信息（年月日时）不可修改，如需修改请删除后重建

**响应** (200):
```json
{
  "success": true,
  "data": {
    "id": "660e8400-e29b-41d4-a716-446655440000",
    "name": "张三(修改后)",
    "notes": "更新的备注",
    "updated_at": "2025-01-19T11:00:00.000Z"
  },
  "message": "档案更新成功"
}
```

---

### 9. 删除八字档案

**端点**: `DELETE /api/bazi/{id}`

**请求头**:
```
Authorization: Bearer <access_token>
```

**响应** (204):
```
(无响应体)
```

---

## 🏥 系统接口

### 10. 健康检查

**端点**: `GET /api/health`

**响应** (200):
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-01-19T10:00:00.000Z",
    "database": "connected"
  }
}
```

---

## 🔑 枚举类型定义

### Gender (性别)
- `male` - 男性
- `female` - 女性
- `unknown` - 未知

### 关系类型（建议值）
- `本人` - 用户本人
- `父亲`
- `母亲`
- `配偶`
- `子女`
- `兄弟姐妹`
- `朋友`
- 其他自定义

---

## 📝 SwiftUI 数据模型参考

```swift
// 用户模型
struct User: Codable {
    let id: String
    let email: String
    let displayName: String?
    let avatarUrl: String?
    let isEmailVerified: Bool
    let baziProfileCount: Int
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, email
        case displayName = "display_name"
        case avatarUrl = "avatar_url"
        case isEmailVerified = "is_email_verified"
        case baziProfileCount = "bazi_profile_count"
        case createdAt = "created_at"
    }
}

// 八字档案模型
struct BaziProfile: Codable {
    let id: String
    let ownerUserId: String
    let isOwner: Bool
    let name: String
    let relationToOwner: String?
    let gender: String?
    let birthYear: Int
    let birthMonth: Int
    let birthDay: Int
    let birthHour: Int?
    let birthMinute: Int?
    let isLunar: Bool
    let birthTimezone: String
    let baziYearStem: String?
    let baziYearBranch: String?
    let baziMonthStem: String?
    let baziMonthBranch: String?
    let baziDayStem: String?
    let baziDayBranch: String?
    let baziHourStem: String?
    let baziHourBranch: String?
    let wuxingAnalysis: WuxingAnalysis?
    let notes: String?
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id, name, gender, notes
        case ownerUserId = "owner_user_id"
        case isOwner = "is_owner"
        case relationToOwner = "relation_to_owner"
        case birthYear = "birth_year"
        case birthMonth = "birth_month"
        case birthDay = "birth_day"
        case birthHour = "birth_hour"
        case birthMinute = "birth_minute"
        case isLunar = "is_lunar"
        case birthTimezone = "birth_timezone"
        case baziYearStem = "bazi_year_stem"
        case baziYearBranch = "bazi_year_branch"
        case baziMonthStem = "bazi_month_stem"
        case baziMonthBranch = "bazi_month_branch"
        case baziDayStem = "bazi_day_stem"
        case baziDayBranch = "bazi_day_branch"
        case baziHourStem = "bazi_hour_stem"
        case baziHourBranch = "bazi_hour_branch"
        case wuxingAnalysis = "wuxing_analysis"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

// 五行分析
struct WuxingAnalysis: Codable {
    let metal: Int
    let wood: Int
    let water: Int
    let fire: Int
    let earth: Int
    let dominant: String?
    let lacking: [String]?
}

// API 响应包装
struct APIResponse<T: Codable>: Codable {
    let success: Bool
    let data: T?
    let message: String?
    let error: APIError?
}

struct APIError: Codable {
    let code: String?
    let message: String
    let details: [String: String]?
}

// 登录响应
struct LoginResponse: Codable {
    let user: User
    let accessToken: String
    let refreshToken: String

    enum CodingKeys: String, CodingKey {
        case user
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
    }
}
```

---

## 🔄 变更日志

### v1.0 (2025-01-19)
- 初始版本
- 实现用户认证（注册、登录）
- 实现八字档案管理（创建、查询、更新、删除）
- 支持本人和亲友档案区分
- 集成八字计算功能（占位符实现）
