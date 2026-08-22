import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const base = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/017_insight_card_content.sql'),
  'utf8',
);
const v2 = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/018_insight_card_content_v2.sql'),
  'utf8',
);
const v3 = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/019_insight_detail_length_tolerance.sql'),
  'utf8',
);
const v4 = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/022_insight_prompt_vnext.sql'),
  'utf8',
);

function functionBody(source: string, name: string, nextName?: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = nextName
    ? source.indexOf(`CREATE OR REPLACE FUNCTION ${nextName}(`, start + 1)
    : source.length;
  assert.ok(end > start, `${name} body must be bounded`);
  return source.slice(start, end);
}

function functionDefinition(source: string, name: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = source.indexOf('\n$$;', start);
  assert.ok(end > start, `${name} definition must end with $$;`);
  return source.slice(start, end + 4);
}

// 017 remains the additive base for empty databases and already records the
// immutable detail/follow-up artifacts, RLS, ancestry and client idempotency.
assert.match(base, /CREATE TABLE IF NOT EXISTS insight_card_details/);
assert.match(base, /CREATE TABLE IF NOT EXISTS insight_card_follow_ups/);
assert.match(base, /UNIQUE \(user_id, client_request_id\)/);
assert.match(base, /CREATE OR REPLACE FUNCTION get_insight_follow_up_ancestry/);
assert.match(base, /ENABLE ROW LEVEL SECURITY/g);
assert.match(base, /REVOKE ALL ON TABLE insight_card_details, insight_card_follow_ups FROM PUBLIC, anon, authenticated/);

const claim = functionBody(v2, 'claim_insight_card_detail', 'finalize_insight_card_detail');
for (const identity of [
  'insight_card_content_v2',
  'insight_medium_detail_prompt_v2',
  'insight_large_detail_prompt_v2',
  'insight_card_detail_output_v2',
]) assert.ok(claim.includes(identity), `detail claim must require ${identity}`);

const vNextClaim = functionDefinition(v4, 'claim_insight_card_detail');
for (const identity of [
  'insight_medium_detail_prompt_v2',
  'insight_medium_detail_prompt_v3',
  'insight_medium_detail_prompt_v4',
  'insight_large_detail_prompt_v2',
  'insight_large_detail_prompt_v3',
  'insight_large_detail_prompt_v4',
  'medium_insight_prompt_v5',
  'medium_insight_prompt_v6',
  'medium_insight_prompt_v7',
  'recommendation_prompt_v8',
  'recommendation_prompt_v9',
  'recommendation_prompt_v10',
]) assert.ok(vNextClaim.includes(identity), `VNext detail claim must accept ${identity}`);
for (const unsupported of [
  'insight_medium_detail_prompt_v5',
  'insight_large_detail_prompt_v5',
  'medium_insight_prompt_v8',
  'recommendation_prompt_v11',
]) assert.equal(vNextClaim.includes(unsupported), false, `VNext claim must reject ${unsupported}`);
assert.match(vNextClaim, /v_root\.prompt_version <> v_large\.prompt_version/);

const normalizedVNextClaim = vNextClaim
  .replace(
    `OR (p_source_type = 'medium' AND p_prompt_version NOT IN (\n       'insight_medium_detail_prompt_v2', 'insight_medium_detail_prompt_v3', 'insight_medium_detail_prompt_v4'\n     ))\n     OR (p_source_type = 'large' AND p_prompt_version NOT IN (\n       'insight_large_detail_prompt_v2', 'insight_large_detail_prompt_v3', 'insight_large_detail_prompt_v4'\n     ))`,
    `OR (p_source_type = 'medium' AND p_prompt_version <> 'insight_medium_detail_prompt_v2')\n     OR (p_source_type = 'large' AND p_prompt_version <> 'insight_large_detail_prompt_v2')`,
  )
  .replace(
    `AND prompt_version IN ('medium_insight_prompt_v5', 'medium_insight_prompt_v6', 'medium_insight_prompt_v7')`,
    `AND prompt_version = 'medium_insight_prompt_v5'`,
  )
  .split(`AND prompt_version IN ('recommendation_prompt_v8', 'recommendation_prompt_v9', 'recommendation_prompt_v10')`)
  .join(`AND prompt_version = 'recommendation_prompt_v8'`)
  .replace(`         OR v_root.prompt_version <> v_large.prompt_version\n`, '');
assert.equal(
  normalizedVNextClaim,
  functionDefinition(v2, 'claim_insight_card_detail'),
  '022 may only widen approved prompt allowlists and add the pool root/source version fence',
);

// Medium source: current V2 discovery only, four fixed structural facts first,
// then the exact card refs. No lifecycle/十二长生 package is selected.
for (const identity of [
  'medium_insight_v2',
  'medium_fact_snapshot_v2',
  'medium_context_snapshot_v2',
  'medium_generator_v5',
  'medium_insight_prompt_v5',
  'medium_insight_output_v1',
]) assert.ok(claim.includes(identity), `medium source must require ${identity}`);
assert.match(claim, /jsonb_array_length\(v_card_refs\) NOT BETWEEN 1 AND 4/);
assert.match(claim, /medium source card has invalid hard fact references/);
assert.match(claim, /ARRAY\[\s*'month_command', 'day_master_capacity', 'pattern_candidates', 'yongshen_basis'\s*\]::TEXT\[\]/);
assert.match(claim, /medium structural foundation is missing or duplicated/);
assert.match(claim, /v_refs := v_structure_refs/);
assert.match(claim, /IF NOT v_refs \? v_ref THEN/);
assert.match(claim, /medium detail facts do not resolve uniquely/);

