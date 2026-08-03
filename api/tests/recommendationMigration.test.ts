import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../supabase/migrations/013_recommendation_engine.sql',
);
const migration = readFileSync(migrationPath, 'utf8');
const poolMigration = readFileSync(resolve(
  __dirname,
  '../../supabase/migrations/014_recommendation_candidate_pool.sql',
), 'utf8');

function sectionAfter(anchor: string): string {
  const start = migration.indexOf(anchor);
  assert.notEqual(start, -1, `migration must contain ${anchor}`);
  return migration.slice(start);
}

function run(name: string, test: () => void): void {
  try {
    test();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

run('only batches, events, and a content-free provider-cost ledger are persisted', () => {
  const tables = [...migration.matchAll(/CREATE TABLE IF NOT EXISTS\s+(recommendation_[a-z_]+)/g)]
    .map((match) => match[1]);
  assert.deepEqual(tables, [
    'recommendation_batches',
    'recommendation_provider_attempts',
    'recommendation_events',
  ]);
  assert.equal(/recommendation_cards/i.test(migration), false);
});

run('same-day root and successor slots are unique despite later behavior changes', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendation_batches_successor_slot[\s\S]*?user_id,[\s\S]*?profile_id,[\s\S]*?generation_timezone,[\s\S]*?effective_date,[\s\S]*?COALESCE\(after_batch_id, '00000000-0000-0000-0000-000000000000'::UUID\)/,
  );

  const claim = sectionAfter('CREATE OR REPLACE FUNCTION claim_recommendation_batch(');
  assert.match(claim, /AND batch\.after_batch_id IS NOT DISTINCT FROM p_after_batch_id/);
  assert.match(claim, /input_hash\. If a user[\s\S]*?existing slot/);
});

