const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const inviteCodeService = require('../src/services/inviteCodeService');
const { inviteCodeRepository } = require('../src/database/repositories/InviteCodeRepository');
const { userRepository } = require('../src/database/repositories/UserRepository');

type AsyncFn = (...args: any[]) => Promise<any>;

const originalInviteMethods: Record<string, AsyncFn> = {
  findByCode: inviteCodeRepository.findByCode.bind(inviteCodeRepository),
  findByCreator: inviteCodeRepository.findByCreator.bind(inviteCodeRepository),
  findByCreatorAndPeriod: inviteCodeRepository.findByCreatorAndPeriod.bind(inviteCodeRepository),
  createForUser: inviteCodeRepository.createForUser.bind(inviteCodeRepository),
  createUsage: inviteCodeRepository.createUsage.bind(inviteCodeRepository),
  incrementUsedCount: inviteCodeRepository.incrementUsedCount.bind(inviteCodeRepository),
  findUsagesByCode: inviteCodeRepository.findUsagesByCode.bind(inviteCodeRepository),
  countUsagesByCodeSince: inviteCodeRepository.countUsagesByCodeSince.bind(inviteCodeRepository),
};

const originalUserMethods: Record<string, AsyncFn> = {
  findByIds: userRepository.findByIds.bind(userRepository),
};

function restoreMocks(): void {
  for (const [name, fn] of Object.entries(originalInviteMethods)) {
    inviteCodeRepository[name] = fn;
  }
  for (const [name, fn] of Object.entries(originalUserMethods)) {
    userRepository[name] = fn;
  }
}

function sampleInvite(overrides: Record<string, any> = {}) {
  return {
    id: 'invite-1',
    code: 'ZZABC123',
    created_by: 'user-1',
    used_count: 0,
    max_uses: 5,
    is_active: true,
    expires_at: '2099-01-01T00:00:00.000Z',
    period_start: '2026-05-10T16:00:00.000Z',
    period_end: '2026-05-17T16:00:00.000Z',
    note: null,
    created_at: '2026-05-14T00:00:00.000Z',
    ...overrides,
  };
}

async function run(name: string, fn: () => Promise<void>): Promise<void> {
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
  await run('current week invite code is reused instead of creating duplicates', async () => {
    let createCalls = 0;
    let capturedPeriodStart = '';
    inviteCodeRepository.findByCreatorAndPeriod = async (_userId: string, periodStart: string) => {
      capturedPeriodStart = periodStart;
      return sampleInvite({ period_start: periodStart });
    };
    inviteCodeRepository.createForUser = async () => {
      createCalls += 1;
      return sampleInvite();
    };

    const invite = await inviteCodeService.getUserInviteCode('user-1');

    assert.equal(invite.code, 'ZZABC123');
    assert.match(capturedPeriodStart, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(createCalls, 0);
  });

  await run('missing current week invite creates exactly one period-owned code', async () => {
    let captured: any;
    inviteCodeRepository.findByCreatorAndPeriod = async () => null;
    inviteCodeRepository.createForUser = async (userId: string, periodStart: string, periodEnd: string) => {
      captured = { userId, periodStart, periodEnd };
      return sampleInvite({ created_by: userId, period_start: periodStart, period_end: periodEnd, expires_at: periodEnd });
    };

    const invite = await inviteCodeService.getUserInviteCode('user-1');

    assert.equal(captured.userId, 'user-1');
    assert.ok(Date.parse(captured.periodEnd) > Date.parse(captured.periodStart));
    assert.equal(invite.expires_at, captured.periodEnd);
  });

  await run('concurrent current week creation falls back to the winning code', async () => {
    let reads = 0;
    inviteCodeRepository.findByCreatorAndPeriod = async () => {
      reads += 1;
      return reads === 1 ? null : sampleInvite({ code: 'ZZWINNER' });
    };
    inviteCodeRepository.createForUser = async () => {
      throw new Error('duplicate key value violates unique constraint');
    };

    const invite = await inviteCodeService.getUserInviteCode('user-1');

    assert.equal(invite.code, 'ZZWINNER');
  });

  await run('quota contract uses weekly usage count and exposes backend-owned remaining count', async () => {
    inviteCodeRepository.countUsagesByCodeSince = async (codeId: string, since: string) => {
      assert.equal(codeId, 'invite-1');
      assert.match(since, /^\d{4}-\d{2}-\d{2}T/);
      return 2;
    };

    const quota = await inviteCodeService.buildInviteQuotaContract(sampleInvite());

    assert.equal(quota.used_count, 2);
    assert.equal(quota.max_uses, 5);
    assert.equal(quota.remaining_count, 3);
    assert.equal(quota.reset_policy, 'weekly');
    assert.match(quota.reset_at, /\+08:00$/);
  });

  await run('invitation list keeps inviter trace and enriches frontend display fields', async () => {
    inviteCodeRepository.findByCreator = async () => [sampleInvite()];
    inviteCodeRepository.findUsagesByCode = async () => [
      {
        id: 'usage-1',
        invite_code_id: 'invite-1',
        used_by_user_id: 'user-2',
        used_at: '2026-05-14T06:00:00.000Z',
      },
    ];
    userRepository.findByIds = async (ids: string[]) => {
      assert.deepEqual(ids, ['user-2']);
      return [
        {
          id: 'user-2',
          email: 'friend@example.com',
          display_name: '好友',
        },
      ];
    };

    const records = await inviteCodeService.getUserInvitations('user-1');

    assert.equal(records.length, 1);
    assert.equal(records[0].id, 'usage-1');
    assert.equal(records[0].invite_code, 'ZZABC123');
    assert.equal(records[0].inviter_user_id, 'user-1');
    assert.equal(records[0].invited_user_id, 'user-2');
    assert.equal(records[0].email, 'friend@example.com');
    assert.equal(records[0].display_name, '好友');
    assert.equal(records[0].created_at, records[0].invited_at);
  });

  await run('expired weekly invite code is rejected', async () => {
    inviteCodeRepository.findByCode = async () => sampleInvite({
      expires_at: '2000-01-01T00:00:00.000Z',
    });

    const result = await inviteCodeService.checkInviteCode('ZZABC123');

    assert.equal(result.valid, false);
    assert.equal(result.message, '邀请码已过期');
  });

  console.log('Invite code service tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
