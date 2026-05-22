/**
 * 认证服务层（Service）
 *
 * 依据：simple.md §3 用户认证模块
 *
 * 本文件封装所有认证相关的核心业务逻辑：
 *   1. 发送验证码          — sendVerificationCode()
 *   2. 用户注册            — registerUser()
 *   3. 密码登录            — loginWithPassword()
 *   4. 验证码登录          — loginWithCode()
 *   5. 第三方登录          — socialLogin()
 *   6. 密码重置            — resetPassword()
 *   7. 刷新 Token          — refreshAccessToken()
 *   8. 登出               — logoutUser()
 *   9. 注销账号            — deleteAccount()
 *  10. 验证 Token（中间件）— verifyToken()
 *
 * 技术选型（来自 simple.md §1.2）：
 *   - 验证码：Supabase Auth 内置 OTP（signInWithOtp / verifyOtp），无需第三方邮件服务
 *   - 第三方登录：Supabase signInWithIdToken，直接验证 iOS SDK 返回的 identity_token
 *   - Token：Supabase 管理的 JWT，access_token（短效）+ refresh_token（长效）
 *
 * 调用关系：
 *   Handler → authService → { supabase.auth, userRepository, inviteCodeService }
 */

import { supabase, createServiceSupabaseClient, createUserSupabaseClient } from '../database/supabase';
import { userRepository } from '../database/repositories/UserRepository';
import { getValidInviteCode, consumeInviteCode } from './inviteCodeService';
import { isInviteCodeRequired } from '../config/auth';
import { validateEmail, validatePassword } from '../utils/validation';
import { UnauthorizedError, ValidationError, NotFoundError } from '../utils/errors';
import { LoginResponse, RefreshTokenResponse, User } from '../models/User';
import { InviteCode } from '../models/InviteCode';


// ─────────────────────────────────────────────────────────────
// 输入类型定义（对应 simple.md §3.2 前端字段，后端用 snake_case）
// ─────────────────────────────────────────────────────────────

/** 发送验证码输入 */
export interface SendCodeInput {
  email: string;
}

/** 注册输入（simple.md §3.1：邮箱 → 发验证码 → 输入验证码+密码 → 注册） */
export interface RegisterInput {
  email: string;
  password: string;
  verification_code: string; // 对应前端 verificationCode
  invitation_code?: string;  // 对应前端 invitationCode（受 INVITE_CODE_REQUIRED 开关控制）
  display_name?: string;     // 对应前端 displayName（可选）
}

/** 密码登录输入（simple.md §3.1：邮箱+密码 → 登录） */
export interface PasswordLoginInput {
  email: string;
  password: string;
}

/** 验证码登录输入（simple.md §3.1：邮箱 → 发验证码 → 输入验证码 → 登录） */
export interface CodeLoginInput {
  email: string;
  verification_code: string; // 对应前端 verificationCode
}

/** 第三方登录输入（simple.md §3.1：获取 OAuth Token → 调用 API） */
export interface SocialLoginInput {
  provider: 'apple' | 'google';
  social_token: string;       // 对应前端 socialToken（iOS SDK 返回的 identity_token）
  nonce?: string;             // Google Sign-In 生产环境 nonce 校验
  invitation_code?: string;   // 对应前端 invitationCode（邀请码门禁开启时新用户需要）
}

/** 密码重置输入（simple.md §3.1：邮箱 → 发验证码 → 输入新密码 → 重置） */
export interface ResetPasswordInput {
  email: string;
  verification_code: string;
  new_password: string;
}

/** 刷新 Token 输入 */
export interface RefreshTokenInput {
  refresh_token: string;
}

/**
 * 第三方登录响应（两种结果，由后端判断用哪种）
 *   - status='ok'        : 登录/注册成功，直接返回 token
 *   - status='need_info' : 新用户且邀请码门禁开启，需前端补全注册信息
 */
export type SocialLoginResponse =
  | { status: 'ok'; data: LoginResponse }
  | { status: 'need_info'; temp_token: string };

async function resolveInviteCodeForRegistration(
  invitationCode: string | undefined,
  required: boolean,
): Promise<InviteCode | null> {
  const code = invitationCode?.trim();

  if (!code) {
    if (required) {
      throw new ValidationError('请输入邀请码');
    }
    return null;
  }

  try {
    return await getValidInviteCode(code);
  } catch {
    if (required) {
      throw new ValidationError('邀请码无效或已失效');
    }
    console.warn('[注册] 已忽略无效邀请码（当前未强制要求邀请码）:', code);
    return null;
  }
}


