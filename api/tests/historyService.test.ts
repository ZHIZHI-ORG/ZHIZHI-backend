import type { HistoryRecord } from '../src/models/HistoryRecord';

const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const historyService = require('../src/services/historyService');
const fortuneService = require('../src/services/fortuneService');
const { historyRepository } = require('../src/database/repositories/HistoryRepository');
const { baziProfileRepository } = require('../src/database/repositories/BaziProfileRepository');
const { userInteractionRepository } = require('../src/database/repositories/UserInteractionRepository');

type AsyncFn = (...args: any[]) => Promise<any>;

const originalHistoryMethods: Record<string, AsyncFn> = {
  listByUser: historyRepository.listByUser.bind(historyRepository),
  findById: historyRepository.findById.bind(historyRepository),
  findByDedupeKey: historyRepository.findByDedupeKey.bind(historyRepository),
  create: historyRepository.create.bind(historyRepository),
  setFavorite: historyRepository.setFavorite.bind(historyRepository),
  softDelete: historyRepository.softDelete.bind(historyRepository),
};

const originalBaziFindById = baziProfileRepository.findById.bind(baziProfileRepository);
const originalUserInteractionWeights = userInteractionRepository.getCategoryWeights.bind(userInteractionRepository);

function restoreMocks(): void {
  for (const [name, fn] of Object.entries(originalHistoryMethods)) {
    historyRepository[name] = fn;
  }
  baziProfileRepository.findById = originalBaziFindById;
  userInteractionRepository.getCategoryWeights = originalUserInteractionWeights;
}

function sampleRecord(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: 'history-1',
    user_id: 'user-1',
    bazi_profile_id: 'bazi-1',
    type: 'analysis',
    category: 'career',
    title: '事业发展',
    subtitle: null,
    summary: '今日适合收束方案。',
    source_date: '2026-05-03',
    payload: {
      schema_version: 1,
      detail_preview: {
        golden_sentence: '收束生金',
        detailed_content: '今日适合把方案细节补齐。',
      },
    },
    thumbnail_key: null,
    is_favorited: false,
    occurred_at: '2026-05-03T08:30:00Z',
    created_at: '2026-05-03T08:30:00Z',
    updated_at: '2026-05-03T08:30:00Z',
    deleted_at: null,
    dedupe_key: 'analysis:bazi-1:2026-05-03:career',
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
  }
}

