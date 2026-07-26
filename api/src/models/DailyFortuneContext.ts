export const DAILY_FORTUNE_WORK_STUDY_MODES = [
  'career',
  'study',
  'both',
  'transition',
  'none',
] as const;

export type DailyFortuneWorkStudyMode =
  typeof DAILY_FORTUNE_WORK_STUDY_MODES[number];

/**
 * Per-profile facts that make a daily-fortune interpretation situationally
 * useful. They are never deterministic 命理 inputs: the AI can only use them
 * to map an already-supported change to a user's real-life setting.
 */
export interface DailyFortuneProfileContext {
  life_stage?: {
    primary?: string | null;
    tags?: string[];
  };
  work_study?: {
    mode?: DailyFortuneWorkStudyMode | null;
    career_status?: string | null;
    occupation?: string | null;
    industry?: string | null;
    study_status?: string | null;
    school?: string | null;
    current_goal?: string | null;
  };
  relationship?: {
    status?: string | null;
    current_focus?: string | null;
  };
  zhizhi_understanding?: {
    snapshot_version?: string | null;
    current_focus?: string[];
    expression_preferences?: string[];
    behavior_signals?: string[];
    updated_at?: string | null;
  };
}

export interface DailyFortuneUserContext {
  declared: {
    mbti: string | null;
    life_stage: {
      primary: string | null;
      tags: string[];
    };
    work_study: {
      mode: DailyFortuneWorkStudyMode | null;
      career_status: string | null;
      occupation: string | null;
      industry: string | null;
      study_status: string | null;
      school: string | null;
      current_goal: string | null;
    };
    relationship: {
      status: string | null;
      current_focus: string | null;
    };
  };
  zhizhi_understanding: {
    snapshot_version: string | null;
    current_focus: string[];
    expression_preferences: string[];
    behavior_signals: string[];
    updated_at: string | null;
  };
}
