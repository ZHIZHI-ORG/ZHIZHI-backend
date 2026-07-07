const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';

const { supabase, checkDatabaseHealth } = require('../src/database/supabase');
const { formatError, ServiceUnavailableError } = require('../src/utils/errors');

const originalFrom = supabase.from.bind(supabase);

function restoreMocks(): void {
  supabase.from = originalFrom;
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

  console.log('Auth infrastructure tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
