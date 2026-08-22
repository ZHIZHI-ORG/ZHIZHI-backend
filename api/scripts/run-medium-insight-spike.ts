import 'dotenv/config';
import {
  MEDIUM_INSIGHT_DOMAINS,
  MEDIUM_INSIGHT_CONTEXT_VERSION,
  MEDIUM_INSIGHT_FACT_VERSION,
  MediumInsightFactSnapshot,
  MediumInsightRecentCard,
} from '../src/models/MediumInsight';
import { generateMediumInsightsWithAi } from '../src/utils/mediumInsightAi';

interface RunResult {
  index: number;
  ok: boolean;
  duration_ms: number;
  response_bytes?: number;
  prompt_tokens?: number | null;
  output_tokens?: number | null;
  error?: string;
}

async function main(): Promise<void> {
  const runs = readIntArg('--runs', 30);
  const concurrency = readIntArg('--concurrency', 2);
  const fullHistoryEvery = readIntArg('--full-history-every', 10);
  const queue = Array.from({ length: runs }, (_, index) => index);
  const results: RunResult[] = [];

  await Promise.all(Array.from({ length: Math.min(concurrency, runs) }, async () => {
    while (queue.length > 0) {
      const index = queue.shift();
      if (index === undefined) return;
      const startedAt = Date.now();
      try {
        const result = await generateMediumInsightsWithAi({
          snapshot: fixtureSnapshot(index),
          groundingContext: fixtureGroundingContext(index),
          recentCards: fullHistoryEvery > 0 && (index + 1) % fullHistoryEvery === 0
            ? fixtureHistory()
            : [],
        });
        const run: RunResult = {
          index: index + 1,
          ok: true,
          duration_ms: result.metrics.duration_ms,
          response_bytes: result.metrics.provider_response_bytes,
          prompt_tokens: result.metrics.prompt_tokens,
          output_tokens: result.metrics.output_tokens,
        };
        results.push(run);
        console.log(JSON.stringify(run));
      } catch (error) {
        const run: RunResult = {
          index: index + 1,
          ok: false,
          duration_ms: Date.now() - startedAt,
          error: error instanceof Error ? `${error.name}:${error.message}` : 'unknown',
        };
        results.push(run);
        console.log(JSON.stringify(run));
      }
    }
  }));

  const sorted = [...results].sort((left, right) => left.duration_ms - right.duration_ms);
  const success = results.filter((result) => result.ok);
  const summary = {
    runs,
    success: success.length,
    failed: runs - success.length,
    p50_ms: percentile(sorted.map((item) => item.duration_ms), 0.5),
    p95_ms: percentile(sorted.map((item) => item.duration_ms), 0.95),
    max_ms: sorted.at(-1)?.duration_ms ?? 0,
    max_response_bytes: Math.max(0, ...success.map((item) => item.response_bytes ?? 0)),
    schema_complexity_errors: results.filter((item) => item.error?.toLowerCase().includes('schema')).length,
    passed: success.length >= Math.ceil(runs * 0.9666)
      && percentile(sorted.map((item) => item.duration_ms), 0.95) <= 30_000
      && (sorted.at(-1)?.duration_ms ?? Infinity) < 90_000
      && Math.max(0, ...success.map((item) => item.response_bytes ?? 0)) < 256 * 1024,
  };
  console.log(JSON.stringify({ summary }));
  if (!summary.passed) process.exitCode = 1;
}

function fixtureSnapshot(index: number): MediumInsightFactSnapshot {
  const variant = index % 3;
  const pillarSets = [
    ['甲子', '丁卯', '庚申', '辛巳'],
    ['乙丑', '戊辰', '壬午'],
    ['丙寅', '己未', '癸酉', '甲寅'],
  ];
  const pillars = pillarSets[variant];
  const facts = [
    { source: 'day_master' as const, canonical_source: 'natal.day_master', canonical_text: `日主为${['庚金', '壬水', '癸水'][variant]}`, relation: null, participants: [pillars[2][0]], scope: 'natal', time_horizon: 'baseline' as const, full_match: null, conditions: [] },
    ...pillars.map((pillar, pillarIndex) => ({ source: 'natal_pillar' as const, canonical_source: `natal.pillar.${pillarIndex}`, canonical_text: `${['年', '月', '日', '时'][pillarIndex]}柱${pillar}，天干与日主的十神分别体现资源、表达、责任与交换方式`, relation: null, participants: [pillar], scope: `natal_${pillarIndex}`, time_horizon: 'baseline' as const, full_match: null, conditions: [] })),
    { source: 'dayun' as const, canonical_source: 'timing.dayun', canonical_text: `当前大运${['壬午', '庚戌', '乙卯'][variant]}，用于解释当前十年背景而非具体日期结果`, relation: null, participants: [['壬午', '庚戌', '乙卯'][variant]], scope: 'dayun', time_horizon: 'ten_years' as const, full_match: null, conditions: [] },
    { source: 'natal_interaction' as const, canonical_source: 'natal.interaction.1', canonical_text: '原局月支与日支存在相互牵动的地支关系，关系强度取决于实际参与者', relation: ['branch_clash', 'branch_harm', 'branch_combine'][variant], participants: [pillars[1], pillars[2]], scope: 'natal', time_horizon: 'baseline' as const, full_match: true, conditions: ['adjacent'] },
    { source: 'dayun_interaction' as const, canonical_source: 'dayun.interaction.1', canonical_text: '当前大运与原局月柱形成十年层面的作用关系，可放大长期角色与环境议题', relation: ['stem_combine', 'branch_clash', 'branch_same'][variant], participants: [['壬午', '庚戌', '乙卯'][variant], pillars[1]], scope: 'dayun_to_natal', time_horizon: 'ten_years' as const, full_match: true, conditions: ['activated_palace:month'] },
  ];
  return {
    version: MEDIUM_INSIGHT_FACT_VERSION,
    effective_date: '2026-08-13',
    profile_id: `00000000-0000-4000-8000-${String(variant + 1).padStart(12, '0')}`,
    profile_updated_at: '2026-08-13T00:00:00.000Z',
    facts: facts.map((fact, factIndex) => ({ ref: `F${factIndex + 1}`, ...fact })),
  };
}

function fixtureGroundingContext(index: number) {
  const variant = index % 3;
  return {
    version: MEDIUM_INSIGHT_CONTEXT_VERSION,
    user_context: {
      declared: {
        mbti: ['INTJ', 'ISFP', null][variant],
        life_stage: { primary: ['building', 'transition', null][variant], tags: [] },
        work_study: {
          mode: ['career', 'study', 'both'][variant], career_status: null,
          occupation: null, industry: null, study_status: null, school: null, current_goal: null,
        },
        relationship: { status: ['single', 'relationship', null][variant], current_focus: null },
      },
      zhizhi_understanding: {
        snapshot_version: null, current_focus: [], expression_preferences: [], behavior_signals: [], updated_at: null,
      },
    },
  };
}

function fixtureHistory(): MediumInsightRecentCard[] {
  return MEDIUM_INSIGHT_DOMAINS.flatMap((domain) => Array.from({ length: 112 }, (_, index) => ({
    domain,
    title: `既有角度${String(index + 1).padStart(3, '0')}`,
    preview: `这是${domain}领域用于压力测试输入体积的既有表达编号${String(index + 1).padStart(3, '0')}，不要复述。`,
  })));
}

function readIntArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1);
  return values[index];
}

void main();