// ─────────────────────────────────────────────────────────────
// 1. 发送验证码
// ─────────────────────────────────────────────────────────────

/**
 * 发送邮件验证码
 *
 * simple.md §3.1 涉及验证码的场景：注册、验证码登录、密码重置。
 * 三个场景都复用同一个发送接口（POST /api/auth/send-code）。
 *
 * 技术实现：
 *   使用 Supabase Auth 的 signInWithOtp，会向指定邮箱发送 6 位数字验证码。
 *   shouldCreateUser: false — 不自动创建用户，只负责发码。
 *
 * @param input - { email }
 */
export async function sendVerificationCode(input: SendCodeInput): Promise<void> {
  const { email } = input;
  const authClient = createServiceSupabaseClient();

  // 邮箱格式校验（validateEmail 返回 boolean，这里统一处理）
  if (!validateEmail(email)) {
    throw new ValidationError('邮箱格式不正确');
  }

  // 调用 Supabase Auth 发送 OTP
  const { error } = await authClient.auth.signInWithOtp({
    email,
    options: {
      // shouldCreateUser: true — 允许 Supabase 为新邮箱创建临时 auth 用户以发送验证码
      // 业务层的控制（邀请码验证、用户是否已注册）在 register / login 接口中完成
      // 设为 false 会在某些 Supabase 配置下触发 "Signups not allowed for otp" 错误
      shouldCreateUser: true,
    },
  });

  if (error) {
    // 最常见的错误：60 秒内重复发送被限流
    if (error.message.toLowerCase().includes('rate limit')) {
      throw new ValidationError('发送过于频繁，请 60 秒后再试');
    }
    throw new Error(`验证码发送失败: ${error.message}`);
  }
}


// ─────────────────────────────────────────────────────────────
// 2. 用户注册
// ─────────────────────────────────────────────────────────────

/**
 * 用户注册
 *
 * simple.md §3.1 注册流程（两步，第一步由 send-code 接口完成）：
 *   Step 1（前端已发起）: POST /send-code { email }
 *   Step 2（此函数处理）: POST /register { email, password, verificationCode, invitationCode? }
 *
 * 后端处理顺序：
 *   1. 按 INVITE_CODE_REQUIRED 判断是否强制校验邀请码
 *   2. 用验证码 + 邮箱向 Supabase 完成注册（verifyOtp 同时创建 auth 用户）
 *   3. 在业务 users 表创建用户记录
 *   4. 有有效邀请码时消耗邀请码（写使用记录 + 自增次数）
 *   5. 返回 token
 *
 * @param input - { email, password, verification_code, invitation_code?, display_name? }
 * @returns LoginResponse - { user, access_token, refresh_token }
 */
export async function registerUser(input: RegisterInput): Promise<LoginResponse> {
  const { email, password, verification_code, invitation_code, display_name } = input;
  const authClient = createServiceSupabaseClient();

  // 1. 基础格式校验
  if (!validateEmail(email)) {
    throw new ValidationError('邮箱格式不正确');
  }
  const pwCheck = validatePassword(password);
  if (!pwCheck.valid) {
    throw new ValidationError(pwCheck.message!);
  }

  // 2. 邀请码门禁由环境变量控制。关闭时允许无邀请码注册；有有效邀请码仍记录邀请关系。
  const inviteCode = await resolveInviteCodeForRegistration(invitation_code, isInviteCodeRequired());

  // 3. 用验证码向 Supabase 完成注册
  //    verifyOtp type='email' 对应 signInWithOtp 发出的验证码
  //    成功后 Supabase 会在 auth.users 创建认证用户，并返回 session
  const { data: authData, error: otpError } = await authClient.auth.verifyOtp({
    email,
    token: verification_code,
    type: 'email',
  });

  if (otpError || !authData.user || !authData.session) {
    throw new ValidationError('验证码错误或已过期，请重新获取');
  }

  // 4. 在业务 users 表创建记录
  let user;
  try {
    user = await userRepository.create({
      id: authData.user.id,
      email,
      display_name,
    });
  } catch (dbError) {
    // users 表创建失败：清理已创建的 auth 用户，保证数据一致性
    await supabase.auth.admin.deleteUser(authData.user.id);
    throw new Error(`注册失败，请稍后重试: ${dbError instanceof Error ? dbError.message : ''}`);
  }

  // 5. 消耗邀请码（写关系记录 + 次数自增）
  //    邀请关系是增长追溯的核心账本，失败时回滚新账号，避免“注册成功但查不到邀请人”。
  if (inviteCode) {
    try {
      await consumeInviteCode(inviteCode, user.id);
    } catch (e) {
      console.error('[注册] 邀请码消耗失败，回滚新账号:', e);
      await userRepository.hardDeleteById(user.id).catch((cleanupError) => {
        console.error('[注册] 回滚 users 记录失败:', cleanupError);
      });
      await supabase.auth.admin.deleteUser(authData.user.id);
      throw new Error('注册失败：邀请码使用记录写入失败，请稍后重试');
    }
  }

  // 6. 返回用户信息 + Token
  return {
    user: userRepository.toProfile(user),
    access_token: authData.session.access_token,
    refresh_token: authData.session.refresh_token,
  };
}


