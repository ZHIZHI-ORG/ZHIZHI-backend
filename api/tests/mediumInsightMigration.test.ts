import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/016_medium_insight_daily_batches.sql'),
  'utf8',
);

const tables = [...migration.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map((match) => match[1]);
assert.deepEqual(tables, ['medium_insight_batches', 'medium_insight_events']);
assert.match(migration, /FROM bazi_profiles AS profile[\s\S]*FOR UPDATE/);
assert.match(migration, /ORDER BY batch\.effective_date DESC, batch\.batch_revision DESC[\s\S]*LIMIT 1[\s\S]*FOR UPDATE/);
assert.doesNotMatch(migration.match(/SELECT batch\.\* INTO v_head[\s\S]*?FOR UPDATE;/)?.[0] ?? '', /status\s*=/);
assert.match(migration, /p_fact_snapshot_json->>'effective_date'[\s\S]*v_target_date::TEXT/);
assert.match(migration, /batch_revision = 1 AND supersedes_batch_id IS NOT NULL/);
assert.match(migration, /READY medium insight batches are immutable/);
assert.match(migration, /jsonb_array_length\(p_cards_json -> 'domains'\) <> 5/);
assert.match(migration, /jsonb_array_length\(v_domain -> 'cards'\) <> 8/);
assert.match(migration, /newer\.effective_date > v_batch\.effective_date/);
assert.match(migration, /lease_token = p_lease_token AND lease_epoch = p_lease_epoch/);
assert.match(migration, /v_profile_updated_at IS DISTINCT FROM v_batch\.profile_updated_at/);
assert.match(migration, /card ->> 'content_id' = p_content_id::TEXT/);
assert.match(migration, /v_card->>'content_type'/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL ON TABLE medium_insight_batches, medium_insight_events FROM PUBLIC, anon, authenticated/);
assert.doesNotMatch(migration, /\b(?:ALTER TABLE|UPDATE|DELETE FROM|DROP TABLE)\s+(?:daily_fortune_artifacts|recommendation_batches)\b/i);
console.log('✓ medium insight migration locks one immutable daily head and derives event dimensions server-side');
