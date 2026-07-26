import type { BaziProfile } from '../models/BaziProfile';
import {
  DAILY_FORTUNE_WORK_STUDY_MODES,
  DailyFortuneProfileContext,
  DailyFortuneUserContext,
  DailyFortuneWorkStudyMode,
} from '../models/DailyFortuneContext';
import type { User } from '../models/User';
import { ValidationError } from './errors';

const MAX_TEXT_LENGTH = 160;
const MAX_TAG_COUNT = 8;
const MAX_TAG_LENGTH = 80;

/**
 * Validates the API payload before it becomes a persisted profile snapshot.
 * Empty objects deliberately clear the snapshot; arbitrary notes and event
 * logs are intentionally not accepted here.
 */
export function parseDailyFortuneProfileContextInput(
  value: unknown,
): DailyFortuneProfileContext {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    throw new ValidationError('daily_fortune_context 必须是对象');
  }
  assertOnlyKeys(value, [
    'life_stage',
    'work_study',
    'relationship',
    'zhizhi_understanding',
  ], 'daily_fortune_context');

  return compactObject({
    life_stage: parseLifeStage(value.life_stage),
    work_study: parseWorkStudy(value.work_study),
    relationship: parseRelationship(value.relationship),
    zhizhi_understanding: parseZhizhiUnderstanding(value.zhizhi_understanding),
  });
}

/**
 * Reads an existing database snapshot defensively. A malformed legacy value is
 * reduced to the valid subset instead of preventing the user from reading a
 * daily fortune.
 */
export function normalizeStoredDailyFortuneProfileContext(
  value: unknown,
): DailyFortuneProfileContext {
  try {
    return parseDailyFortuneProfileContextInput(value);
  } catch {
    return {};
  }
}

export function buildDailyFortuneUserContext(
  profile: BaziProfile,
  user: User | null,
): DailyFortuneUserContext {
  const context = normalizeStoredDailyFortuneProfileContext(
    profile.daily_fortune_context,
  );
  const account = profile.is_owner ? user : null;
  const lifeStage = context.life_stage;
  const workStudy = context.work_study;
  const relationship = context.relationship;
  const zhizhi = context.zhizhi_understanding;

  return {
    declared: {
      mbti: textOrNull(profile.mbti) ?? textOrNull(account?.mbti),
      life_stage: {
        primary: textOrNull(lifeStage?.primary),
        tags: normalizedTags(lifeStage?.tags),
      },
      work_study: {
        mode: workStudy?.mode ?? null,
        career_status: textOrNull(workStudy?.career_status),
        occupation: textOrNull(workStudy?.occupation) ?? textOrNull(account?.career),
        industry: textOrNull(workStudy?.industry),
        study_status: textOrNull(workStudy?.study_status),
        school: textOrNull(workStudy?.school) ?? textOrNull(account?.school),
        current_goal: textOrNull(workStudy?.current_goal),
      },
      relationship: {
        status: textOrNull(relationship?.status),
        current_focus: textOrNull(relationship?.current_focus),
      },
    },
    zhizhi_understanding: {
      snapshot_version: textOrNull(zhizhi?.snapshot_version),
      current_focus: normalizedTags(zhizhi?.current_focus),
      expression_preferences: normalizedTags(zhizhi?.expression_preferences),
      behavior_signals: normalizedTags(zhizhi?.behavior_signals),
      updated_at: textOrNull(zhizhi?.updated_at),
    },
  };
}

function parseLifeStage(value: unknown): DailyFortuneProfileContext['life_stage'] {
  if (value === undefined || value === null) return undefined;
  const record = expectRecord(value, 'daily_fortune_context.life_stage');
  assertOnlyKeys(record, ['primary', 'tags'], 'daily_fortune_context.life_stage');
  return compactObject({
    primary: nullableText(record.primary, 'daily_fortune_context.life_stage.primary'),
    tags: tags(record.tags, 'daily_fortune_context.life_stage.tags'),
  });
}

