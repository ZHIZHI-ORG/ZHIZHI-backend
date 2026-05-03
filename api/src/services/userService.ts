/**
 * 用户服务层（Service）
 * 处理用户资料的查询和更新
 */
import { userRepository } from '../database/repositories/UserRepository';
import { UpdateUserInput, UpdateUserExtendedInput, UserProfile } from '../models/User';
import { NotFoundError, ValidationError } from '../utils/errors';

const EXTENDED_PROFILE_LIMITS: Record<keyof UpdateUserExtendedInput, number> = {
  bio: 500,
  location: 100,
  career: 100,
  school: 100,
  mbti: 4,
  notes: 1000,
};

/**
 * 获取用户资料
 * @param userId - 用户 ID
 * @returns UserProfile
 */
export async function getUserProfile(userId: string): Promise<UserProfile> {
  const user = await userRepository.findById(userId);

  if (!user) {
    throw new NotFoundError('用户不存在');
  }

  return userRepository.toProfile(user);
}

/**
 * 更新用户资料
 * @param userId - 用户 ID
 * @param input - 更新数据
 * @returns UserProfile
 */
export async function updateUserProfile(userId: string, input: UpdateUserInput): Promise<UserProfile> {
  // 验证输入
  if (input.display_name !== undefined) {
    if (input.display_name.length > 50) {
      throw new Error('显示名称不能超过50个字符');
    }
  }

  const updatedUser = await userRepository.update(userId, input);

  return userRepository.toProfile(updatedUser);
}

/**
 * 更新用户扩展资料（职业、MBTI 等）
 * @param userId - 用户 ID
 * @param input - 扩展字段
 * @returns UserProfile
 */
export async function updateUserExtendedProfile(
  userId: string,
  input: UpdateUserExtendedInput,
): Promise<UserProfile> {
  const normalized: UpdateUserExtendedInput = {};

  for (const key of Object.keys(EXTENDED_PROFILE_LIMITS) as Array<keyof UpdateUserExtendedInput>) {
    const value = input[key];
    if (value === undefined) continue;

    const cleaned = typeof value === 'string' ? value.trim() : value;
    if (cleaned === '') {
      normalized[key] = null as any;
      continue;
    }

    if (typeof cleaned === 'string' && cleaned.length > EXTENDED_PROFILE_LIMITS[key]) {
      throw new ValidationError(`${key} 不能超过 ${EXTENDED_PROFILE_LIMITS[key]} 个字符`);
    }

    normalized[key] = cleaned as any;
  }

  // MBTI 格式校验：4位字母，如 INTJ / ENFP
  if (normalized.mbti !== undefined && normalized.mbti !== null) {
    if (!/^[EI][NS][TF][JP]$/i.test(normalized.mbti)) {
      throw new ValidationError('MBTI 格式不正确，应为4位字母（如 INTJ）');
    }
    normalized.mbti = normalized.mbti.toUpperCase();
  }

  const updatedUser = await userRepository.update(userId, normalized as any);
  return userRepository.toProfile(updatedUser);
}
