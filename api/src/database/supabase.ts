/**
 * Supabase 客户端配置
 * 类似于 Java 中的 DataSource 配置
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// 环境变量配置
const supabaseUrl = cleanEnvValue(process.env.SUPABASE_URL || '');
const supabaseAnonKey = cleanEnvValue(process.env.SUPABASE_ANON_KEY || '');
const supabaseServiceKey = cleanEnvValue(process.env.SUPABASE_SERVICE_KEY || '');
const supabaseRequestTimeoutMs = Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS || 5000);

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('缺少 Supabase 环境变量配置，请检查 .env 文件');
}

function cleanEnvValue(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

export async function fetchWithTimeout(
  input: FetchInput,
  init: FetchInit = {},
  timeoutMs: number = supabaseRequestTimeoutMs,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (init?.signal) {
    if (init.signal.aborted) {
      controller.abort();
    } else {
      init.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSupabaseAuth(path: string, init: FetchInit = {}): Promise<Response> {
  const authKey = supabaseAnonKey || supabaseServiceKey;
  const url = new URL(path.replace(/^\//, ''), `${supabaseUrl.replace(/\/$/, '')}/auth/v1/`);
  const headers = new Headers(init?.headers);

  if (!headers.has('apikey')) {
    headers.set('apikey', authKey);
  }
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${authKey}`);
  }

  return fetchWithTimeout(url, {
    ...init,
    headers,
  });
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
  global: {
    fetch: fetchWithTimeout,
  },
});

/**
 * 为认证流程创建独立的服务端客户端。
 * 避免全局 client 在 signIn / verifyOtp 后切换到用户 session。
 */
export function createServiceSupabaseClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: fetchWithTimeout,
    },
  });
}

/**
 * 创建带用户上下文的 Supabase 客户端
 * 用于需要遵循 RLS 策略的操作
 * @param userToken - 用户的 JWT token
 */
export function createUserSupabaseClient(userToken: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      fetch: fetchWithTimeout,
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
    const { error } = await supabase.from('users').select('id').limit(1);
    return !error;
  } catch (error) {
    console.error('数据库健康检查失败:', error);
    return false;
  }
}