// ─────────────────────────────────────────────────────────────
// 3. 密码登录
// ─────────────────────────────────────────────────────────────

/**
 * 密码登录
 *
 * simple.md §3.1：用户输入邮箱+密码 → 调用登录API → 获取Token
 *
 * @param input - { email, password }
 * @returns LoginResponse
 */
export async function loginWithPassword(input: PasswordLoginInput): Promise<LoginResponse> {
  const { email, password } = input;
  const authClient = createServiceSupabaseClient();

  if (!validateEmail(email)) {
    throw new ValidationError('邮箱格式不正确');
  }

  // Supabase 密码登录
  const { data: authData, error } = await authClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !authData.user || !authData.session) {
    // 不区分"邮箱不存在"和"密码错误"，统一返回模糊提示（安全最佳实践）
    throw new UnauthorizedError('邮箱或密码错误');
  }

  // 查询业务表用户记录
  const user = await userRepository.findById(authData.user.id);
  if (!user) {
    throw new NotFoundError('账号不存在，请先注册');
  }

  if (!user.is_active) {
    throw new UnauthorizedError('账号已被禁用，请联系客服');
  }

  // 更新最后登录时间
  await userRepository.updateLastLogin(user.id);

  return {
    user: userRepository.toProfile(user),
    access_token: authData.session.access_token,
    refresh_token: authData.session.refresh_token,
  };
}


// ─────────────────────────────────────────────────────────────
// 4. 验证码登录
// ─────────────────────────────────────────────────────────────

/**
 * 验证码登录（免密登录）
 *
 * simple.md §3.1：用户输入邮箱 → 发送验证码 → 输入验证码 → 调用登录API → 获取Token
 * 注意：验证码登录不自动注册，账号不存在时返回错误，引导用户去注册。
 *
 * @param input - { email, verification_code }
 * @returns LoginResponse
 */
export async function loginWithCode(input: CodeLoginInput): Promise<LoginResponse> {
  const { email, verification_code } = input;
  const authClient = createServiceSupabaseClient();

  if (!validateEmail(email)) {
    throw new ValidationError('邮箱格式不正确');
  }

  // 用验证码向 Supabase 认证（verifyOtp）
  const { data: authData, error } = await authClient.auth.verifyOtp({
    email,
    token: verification_code,
    type: 'email',
  });

  if (error || !authData.user || !authData.session) {
    throw new ValidationError('验证码错误或已过期，请重新获取');
  }

  // 检查业务表是否有此用户（区分"已注册老用户"和"未注册"）
  const user = await userRepository.findById(authData.user.id);
  if (!user) {
    // 用验证码登录但账号不存在：引导注册，不自动创建
    throw new NotFoundError('账号不存在，请先注册');
  }

  if (!user.is_active) {
    throw new UnauthorizedError('账号已被禁用，请联系客服');
  }

  await userRepository.updateLastLogin(user.id);

  return {
    user: userRepository.toProfile(user),
    access_token: authData.session.access_token,
    refresh_token: authData.session.refresh_token,
  };
}


// ─────────────────────────────────────────────────────────────
// 5. 第三方登录（Apple / Google）
// ─────────────────────────────────────────────────────────────