async function main(): Promise<void> {
  await run('list validates filters and returns preview-only items', async () => {
    let capturedQuery: any;
    historyRepository.listByUser = async (userId: string, query: any) => {
      assert.equal(userId, 'user-1');
      capturedQuery = query;
      return { items: [sampleRecord()], total: 1 };
    };

    const result = await historyService.listHistoryRecords('user-1', {
      page: '2',
      page_size: '10',
      type: 'analysis',
      favorited: 'false',
      date_from: '2026-05-01',
      date_to: '2026-05-03',
    });

    assert.deepEqual(capturedQuery, {
      page: 2,
      page_size: 10,
      type: 'analysis',
      favorited: false,
      date_from: '2026-05-01',
      date_to: '2026-05-03',
    });
    assert.equal(result.total_pages, 1);
    assert.equal(result.items[0].detail_preview.golden_sentence, '收束生金');
    assert.equal(Object.prototype.hasOwnProperty.call(result.items[0], 'payload'), false);
  });

  await run('list rejects invalid query values', async () => {
    await assert.rejects(
      () => historyService.listHistoryRecords('user-1', { favorited: 'maybe' }),
      /favorited 必须是 true 或 false/,
    );
    await assert.rejects(
      () => historyService.listHistoryRecords('user-1', { date_from: '2026/05/03' }),
      /date_from 必须是 YYYY-MM-DD 格式/,
    );
    await assert.rejects(
      () => historyService.listHistoryRecords('user-1', {
        date_from: '2026-05-04',
        date_to: '2026-05-03',
      }),
      /date_from 不能晚于 date_to/,
    );
  });

  await run('create trims title, enforces bazi ownership, and normalizes schema version', async () => {
    baziProfileRepository.findById = async (id: string) => ({
      id,
      owner_user_id: 'user-1',
    });
    let createdInput: any;
    historyRepository.create = async (userId: string, input: any) => {
      assert.equal(userId, 'user-1');
      createdInput = input;
      return sampleRecord({
        id: 'created-1',
        title: input.title,
        payload: input.payload,
        created_at: '2026-05-03T09:00:00Z',
      });
    };

    const result = await historyService.createHistoryRecord('user-1', {
      type: 'analysis',
      title: '  事业发展  ',
      source_date: '2026-05-03',
      bazi_profile_id: 'bazi-1',
      payload: { schema_version: 0, card: {} },
    });

    assert.equal(result.id, 'created-1');
    assert.equal(createdInput.title, '事业发展');
    assert.equal(createdInput.payload.schema_version, 1);
  });

  await run('create rejects records for another user bazi profile', async () => {
    baziProfileRepository.findById = async (id: string) => ({
      id,
      owner_user_id: 'user-2',
    });

    await assert.rejects(
      () => historyService.createHistoryRecord('user-1', {
        type: 'analysis',
        title: '事业发展',
        bazi_profile_id: 'bazi-2',
        payload: { schema_version: 1 },
      }),
      /无权使用此八字档案/,
    );
  });

  await run('createOrGet returns existing deduped record without creating duplicates', async () => {
    let createCalls = 0;
    historyRepository.findByDedupeKey = async () => sampleRecord({ id: 'existing-1' });
    historyRepository.create = async () => {
      createCalls += 1;
      return sampleRecord({ id: 'created-1' });
    };

    const result = await historyService.createOrGetHistoryRecord('user-1', {
      type: 'analysis',
      title: '事业发展',
      dedupe_key: 'same-key',
      payload: { schema_version: 1 },
    });

    assert.equal(result.id, 'existing-1');
    assert.equal(createCalls, 0);
  });

  await run('createOrGet returns the newly created row when no dedupe match exists', async () => {
    historyRepository.findByDedupeKey = async () => null;
    historyRepository.create = async () => sampleRecord({ id: 'created-1' });

    const result = await historyService.createOrGetHistoryRecord('user-1', {
      type: 'analysis',
      title: '事业发展',
      dedupe_key: 'new-key',
      payload: { schema_version: 1 },
    });

    assert.equal(result.id, 'created-1');
  });

  await run('detail, favorite, and delete are user-scoped', async () => {
    const calls: string[] = [];
    historyRepository.findById = async (userId: string, id: string) => {
      calls.push(`find:${userId}:${id}`);
      return sampleRecord({ id, user_id: userId });
    };
    historyRepository.setFavorite = async (userId: string, id: string, value: boolean) => {
      calls.push(`favorite:${userId}:${id}:${value}`);
      return sampleRecord({ id, user_id: userId, is_favorited: value });
    };
    historyRepository.softDelete = async (userId: string, id: string) => {
      calls.push(`delete:${userId}:${id}`);
    };

    const detail = await historyService.getHistoryRecord('user-1', 'history-1');
    const favorite = await historyService.setHistoryFavorite('user-1', 'history-1', true);
    const deleted = await historyService.deleteHistoryRecord('user-1', 'history-1');

    assert.equal(detail.id, 'history-1');
    assert.equal(favorite.is_favorited, true);
    assert.equal(deleted.deleted, true);
    assert.deepEqual(calls, [
      'find:user-1:history-1',
      'find:user-1:history-1',
      'favorite:user-1:history-1:true',
      'find:user-1:history-1',
      'delete:user-1:history-1',
    ]);
  });

  await run('detail returns not found when user-scoped lookup misses', async () => {
    historyRepository.findById = async () => null;

    await assert.rejects(
      () => historyService.getHistoryRecord('user-1', 'missing-history'),
      /历史记录不存在/,
    );
  });

  await run('insight detail writes one replayable analysis history record', async () => {
    const createdInputs: any[] = [];
    baziProfileRepository.findById = async (id: string) => ({
      id,
      owner_user_id: 'user-1',
      name: '本人',
      is_owner: true,
      birth_year: 1995,
      birth_month: 10,
      birth_day: 10,
      is_lunar: false,
      birth_timezone: 'Asia/Shanghai',
      day_master: '庚',
      day_master_element: '金',
      created_at: '2026-05-03T00:00:00Z',
      updated_at: '2026-05-03T00:00:00Z',
    });
    userInteractionRepository.getCategoryWeights = async () => [];
    historyRepository.findByDedupeKey = async () => null;
    historyRepository.create = async (userId: string, input: any) => {
      createdInputs.push({ userId, input });
      return sampleRecord({
        id: `created-${createdInputs.length}`,
        user_id: userId,
        type: input.type,
        title: input.title,
        source_date: input.source_date,
        bazi_profile_id: input.bazi_profile_id,
        category: input.category,
        payload: input.payload,
        dedupe_key: input.dedupe_key,
      });
    };

    const result = await fortuneService.getInsightDetail('user-1', 'career', 'bazi-1');
    const analysisWrite = createdInputs.find((item) => item.input.type === 'analysis');

    assert.equal(result.category, 'career');
    assert.equal(result.history_record_id, 'created-2');
    assert.ok(analysisWrite, 'analysis history write should exist');
    assert.equal(analysisWrite.input.dedupe_key, `insight_detail:bazi-1:${result.date}:career`);
    assert.equal(analysisWrite.input.payload.schema_version, 1);
    assert.equal(analysisWrite.input.payload.source_type, 'insight_detail');
    assert.equal(analysisWrite.input.payload.category, 'career');
    assert.ok(Array.isArray(analysisWrite.input.payload.cards));
    assert.ok(analysisWrite.input.payload.detail_preview.golden_sentence);
  });

  restoreMocks();
  console.log('History service tests passed');
}

main().catch((error) => {
  restoreMocks();
  console.error(error);
  process.exit(1);
});
