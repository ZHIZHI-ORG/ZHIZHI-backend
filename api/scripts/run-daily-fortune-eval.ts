import 'dotenv/config';
import { dailyFortunePromptEvalCases } from '../evals/dailyFortunePromptCases';
import { DAILY_FORTUNE_PROMPT_VERSION } from '../src/models/DailyFortune';
import { generateDailyFortuneWithAi } from '../src/utils/dailyFortuneAi';

const GLOBAL_FORBIDDEN_TERMS = ['命理证据', '点击', '确诊'];

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new Error('GEMINI_API_KEY 未配置，无法运行真实模型日运评估');
  }
  if (!process.env.DAILY_FORTUNE_AI_MODEL?.trim()) {
    throw new Error('DAILY_FORTUNE_AI_MODEL 未配置，无法运行真实模型日运评估');
  }

  const results = [];
  for (const item of dailyFortunePromptEvalCases) {
    const startedAt = Date.now();
    const content = await generateDailyFortuneWithAi(item.facts);
    const serialized = JSON.stringify(content);
    const forbiddenHits = [...GLOBAL_FORBIDDEN_TERMS, ...item.forbidden_terms]
      .filter((term) => serialized.includes(term));
    if (forbiddenHits.length > 0) {
      throw new Error(`${item.id} 出现禁用内容：${[...new Set(forbiddenHits)].join('、')}`);
    }

    results.push({
      id: item.id,
      title: item.title,
      duration_ms: Date.now() - startedAt,
      review_focus: item.review_focus,
      comparison_group: item.comparison_group,
      selected_scenes: content.selected_scenes.map((scene) => scene.scene),
      content,
    });
    console.log(`✓ ${item.id}: ${content.selected_scenes.map((scene) => scene.scene).join(' + ')}`);
  }

  const comparisonGroups = new Map<string, string[][]>();
  for (const result of results) {
    if (!result.comparison_group) continue;
    const group = comparisonGroups.get(result.comparison_group) ?? [];
    group.push(result.selected_scenes);
    comparisonGroups.set(result.comparison_group, group);
  }
  for (const [group, sceneSelections] of comparisonGroups) {
    if (sceneSelections.length !== 2 || JSON.stringify(sceneSelections[0]) !== JSON.stringify(sceneSelections[1])) {
      throw new Error(`${group} 的空背景与丰富背景改变了 Top 2 场景或顺序`);
    }
  }

  console.log('\nDAILY_FORTUNE_PROMPT_EVAL_RESULT');
  console.log(JSON.stringify({
    contract_version: dailyFortunePromptEvalCases[0]?.facts.contract_version,
    prompt_version: DAILY_FORTUNE_PROMPT_VERSION,
    model: process.env.DAILY_FORTUNE_AI_MODEL,
    generated_at: new Date().toISOString(),
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
