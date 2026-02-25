/**
 * Supabase 客户端配置
 * 类似于 Java 中的 DataSource 配置
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// 环境变量配置
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('缺少 Supabase 环境变量配置，请检查 .env 文件');
}

/**
 * Supabase 客户端实例（使用 Service Role Key）
 * 拥有完整的数据库访问权限，绕过 RLS 策略
 * 注意：仅在服务端使用，不要暴露给前端
 */
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/**
 * 创建带用户上下文的 Supabase 客户端
 * 用于需要遵循 RLS 策略的操作
 * @param userToken - 用户的 JWT token
 */
export function createUserSupabaseClient(userToken: string): SupabaseClient {
  return createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY || '', {
    global: {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    },
  });
}

/**
 * 数据库健康检查
 * 类似于 Spring Boot 的 HealthIndicator
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    // 查询 users 表（项目实际使用的表，非 Supabase 默认的 profiles 表）
    const { error } = await supabase.from('users').select('count').limit(1);
    return !error;
  } catch (error) {
    console.error('数据库健康检查失败:', error);
    return false;
  }
}
