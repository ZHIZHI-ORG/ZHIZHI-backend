/**
 * 用户服务层（Service）
 * 处理用户资料的查询和更新
 */
import { userRepository } from '../database/repositories/UserRepository';
import { UpdateUserInput, UserProfile } from '../models/User';
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