// Large source: only current recommendation V8, exact visible item, four
// structural facts plus at least one frozen time fact from the original card.
for (const identity of [
  'recommendation_prompt_v8',
  'recommendation_output_v3',
  'recommendation_taxonomy_v2',
  'recommendation_ai_v8',
]) assert.ok(claim.includes(identity), `large source must require ${identity}`);
assert.match(claim, /v_item#>'\{event_hypothesis,fact_refs\}'/);
assert.match(claim, /refs\.ref LIKE 'time:%'/);
assert.match(claim, /large source card is incomplete or lacks time facts/);
assert.match(claim, /large structural foundation is missing or duplicated/);
assert.match(claim, /v_refs := v_structure_refs;[\s\S]*jsonb_array_elements_text\(v_card_refs\) WITH ORDINALITY[\s\S]*v_refs := v_refs \|\| jsonb_build_array\(v_ref\)/);
assert.match(claim, /large source fact ref has no selected entity/);
assert.match(claim, /octet_length\(v_selected::TEXT\) > 196608/);

// Both card sizes share the same product-day cost envelope. Existing READY,
// active, and future-retry rows resolve before the admission checks.
assert.match(v2, /WHERE quota_day IS NOT NULL/);
assert.match(claim, /v_quota_day := \(\(v_now AT TIME ZONE 'Asia\/Hong_Kong'\) \+ interval '1 hour'\)::DATE/);
assert.match(claim, /WHERE user_id = p_user_id AND quota_day = v_quota_day/);
assert.match(claim, /v_daily_count >= 10[\s\S]*ERRCODE = 'P4291'/);
assert.match(claim, /v_active_count >= 2[\s\S]*ERRCODE = 'P4292'/);
assert.equal((claim.match(/'insight-detail-active'/g) ?? []).length, 2,
  'new and resumed details must share one user-global active lock');
assert.ok(
  claim.indexOf("v_row.status = 'generating' AND v_row.lease_expires_at > v_now")
    < claim.indexOf('v_row.attempt_count >= p_max_attempts'),
  'active owners must join before attempt limits',
);
assert.ok(
  claim.indexOf("v_row.status = 'retry_wait' AND v_row.next_attempt_at > v_now")
    < claim.indexOf('v_row.attempt_count >= p_max_attempts'),
  'future retries must wait before attempt limits',
);
assert.match(claim, /detail\.id <> v_row\.id/);

const finalizeDetail = functionBody(v2, 'finalize_insight_card_detail', 'finalize_insight_card_follow_up');
assert.match(finalizeDetail, /source_type = 'large' AND v_body_length NOT BETWEEN 500 AND 800/);
assert.match(finalizeDetail, /source_type = 'medium' AND v_body_length NOT BETWEEN 220 AND 420/);
const tolerantFinalizeDetail = functionBody(v3, 'finalize_insight_card_detail');
assert.doesNotMatch(tolerantFinalizeDetail, /v_body_length|char_length\(p_detail_content_json->>'body'\)/);
assert.match(finalizeDetail, /jsonb_array_length\(p_detail_content_json->'suggested_follow_ups'\) <> 2/);
assert.match(finalizeDetail, /v_original_refs \? used\.ref/);
assert.match(finalizeDetail, /used\.ref LIKE 'time:%'/);
assert.match(finalizeDetail, /provider_prompt_tokens = provider_prompt_tokens/);
assert.match(finalizeDetail, /provider_billed_output_tokens = provider_billed_output_tokens/);

const finalizeFollowUp = functionBody(v2, 'finalize_insight_card_follow_up', 'retry_insight_card_content_v2');
assert.match(finalizeFollowUp, /char_length\(p_answer_content_json->>'answer'\) NOT BETWEEN 80 AND 500/);
assert.match(finalizeFollowUp, /contract_version = 'insight_card_content_v2'/);
assert.match(finalizeFollowUp, /provider_prompt_tokens = provider_prompt_tokens/);
assert.match(finalizeFollowUp, /provider_billed_output_tokens = provider_billed_output_tokens/);

const retry = functionBody(v2, 'retry_insight_card_content_v2', 'fail_insight_card_content_v2');
const fail = functionBody(v2, 'fail_insight_card_content_v2');
for (const source of [retry, fail]) {
  assert.match(source, /p_provider_prompt_tokens BIGINT/);
  assert.match(source, /p_provider_billed_output_tokens BIGINT/);
  assert.match(source, /provider_prompt_tokens = provider_prompt_tokens \+ GREATEST/);
  assert.match(source, /provider_billed_output_tokens = provider_billed_output_tokens\s*\+ GREATEST/);
}

console.log('✓ 017→022 migrations preserve detail facts/cost/leases and add VNext rolling compatibility');