/**
 * 第三方登录
 *
 * simple.md §3.1：获取 OAuth Token → 调用社交登录API → 已绑定直接登录 / 新用户需补充信息
 *
 * iOS 端流程：
 *   1. 用户点击 "Sign in with Apple" 或 "Sign in with Google"
 *   2. iOS SDK 返回 identity_token（JWT 格式）
 *   3. Google 登录同时返回前端生成的 nonce，用于防止 token 重放
 *   4. 前端将 identity_token 作为 social_token 发给本接口
 *   5. 后端用 Supabase signInWithIdToken 验证 token 与 nonce
 *
 * 三种处理结果：
 *   A. 已有账号 → 直接返回 token（200 ok）
 *   B. 新用户 + 邀请码门禁关闭或有效邀请码 → 自动注册并返回 token（200 ok）
 *   C. 新用户 + 邀请码门禁开启且无有效邀请码 → 返回 need_info（202）
 *
 * @param input - { provider, social_token, nonce?, invitation_code? }
 * @returns SocialLoginResponse
 */
export async function socialLogin(input: SocialLoginInput): Promise<SocialLoginResponse> {
  const { provider, social_token, nonce, invitation_code } = input;
  const authClient = createServiceSupabaseClient();

  // 用 Supabase 验证 iOS SDK 返回的 identity_token
  const { data: authData, error: authError } = await authClient.auth.signInWithIdToken({
    provider,
    token: social_token,
    nonce,
  });

  if (authError || !authData.user || !authData.session) {
    throw new UnauthorizedError(`第三方登录失败: ${authError?.message || '无效的 token'}`);
  }

  // 检查业务 users 表中是否已有此用户
  const existingUser = await userRepository.findById(authData.user.id);

  if (existingUser) {
    // 情况 A：已有账号，直接登录
    await userRepository.updateLastLogin(existingUser.id);
    return {
      status: 'ok',
      data: {
        user: userRepository.toProfile(existingUser),
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
      },
    };
  }

  // 情况 B / C：新用户
  const inviteCode = await resolveInviteCodeForRegistration(invitation_code, false);

  if (isInviteCodeRequired() && !inviteCode) {
    // 情况 C：邀请码门禁开启且无有效邀请码，返回临时 token 让前端补全
    return {
      status: 'need_info',
      temp_token: authData.session.access_token,
    };
  }

  // 情况 B：邀请码门禁关闭，或已有有效邀请码，自动注册
  const email = authData.user.email ?? '';
  // Supabase 会在 user_metadata 中存储第三方提供的姓名
  const display_name =
    authData.user.user_metadata?.full_name ||
    authData.user.user_metadata?.name ||
    undefined;

  let newUser;
  try {
    newUser = await userRepository.create({ id: authData.user.id, email, display_name });
  } catch (dbError) {
    await supabase.auth.admin.deleteUser(authData.user.id);
    throw new Error(`第三方注册失败: ${dbError instanceof Error ? dbError.message : ''}`);
  }

  if (inviteCode) {
    try {
      await consumeInviteCode(inviteCode, newUser.id);
    } catch (e) {
      console.error('[社交登录] 邀请码消耗失败，回滚新账号:', e);
      await userRepository.hardDeleteById(newUser.id).catch((cleanupError) => {
        console.error('[社交登录] 回滚 users 记录失败:', cleanupError);
      });
      await supabase.auth.admin.deleteUser(authData.user.id);
      throw new Error('第三方注册失败：邀请码使用记录写入失败，请稍后重试');
    }
  }

  return {
    status: 'ok',
    data: {
      user: userRepository.toProfile(newUser),
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
    },
  };
}


// ─────────────────────────────────────────────────────────────
// 6. 密码重置
// ─────────────────────────────────────────────────────────────

/**
 * 重置密码
 *
 * simple.md §3.1：用户输入邮箱 → 发送验证码 → 输入新密码 → 调用重置API
 * 第一步发码由 send-code 接口完成；此函数处理第二步（验证码 + 新密码）。
 *
 * @param input - { email, verification_code, new_password }
 */
export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const { email, verification_code, new_password } = input;
  const authClient = createServiceSupabaseClient();

  // 校验新密码强度
  const pwCheck = validatePassword(new_password);
  if (!pwCheck.valid) {
    throw new ValidationError(`新密码不符合要求：${pwCheck.message}`);
  }

  // 用验证码换取 session（同时完成验证码校验）
  // type: 'recovery' 是 Supabase 密码重置场景对应的 OTP 类型
  const { data: otpData, error: otpError } = await authClient.auth.verifyOtp({
    email,
    token: verification_code,
    type: 'recovery',
  });

  if (otpError || !otpData.session) {
    throw new ValidationError('验证码错误或已过期');
  }

  // 用用户自己的 session 更新密码（而非 service role，保证安全边界）
  const userClient = createUserSupabaseClient(otpData.session.access_token);
  const { error: updateError } = await userClient.auth.updateUser({
    password: new_password,
  });

  if (updateError) {
    throw new Error(`密码更新失败: ${updateError.message}`);
  }
}


