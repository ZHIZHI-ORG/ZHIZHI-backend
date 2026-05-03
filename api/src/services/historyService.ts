import {
  CreateHistoryRecordInput,
  HistoryRecord,
  HistoryRecordListQuery,
  HistoryRecordListResponse,
  HistoryRecordType,
} from '../models/HistoryRecord';
import { baziProfileRepository } from '../database/repositories/BaziProfileRepository';
import { historyRepository } from '../database/repositories/HistoryRepository';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';

const HISTORY_TYPES: HistoryRecordType[] = [
  'daily_fortune',
  'insight',
  'analysis',
  'drilldown',
  'bazi_chart',
];

function normalizePositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function assertDate(value: string | undefined, field: string): void {
  if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError(`${field} 必须是 YYYY-MM-DD 格式`);
  }
}

function validateDateRange(dateFrom?: string, dateTo?: string): void {
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new ValidationError('date_from 不能晚于 date_to');
  }
}

function validateType(type: unknown): HistoryRecordType {
  if (!HISTORY_TYPES.includes(type as HistoryRecordType)) {
    throw new ValidationError('历史类型不支持');
  }
  return type as HistoryRecordType;
}

function validateFavorited(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new ValidationError('favorited 必须是 true 或 false');
}

function normalizePayload(payload: Record<string, any>): Record<string, any> {
  const version = Number(payload.schema_version);
  return {
    ...payload,
    schema_version: Number.isInteger(version) && version > 0 ? version : 1,
  };
}

function buildDetailPreview(payload: Record<string, any>): Record<string, any> {
  if (payload.detail_preview && typeof payload.detail_preview === 'object') {
    return payload.detail_preview;
  }

  return {
    golden_sentence: payload.golden_sentence || payload.source_advice?.golden_sentence || null,
    detailed_content: payload.detailed_content || payload.answer || null,
  };
}

function toListItem(record: HistoryRecord) {
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    subtitle: record.subtitle,
    summary: record.summary,
    occurred_at: record.occurred_at,
    source_date: record.source_date,
    category: record.category,
    is_favorited: record.is_favorited,
    thumbnail_key: record.thumbnail_key,
    detail_preview: buildDetailPreview(record.payload || {}),
  };
}

async function assertBaziOwnership(userId: string, baziProfileId?: string | null): Promise<void> {
  if (!baziProfileId) return;

  const profile = await baziProfileRepository.findById(baziProfileId);
  if (!profile) {
    throw new NotFoundError('八字档案不存在');
  }
  if (profile.owner_user_id !== userId) {
    throw new ForbiddenError('无权使用此八字档案');
  }
}

async function getOwnedRecord(userId: string, id: string): Promise<HistoryRecord> {
  const record = await historyRepository.findById(userId, id);
  if (!record) {
    throw new NotFoundError('历史记录不存在');
  }
  return record;
}

async function createHistoryRecordFull(
  userId: string,
  input: CreateHistoryRecordInput,
): Promise<HistoryRecord> {
  validateType(input.type);
  assertDate(input.source_date || undefined, 'source_date');

  if (!input.title || input.title.trim().length === 0) {
    throw new ValidationError('历史标题不能为空');
  }
  if (input.title.length > 200) {
    throw new ValidationError('历史标题不能超过200个字符');
  }
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new ValidationError('payload 必须是对象');
  }

  await assertBaziOwnership(userId, input.bazi_profile_id);

  return historyRepository.create(userId, {
    ...input,
    title: input.title.trim(),
    payload: normalizePayload(input.payload),
  });
}

export async function listHistoryRecords(
  userId: string,
  rawQuery: Record<string, any>,
): Promise<HistoryRecordListResponse> {
  const page = normalizePositiveInt(rawQuery.page, 1, 100000);
  const pageSize = normalizePositiveInt(rawQuery.page_size, 20, 100);
  const type = rawQuery.type ? validateType(rawQuery.type) : undefined;
  const favorited = validateFavorited(rawQuery.favorited);
  const dateFrom = rawQuery.date_from as string | undefined;
  const dateTo = rawQuery.date_to as string | undefined;

  assertDate(dateFrom, 'date_from');
  assertDate(dateTo, 'date_to');
  validateDateRange(dateFrom, dateTo);

  const query: HistoryRecordListQuery = {
    page,
    page_size: pageSize,
    type,
    favorited,
    date_from: dateFrom,
    date_to: dateTo,
  };

  const { items, total } = await historyRepository.listByUser(userId, query);
  return {
    items: items.map(toListItem),
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
  };
}

export async function getHistoryRecord(userId: string, id: string) {
  const record = await getOwnedRecord(userId, id);
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    subtitle: record.subtitle,
    summary: record.summary,
    source_date: record.source_date,
    bazi_profile_id: record.bazi_profile_id,
    category: record.category,
    is_favorited: record.is_favorited,
    payload: record.payload,
    occurred_at: record.occurred_at,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export async function createHistoryRecord(
  userId: string,
  input: CreateHistoryRecordInput,
): Promise<{ id: string; created_at: string }> {
  const record = await createHistoryRecordFull(userId, input);

  return {
    id: record.id,
    created_at: record.created_at,
  };
}

export async function createOrGetHistoryRecord(
  userId: string,
  input: CreateHistoryRecordInput,
): Promise<HistoryRecord> {
  if (input.dedupe_key) {
    const existing = await historyRepository.findByDedupeKey(userId, input.dedupe_key);
    if (existing) return existing;
  }

  return createHistoryRecordFull(userId, input);
}

export async function setHistoryFavorite(userId: string, id: string, isFavorited: boolean) {
  await getOwnedRecord(userId, id);
  const updated = await historyRepository.setFavorite(userId, id, isFavorited);
  return {
    id: updated.id,
    is_favorited: updated.is_favorited,
    updated_at: updated.updated_at,
  };
}

export async function deleteHistoryRecord(userId: string, id: string) {
  await getOwnedRecord(userId, id);
  await historyRepository.softDelete(userId, id);
  return {
    id,
    deleted: true,
  };
}
