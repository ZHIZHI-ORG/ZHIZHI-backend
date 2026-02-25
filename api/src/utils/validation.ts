/**
 * 参数验证工具
 * 类似于 Java 中的 @Valid 或 Hibernate Validator
 */
import { ValidationError } from './errors';

/**
 * 验证必填字段
 */
export function requireFields(data: any, fields: string[]): void {
  const missing: string[] = [];

  for (const field of fields) {
    if (!data[field]) {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    throw new ValidationError(`缺少必填字段: ${missing.join(', ')}`);
  }
}

/**
 * 验证邮箱格式
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * 验证密码强度
 * 要求：至少8位，包含字母和数字
 */
export function validatePassword(password: string): { valid: boolean; message?: string } {
  if (password.length < 8) {
    return { valid: false, message: '密码长度至少为8位' };
  }

  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, message: '密码必须包含字母' };
  }

  if (!/\d/.test(password)) {
    return { valid: false, message: '密码必须包含数字' };
  }

  return { valid: true };
}

/**
 * 验证用户名格式
 * 要求：3-20位，只能包含字母、数字、下划线
 */
export function validateUsername(username: string): { valid: boolean; message?: string } {
  if (username.length < 3 || username.length > 20) {
    return { valid: false, message: '用户名长度必须在3-20位之间' };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return { valid: false, message: '用户名只能包含字母、数字、下划线' };
  }

  return { valid: true };
}

/**
 * 验证注册输入
 */
export function validateRegisterInput(data: any): void {
  requireFields(data, ['email', 'password', 'username']);

  if (!validateEmail(data.email)) {
    throw new ValidationError('邮箱格式不正确');
  }

  const usernameCheck = validateUsername(data.username);
  if (!usernameCheck.valid) {
    throw new ValidationError(usernameCheck.message!);
  }

  const passwordCheck = validatePassword(data.password);
  if (!passwordCheck.valid) {
    throw new ValidationError(passwordCheck.message!);
  }
}

/**
 * 验证登录输入
 */
export function validateLoginInput(data: any): void {
  requireFields(data, ['email', 'password']);

  if (!validateEmail(data.email)) {
    throw new ValidationError('邮箱格式不正确');
  }
}

/**
 * 验证创建内容输入
 */
export function validateCreateContentInput(data: any): void {
  requireFields(data, ['title', 'body', 'content_type']);

  if (data.title.length < 1 || data.title.length > 200) {
    throw new ValidationError('标题长度必须在1-200字符之间');
  }

  if (data.body.length < 1) {
    throw new ValidationError('内容不能为空');
  }
}
