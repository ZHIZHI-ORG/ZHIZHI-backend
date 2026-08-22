const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';

const supabaseModule = require('../src/database/supabase');
const { supabase, checkDatabaseHealth } = supabaseModule;
const { userRepository } = require('../src/database/repositories/UserRepository');
const { registerUser, resetPassword, logoutUser } = require('../src/services/authService');
const { formatError, ServiceUnavailableError } = require('../src/utils/errors');

const originalFrom = supabase.from.bind(supabase);
const originalCreateServiceSupabaseClient = supabaseModule.createServiceSupabaseClient;
const originalCreateUserSupabaseClient = supabaseModule.createUserSupabaseClient;
const originalUserCreate = userRepository.create.bind(userRepository);

function restoreMocks(): void {
  supabase.from = originalFrom;
  supabaseModule.createServiceSupabaseClient = originalCreateServiceSupabaseClient;
  supabaseModule.createUserSupabaseClient = originalCreateUserSupabaseClient;
  userRepository.create = originalUserCreate;
}

async function run(name: string, fn: () => Promise<void> | void): Promise<void> {
  restoreMocks();
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  } finally {
    restoreMocks();
  }
}

async function main(): Promise<void> {
  await run('database health checks a real users column', async () => {
    supabase.from = (tableName: string) => {
      assert.equal(tableName, 'users');
      return {
        select(columns: string) {
          assert.equal(columns, 'id');
          return {
            async limit(limit: number) {
              assert.equal(limit, 1);
              return { data: [], error: null };
            },
          };
        },
      };
    };

    const healthy = await checkDatabaseHealth();

    assert.equal(healthy, true);
  });

  await run('database health reports false on query errors', async () => {
    supabase.from = () => ({
      select() {
        return {
          async limit() {
            return { data: null, error: { message: 'fetch failed' } };
          },
        };
      },
    });

    const healthy = await checkDatabaseHealth();

    assert.equal(healthy, false);
  });

  await run('service unavailable errors map to 503 responses', () => {
    const response = formatError(new ServiceUnavailableError('认证服务暂时不可用，请稍后重试'));

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.error.code, 'SERVICE_UNAVAILABLE');
    assert.equal(response.body.error.message, '认证服务暂时不可用，请稍后重试');
  });

  await run('verified registration persists the password before creating the business user', async () => {
    const userId = '12345678-1234-4234-8234-123456789012';
    const accessToken = 'verified-otp-access-token';
    const password = 'StrongPass123!';
    let persistedPassword: string | undefined;

    supabaseModule.createServiceSupabaseClient = () => ({
      auth: {
        async verifyOtp() {
          return {
            data: {
              user: { id: userId },
              session: {
                access_token: accessToken,
                refresh_token: 'refresh-token',
              },
            },
            error: null,
          };
        },
        async updateUser(input: { password?: string }) {
          persistedPassword = input.password;
          return { data: {}, error: null };
        },
      },
    });
    userRepository.create = async (input: {
      id: string;
      email: string;
      display_name?: string;
      is_email_verified?: boolean;
    }) => {
      assert.equal(persistedPassword, password);
      assert.equal(input.is_email_verified, true);
      return {
        ...input,
        is_active: true,
        is_email_verified: true,
        bazi_profile_count: 0,
        created_at: '2026-08-09T00:00:00.000Z',
        updated_at: '2026-08-09T00:00:00.000Z',
      };
    };

    const result = await registerUser({
      email: 'registration-test@zhizhi.app',
      password,
      verification_code: '123456',
    });

    assert.equal(result.user.is_email_verified, true);
  });

  await run('password recovery updates the password on the OTP-verified client', async () => {
    const password = 'RecoveredPass123!';
    let persistedPassword: string | undefined;

    supabaseModule.createServiceSupabaseClient = () => ({
      auth: {
        async verifyOtp() {
          return {
            data: {
              session: {
                access_token: 'recovery-access-token',
                refresh_token: 'recovery-refresh-token',
              },
            },
            error: null,
          };
        },
        async updateUser(input: { password?: string }) {
          persistedPassword = input.password;
          return { data: {}, error: null };
        },
      },
    });

    await resetPassword({
      email: 'password-recovery-test@zhizhi.app',
      verification_code: '654321',
      new_password: password,
    });

    assert.equal(persistedPassword, password);
  });

  await run('ordinary logout revokes only the current device session', async () => {
    const accessToken = 'current-device-access-token';
    let receivedAccessToken: string | undefined;
    let receivedScope: string | undefined;

    supabaseModule.createUserSupabaseClient = (token: string) => {
      receivedAccessToken = token;
      return {
        auth: {
          async signOut(options: { scope?: string }) {
            receivedScope = options.scope;
            return { error: null };
          },
        },
      };
    };

    await logoutUser(accessToken);

    assert.equal(receivedAccessToken, accessToken);
    assert.equal(receivedScope, 'local');
  });

  console.log('Auth infrastructure tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
