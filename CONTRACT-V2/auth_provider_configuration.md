# ZHIZHI Auth Provider Configuration

## Product Meaning

Auth is not only an account utility for ZHIZHI. It decides whether a new user can enter the private beta, whether App Review can verify the app, and whether user data can be safely attached to one stable account.

The product requirement is:

1. Existing users can log in with email and password.
2. Existing users can log in with email verification code.
3. New users register with invitation code, email verification code, and password.
4. Users can authenticate with native Apple and Google sign-in.
5. Backend remains the single owner of the app session returned to iOS.

`identity token` means the signed login proof returned by Apple or Google after the native SDK flow. iOS sends it to this backend, and this backend asks Supabase Auth to verify it.

## Current Code Reality

Frontend repository: `/Users/hangdongguo/Desktop/ZHIZHI/ZHI9.25`

- iOS base URL is currently `http://localhost:3000`.
- App launch still defaults to `AppState.isAuthenticated = true`, so auth is not yet the default startup path.
- Auth UI exists for invitation gate, email/password login, email-code login, registration, password reset, Apple, and Google.
- Apple and Google buttons are visible, but the current button actions do not yet invoke Apple/Google SDKs.
- iOS social-login payload must be `{ provider, socialToken, invitation_code? }`.

Backend repository: `/Users/hangdongguo/Desktop/ZHIZHI/ZHIZHI-backend`

- Backend uses Supabase Auth.
- `POST /api/auth/login` supports password login and verification-code login.
- `POST /api/auth/register` supports invite-code registration.
- `POST /api/auth/social-login` accepts `provider: "apple" | "google"` and `socialToken`.
- Backend service calls `supabase.auth.signInWithIdToken({ provider, token })`.

## Recommended Architecture

Use native iOS sign-in for Apple and Google, then pass the provider identity token to the backend:

```text
iOS native Apple / Google SDK
  -> receives identity token
  -> POST /api/auth/social-login
  -> backend verifies token through Supabase Auth
  -> backend creates or finds business user
  -> backend returns ZHIZHI access_token / refresh_token
```

This keeps the user experience native and avoids browser redirect/deeplink complexity in the app.

## Supabase Project

Project observed in browser:

- Supabase project: `zhizhi-mvp`
- Project ref: `lbukziyhjcwyjwlssymj`
- Supabase callback URL: `https://lbukziyhjcwyjwlssymj.supabase.co/auth/v1/callback`

Browser inspection note:

- Chrome had an active Supabase login session.
- Direct navigation to `/auth/providers` and `/auth/users` loaded a blank dashboard shell during inspection, so provider state was not confirmed visually.
- Do not treat provider configuration as completed until Supabase provider pages or Management API readback confirm it.

## Email / Password Configuration

Supabase Auth must allow email login and email OTP.

Required settings:

| Area | Required setting |
|---|---|
| Email provider | Enabled |
| Email/password signup | Enabled if registration should create Supabase auth users |
| Email OTP | Enabled |
| OTP length / expiry | Product default acceptable; keep rate limits on |
| SMTP | Supabase default is acceptable for development; production should use branded SMTP before launch |

Backend dependency:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`

No additional backend secret is needed for email/password beyond the existing Supabase keys.

## Apple Configuration

### Apple Developer Console

Use bundle ID:

```text
com.ZHI9-25
```

Required:

1. Enable `Sign in with Apple` on the App ID for `com.ZHI9-25`.
2. Add the Sign in with Apple capability to the iOS target in Xcode.
3. Use Apple's native `AuthenticationServices` framework in iOS.
4. Capture `identityToken` from `ASAuthorizationAppleIDCredential`.
5. Capture full name on first Apple login if available, because Apple normally only provides name once.

Native-only path:

- Use the iOS bundle ID as the accepted Apple client identifier in Supabase provider configuration when the dashboard supports native authorized client IDs.
- Secret key rotation is only needed if this project also configures Apple OAuth web flow with Services ID and signing key.

Web/OAuth fallback path, only if Supabase dashboard requires it:

| Apple item | Value / source |
|---|---|
| Team ID | Apple Developer account |
| App ID | `com.ZHI9-25` |
| Services ID | Create one, for example `com.zhizhi.app.web` |
| Website domain | `lbukziyhjcwyjwlssymj.supabase.co` or a future custom auth domain |
| Redirect URL | `https://lbukziyhjcwyjwlssymj.supabase.co/auth/v1/callback` |
| Apple key `.p8` | Store securely; do not commit |
| Apple client secret | Generated from Team ID, Services ID, Key ID, and `.p8` |

