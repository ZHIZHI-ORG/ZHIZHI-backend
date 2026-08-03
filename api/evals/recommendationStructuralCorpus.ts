/**
 * Fixed, offline structural evaluation corpus for Recommendation V1.
 *
 * These are intentionally not claims about a live Gemini model's 命理 quality.
 * They make the non-negotiable product boundaries executable: factual refs,
 * three-pillar preservation, bounded valid time windows, explicit reality and
 * preference context, time-window memory, and the P1/P2 roles the model may emit.
 */

export type RecommendationEvalHorizon = 'baseline' | 'phase' | 'year' | 'month';

export interface RecommendationStructuralEvalCase {
  id: string;
  domain: 'love' | 'career' | 'wealth' | 'health' | 'study';
  topicKey: string;
  questionJob: 'describe' | 'explain' | 'forecast' | 'compare' | 'act';
  horizon: RecommendationEvalHorizon;
  relationshipStatus: 'single' | 'dating' | 'married' | 'unknown';
  unknownHour: boolean;
  preferenceWindow: 'none' | 'long_term' | 'recent' | 'session';
  factRef: string;
  expectedValidity: { validFrom: string; validUntil: string | null };
  expectedSelectionRole:
    | 'p1_mingli_change'
    | 'p2_interest_match'
    | 'p2_baseline';
}

const domains = [
  { domain: 'love', topicKey: 'conflict_and_repair' },
  { domain: 'career', topicKey: 'opportunity_and_change' },
  { domain: 'wealth', topicKey: 'money_decision' },
  { domain: 'health', topicKey: 'energy_and_rhythm' },
  { domain: 'study', topicKey: 'focus_and_efficiency' },
] as const;

const jobs = ['describe', 'explain', 'forecast', 'compare', 'act'] as const;

const horizons: Array<{
  horizon: RecommendationEvalHorizon;
  factRef: string;
  validFrom: string;
  validUntil: string | null;
  role: RecommendationStructuralEvalCase['expectedSelectionRole'];
}> = [
  {
    horizon: 'baseline',
    factRef: 'natal:pillar:day',
    validFrom: '1995-08-12',
    validUntil: null,
    role: 'p2_baseline',
  },
  {
    horizon: 'phase',
    factRef: 'time:dayun:2020:乙酉:timing',
    validFrom: '2020-01-01',
    validUntil: '2029-12-31',
    role: 'p1_mingli_change',
  },
  {
    horizon: 'year',
    factRef: 'time:liunian:2026:丙午:timing',
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    role: 'p1_mingli_change',
  },
  {
    horizon: 'month',
    factRef: 'time:liuyue:2026-08-07:丙戌:timing',
    validFrom: '2026-08-07',
    validUntil: '2026-09-06',
    role: 'p1_mingli_change',
  },
];

const relationshipStatuses = ['single', 'dating', 'married', 'unknown'] as const;
const preferenceWindows = ['none', 'long_term', 'recent', 'session'] as const;

/** 5 domains × 5 question jobs × 4 time horizons = exactly 100 fixed cases. */
export const recommendationStructuralCorpus: RecommendationStructuralEvalCase[] = domains.flatMap((domain, domainIndex) =>
  jobs.flatMap((questionJob, jobIndex) =>
    horizons.map((horizon, horizonIndex) => {
      const sequence = (domainIndex * jobs.length * horizons.length) + (jobIndex * horizons.length) + horizonIndex;
      const preferenceWindow = preferenceWindows[sequence % preferenceWindows.length];
      return {
        id: `recommendation-${String(sequence + 1).padStart(3, '0')}-${domain.domain}-${questionJob}-${horizon.horizon}`,
        domain: domain.domain,
        topicKey: domain.topicKey,
        questionJob,
        horizon: horizon.horizon,
        relationshipStatus: relationshipStatuses[sequence % relationshipStatuses.length],
        unknownHour: sequence % 2 === 0,
        preferenceWindow,
        factRef: horizon.factRef,
        expectedValidity: {
          validFrom: horizon.validFrom,
          validUntil: horizon.validUntil,
        },
        expectedSelectionRole: preferenceWindow === 'none'
          ? horizon.role
          : horizon.horizon === 'baseline'
            ? 'p2_interest_match'
            : horizon.role,
      };
    }),
  ),
);

if (recommendationStructuralCorpus.length !== 100) {
  throw new Error(`Recommendation structural corpus must contain 100 cases, received ${recommendationStructuralCorpus.length}`);
}