// ─────────────────────────────────────────────────────────────
// 7. 刷新 Token
// ─────────────────────────────────────────────────────────────

/**
 * 刷新访问令牌
 *
 * 移动端"长效会话"核心机制：
 *   access_token 有效期约 1 小时，过期后前端用 refresh_token 换新的。
 *   iOS 客户端在收到 401 时自动调用此接口（拦截器逻辑由前端实现）。
 *
 * @param input - { refresh_token }
 * @returns RefreshTokenResponse - { access_token, refresh_token }
 */
export async function refreshAccessToken(input: RefreshTokenInput): Promise<RefreshTokenResponse> {
  const authClient = createServiceSupabaseClient();
  const { data, error } = await authClient.auth.refreshSession({
    refresh_token: input.refresh_token,
  });

  if (error || !data.session) {
    throw new UnauthorizedError('登录状态已过期，请重新登录');
  }

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  };
}


// ─────────────────────────────────────────────────────────────
// 8. 登出
// ─────────────────────────────────────────────────────────────

/**
 * 用户登出
 *
 * 使当前 session 的 refresh_token 在服务端失效。
 * access_token 因 JWT 无状态特性在剩余有效期内仍可用，但时间短（1小时内），可接受。
 *
 * @param accessToken - 从请求头 Authorization: Bearer 提取的 token
 */
export async function logoutUser(accessToken: string): Promise<void> {
  // 用用户自己的 client 调用 signOut，确保撤销的是该用户的 session
  const userClient = createUserSupabaseClient(accessToken);
  const { error } = await userClient.auth.signOut();

  if (error) {
    // token 已过期时 signOut 也会报错，此情况对前端无影响（前端清除本地 token 即可）
    console.warn('[登出] Supabase signOut 返回错误（可忽略）:', error.message);
  }
}


// ─────────────────────────────────────────────────────────────
// 9. 注销账号
// ─────────────────────────────────────────────────────────────

/**
 * 注销账号（App Store 合规必须提供）
 *
 * Apple App Store 审核要求：必须提供彻底删除账号和数据的入口。
 *
 * 实现策略：
 *   - users 业务表：软删除（打 deleted_at 时间戳），保留数据用于合规审计
 *   - auth.users 认证表：硬删除，用户无法再次用此邮箱登录
 *
 * @param userId - 当前用户 ID（从 JWT 中解析）
 */
export async function deleteAccount(userId: string): Promise<void> {
  // Step 1: 软删除业务表记录（保留数据）
  const deleted = await userRepository.softDelete(userId);
  if (!deleted) {
    throw new Error('账号注销失败，请稍后重试');
  }

  // Step 2: 删除 Supabase Auth 用户（使用 service role admin 权限）
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    // auth 删除失败：users 表已软删，用户实际已无法登录
    // 记录错误，由管理员定期清理孤立的 auth 用户
    console.error(`[注销] 删除 Auth 用户失败（userId: ${userId}）:`, error.message);
  }
}


// ─────────────────────────────────────────────────────────────
// 10. Token 验证（被 auth 中间件调用）
// ─────────────────────────────────────────────────────────────

/**
 * 验证 access_token 并返回当前用户
 *
 * 被 src/utils/auth.ts 中的 getCurrentUser() 调用。
 * 所有需要登录的接口都通过此函数鉴权。
 *
 * @param token - 从 Authorization: Bearer <token> 提取的 JWT
 * @returns User - 当前登录用户完整信息
 * @throws UnauthorizedError - token 无效、用户不存在或账号被禁用
 */
export async function verifyToken(token: string): Promise<User> {
  // Supabase 验证 JWT 签名并解析用户 ID
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new UnauthorizedError('无效的访问令牌，请重新登录');
  }

  // 从业务表获取完整用户信息（包含 is_active 等字段）
  const user = await userRepository.findById(data.user.id);
  if (!user) {
    throw new UnauthorizedError('用户不存在');
  }

  if (!user.is_active) {
    throw new UnauthorizedError('账号已被禁用，请联系客服');
  }

  return user;
}