run('profile/context revision creates a distinct same-day slot and fences stale parents', () => {
  assert.match(migration, /profile_revision_hash TEXT NOT NULL/);
  assert.match(migration, /profile_updated_at TIMESTAMPTZ NOT NULL/);
  assert.match(
    migration,
    /idx_recommendation_batches_successor_slot[\s\S]*?effective_date,[\s\S]*?profile_revision_hash,[\s\S]*?COALESCE\(after_batch_id/,
  );
  assert.match(migration, /NEW\.profile_revision_hash IS DISTINCT FROM OLD\.profile_revision_hash/);

  const claim = sectionAfter('CREATE OR REPLACE FUNCTION claim_recommendation_batch(');
  assert.match(claim, /p_profile_revision_hash TEXT/);
  assert.match(claim, /p_profile_updated_at TIMESTAMPTZ/);
  assert.match(claim, /v_profile_updated_at <> p_profile_updated_at/);
  assert.match(claim, /prior\.profile_revision_hash = p_profile_revision_hash/);
  assert.match(claim, /batch\.profile_revision_hash = p_profile_revision_hash/);
  assert.match(claim, /profile_updated_at = p_profile_updated_at,/);
});

run('a stale prior batch cannot anchor a new-day successor chain', () => {
  const claim = sectionAfter('CREATE OR REPLACE FUNCTION claim_recommendation_batch(');
  const priorValidation = claim.slice(
    claim.indexOf('IF p_after_batch_id IS NOT NULL THEN'),
    claim.indexOf('-- Short transaction-wide serialization'),
  );
  assert.match(priorValidation, /prior\.effective_date = p_effective_date/);
  assert.match(priorValidation, /prior\.generation_timezone = p_generation_timezone/);
  assert.match(priorValidation, /prior\.valid_until > clock_timestamp\(\)/);
});

run('timezone is a batch-slot identity rather than a cosmetic response field', () => {
  assert.match(
    migration,
    /idx_recommendation_batches_successor_slot[\s\S]*?generation_timezone,[\s\S]*?effective_date/,
  );
  assert.match(migration, /NEW\.generation_timezone IS DISTINCT FROM OLD\.generation_timezone/);
  const claim = sectionAfter('CREATE OR REPLACE FUNCTION claim_recommendation_batch(');
  assert.match(claim, /v_key_batch\.generation_timezone <> p_generation_timezone/);
  assert.match(claim, /batch\.generation_timezone = p_generation_timezone/);
});

run('READY batches are immutable and generation leases have explicit transitions', () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION prevent_ready_recommendation_batch_update\(\)[\s\S]*?READY recommendation batches are immutable/,
  );
  assert.match(migration, /CREATE TRIGGER protect_ready_recommendation_batch/);
  assert.match(migration, /status IN \('generating', 'retry_wait', 'ready'\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION finalize_recommendation_batch\(/);
  const finalize = sectionAfter('CREATE OR REPLACE FUNCTION finalize_recommendation_batch(')
    .split('CREATE OR REPLACE FUNCTION mark_recommendation_batch_retry_wait(')[0];
  assert.match(finalize, /FROM bazi_profiles AS profile/);
  assert.match(finalize, /profile\.updated_at = batch\.profile_updated_at/);
  assert.match(finalize, /batch\.valid_until > clock_timestamp\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION mark_recommendation_batch_retry_wait\(/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION release_recommendation_batch_generation\(/);
  const release = sectionAfter('CREATE OR REPLACE FUNCTION release_recommendation_batch_generation(')
    .split('CREATE TABLE IF NOT EXISTS recommendation_events')[0];
  assert.match(release, /UPDATE recommendation_batches AS batch/);
  assert.match(release, /status = 'retry_wait'/);
  assert.doesNotMatch(release, /DELETE FROM recommendation_batches/);
  assert.match(
    migration,
    /Recommendation input snapshot can change only with a new retry\/takeover lease/,
  );

  const claim = sectionAfter('CREATE OR REPLACE FUNCTION claim_recommendation_batch(');
  assert.match(claim, /generation_key = p_generation_key,/);
  assert.match(claim, /profile_updated_at = p_profile_updated_at,/);
  assert.match(claim, /input_hash = p_input_hash,/);
  assert.match(claim, /valid_until = p_valid_until,/);
});

run('claim lease outlives the maximum AI call and cannot be configured too short', () => {
  const claim = sectionAfter('CREATE OR REPLACE FUNCTION claim_recommendation_batch(');
  assert.match(claim, /p_lease_ttl_seconds INTEGER DEFAULT 150/);
  assert.match(claim, /p_lease_ttl_seconds < 130/);
  assert.match(claim, /p_lease_ttl_seconds > 300/);
  assert.match(claim, /lease_ttl_seconds must be between 130 and 300/);
});

run('new AI batches are bounded over 24 hours without blocking joins or retries', () => {
  const claim = sectionAfter('CREATE OR REPLACE FUNCTION claim_recommendation_batch(');
  assert.match(claim, /p_max_new_batches_per_24h INTEGER DEFAULT 6/);
  assert.match(claim, /p_max_new_batches_per_24h < 1/);
  assert.match(claim, /p_max_new_batches_per_24h > 50/);
  assert.match(claim, /batch\.created_at > v_now - INTERVAL '24 hours'/);
  assert.match(claim, /IF v_batch\.id IS NULL THEN[\s\S]*?'daily_limit'::TEXT/);
});

run('one existing slot cannot retry provider work forever after repeated profile fences', () => {
  const claim = sectionAfter('CREATE OR REPLACE FUNCTION claim_recommendation_batch(');
  assert.match(claim, /p_max_attempts_per_batch INTEGER DEFAULT 3/);
  assert.match(claim, /p_max_attempts_per_batch < 1/);
  assert.match(claim, /p_max_attempts_per_batch > 10/);
  assert.match(
    claim,
    /v_batch\.attempt_count >= p_max_attempts_per_batch[\s\S]*?'attempt_limit'::TEXT/,
  );
});

run('a global provider-attempt budget bounds account farms without entering recommendation semantics', () => {
  const claim = sectionAfter('CREATE OR REPLACE FUNCTION claim_recommendation_batch(');
  assert.match(claim, /p_max_provider_attempts_global_per_24h INTEGER DEFAULT 100/);
  assert.match(claim, /p_max_provider_attempts_global_per_24h < 1/);
  assert.match(claim, /FROM recommendation_provider_attempts AS attempt/);
  assert.match(claim, /attempt\.attempted_at > v_now - INTERVAL '24 hours'/);
  assert.match(claim, /INSERT INTO recommendation_provider_attempts \(attempted_at\)/);
  assert.match(
    claim,
    /v_global_provider_attempt_count >= p_max_provider_attempts_global_per_24h[\s\S]*?'global_limit'::TEXT/,
  );
  assert.match(migration, /DROP POLICY IF EXISTS "用户只能删除自己的八字档案" ON bazi_profiles/);
  assert.match(migration, /REVOKE ALL ON TABLE recommendation_provider_attempts FROM PUBLIC, anon, authenticated/);
});

run('legacy V1 batch JSON remains bounded at six deck and three center cards', () => {
  assert.match(migration, /jsonb_typeof\(cards_json -> 'deck_cards'\) = 'array'/);
  assert.match(migration, /jsonb_array_length\(cards_json -> 'deck_cards'\) = 6/);
  assert.match(migration, /jsonb_typeof\(cards_json -> 'center_cards'\) = 'array'/);
  assert.match(migration, /jsonb_array_length\(cards_json -> 'center_cards'\) = 3/);
});

run('V2 stores one immutable 24-card pool separately from an 8+4 display projection', () => {
  assert.match(poolMigration, /ADD COLUMN IF NOT EXISTS candidate_pool_json JSONB/);
  assert.match(
    poolMigration,
    /candidate_pool_json ->> 'pool_version' IS DISTINCT FROM 'recommendation_pool_v1'/,
  );
  assert.match(poolMigration, /jsonb_array_length\(candidate_pool_json -> 'candidates'\) = 24/);
  assert.match(poolMigration, /output_schema_version = 'recommendation_output_v2'/);
  assert.match(poolMigration, /jsonb_array_length\(cards_json -> 'deck_cards'\) = 8/);
  assert.match(poolMigration, /jsonb_array_length\(cards_json -> 'center_cards'\) = 4/);
  assert.match(poolMigration, /output_schema_version = 'recommendation_output_v1'/);
  assert.match(poolMigration, /jsonb_array_length\(cards_json -> 'deck_cards'\) = 6/);
  assert.match(poolMigration, /jsonb_array_length\(cards_json -> 'center_cards'\) = 3/);
  assert.match(poolMigration, /jsonb_typeof\(cards_json\) IS DISTINCT FROM 'object'/);
  assert.match(poolMigration, /jsonb_typeof\(candidate_pool_json -> 'candidates'\) IS DISTINCT FROM 'array'/);
  assert.match(poolMigration, /after_batch_id IS NOT NULL/);
  assert.match(poolMigration, /after_batch_id IS NOT DISTINCT FROM pool_source_batch_id/);
  assert.match(poolMigration, /generation_kind = 'pool'[\s\S]*?output_schema_version = 'recommendation_output_v2'/);
});

run('pool continuation consumes only the 12 undisplayed candidates and does not reserve provider cost', () => {
  const start = poolMigration.indexOf('CREATE OR REPLACE FUNCTION create_recommendation_pool_continuation(');
  assert.notEqual(start, -1);
  const continuation = poolMigration.slice(start);
  assert.match(continuation, /pool continuation must contain 8 deck and 4 center cards/);
  assert.match(continuation, /v_pool_count <> 24/);
  assert.match(continuation, /v_source_display_count <> 12/);
  assert.match(continuation, /v_selected_count <> 12/);
  assert.match(continuation, /pool continuation must contain every and only remaining candidate/);
  assert.match(continuation, /selected\.card - 'surface' - 'position'/);
  assert.match(continuation, /exact projections of the candidate pool/);
  assert.match(continuation, /'pool'/);
  assert.match(continuation, /pool_source_batch_id/);
  assert.doesNotMatch(continuation, /INSERT INTO recommendation_provider_attempts/);
});

run('V2 finalize atomically saves the generated pool and display selection context', () => {
  const start = poolMigration.indexOf('CREATE OR REPLACE FUNCTION finalize_recommendation_batch(');
  assert.notEqual(start, -1);
  const finalize = poolMigration.slice(start).split(
    'CREATE OR REPLACE FUNCTION create_recommendation_pool_continuation(',
  )[0];
  assert.match(finalize, /p_candidate_pool_json JSONB/);
  assert.match(finalize, /p_selection_context_json JSONB/);
  assert.match(finalize, /p_generation_metrics_json JSONB/);
  assert.match(finalize, /candidate_pool_json = p_candidate_pool_json/);
  assert.match(finalize, /selection_context_json = p_selection_context_json/);
  assert.match(finalize, /generation_metrics_json = p_generation_metrics_json/);
  assert.match(finalize, /p_generation_metrics_json ->> 'outcome' IS DISTINCT FROM 'success'/);
  assert.match(finalize, /batch\.generation_kind = 'ai'/);
  assert.match(finalize, /displayed\.card - 'surface' - 'position'/);
  assert.match(finalize, /first display cards must be exact projections of the candidate pool/);
  assert.match(finalize, /entry\.value ->> 'pool_position' IS DISTINCT FROM \(entry\.ordinality - 1\)::TEXT/);
  assert.match(finalize, /jsonb_typeof\(entry\.value -> 'pool_position'\) IS DISTINCT FROM 'number'/);
  assert.match(finalize, /candidate_id' IS DISTINCT FROM btrim/);
  assert.match(finalize, /primary_time_window_key/);
  assert.match(finalize, /referenced_window_keys/);
  assert.match(finalize, /jsonb_array_elements\(entry\.value -> 'referenced_window_keys'\)/);
  assert.match(finalize, /COUNT\(DISTINCT key\.value #>> '\{\}'\)/);
  assert.match(finalize, /jsonb_array_length\(entry\.value -> 'referenced_window_keys'\) = 0/);
  assert.match(finalize, /primary_time_window_key'\) IS DISTINCT FROM 'null'/);
  assert.doesNotMatch(
    poolMigration,
    /DROP FUNCTION IF EXISTS finalize_recommendation_batch\(\s*UUID, UUID, UUID, BIGINT, JSONB, JSONB, TEXT/,
  );
});

run('time-window behavior labels are derived from frozen cards without changing the client event API', () => {
  assert.match(poolMigration, /ADD COLUMN IF NOT EXISTS primary_time_window_key TEXT/);
  assert.match(poolMigration, /ADD COLUMN IF NOT EXISTS referenced_window_keys TEXT\[\]/);
  assert.match(poolMigration, /primary_time_window_key = ANY\(referenced_window_keys\)/);
  assert.match(poolMigration, /CREATE OR REPLACE FUNCTION derive_recommendation_event_time_windows\(\)/);
  assert.match(poolMigration, /FROM jsonb_array_elements\(batch\.cards_json -> 'deck_cards'\)/);
  assert.match(poolMigration, /FROM jsonb_array_elements\(batch\.cards_json -> 'center_cards'\)/);
  assert.match(poolMigration, /NEW\.primary_time_window_key := v_primary_time_window_key/);
  assert.match(poolMigration, /NEW\.referenced_window_keys := v_referenced_window_keys/);
  assert.match(poolMigration, /BEFORE INSERT ON recommendation_events/);

  const eventFunction = sectionAfter('CREATE OR REPLACE FUNCTION record_recommendation_event(')
    .split('ALTER TABLE recommendation_batches ENABLE ROW LEVEL SECURITY;')[0];
  const signature = eventFunction.slice(0, eventFunction.indexOf(')\nRETURNS TEXT'));
  assert.doesNotMatch(signature, /time_window/);
});

run('time-window memory separates primary exposure from interest and stays bounded', () => {
  const start = poolMigration.indexOf('CREATE OR REPLACE FUNCTION get_recommendation_time_window_snapshot(');
  assert.notEqual(start, -1);
  const snapshot = poolMigration.slice(start);
  assert.match(snapshot, /event\.created_at >= p_now - INTERVAL '90 days'/);
  assert.match(snapshot, /event\.primary_time_window_key AS window_key/);
  assert.match(snapshot, /COUNT\(\*\) FILTER \(WHERE event\.event_type = 'exposure'\) AS primary_exposures/);
  assert.match(snapshot, /COUNT\(\*\) FILTER \(WHERE event\.event_type = 'open'\) AS primary_opens/);
  assert.match(snapshot, /LIMIT 100/);
  assert.match(snapshot, /event\.session_id = btrim\(p_session_id\)/);
  assert.match(snapshot, /event\.created_at >= p_now - INTERVAL '12 hours'/);
  assert.match(snapshot, /'current_session_windows'/);
  assert.match(snapshot, /CREATE OR REPLACE FUNCTION get_recommendation_memory_snapshot\(/);
  assert.match(snapshot, /get_recommendation_preference_snapshot\(/);
  assert.match(
    snapshot,
    /get_recommendation_time_window_snapshot\([\s\S]*?RETURNS JSONB[\s\S]*?LANGUAGE plpgsql[\s\S]*?STABLE/,
  );
  assert.match(
    snapshot,
    /ALTER FUNCTION get_recommendation_preference_snapshot\([\s\S]*?\) STABLE/,
  );
  assert.match(
    snapshot,
    /get_recommendation_memory_snapshot\([\s\S]*?RETURNS JSONB[\s\S]*?LANGUAGE plpgsql[\s\S]*?STABLE/,
  );
  assert.match(snapshot, /p_now - INTERVAL '12 hours'/);
  assert.doesNotMatch(snapshot, /importance|domain_candidates|intensity/);
});

run('event RPC derives labels from immutable cards rather than client parameters', () => {
  const eventFunction = sectionAfter('CREATE OR REPLACE FUNCTION record_recommendation_event(')
    .split('ALTER TABLE recommendation_batches ENABLE ROW LEVEL SECURITY;')[0];

  const signature = eventFunction.slice(0, eventFunction.indexOf(')\nRETURNS TEXT'));
  assert.match(signature, /p_event_id UUID/);
  assert.match(signature, /p_user_id UUID/);
  assert.match(signature, /p_batch_id UUID/);
  assert.match(signature, /p_session_id TEXT/);
  assert.match(signature, /p_candidate_id TEXT/);
  assert.match(signature, /p_event_type TEXT/);
  assert.doesNotMatch(signature, /p_(domain|topic_key|question_job|content_horizon|surface|position|semantic_key)/);

  assert.match(eventFunction, /FROM jsonb_array_elements\(v_batch\.cards_json -> 'deck_cards'\)/);
  assert.match(eventFunction, /FROM jsonb_array_elements\(v_batch\.cards_json -> 'center_cards'\)/);
  assert.match(eventFunction, /v_domain := v_card #>> '\{content_profile,domain\}'/);
  assert.match(eventFunction, /v_semantic_key := v_card ->> 'semantic_key'/);
  assert.match(migration, /UNIQUE \(user_id, batch_id, candidate_id, event_type\)/);
  assert.doesNotMatch(migration, /UNIQUE \(user_id, batch_id, candidate_id, event_type, session_id\)/);
  assert.match(
    eventFunction,
    /event\.candidate_id = btrim\(p_candidate_id\)[\s\S]*?event\.event_type = p_event_type;/,
  );
  assert.match(eventFunction, /ON CONFLICT DO NOTHING/);
});

run('preference RPC aggregates the full windows before applying bounded AI output', () => {
  const preference = sectionAfter('CREATE OR REPLACE FUNCTION get_recommendation_preference_snapshot(')
    .split('ALTER TABLE recommendation_batches ENABLE ROW LEVEL SECURITY;')[0];

  assert.match(preference, /SECURITY DEFINER/);
  assert.match(preference, /profile\.owner_user_id = p_user_id/);
  assert.match(preference, /event\.created_at >= v_long_term_cutoff/);
  assert.match(preference, /'recent_14d'::TEXT AS window_name, v_recent_cutoff/);
  assert.match(preference, /'long_term_90d'::TEXT AS window_name, v_long_term_cutoff/);
  assert.match(preference, /\('domain'::TEXT, event\.domain\)/);
  assert.match(preference, /\('topic_key'::TEXT, event\.topic_key\)/);
  assert.match(preference, /\('question_job'::TEXT, event\.question_job\)/);
  assert.match(preference, /\('content_horizon'::TEXT, event\.content_horizon\)/);
  assert.match(preference, /signal\.signal_rank <= 40/);
  assert.match(preference, /LIMIT 20/);
  assert.match(preference, /LIMIT 60/);
  assert.doesNotMatch(preference, /LIMIT 500/);
});

run('product tables and the detached cost ledger are private; RPCs are service-role only', () => {
  assert.match(migration, /ALTER TABLE recommendation_batches ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE recommendation_events ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE recommendation_provider_attempts ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE recommendation_batches FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON TABLE recommendation_events FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON TABLE recommendation_provider_attempts FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION claim_recommendation_batch\([\s\S]*?SECURITY DEFINER/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION record_recommendation_event\([\s\S]*?SECURITY DEFINER/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION get_recommendation_preference_snapshot\([\s\S]*?SECURITY DEFINER/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION record_recommendation_event\([\s\S]*?TO service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION get_recommendation_preference_snapshot\([\s\S]*?TO service_role/);
  assert.match(poolMigration, /REVOKE ALL ON FUNCTION get_recommendation_time_window_snapshot\([\s\S]*?FROM PUBLIC, anon, authenticated/);
  assert.match(poolMigration, /GRANT EXECUTE ON FUNCTION get_recommendation_time_window_snapshot\([\s\S]*?TO service_role/);
  assert.match(poolMigration, /REVOKE ALL ON FUNCTION get_recommendation_memory_snapshot\([\s\S]*?FROM PUBLIC, anon, authenticated/);
  assert.match(poolMigration, /GRANT EXECUTE ON FUNCTION get_recommendation_memory_snapshot\([\s\S]*?TO service_role/);
});

console.log('Recommendation migration static checks passed.');
