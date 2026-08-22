import assert from 'node:assert/strict';
import {
  MEDIUM_INSIGHT_DOMAINS,
  MEDIUM_INSIGHT_FACT_VERSION,
  MediumInsightAiOutput,
  MediumInsightFactSnapshot,
} from '../src/models/MediumInsight';
import { MEDIUM_INSIGHT_RESPONSE_SCHEMA } from '../src/utils/mediumInsightAi';
import { MediumInsightContentError, validateMediumInsightOutput } from '../src/utils/mediumInsightValidator';

const numbers = ['一', '二', '三', '四', '五', '六', '七', '八'];
const labels = { career: '事业', wealth: '财富', love: '关系', health: '身心', study: '学习' } as const;

function snapshot(): MediumInsightFactSnapshot {
  return {
    version: MEDIUM_INSIGHT_FACT_VERSION,
    effective_date: '2026-08-13',
    profile_id: '00000000-0000-4000-8000-000000000001',
    profile_updated_at: '2026-08-13T00:00:00.000Z',
    facts: Array.from({ length: 8 }, (_, index) => ({
      ref: `F${index + 1}`,
      source: index === 0 ? 'day_master' : 'natal_pillar',
      canonical_source: `fixture.${index}`,
      canonical_text: `确定性命理事实${index + 1}`,
      relation: null,
      participants: ['甲子'],
      scope: 'natal',
      time_horizon: 'baseline',
      full_match: null,
      conditions: [],
    })),
  };
}

function validOutput(): MediumInsightAiOutput {
  return {
    domains: MEDIUM_INSIGHT_DOMAINS.map((domain) => ({
      domain,
      cards: numbers.map((number, index) => ({
        title: `${labels[domain]}视角${number}`,
        preview: `在${labels[domain]}场景里，你更容易从第${number}种线索理解自己的稳定反应和内在需要。`,
        content_type: ['pattern', 'self_explanation', 'strength', 'tension', 'fit'][index % 5] as any,
        fact_refs: [`F${index + 1}`],
      })),
    })),
  };
}

function expectCode(code: string, mutate: (value: MediumInsightAiOutput) => void): void {
  const output = structuredClone(validOutput());
  mutate(output);
  assert.throws(
    () => validateMediumInsightOutput({ output, snapshot: snapshot() }),
    (error: unknown) => error instanceof MediumInsightContentError && error.code === code,
  );
}

assert.equal(validateMediumInsightOutput({ output: validOutput(), snapshot: snapshot() }).domains.length, 5);

const marginalPreviewOutput = structuredClone(validOutput());
marginalPreviewOutput.domains[0].cards[0].preview = '甲'.repeat(24);
marginalPreviewOutput.domains[0].cards[1].preview = '乙'.repeat(56);
assert.equal(
  validateMediumInsightOutput({ output: marginalPreviewOutput, snapshot: snapshot() }).domains.length,
  5,
  'minor preview length drift must not discard all 40 cards',
);

for (const length of [23, 57]) {
  expectCode('INVALID_PREVIEW', (output) => { output.domains[0].cards[0].preview = '甲'.repeat(length); });
}
expectCode('INVALID_PREVIEW', (output) => { output.domains[0].cards[0].preview = '   '; });
expectCode('INVALID_CARDINALITY', (output) => { output.domains[0].cards.pop(); });
expectCode('UNKNOWN_FACT_REF', (output) => { output.domains[0].cards[0].fact_refs = ['F99']; });
expectCode('DUPLICATE_TEXT', (output) => { output.domains[0].cards[1] = { ...output.domains[0].cards[0] }; });

const similarButDistinct = structuredClone(validOutput());
similarButDistinct.domains[0].cards[0].preview = '在合作压力上升时你会先收集信息再表达判断并观察对方反馈';
similarButDistinct.domains[0].cards[1].preview = '在合作压力上升时你会先收集信息再表达判断并观察对方反应';
assert.equal(
  validateMediumInsightOutput({ output: similarButDistinct, snapshot: snapshot() }).domains.length,
  5,
  'near-duplicate wording is a soft quality issue and must not hide all 40 cards',
);

const conditionalOutput = structuredClone(validOutput());
conditionalOutput.domains[0].cards[0].preview = '这并不一定会导向固定结果，也不建议立刻投资，应继续核对现实条件。';
conditionalOutput.domains[0].cards[1].preview = '并不必因为这种倾向分手或辞职，它仍需要放回真实关系与工作中验证。';
assert.equal(validateMediumInsightOutput({ output: conditionalOutput, snapshot: snapshot() }).domains.length, 5);

const multipleViolations = structuredClone(validOutput());
multipleViolations.domains[1].cards[0].preview = '你在明天一定会得到一笔收益，并从此彻底解决所有财务问题。';
multipleViolations.domains[3].cards[2].preview = '这个命理组合可以确诊疾病，并给出明确药物治疗方案。';
const promptOwnedOutput = validateMediumInsightOutput({
  output: multipleViolations,
  snapshot: snapshot(),
});
assert.ok(promptOwnedOutput.domains[1].cards[0].preview.includes('一定会'));
assert.ok(promptOwnedOutput.domains[3].cards[2].preview.includes('确诊疾病'));

const schemaText = JSON.stringify(MEDIUM_INSIGHT_RESPONSE_SCHEMA);
assert.equal(schemaText.includes('minItems'), false);
assert.equal(schemaText.includes('maxItems'), false);
console.log('✓ medium insight validator enforces 5×8, usable card length, facts and exact de-duplication');