function parseWorkStudy(value: unknown): DailyFortuneProfileContext['work_study'] {
  if (value === undefined || value === null) return undefined;
  const record = expectRecord(value, 'daily_fortune_context.work_study');
  assertOnlyKeys(record, [
    'mode',
    'career_status',
    'occupation',
    'industry',
    'study_status',
    'school',
    'current_goal',
  ], 'daily_fortune_context.work_study');
  return compactObject({
    mode: nullableMode(record.mode),
    career_status: nullableText(record.career_status, 'daily_fortune_context.work_study.career_status'),
    occupation: nullableText(record.occupation, 'daily_fortune_context.work_study.occupation'),
    industry: nullableText(record.industry, 'daily_fortune_context.work_study.industry'),
    study_status: nullableText(record.study_status, 'daily_fortune_context.work_study.study_status'),
    school: nullableText(record.school, 'daily_fortune_context.work_study.school'),
    current_goal: nullableText(record.current_goal, 'daily_fortune_context.work_study.current_goal'),
  });
}

function parseRelationship(value: unknown): DailyFortuneProfileContext['relationship'] {
  if (value === undefined || value === null) return undefined;
  const record = expectRecord(value, 'daily_fortune_context.relationship');
  assertOnlyKeys(record, ['status', 'current_focus'], 'daily_fortune_context.relationship');
  return compactObject({
    status: nullableText(record.status, 'daily_fortune_context.relationship.status'),
    current_focus: nullableText(record.current_focus, 'daily_fortune_context.relationship.current_focus'),
  });
}

function parseZhizhiUnderstanding(
  value: unknown,
): DailyFortuneProfileContext['zhizhi_understanding'] {
  if (value === undefined || value === null) return undefined;
  const record = expectRecord(value, 'daily_fortune_context.zhizhi_understanding');
  assertOnlyKeys(record, [
    'snapshot_version',
    'current_focus',
    'expression_preferences',
    'behavior_signals',
    'updated_at',
  ], 'daily_fortune_context.zhizhi_understanding');
  return compactObject({
    snapshot_version: nullableText(record.snapshot_version, 'daily_fortune_context.zhizhi_understanding.snapshot_version'),
    current_focus: tags(record.current_focus, 'daily_fortune_context.zhizhi_understanding.current_focus'),
    expression_preferences: tags(record.expression_preferences, 'daily_fortune_context.zhizhi_understanding.expression_preferences'),
    behavior_signals: tags(record.behavior_signals, 'daily_fortune_context.zhizhi_understanding.behavior_signals'),
    updated_at: nullableText(record.updated_at, 'daily_fortune_context.zhizhi_understanding.updated_at'),
  });
}

function nullableMode(value: unknown): DailyFortuneWorkStudyMode | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !DAILY_FORTUNE_WORK_STUDY_MODES.includes(value as DailyFortuneWorkStudyMode)) {
    throw new ValidationError('daily_fortune_context.work_study.mode 无效');
  }
  return value as DailyFortuneWorkStudyMode;
}

function nullableText(value: unknown, path: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError(`${path} 必须是字符串或 null`);
  }
  const normalized = value.trim();
  if (normalized.length > MAX_TEXT_LENGTH) {
    throw new ValidationError(`${path} 最长 ${MAX_TEXT_LENGTH} 个字符`);
  }
  return normalized || null;
}

function tags(value: unknown, path: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > MAX_TAG_COUNT) {
    throw new ValidationError(`${path} 必须是不超过 ${MAX_TAG_COUNT} 项的数组`);
  }
  const values = value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new ValidationError(`${path}[${index}] 必须是字符串`);
    }
    const normalized = item.trim();
    if (!normalized || normalized.length > MAX_TAG_LENGTH) {
      throw new ValidationError(`${path}[${index}] 长度无效`);
    }
    return normalized;
  });
  return [...new Set(values)];
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ValidationError(`${path} 必须是对象`);
  }
  return value;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
): void {
  const unsupported = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unsupported.length > 0) {
    throw new ValidationError(`${path} 不支持字段：${unsupported.join(', ')}`);
  }
}

function normalizedTags(value: string[] | undefined): string[] {
  return Array.isArray(value) ? [...new Set(value.map((item) => item.trim()).filter(Boolean))] : [];
}

function textOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function compactObject<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
