import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseDailyFortuneProfileContextInput } from '../src/utils/dailyFortuneUserContext';

const context = parseDailyFortuneProfileContextInput({
  life_stage: { primary: 'founder', tags: [] },
  work_study: { mode: 'career', career_status: 'entrepreneur' },
  relationship: { status: 'single', current_focus: null },
});

assert.equal(context.life_stage?.primary, 'founder');
assert.equal(context.work_study?.career_status, 'entrepreneur');
assert.equal(context.relationship?.status, 'single');

for (const file of ['api/[...path].ts', 'server.ts']) {
  const source = fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
  assert.match(source, /baziContextHandler/);
  assert.match(source, /child === 'context'/);
}

console.log('Recommendation user-context persistence contract passed.');
