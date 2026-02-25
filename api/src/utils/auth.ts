/**
 * 认证工具函数
 */
import { VercelRequest } from '@vercel/node';
import { UnauthorizedError } from './errors';
import { verifyToken } from '../services/authService';
import { User } from '../models/User';

/**
 * 从请求头中提取 JWT Token
 */
export function extractToken(req: VercelRequest): string {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new UnauthorizedError('缺少认证令牌');
  }

  // 支持 "Bearer <token>" 格式
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer') {
    return parts[1];
  }

  // 直接传递 token
  return authHeader;
}

/**
 * 验证请求并返回当前用户
 * 类似于 Spring Security 的 @AuthenticationPrincipal
 */
export async function getCurrentUser(req: VercelRequest): Promise<User> {
  const token = extractToken(req);
  const user = await verifyToken(token);
  return user;
}

/**
 * 可选认证：如果有 token 则验证，没有则返回 null
 */
export async function getOptionalUser(req: VercelRequest): Promise<User | null> {
  try {
    return await getCurrentUser(req);
  } catch (error) {
    return null;
  }
}
