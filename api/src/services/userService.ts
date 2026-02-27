/**
 * 用户服务层（Service）
 * 处理用户资料的查询和更新
 */
import { userRepository } from '../database/repositories/UserRepository';
import { UpdateUserInput, UpdateUserExtendedInput, UserProfile } from '../models/User';
import { NotFoundError } from '../utils/errors';

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
  // MBTI 格式校验：4位字母，如 INTJ / ENFP
  if (input.mbti !== undefined && input.mbti !== '') {
    if (!/^[EI][NS][TF][JP]$/i.test(input.mbti)) {
      throw new Error('MBTI 格式不正确，应为4位字母（如 INTJ）');
    }
    input.mbti = input.mbti.toUpperCase();
  }

  const updatedUser = await userRepository.update(userId, input as any);
  return userRepository.toProfile(updatedUser);
}
