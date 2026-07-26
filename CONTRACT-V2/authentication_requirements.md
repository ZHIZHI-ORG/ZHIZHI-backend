# 认证模块业务需求与接口契约 (Authentication Requirements & API Contract) - V4.1 (Backend Aligned)

> **Status:** SUPERSEDED
> **Release:** HISTORICAL
> **Verification:** COMMITTED
> **Last verified:** 2026-07-11
> **Sources:** V4.1 需求草案；当前 handler 使用 `/api/*` 与 camelCase 请求字段

> 本文保留认证策略和前端清单供追溯。`GET /config/auth`、部分 snake_case 字段和社交登录 payload 与当前 handler 不一致，实施时以 [当前后端实现方案](../docs/current-backend-implementation.md#41-认证和邀请码) 为准。

> **版本 (Version)**: 4.1 (Aligned with Backend naming convention)
> **基础 (Base)**: Inherits from existing [API-CONTRACT.md](../API-CONTRACT.md) (v1.0)
> **状态 (Status)**: 已锁定 (Locked for Development)

---

## 1. 核心业务策略 (Core Business Strategy)

### 1.1 门禁式邀请制 (The Gatekeeper Flow)

当前处于 **内测阶段 (STRICT)**，采用“先验票，后入场”策略。

1.  **全局拦截**: 未认证设备启动 App，仅展示“输入邀请码”界面。
2.  **校验逻辑**: 用户输入邀请码 -> 调用API校验。
    *   **有效**: 解锁完整登录/注册功能，并缓存邀请码。
    *   **无效**: 阻断在当前页，提示错误。
3.  **体验优化**: 校验通过后，后续的注册或社交登录流程自动携带此“通行证”，实现**无感关联邀请关系**。

### 1.2 账号体系 (Account System)

*   **唯一标识**: 手机号 (Email/Phone) 为账号主键。
*   **双轨登录**:
    *   **密码登录 (主推)**: 适合老用户，安全且体验稳定。
    *   **验证码登录 (辅助)**: 适合忘记密码场景。**严禁自动注册**，必须严格返回 404 让用户走注册流程。
*   **长效会话**: 采用 `access_token` (短效) + `refresh_token` (长效) 机制，实现移动端“一次登录，长期有效”的体验。

### 1.3 合规与安全 (Compliance & Security)

*   **App Store 强制合规**:
    *   **注销账号**: 必须提供彻底删除账号和数据的接口。
    *   **EULA/隐私**: 注册前必须有明确的“同意条款”交互 (UI Check)。
*   **风控**: 短信/邮件验证码接口必须统一，以便实施全局频率限制 (Rate Limiting)，防止盗刷。

---

## 2. API 接口契约 (API Contract)

### 2.0 通用标准 (Standards)

* **Protocol**: HTTPS

* **Format**: JSON

* **Naming Convention**: **snake_case** (to match existing backend style)

* **Auth Header**: `Authorization: Bearer <access_token>`

* **Error Format**:

  ```json
  { "code": "ERROR_CODE", "message": "Human readable error" }
  ```

### 2.1 全局配置 (Global Config)

`GET /config/auth`
*用于前端判断当前的注册门槛模式。*

```json
// Response 200 OK
{
  "register_invite_mode": "STRICT" // 枚举: "STRICT" (必填), "OPEN" (选填)
}
```

### 2.2 校验邀请码 (Check Invite Code)

`POST /auth/check-invite-code`
*门禁页专用。*

```json
// Request
{ "code": "INVITE_2026" }

// Response 200 OK
{ "valid": true, "message": "欢迎加入" }

// Response 400 Bad Request
{ "valid": false, "message": "邀请码无效或已失效" }
```

### 2.3 发送验证码 (Send Verification Code)

`POST /auth/send-code`

> **设计说明**: 采用统一接口 + `scene` 参数，是为了对手机号实施**全局频率控制 (Rate Limiting)**，防止验证码盗刷。同时通过后端逻辑严格隔离业务场景。

```json
// Request
{
  "email": "user@example.com",
  "scene": "LOGIN" // 枚举: "LOGIN", "REGISTER", "FORGOT_PASSWORD", "DELETE_ACCOUNT"
}
```

*   **后端逻辑强制校验**:
    *   `LOGIN`: 用户必须存在，否则 404。
    *   `REGISTER`: 用户必须**不存在**，否则 409 (Conflict)。
    *   `FORGOT_PASSWORD`: 用户必须存在。
    *   `DELETE_ACCOUNT`: 用户必须存在。

### 2.4 注册 (Register)

`POST /auth/register`
*Ref: 原 API-CONTRACT.md v1.0 扩充*

```json
// Request
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "verification_code": "123456",
  "invitation_code": "INVITE_2026", // Strict模式下必填
  "social_token": "optional_token",
  "display_name": "optional_name" // 保持snake_case
}

// Response 200 OK
{
  "user": { "id": "...", "email": "...", "display_name": "..." },
  "access_token": "ey...",
  "refresh_token": "rt..."
}
```

### 2.5 登录 (Login)

`POST /auth/login`

```json
// Request
{
  "email": "user@example.com",
  "type": "PASSWORD", // 枚举: "PASSWORD" | "CODE"
  "password": "...",    // Required if type=PASSWORD
  "verification_code": "..." // Required if type=CODE
}

// Response 200 OK
{ "user": {...}, "access_token": "...", "refresh_token": "..." }

// Response 404 Not Found (CRITICAL)
{ "code": "USER_NOT_FOUND", "message": "账号不存在，请先注册" }
```

### 2.6 社交登录 (Social Login)

`POST /auth/social-login`

```json
// Request
{
  "provider": "APPLE", // "GOOGLE"
  "token": "identity_token_from_sdk",
  "invitation_code": "opt_code_from_gatekeeper"
}
```

*   **后端逻辑**:
    1.  若账号已存在 -> 登录成功 (200 OK)。
    2.  若账号不存在:
        *   若 `invitation_code` 有效 -> **自动注册并登录** (200 OK)。
        *   若无邀请码/无效 -> 返回需补全状态。

// Response 202 Accepted (Need Info)
{ "code": "NEED_REGISTER_INFO", "temp_token": "...", "message": "需补全注册信息" }

```
### 2.7 重置密码 (Reset Password)
`POST /auth/reset-password`
```json
// Request
{
  "email": "...",
  "verification_code": "...",
  "new_password": "..."
}
// Response 200 OK
{ "success": true }
```

### 2.8 刷新凭证 (Refresh Token)

`POST /auth/refresh-token`

```json
// Request
{ "refresh_token": "current_valid_refresh_token" }

// Response 200 OK
{ "access_token": "new_access_token", "refresh_token": "new_refresh_token" }
```

### 2.9 登出 (Logout)

`POST /auth/logout`
*Header: Authorization required*

```json
{ "success": true }
```

### 2.10 注销账号 (Delete Account)

`POST /auth/delete-account`
*Header: Authorization required*

```json
{ "success": true }
```

---

## 3. 前端开发清单 (Frontend Checklist)

1.  **Gatekeeper View**: 实现“请输入邀请码”的初始独立页面。
2.  **State Management**: 增加 `verifiedInviteCode` 全局状态。
3.  **UI Compliance**:
    *   注册页底部增加: `[ ] 我已阅读并同意《用户协议》及《隐私政策》`。
    *   个人设置页增加: `[注销账号]` 红色按钮。
4.  **Network Logic**:
    *   **字段名映射**: 注意前端 model (camelCase) 需映射为 API (snake_case)。
    *   实现 401 自动刷新 Token 拦截器。
    *   实现 404 登录失败自动跳注册逻辑。