Supabase Management API shape if using OAuth fields:

```json
{
  "external_apple_enabled": true,
  "external_apple_client_id": "your-apple-client-id",
  "external_apple_secret": "your-generated-apple-client-secret"
}
```

## Google Configuration

### Google Cloud Console

Required OAuth clients:

1. A Web application OAuth client for Supabase provider configuration.
2. An iOS OAuth client for the native Google Sign-In SDK.

Use bundle ID:

```text
com.ZHI9-25
```

Web OAuth client:

| Field | Value |
|---|---|
| Authorized JavaScript origins | Production website/API origin when available; local origin only for development |
| Authorized redirect URI | `https://lbukziyhjcwyjwlssymj.supabase.co/auth/v1/callback` |

iOS OAuth client:

| Field | Value |
|---|---|
| Bundle ID | `com.ZHI9-25` |
| Client ID | Used by iOS Google Sign-In SDK |

Supabase provider configuration:

```json
{
  "external_google_enabled": true,
  "external_google_client_id": "web-client-id,ios-client-id",
  "external_google_secret": "web-client-secret"
}
```

Keep the Web client ID first if multiple Google client IDs are concatenated.

## Backend API Contract

### Password login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "Password123"
}
```

### Code login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "verificationCode": "123456"
}
```

### Social login

```http
POST /api/auth/social-login
Content-Type: application/json

{
  "provider": "apple",
  "socialToken": "<apple-identity-token>",
  "invitationCode": "ZHIZHI2026"
}
```

```http
POST /api/auth/social-login
Content-Type: application/json

{
  "provider": "google",
  "socialToken": "<google-id-token>",
  "invitationCode": "ZHIZHI2026"
}
```

Provider values must be lowercase: `apple` or `google`.

## Backend Acceptance Checks

Before calling auth complete, verify:

1. `POST /api/auth/login` succeeds for a seeded email/password user.
2. `POST /api/auth/send-code` sends OTP without Supabase provider errors.
3. `POST /api/auth/register` creates both Supabase auth user and business `users` row.
4. `POST /api/auth/social-login` with valid Apple identity token returns app tokens.
5. `POST /api/auth/social-login` with valid Google ID token returns app tokens.
6. A new social user without invite code returns `202` and `status: "need_info"`.
7. A new social user with valid invite code creates the business `users` row and consumes the invite code.
8. Invalid or expired provider token returns `401`.
9. Existing user login updates `last_login_at`.
10. All authenticated product APIs accept the returned Bearer token.

## Remaining iOS Work

Backend/provider configuration alone will not make Apple/Google login usable.

iOS still needs:

1. Apple capability and entitlement.
2. Native Apple Sign-In request with nonce support.
3. Google Sign-In SDK dependency and `GoogleService-Info.plist` or equivalent client ID config.
4. URL scheme for Google callback if the selected SDK flow needs it.
5. Button actions wired to `performSocialLogin(provider:token:)`.
6. Handling of `need_info` response by routing the user to invitation-code completion.
7. Release-safe removal of default fake-auth startup.

## Main Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Supabase provider not actually enabled | Apple/Google tokens fail at backend verification | Confirm provider settings by dashboard or Management API readback |
| Bundle ID mismatch | Native provider tokens rejected | Use `com.ZHI9-25` consistently across Xcode, Apple, Google, Supabase |
| Apple name not captured on first login | User profile may miss display name permanently | iOS must capture first-login full name and send/update profile immediately |
| Client secret committed | Account/security exposure | Store Apple `.p8`, Google secret, and Supabase service key outside git |
| Fake auth remains default | App appears logged in without real session | Move bypass behind debug-only build flag before release |
| Provider payload mismatch | Backend returns 400 despite valid SDK token | Keep iOS payload as `socialToken`, provider lowercase |

