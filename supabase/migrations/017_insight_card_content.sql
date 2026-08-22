-- Medium grounding V2 plus owner-scoped, persistent detail/follow-up content.
-- This migration is additive. It does not rewrite recommendation or READY payloads.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- The context contract participates in medium batch identity independently of
-- the hard-fact projection. Existing rows are explicitly legacy V1.
ALTER TABLE medium_insight_batches
  ADD COLUMN IF NOT EXISTS context_projection_version TEXT NOT NULL
  DEFAULT 'medium_context_snapshot_v1';

ALTER TABLE medium_insight_batches
  DROP CONSTRAINT IF EXISTS medium_insight_batches_batch_revision_check;
ALTER TABLE medium_insight_batches
  DROP CONSTRAINT IF EXISTS medium_insight_revision_shape;
ALTER TABLE medium_insight_batches
  ALTER COLUMN batch_revision TYPE INTEGER;
ALTER TABLE medium_insight_batches
  ADD CONSTRAINT medium_insight_batch_revision_nonnegative CHECK (batch_revision >= 0);
ALTER TABLE medium_insight_batches
  ADD CONSTRAINT medium_insight_revision_shape CHECK (
    (batch_revision = 0 AND supersedes_batch_id IS NULL)
    OR (batch_revision > 0 AND supersedes_batch_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION validate_medium_insight_supersedes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base medium_insight_batches%ROWTYPE;
BEGIN
  IF NEW.batch_revision = 0 THEN RETURN NEW; END IF;
  SELECT * INTO v_base FROM medium_insight_batches
  WHERE id = NEW.supersedes_batch_id FOR SHARE;
  IF NOT FOUND
     OR v_base.user_id <> NEW.user_id
     OR v_base.profile_id <> NEW.profile_id
     OR v_base.effective_date <> NEW.effective_date
     OR v_base.batch_revision <> NEW.batch_revision - 1 THEN
    RAISE EXCEPTION 'medium insight replacement must supersede the immediately prior same-day revision'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Prompt/schema are frozen at claim time in V2. Finalization may fill the
-- model/output payload but cannot silently change the generation identity.
CREATE OR REPLACE FUNCTION protect_ready_medium_insight_batch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'ready' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'READY medium insight batches are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.prompt_version IS NOT NULL
     AND (NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
       OR NEW.output_schema_version IS DISTINCT FROM OLD.output_schema_version) THEN
    RAISE EXCEPTION 'medium insight prompt/schema identity is immutable after claim'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- V2 claim identity includes every generation contract. A version upgrade may
-- supersede an old revision 1; true fact changes remain limited to two batches
-- per identical generation contract and local day.
CREATE OR REPLACE FUNCTION claim_medium_insight_batch_v2(
  p_user_id UUID,
  p_profile_id UUID,
  p_candidate_date DATE,
  p_profile_updated_at TIMESTAMPTZ,
  p_fact_hash TEXT,
  p_fact_snapshot_json JSONB,
  p_soft_context_snapshot_json JSONB,
  p_generation_timezone TEXT,
  p_source_boundary_at TIMESTAMPTZ,
  p_contract_version TEXT,
  p_fact_projection_version TEXT,
  p_context_projection_version TEXT,
  p_generator_version TEXT,
  p_prompt_version TEXT,
  p_output_schema_version TEXT,
  p_lease_ttl_seconds INTEGER DEFAULT 150,
  p_max_active_generations INTEGER DEFAULT 20,
  p_max_attempts INTEGER DEFAULT 3
)
RETURNS TABLE (
  claim_outcome TEXT,
  batch_id UUID,
  batch_status TEXT,
  target_effective_date DATE,
  timezone_change_pending BOOLEAN,
  claim_lease_token UUID,
  claim_lease_epoch BIGINT,
  claim_lease_expires_at TIMESTAMPTZ,
  claim_next_attempt_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_profile_updated_at TIMESTAMPTZ;
  v_profile_is_owner BOOLEAN;
  v_head medium_insight_batches%ROWTYPE;
  v_batch medium_insight_batches%ROWTYPE;
  v_target_date DATE;
  v_revision INTEGER;
  v_supersedes UUID;
  v_generation_key TEXT;
  v_token UUID;
  v_active_count INTEGER;
  v_same_version_count INTEGER;
  v_previous_status TEXT;
  v_same_version BOOLEAN;
BEGIN
  IF p_candidate_date IS NULL OR p_source_boundary_at IS NULL OR p_profile_updated_at IS NULL
     OR p_contract_version IS NULL OR p_fact_projection_version IS NULL
     OR p_context_projection_version IS NULL OR p_generator_version IS NULL
     OR p_prompt_version IS NULL OR p_output_schema_version IS NULL THEN
    RAISE EXCEPTION 'medium insight V2 claim requires complete identity' USING ERRCODE = '22023';
  END IF;
  IF p_fact_hash IS NULL OR length(p_fact_hash) <> 64 THEN
    RAISE EXCEPTION 'medium insight fact hash must be sha256' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_fact_snapshot_json) <> 'object'
     OR jsonb_typeof(p_soft_context_snapshot_json) <> 'object'
     OR p_soft_context_snapshot_json->>'version' IS DISTINCT FROM p_context_projection_version THEN
    RAISE EXCEPTION 'medium insight V2 snapshots are invalid' USING ERRCODE = '22023';
  END IF;
  IF p_lease_ttl_seconds NOT BETWEEN 130 AND 300 OR p_max_attempts NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'medium insight lease or attempts out of range' USING ERRCODE = '22023';
  END IF;

  SELECT profile.updated_at, profile.is_owner INTO v_profile_updated_at, v_profile_is_owner
  FROM bazi_profiles AS profile
  WHERE profile.id = p_profile_id AND profile.owner_user_id = p_user_id
    AND profile.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_profile_is_owner IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'medium insight profile is not the owned self profile' USING ERRCODE = '42501';
  END IF;
  IF v_profile_updated_at IS DISTINCT FROM p_profile_updated_at THEN
    RAISE EXCEPTION 'medium insight profile revision changed before claim' USING ERRCODE = '40001';
  END IF;

  SELECT batch.* INTO v_head FROM medium_insight_batches AS batch
  WHERE batch.user_id = p_user_id AND batch.profile_id = p_profile_id
  ORDER BY batch.effective_date DESC, batch.batch_revision DESC LIMIT 1 FOR UPDATE;

  IF v_head.id IS NULL OR p_candidate_date > v_head.effective_date THEN
    v_target_date := p_candidate_date;
    v_revision := 0;
    v_supersedes := NULL;
  ELSE
    v_target_date := v_head.effective_date;
    v_same_version := v_head.contract_version = p_contract_version
      AND v_head.fact_projection_version = p_fact_projection_version
      AND v_head.context_projection_version = p_context_projection_version
      AND v_head.generator_version = p_generator_version
      AND v_head.prompt_version = p_prompt_version
      AND v_head.output_schema_version = p_output_schema_version;
    IF v_same_version AND v_head.fact_hash = p_fact_hash THEN
      v_batch := v_head;
    ELSE
      IF v_same_version THEN
        SELECT COUNT(*) INTO v_same_version_count FROM medium_insight_batches
        WHERE user_id = p_user_id AND profile_id = p_profile_id
          AND effective_date = v_target_date
          AND contract_version = p_contract_version
          AND fact_projection_version = p_fact_projection_version
          AND context_projection_version = p_context_projection_version
          AND generator_version = p_generator_version
          AND prompt_version = p_prompt_version
          AND output_schema_version = p_output_schema_version;
        IF v_same_version_count >= 2 THEN
          RETURN QUERY SELECT 'fact_revision_exhausted'::TEXT, v_head.id, v_head.status,
            v_target_date, p_candidate_date < v_target_date, NULL::UUID, v_head.lease_epoch,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
          RETURN;
        END IF;
      END IF;
      v_revision := v_head.batch_revision + 1;
      v_supersedes := v_head.id;
    END IF;
  END IF;

  IF p_fact_snapshot_json->>'effective_date' IS DISTINCT FROM v_target_date::TEXT THEN
    RAISE EXCEPTION 'medium insight target date changed during claim' USING ERRCODE = '40001';
  END IF;

  IF v_batch.id IS NOT NULL THEN
    IF v_batch.status = 'ready' THEN
      RETURN QUERY SELECT 'ready'::TEXT, v_batch.id, v_batch.status, v_target_date,
        p_candidate_date < v_target_date, NULL::UUID, v_batch.lease_epoch,
        NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    IF v_batch.status = 'failed' THEN
      RETURN QUERY SELECT 'failed'::TEXT, v_batch.id, v_batch.status, v_target_date,
        p_candidate_date < v_target_date, NULL::UUID, v_batch.lease_epoch,
        NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    IF v_batch.status = 'generating' AND v_batch.lease_expires_at > v_now THEN
      RETURN QUERY SELECT 'join'::TEXT, v_batch.id, v_batch.status, v_target_date,
        p_candidate_date < v_target_date, NULL::UUID, v_batch.lease_epoch,
        v_batch.lease_expires_at, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    IF v_batch.status = 'retry_wait' AND v_batch.next_attempt_at > v_now THEN
      RETURN QUERY SELECT 'wait'::TEXT, v_batch.id, v_batch.status, v_target_date,
        p_candidate_date < v_target_date, NULL::UUID, v_batch.lease_epoch,
        NULL::TIMESTAMPTZ, v_batch.next_attempt_at;
      RETURN;
    END IF;
    IF v_batch.attempt_count >= p_max_attempts THEN
      UPDATE medium_insight_batches SET status = 'failed', lease_token = NULL,
        lease_expires_at = NULL, next_attempt_at = NULL, last_error_code = 'ATTEMPT_LIMIT',
        last_error_stage = 'claim', updated_at = v_now WHERE id = v_batch.id;
      RETURN QUERY SELECT 'failed'::TEXT, v_batch.id, 'failed'::TEXT, v_target_date,
        p_candidate_date < v_target_date, NULL::UUID, v_batch.lease_epoch,
        NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_active_count FROM medium_insight_batches
  WHERE status = 'generating' AND lease_expires_at > v_now
    AND (v_batch.id IS NULL OR id <> v_batch.id);
  IF v_active_count >= p_max_active_generations THEN
    RETURN QUERY SELECT 'busy'::TEXT, v_batch.id, v_batch.status, v_target_date,
      p_candidate_date < v_target_date, NULL::UUID, COALESCE(v_batch.lease_epoch, 0),
      NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_token := gen_random_uuid();
  IF v_batch.id IS NULL THEN
    v_generation_key := encode(extensions.digest(concat_ws('|', p_user_id::TEXT,
      p_profile_id::TEXT, v_target_date::TEXT, p_fact_hash, p_contract_version,
      p_fact_projection_version, p_context_projection_version, p_generator_version,
      p_prompt_version, p_output_schema_version), 'sha256'), 'hex');
    INSERT INTO medium_insight_batches (
      generation_key, user_id, profile_id, effective_date, batch_revision,
      supersedes_batch_id, generation_timezone, source_boundary_at, profile_updated_at,
      fact_hash, fact_snapshot_json, soft_context_snapshot_json, status, lease_token,
      lease_epoch, lease_expires_at, attempt_count, contract_version,
      fact_projection_version, context_projection_version, generator_version,
      prompt_version, output_schema_version
    ) VALUES (
      v_generation_key, p_user_id, p_profile_id, v_target_date, v_revision,
      v_supersedes, p_generation_timezone, p_source_boundary_at, p_profile_updated_at,
      p_fact_hash, p_fact_snapshot_json, p_soft_context_snapshot_json, 'generating',
      v_token, 1, v_now + make_interval(secs => p_lease_ttl_seconds), 1,
      p_contract_version, p_fact_projection_version, p_context_projection_version, p_generator_version,
      p_prompt_version, p_output_schema_version
    ) RETURNING * INTO v_batch;
    RETURN QUERY SELECT 'owner'::TEXT, v_batch.id, v_batch.status, v_target_date,
      p_candidate_date < v_target_date, v_batch.lease_token, v_batch.lease_epoch,
      v_batch.lease_expires_at, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_previous_status := v_batch.status;
  UPDATE medium_insight_batches AS batch SET
    status = 'generating', lease_token = v_token, lease_epoch = batch.lease_epoch + 1,
    lease_expires_at = v_now + make_interval(secs => p_lease_ttl_seconds),
    attempt_count = batch.attempt_count + 1, next_attempt_at = NULL,
    last_error_code = NULL, last_error_stage = NULL, updated_at = v_now
  WHERE batch.id = v_batch.id
    AND ((batch.status = 'generating' AND batch.lease_expires_at <= v_now)
      OR (batch.status = 'retry_wait' AND batch.next_attempt_at <= v_now))
  RETURNING batch.* INTO v_batch;
  IF NOT FOUND THEN RAISE EXCEPTION 'medium insight claim state changed' USING ERRCODE = '40001'; END IF;
  RETURN QUERY SELECT CASE WHEN v_previous_status = 'generating' THEN 'owner_takeover' ELSE 'owner' END,
    v_batch.id, v_batch.status, v_target_date, p_candidate_date < v_target_date,
    v_batch.lease_token, v_batch.lease_epoch, v_batch.lease_expires_at, NULL::TIMESTAMPTZ;
END;
$$;

CREATE TABLE IF NOT EXISTS insight_card_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_key TEXT NOT NULL UNIQUE CHECK (length(generation_key) = 64),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES bazi_profiles(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('medium', 'large')),
  source_batch_id UUID NOT NULL,
  source_item_id TEXT NOT NULL CHECK (length(btrim(source_item_id)) BETWEEN 1 AND 128),
  quota_day DATE,
  source_item_snapshot_json JSONB NOT NULL CHECK (jsonb_typeof(source_item_snapshot_json) = 'object'),
  selected_fact_snapshot_json JSONB NOT NULL,
  grounding_context_snapshot_json JSONB NOT NULL,
  fact_refs_json JSONB NOT NULL CHECK (jsonb_typeof(fact_refs_json) = 'array' AND jsonb_array_length(fact_refs_json) > 0),
  status TEXT NOT NULL CHECK (status IN ('generating', 'retry_wait', 'ready', 'failed')),
  lease_token UUID,
  lease_epoch BIGINT NOT NULL DEFAULT 1 CHECK (lease_epoch >= 1),
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 3),
  provider_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (provider_attempt_count >= 0),
  provider_input_bytes BIGINT NOT NULL DEFAULT 0 CHECK (provider_input_bytes >= 0),
  next_attempt_at TIMESTAMPTZ,
  detail_json JSONB,
  contract_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  output_schema_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  generation_metrics_json JSONB,
  last_error_code TEXT,
  last_error_stage TEXT,
  ready_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT insight_detail_status_shape CHECK (
    (status = 'generating' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND next_attempt_at IS NULL AND detail_json IS NULL AND ready_at IS NULL)
    OR (status = 'retry_wait' AND lease_token IS NULL AND lease_expires_at IS NULL AND next_attempt_at IS NOT NULL AND detail_json IS NULL AND ready_at IS NULL)
    OR (status = 'failed' AND lease_token IS NULL AND lease_expires_at IS NULL AND next_attempt_at IS NULL AND detail_json IS NULL AND ready_at IS NULL)
    OR (status = 'ready' AND lease_token IS NULL AND lease_expires_at IS NULL AND next_attempt_at IS NULL AND detail_json IS NOT NULL AND generation_metrics_json IS NOT NULL AND ready_at IS NOT NULL)
  ),
  CONSTRAINT insight_detail_quota_shape CHECK (
    (source_type = 'medium' AND quota_day IS NOT NULL)
    OR (source_type = 'large' AND quota_day IS NULL)
  ),
  UNIQUE (user_id, source_type, source_batch_id, source_item_id, contract_version, prompt_version, output_schema_version, model_id)
);

CREATE INDEX IF NOT EXISTS idx_insight_card_details_source
  ON insight_card_details(user_id, source_type, source_batch_id, source_item_id);
CREATE INDEX IF NOT EXISTS idx_insight_card_details_user_quota_day
  ON insight_card_details(user_id, quota_day) WHERE source_type = 'medium';

CREATE TABLE IF NOT EXISTS insight_card_follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_key TEXT NOT NULL UNIQUE CHECK (length(generation_key) = 64),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  detail_id UUID NOT NULL REFERENCES insight_card_details(id) ON DELETE CASCADE,
  parent_follow_up_id UUID REFERENCES insight_card_follow_ups(id) ON DELETE RESTRICT,
  client_request_id UUID NOT NULL,
  quota_day DATE NOT NULL,
  normalized_question_hash TEXT NOT NULL CHECK (length(normalized_question_hash) = 64),
  question TEXT NOT NULL CHECK (length(btrim(question)) BETWEEN 1 AND 600),
  status TEXT NOT NULL CHECK (status IN ('generating', 'retry_wait', 'ready', 'failed')),
  lease_token UUID,
  lease_epoch BIGINT NOT NULL DEFAULT 1 CHECK (lease_epoch >= 1),
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 3),
  provider_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (provider_attempt_count >= 0),
  provider_input_bytes BIGINT NOT NULL DEFAULT 0 CHECK (provider_input_bytes >= 0),
  next_attempt_at TIMESTAMPTZ,
  input_snapshot_json JSONB,
  answer_json JSONB,
  contract_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  output_schema_version TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT 'pending',
  generation_metrics_json JSONB,
  last_error_code TEXT,
  last_error_stage TEXT,
  ready_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT insight_follow_up_status_shape CHECK (
    (status = 'generating' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND next_attempt_at IS NULL AND answer_json IS NULL AND ready_at IS NULL)
    OR (status = 'retry_wait' AND lease_token IS NULL AND lease_expires_at IS NULL AND next_attempt_at IS NOT NULL AND answer_json IS NULL AND ready_at IS NULL)
    OR (status = 'failed' AND lease_token IS NULL AND lease_expires_at IS NULL AND next_attempt_at IS NULL AND answer_json IS NULL AND ready_at IS NULL)
    OR (status = 'ready' AND lease_token IS NULL AND lease_expires_at IS NULL AND next_attempt_at IS NULL AND input_snapshot_json IS NOT NULL AND answer_json IS NOT NULL AND generation_metrics_json IS NOT NULL AND ready_at IS NOT NULL)
  ),
  UNIQUE (user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS idx_insight_follow_ups_detail_history
  ON insight_card_follow_ups(user_id, detail_id, created_at DESC) WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS idx_insight_follow_ups_user_quota_day
  ON insight_card_follow_ups(user_id, quota_day);

CREATE OR REPLACE FUNCTION protect_ready_insight_card_content()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status = 'ready' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'READY insight content is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_ready_insight_detail_trigger BEFORE UPDATE ON insight_card_details
  FOR EACH ROW EXECUTE FUNCTION protect_ready_insight_card_content();
CREATE TRIGGER protect_ready_insight_follow_up_trigger BEFORE UPDATE ON insight_card_follow_ups
  FOR EACH ROW EXECUTE FUNCTION protect_ready_insight_card_content();

CREATE OR REPLACE FUNCTION claim_insight_card_detail(
  p_user_id UUID, p_source_type TEXT, p_source_batch_id UUID, p_source_item_id TEXT,
  p_generation_key TEXT, p_contract_version TEXT, p_prompt_version TEXT,
  p_output_schema_version TEXT, p_model_identity TEXT,
  p_lease_ttl_seconds INTEGER DEFAULT 150, p_max_attempts INTEGER DEFAULT 3
)
RETURNS TABLE (
  claim_outcome TEXT, generation_id UUID, generation_status TEXT,
  claim_lease_token UUID, claim_lease_epoch BIGINT,
  claim_lease_expires_at TIMESTAMPTZ, claim_next_attempt_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_row insight_card_details%ROWTYPE;
  v_medium medium_insight_batches%ROWTYPE;
  v_large recommendation_batches%ROWTYPE;
  v_root recommendation_batches%ROWTYPE;
  v_item JSONB;
  v_selected JSONB;
  v_context JSONB;
  v_refs JSONB;
  v_card_refs JSONB;
  v_structure_refs JSONB;
  v_ref TEXT;
  v_structure_source TEXT;
  v_structure_ref TEXT;
  v_structure_count INTEGER;
  v_valid_structure_count INTEGER;
  v_profile_id UUID;
  v_token UUID;
  v_previous_status TEXT;
  v_detail JSONB;
  v_metrics JSONB;
  v_quota_day DATE;
  v_daily_count INTEGER;
  v_active_count INTEGER;
BEGIN
  IF p_source_type NOT IN ('medium', 'large') OR length(p_generation_key) <> 64
     OR length(btrim(p_model_identity)) = 0
     OR p_lease_ttl_seconds NOT BETWEEN 130 AND 300 OR p_max_attempts NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'invalid insight detail claim' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_generation_key, 0));

  SELECT * INTO v_row FROM insight_card_details
  WHERE user_id = p_user_id AND generation_key = p_generation_key FOR UPDATE;
  IF v_row.id IS NULL THEN
    IF p_source_type = 'medium' THEN
      SELECT * INTO v_medium FROM medium_insight_batches
      WHERE id = p_source_batch_id AND user_id = p_user_id AND status = 'ready'
        AND contract_version = 'medium_insight_v2'
        AND fact_projection_version = 'medium_fact_snapshot_v2'
        AND context_projection_version = 'medium_context_snapshot_v2'
        AND generator_version = 'medium_generator_v4'
        AND prompt_version = 'medium_insight_prompt_v4'
        AND output_schema_version = 'medium_insight_output_v1'
        AND fact_snapshot_json->>'version' = 'medium_fact_snapshot_v2'
        AND soft_context_snapshot_json->>'version' = 'medium_context_snapshot_v2';
      IF NOT FOUND THEN RAISE EXCEPTION 'owned medium source batch not found' USING ERRCODE = '42501'; END IF;
      SELECT card INTO v_item
      FROM jsonb_array_elements(v_medium.cards_json->'domains') domain_row,
        jsonb_array_elements(domain_row->'cards') card
      WHERE card->>'content_id' = p_source_item_id LIMIT 1;
      IF v_item IS NULL THEN RAISE EXCEPTION 'medium source item not found' USING ERRCODE = '42501'; END IF;
      v_profile_id := v_medium.profile_id;
      v_context := v_medium.soft_context_snapshot_json;
      v_card_refs := v_item->'fact_refs';
      IF jsonb_typeof(v_medium.fact_snapshot_json->'facts') <> 'array'
         OR jsonb_typeof(v_card_refs) <> 'array'
         OR jsonb_array_length(v_card_refs) NOT BETWEEN 1 AND 4
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_card_refs) AS card_ref(value)
           WHERE jsonb_typeof(card_ref.value) <> 'string'
             OR length(btrim(card_ref.value #>> '{}')) = 0
         )
         OR (SELECT COUNT(*) FROM jsonb_array_elements_text(v_card_refs))
            <> (SELECT COUNT(DISTINCT ref)
                FROM jsonb_array_elements_text(v_card_refs) AS refs(ref)) THEN
        RAISE EXCEPTION 'medium source card has invalid hard fact references' USING ERRCODE = '22023';
      END IF;
      SELECT jsonb_set(v_medium.fact_snapshot_json, '{facts}', COALESCE(jsonb_agg(fact), '[]'::JSONB))
      INTO v_selected
      FROM jsonb_array_elements(v_medium.fact_snapshot_json->'facts') fact
      WHERE fact->>'ref' IN (SELECT jsonb_array_elements_text(v_card_refs));
      IF jsonb_array_length(v_selected->'facts') <> jsonb_array_length(v_card_refs)
         OR (SELECT COUNT(DISTINCT fact->>'ref') FROM jsonb_array_elements(v_selected->'facts') fact)
            <> jsonb_array_length(v_card_refs) THEN
        RAISE EXCEPTION 'medium source fact references do not resolve uniquely' USING ERRCODE = '22023';
      END IF;

      -- Every paid-on-click medium detail carries the same four structural
      -- foundations, even when the preview card cited only a narrow pillar or
      -- interaction. Resolve by semantic source rather than assuming F#s.
      v_structure_refs := '[]'::JSONB;
      FOREACH v_structure_source IN ARRAY ARRAY[
        'month_command',
        'day_master_capacity',
        'pattern_candidates',
        'yongshen_basis'
      ]::TEXT[] LOOP
        SELECT COUNT(*),
          COUNT(*) FILTER (
            WHERE jsonb_typeof(fact->'ref') = 'string'
              AND length(btrim(fact->>'ref')) BETWEEN 1 AND 256
          ),
          MIN(fact->>'ref')
        INTO v_structure_count, v_valid_structure_count, v_structure_ref
        FROM jsonb_array_elements(v_medium.fact_snapshot_json->'facts') fact
        WHERE fact->>'source' = v_structure_source;
        IF v_structure_count <> 1 OR v_valid_structure_count <> 1
           OR v_structure_refs ? v_structure_ref THEN
          RAISE EXCEPTION 'medium source structural foundation is missing or duplicated'
            USING ERRCODE = '22023';
        END IF;
        v_structure_refs := v_structure_refs || jsonb_build_array(v_structure_ref);
      END LOOP;

      -- Stable order: four fixed foundations first, then the card's original
      -- references in source order, omitting overlaps already in the base.
      v_refs := v_structure_refs;
      FOR v_ref IN
        SELECT card_ref.ref
        FROM jsonb_array_elements_text(v_card_refs) WITH ORDINALITY
          AS card_ref(ref, position)
        ORDER BY card_ref.position
      LOOP
        IF NOT v_refs ? v_ref THEN
          v_refs := v_refs || jsonb_build_array(v_ref);
        END IF;
      END LOOP;

      SELECT jsonb_set(
        v_medium.fact_snapshot_json,
        '{facts}',
        COALESCE(jsonb_agg(resolved.fact ORDER BY requested.position), '[]'::JSONB)
      ) INTO v_selected
      FROM jsonb_array_elements_text(v_refs) WITH ORDINALITY
        AS requested(ref, position)
      JOIN LATERAL (
        SELECT fact
        FROM jsonb_array_elements(v_medium.fact_snapshot_json->'facts') fact
        WHERE fact->>'ref' = requested.ref
      ) AS resolved ON TRUE;
      IF jsonb_array_length(v_selected->'facts') <> jsonb_array_length(v_refs)
         OR (SELECT COUNT(DISTINCT fact->>'ref')
             FROM jsonb_array_elements(v_selected->'facts') fact)
            <> jsonb_array_length(v_refs) THEN
        RAISE EXCEPTION 'medium detail foundation references do not resolve uniquely'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      SELECT * INTO v_large FROM recommendation_batches
      WHERE id = p_source_batch_id AND user_id = p_user_id AND status = 'ready'
        AND prompt_version = 'recommendation_prompt_v7'
        AND output_schema_version = 'recommendation_output_v3'
        AND taxonomy_version = 'recommendation_taxonomy_v1';
      IF NOT FOUND THEN RAISE EXCEPTION 'owned large source batch not found' USING ERRCODE = '42501'; END IF;
      SELECT card INTO v_item FROM (
        SELECT value AS card FROM jsonb_array_elements(COALESCE(v_large.cards_json->'deck_cards', '[]'::JSONB))
        UNION ALL
        SELECT value AS card FROM jsonb_array_elements(COALESCE(v_large.cards_json->'center_cards', '[]'::JSONB))
      ) cards WHERE card->>'candidate_id' = p_source_item_id LIMIT 1;
      IF v_item IS NULL THEN RAISE EXCEPTION 'large source item not found' USING ERRCODE = '42501'; END IF;
      IF v_large.generation_kind = 'ai' THEN
        v_root := v_large;
      ELSIF v_large.generation_kind = 'pool' THEN
        SELECT * INTO v_root FROM recommendation_batches
        WHERE id = v_large.pool_source_batch_id AND user_id = p_user_id
          AND profile_id = v_large.profile_id AND status = 'ready'
          AND generation_kind = 'ai'
          AND prompt_version = 'recommendation_prompt_v7'
          AND output_schema_version = 'recommendation_output_v3'
          AND taxonomy_version = 'recommendation_taxonomy_v1';
      ELSE
        RAISE EXCEPTION 'large source generation kind is unsupported' USING ERRCODE = '42501';
      END IF;
      IF v_root.input_snapshot_json IS NULL
         OR v_root.input_snapshot_json->>'contract_version' <> 'recommendation_ai_v7'
         OR v_root.input_snapshot_json->>'taxonomy_version' <> 'recommendation_taxonomy_v1'
         OR v_root.user_id <> p_user_id
         OR v_root.profile_id <> v_large.profile_id
         OR v_root.profile_revision_hash <> v_large.profile_revision_hash
         OR v_root.profile_updated_at <> v_large.profile_updated_at
         OR v_root.generation_timezone <> v_large.generation_timezone
         OR v_root.effective_date <> v_large.effective_date THEN
        RAISE EXCEPTION 'large source grounding snapshot not found' USING ERRCODE = '42501';
      END IF;
      v_profile_id := v_large.profile_id;
      v_context := COALESCE(v_root.input_snapshot_json->'reality_context', '{}'::JSONB);
      v_refs := v_item#>'{event_hypothesis,fact_refs}';
      IF jsonb_typeof(v_item->'question') <> 'string' OR length(btrim(v_item->>'question')) = 0
         OR jsonb_typeof(v_item->'preview') <> 'string' OR length(btrim(v_item->>'preview')) = 0
         OR jsonb_typeof(v_item->'body') <> 'string' OR length(btrim(v_item->>'body')) = 0 THEN
        RAISE EXCEPTION 'large source card content is incomplete' USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v_refs) <> 'array' OR jsonb_array_length(v_refs) = 0
         OR (SELECT COUNT(*) FROM jsonb_array_elements_text(v_refs))
            <> (SELECT COUNT(DISTINCT ref) FROM jsonb_array_elements_text(v_refs) AS refs(ref)) THEN
        RAISE EXCEPTION 'large source card has invalid hard fact references' USING ERRCODE = '22023';
      END IF;
      v_selected := jsonb_build_object(
        'contract_version', v_root.input_snapshot_json->'contract_version',
        'effective_date', v_root.input_snapshot_json->'effective_date',
        'fortune_facts', jsonb_build_object(
          'contract_version', v_root.input_snapshot_json#>'{fortune_facts,contract_version}',
          'effective_date', v_root.input_snapshot_json#>'{fortune_facts,effective_date}',
          'natal', jsonb_build_object(
            'day_master', v_root.input_snapshot_json#>'{fortune_facts,natal,day_master}',
            'pillars', COALESCE((SELECT jsonb_agg(pillar)
              FROM jsonb_array_elements(COALESCE(v_root.input_snapshot_json#>'{fortune_facts,natal,pillars}', '[]'::JSONB)) pillar
              WHERE v_refs ? ('natal:pillar:' || (pillar->>'position'))), '[]'::JSONB)
          ),
          'mingli_interactions', jsonb_build_object(
            'rule_version', v_root.input_snapshot_json#>'{fortune_facts,mingli_interactions,rule_version}',
            'natal', COALESCE((SELECT jsonb_agg(interaction)
              FROM jsonb_array_elements(COALESCE(v_root.input_snapshot_json#>'{fortune_facts,mingli_interactions,natal}', '[]'::JSONB)) interaction
              WHERE v_refs ? ('natal:interaction:' || (interaction->>'id'))), '[]'::JSONB)
          )
        ),
        'time_windows', COALESCE((SELECT jsonb_agg(jsonb_set(
          CASE WHEN v_refs ? ('time:' || (window_row->>'window_key') || ':timing')
            THEN window_row ELSE window_row - 'timing' END,
          '{interactions}',
          COALESCE((SELECT jsonb_agg(interaction)
            FROM jsonb_array_elements(COALESCE(window_row->'interactions', '[]'::JSONB)) interaction
            WHERE v_refs ? ('time:' || (window_row->>'window_key') || ':interaction:' || (interaction->>'id'))
          ), '[]'::JSONB)
        ))
          FROM jsonb_array_elements(COALESCE(v_root.input_snapshot_json->'time_windows', '[]'::JSONB)) window_row
          WHERE window_row->>'window_key' IN (
            SELECT jsonb_array_elements_text(COALESCE(v_item->'referenced_window_keys', '[]'::JSONB))
          )), '[]'::JSONB),
        'available_fact_refs', COALESCE((SELECT jsonb_agg(ref_row)
          FROM jsonb_array_elements(COALESCE(v_root.input_snapshot_json->'available_fact_refs', '[]'::JSONB)) ref_row
          WHERE ref_row->>'ref' IN (SELECT jsonb_array_elements_text(v_refs))), '[]'::JSONB)
      );
      IF jsonb_array_length(v_selected->'available_fact_refs') <> jsonb_array_length(v_refs)
         OR (SELECT COUNT(DISTINCT ref_row->>'ref')
             FROM jsonb_array_elements(v_selected->'available_fact_refs') ref_row)
            <> jsonb_array_length(v_refs) THEN
        RAISE EXCEPTION 'large source fact references do not resolve uniquely' USING ERRCODE = '22023';
      END IF;
      FOR v_ref IN SELECT jsonb_array_elements_text(v_refs) LOOP
        IF v_ref = 'natal:day_master' THEN
          IF v_selected#>'{fortune_facts,natal,day_master}' IS NULL
             OR v_selected#>'{fortune_facts,natal,day_master}' = 'null'::JSONB THEN
            RAISE EXCEPTION 'large source day-master fact is missing' USING ERRCODE = '22023';
          END IF;
        ELSIF 1 = (
          SELECT COUNT(*) FROM jsonb_array_elements(v_selected#>'{fortune_facts,natal,pillars}') pillar
          WHERE v_ref = 'natal:pillar:' || (pillar->>'position')
        ) THEN NULL;
        ELSIF 1 = (
          SELECT COUNT(*) FROM jsonb_array_elements(v_selected#>'{fortune_facts,mingli_interactions,natal}') interaction
          WHERE v_ref = 'natal:interaction:' || (interaction->>'id')
        ) THEN NULL;
        ELSIF 1 = (
          SELECT COUNT(*) FROM jsonb_array_elements(v_selected->'time_windows') window_row
          WHERE v_ref = 'time:' || (window_row->>'window_key') || ':timing'
            AND jsonb_typeof(window_row->'timing') = 'object'
        ) THEN NULL;
        ELSIF 1 = (
          SELECT COUNT(*) FROM jsonb_array_elements(v_selected->'time_windows') window_row,
            jsonb_array_elements(COALESCE(window_row->'interactions', '[]'::JSONB)) interaction
          WHERE v_ref = 'time:' || (window_row->>'window_key') || ':interaction:' || (interaction->>'id')
        ) THEN NULL;
        ELSE
          RAISE EXCEPTION 'large source fact reference has no selected entity' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
    IF jsonb_typeof(v_refs) <> 'array' OR jsonb_array_length(v_refs) = 0 THEN
      RAISE EXCEPTION 'source card has no hard fact references' USING ERRCODE = '22023';
    END IF;
    IF octet_length(v_selected::TEXT) > 196608 THEN
      RAISE EXCEPTION 'selected insight source facts exceed byte ceiling' USING ERRCODE = '22023';
    END IF;

    IF p_source_type = 'medium' THEN
      -- Only brand-new provider-backed details consume these hard limits.
      -- Existing generation keys were resolved above and remain resumable.
      v_quota_day := ((v_now AT TIME ZONE 'Asia/Hong_Kong') + interval '1 hour')::DATE;
      -- A user-global lock keeps the active cap atomic even if two claims
      -- straddle the 23:00 product-day boundary and use different quota days.
      PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws('|',
        'insight-detail-active', p_user_id::TEXT), 0));
      PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws('|',
        'insight-detail-quota', p_user_id::TEXT, v_quota_day::TEXT), 0));
      SELECT COUNT(*) INTO v_daily_count FROM insight_card_details
      WHERE user_id = p_user_id AND source_type = 'medium' AND quota_day = v_quota_day;
      IF v_daily_count >= 10 THEN
        RAISE EXCEPTION 'insight detail daily limit reached' USING ERRCODE = 'P4291';
      END IF;
      SELECT COUNT(*) INTO v_active_count FROM insight_card_details
      WHERE user_id = p_user_id AND source_type = 'medium'
        AND status = 'generating' AND lease_expires_at > v_now;
      IF v_active_count >= 2 THEN
        RAISE EXCEPTION 'insight detail active limit reached' USING ERRCODE = 'P4292';
      END IF;
    END IF;

    IF p_source_type = 'large' THEN
      v_detail := jsonb_build_object(
        'title', v_item->>'question',
        'summary', v_item->>'preview',
        'sections', jsonb_build_array(jsonb_build_object(
          'title', '完整解读', 'content', v_item->>'body', 'fact_refs', v_refs
        )),
        'suggested_follow_ups', jsonb_build_array(
          '这条判断在我当前阶段最可能怎样表现？',
          '我应该观察哪些现实信号来验证它？',
          '结合我的当前目标，最值得先注意什么？'
        ),
        'follow_ups', '[]'::JSONB
      );
      v_metrics := jsonb_build_object(
        'provider_calls', 0, 'input_bytes', 0, 'duration_ms', 0,
        'prompt_tokens', NULL, 'output_tokens', NULL, 'total_tokens', NULL,
        'provider_response_bytes', 0
      );
      INSERT INTO insight_card_details (
        generation_key, user_id, profile_id, source_type, source_batch_id,
        source_item_id, source_item_snapshot_json, selected_fact_snapshot_json,
        grounding_context_snapshot_json, fact_refs_json,
        status, lease_token, lease_epoch, lease_expires_at, attempt_count,
        provider_attempt_count, detail_json, contract_version, prompt_version,
        output_schema_version, model_id, generation_metrics_json, ready_at
      ) VALUES (
        p_generation_key, p_user_id, v_profile_id, p_source_type, p_source_batch_id,
        p_source_item_id, v_item, v_selected, v_context, v_refs,
        'ready', NULL, 1, NULL, 1, 0, v_detail, p_contract_version,
        p_prompt_version, p_output_schema_version, p_model_identity, v_metrics, v_now
      ) RETURNING * INTO v_row;
      RETURN QUERY SELECT 'ready'::TEXT, v_row.id, v_row.status, NULL::UUID,
        v_row.lease_epoch, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;

    v_token := gen_random_uuid();
    INSERT INTO insight_card_details (
      generation_key, user_id, profile_id, source_type, source_batch_id,
      source_item_id, quota_day, source_item_snapshot_json, selected_fact_snapshot_json,
      grounding_context_snapshot_json, fact_refs_json,
      status, lease_token, lease_epoch, lease_expires_at, attempt_count,
      contract_version, prompt_version, output_schema_version, model_id
    ) VALUES (
      p_generation_key, p_user_id, v_profile_id, p_source_type, p_source_batch_id,
      p_source_item_id, v_quota_day, v_item, v_selected, v_context, v_refs,
      'generating', v_token, 1, v_now + make_interval(secs => p_lease_ttl_seconds), 1,
      p_contract_version, p_prompt_version, p_output_schema_version, p_model_identity
    ) RETURNING * INTO v_row;
    RETURN QUERY SELECT 'owner'::TEXT, v_row.id, v_row.status, v_row.lease_token,
      v_row.lease_epoch, v_row.lease_expires_at, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_row.status = 'ready' THEN
    RETURN QUERY SELECT 'ready'::TEXT, v_row.id, v_row.status, NULL::UUID,
      v_row.lease_epoch, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF v_row.status = 'failed' THEN
    RETURN QUERY SELECT 'failed'::TEXT, v_row.id, v_row.status, NULL::UUID,
      v_row.lease_epoch, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF v_row.status = 'generating' AND v_row.lease_expires_at > v_now THEN
    RETURN QUERY SELECT 'join'::TEXT, v_row.id, v_row.status, NULL::UUID,
      v_row.lease_epoch, v_row.lease_expires_at, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF v_row.status = 'retry_wait' AND v_row.next_attempt_at > v_now THEN
    RETURN QUERY SELECT 'wait'::TEXT, v_row.id, v_row.status, NULL::UUID,
      v_row.lease_epoch, NULL::TIMESTAMPTZ, v_row.next_attempt_at; RETURN;
  END IF;
  IF v_row.attempt_count >= p_max_attempts THEN
    UPDATE insight_card_details SET status = 'failed', lease_token = NULL,
      lease_expires_at = NULL, next_attempt_at = NULL, last_error_code = 'ATTEMPT_LIMIT',
      last_error_stage = 'claim', updated_at = v_now WHERE id = v_row.id RETURNING * INTO v_row;
    RETURN QUERY SELECT 'failed'::TEXT, v_row.id, v_row.status, NULL::UUID,
      v_row.lease_epoch, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF v_row.source_type = 'medium' THEN
    -- A due retry or expired-lease takeover performs real provider work, so it
    -- shares the same active cap as a brand-new medium detail. Read-only
    -- ready/join/wait paths have already returned above.
    PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws('|',
      'insight-detail-active', p_user_id::TEXT), 0));
    SELECT COUNT(*) INTO v_active_count FROM insight_card_details AS detail
    WHERE detail.user_id = p_user_id AND detail.source_type = 'medium'
      AND detail.id <> v_row.id AND detail.status = 'generating'
      AND detail.lease_expires_at > v_now;
    IF v_active_count >= 2 THEN
      RAISE EXCEPTION 'insight detail active limit reached' USING ERRCODE = 'P4292';
    END IF;
  END IF;
  v_previous_status := v_row.status;
  v_token := gen_random_uuid();
  UPDATE insight_card_details SET status = 'generating', lease_token = v_token,
    lease_epoch = lease_epoch + 1, lease_expires_at = v_now + make_interval(secs => p_lease_ttl_seconds),
    attempt_count = attempt_count + 1, next_attempt_at = NULL, last_error_code = NULL,
    last_error_stage = NULL, updated_at = v_now WHERE id = v_row.id RETURNING * INTO v_row;
  RETURN QUERY SELECT CASE WHEN v_previous_status = 'generating' THEN 'owner_takeover' ELSE 'owner' END,
    v_row.id, v_row.status, v_row.lease_token, v_row.lease_epoch,
    v_row.lease_expires_at, NULL::TIMESTAMPTZ;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_insight_card_detail(
  p_detail_id UUID, p_user_id UUID, p_lease_token UUID, p_lease_epoch BIGINT,
  p_detail_content_json JSONB, p_model_id TEXT, p_generation_metrics_json JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row insight_card_details%ROWTYPE;
  v_section JSONB;
  v_ref TEXT;
BEGIN
  IF jsonb_typeof(p_detail_content_json) <> 'object'
     OR jsonb_typeof(p_detail_content_json->'sections') <> 'array'
     OR jsonb_array_length(p_detail_content_json->'sections') NOT BETWEEN 3 AND 5 THEN RETURN FALSE; END IF;
  SELECT * INTO v_row FROM insight_card_details
  WHERE id = p_detail_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_row.source_type <> 'medium'
     OR v_row.model_id IS DISTINCT FROM p_model_id THEN RETURN FALSE; END IF;
  FOR v_section IN SELECT value FROM jsonb_array_elements(p_detail_content_json->'sections') LOOP
    IF jsonb_typeof(v_section->'fact_refs') <> 'array' OR jsonb_array_length(v_section->'fact_refs') = 0 THEN RETURN FALSE; END IF;
    FOR v_ref IN SELECT jsonb_array_elements_text(v_section->'fact_refs') LOOP
      IF NOT v_row.fact_refs_json ? v_ref THEN RETURN FALSE; END IF;
    END LOOP;
  END LOOP;
  UPDATE insight_card_details SET status = 'ready', lease_token = NULL,
    lease_expires_at = NULL, next_attempt_at = NULL,
    detail_json = jsonb_build_object('detail_id', id, 'source_type', source_type,
      'source_batch_id', source_batch_id, 'source_item_id', source_item_id) || p_detail_content_json,
    model_id = p_model_id, generation_metrics_json = p_generation_metrics_json,
    provider_attempt_count = provider_attempt_count + COALESCE((p_generation_metrics_json->>'provider_calls')::INTEGER, 0),
    provider_input_bytes = provider_input_bytes + COALESCE((p_generation_metrics_json->>'input_bytes')::BIGINT, 0),
    ready_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE id = p_detail_id AND user_id = p_user_id AND status = 'generating'
    AND lease_token = p_lease_token AND lease_epoch = p_lease_epoch;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION get_insight_follow_up_ancestry(
  p_user_id UUID, p_detail_id UUID, p_parent_follow_up_id UUID,
  p_max_depth INTEGER DEFAULT 6
)
RETURNS TABLE (
  follow_up_id UUID,
  parent_follow_up_id UUID,
  question TEXT,
  answer_json JSONB,
  created_at TIMESTAMPTZ,
  chain_depth INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE ancestry AS (
    SELECT follow_up.id, follow_up.parent_follow_up_id, follow_up.question,
      follow_up.answer_json, follow_up.created_at, 1 AS depth
    FROM insight_card_follow_ups AS follow_up
    WHERE follow_up.id = p_parent_follow_up_id
      AND follow_up.user_id = p_user_id
      AND follow_up.detail_id = p_detail_id
      AND follow_up.status = 'ready'
      AND p_max_depth BETWEEN 1 AND 6
    UNION ALL
    SELECT parent.id, parent.parent_follow_up_id, parent.question,
      parent.answer_json, parent.created_at, child.depth + 1
    FROM ancestry AS child
    JOIN insight_card_follow_ups AS parent ON parent.id = child.parent_follow_up_id
    WHERE child.depth < p_max_depth
      AND parent.user_id = p_user_id
      AND parent.detail_id = p_detail_id
      AND parent.status = 'ready'
  )
  SELECT ancestry.id, ancestry.parent_follow_up_id, ancestry.question,
    ancestry.answer_json, ancestry.created_at, ancestry.depth
  FROM ancestry
  ORDER BY ancestry.depth DESC;
$$;

CREATE OR REPLACE FUNCTION claim_insight_card_follow_up(
  p_user_id UUID, p_detail_id UUID, p_parent_follow_up_id UUID,
  p_client_request_id UUID, p_normalized_question_hash TEXT, p_question TEXT,
  p_generation_key TEXT, p_contract_version TEXT, p_prompt_version TEXT,
  p_output_schema_version TEXT, p_model_identity TEXT,
  p_lease_ttl_seconds INTEGER DEFAULT 150,
  p_max_attempts INTEGER DEFAULT 3
)
RETURNS TABLE (
  claim_outcome TEXT, generation_id UUID, generation_status TEXT,
  claim_lease_token UUID, claim_lease_epoch BIGINT,
  claim_lease_expires_at TIMESTAMPTZ, claim_next_attempt_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_detail insight_card_details%ROWTYPE;
  v_parent insight_card_follow_ups%ROWTYPE;
  v_row insight_card_follow_ups%ROWTYPE;
  v_token UUID;
  v_previous_status TEXT;
  v_quota_day DATE;
  v_daily_count INTEGER;
BEGIN
  IF length(p_generation_key) <> 64 OR length(p_normalized_question_hash) <> 64
     OR length(btrim(p_model_identity)) = 0
     OR length(btrim(p_question)) = 0 OR p_lease_ttl_seconds NOT BETWEEN 130 AND 300
     OR p_max_attempts NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'invalid insight follow-up claim' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws('|', p_user_id::TEXT, p_client_request_id::TEXT), 0));
  SELECT * INTO v_row FROM insight_card_follow_ups
  WHERE user_id = p_user_id AND client_request_id = p_client_request_id FOR UPDATE;
  IF v_row.id IS NOT NULL THEN
    IF v_row.detail_id <> p_detail_id
       OR v_row.parent_follow_up_id IS DISTINCT FROM p_parent_follow_up_id
       OR v_row.normalized_question_hash <> p_normalized_question_hash THEN
      RAISE EXCEPTION 'client_request_id payload conflict' USING ERRCODE = '23505';
    END IF;
  ELSE
    SELECT * INTO v_detail FROM insight_card_details
    WHERE id = p_detail_id AND user_id = p_user_id AND status = 'ready' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'owned ready detail not found' USING ERRCODE = '42501'; END IF;
    IF p_parent_follow_up_id IS NOT NULL THEN
      SELECT * INTO v_parent FROM insight_card_follow_ups
      WHERE id = p_parent_follow_up_id AND user_id = p_user_id
        AND detail_id = p_detail_id AND status = 'ready' FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'ready parent follow-up not found' USING ERRCODE = '42501'; END IF;
    END IF;
    -- Cost protection uses one server-controlled product day: Asia/Hong_Kong
    -- with the existing 23:00 boundary. Source timezones are client supplied
    -- and therefore cannot define a hard per-user quota.
    v_quota_day := ((v_now AT TIME ZONE 'Asia/Hong_Kong') + interval '1 hour')::DATE;
    PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws('|',
      'insight-follow-up-quota', p_user_id::TEXT, v_quota_day::TEXT), 0));
    SELECT COUNT(*) INTO v_daily_count FROM insight_card_follow_ups
    WHERE user_id = p_user_id AND quota_day = v_quota_day;
    IF v_daily_count >= 20 THEN
      RAISE EXCEPTION 'insight follow-up daily limit reached' USING ERRCODE = 'P4290';
    END IF;
    v_token := gen_random_uuid();
    INSERT INTO insight_card_follow_ups (
      generation_key, user_id, detail_id, parent_follow_up_id, client_request_id,
      quota_day, normalized_question_hash, question, status, lease_token, lease_epoch,
      lease_expires_at, attempt_count, contract_version, prompt_version,
      output_schema_version, model_id
    ) VALUES (
      p_generation_key, p_user_id, p_detail_id, p_parent_follow_up_id,
      p_client_request_id, v_quota_day, p_normalized_question_hash, p_question, 'generating',
      v_token, 1, v_now + make_interval(secs => p_lease_ttl_seconds), 1,
      p_contract_version, p_prompt_version, p_output_schema_version, p_model_identity
    ) RETURNING * INTO v_row;
    RETURN QUERY SELECT 'owner'::TEXT, v_row.id, v_row.status, v_row.lease_token,
      v_row.lease_epoch, v_row.lease_expires_at, NULL::TIMESTAMPTZ; RETURN;
  END IF;

  IF v_row.status = 'ready' THEN
    RETURN QUERY SELECT 'ready'::TEXT, v_row.id, v_row.status, NULL::UUID,
      v_row.lease_epoch, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF v_row.status = 'failed' THEN
    RETURN QUERY SELECT 'failed'::TEXT, v_row.id, v_row.status, NULL::UUID,
      v_row.lease_epoch, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF v_row.status = 'generating' AND v_row.lease_expires_at > v_now THEN
    RETURN QUERY SELECT 'join'::TEXT, v_row.id, v_row.status, NULL::UUID,
      v_row.lease_epoch, v_row.lease_expires_at, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  IF v_row.status = 'retry_wait' AND v_row.next_attempt_at > v_now THEN
    RETURN QUERY SELECT 'wait'::TEXT, v_row.id, v_row.status, NULL::UUID,
      v_row.lease_epoch, NULL::TIMESTAMPTZ, v_row.next_attempt_at; RETURN;
  END IF;
  IF v_row.attempt_count >= p_max_attempts THEN
    UPDATE insight_card_follow_ups SET status = 'failed', lease_token = NULL,
      lease_expires_at = NULL, next_attempt_at = NULL, last_error_code = 'ATTEMPT_LIMIT',
      last_error_stage = 'claim', updated_at = v_now WHERE id = v_row.id RETURNING * INTO v_row;
    RETURN QUERY SELECT 'failed'::TEXT, v_row.id, v_row.status, NULL::UUID,
      v_row.lease_epoch, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ; RETURN;
  END IF;
  v_previous_status := v_row.status;
  v_token := gen_random_uuid();
  UPDATE insight_card_follow_ups SET status = 'generating', lease_token = v_token,
    lease_epoch = lease_epoch + 1, lease_expires_at = v_now + make_interval(secs => p_lease_ttl_seconds),
    attempt_count = attempt_count + 1, next_attempt_at = NULL, last_error_code = NULL,
    last_error_stage = NULL, updated_at = v_now WHERE id = v_row.id RETURNING * INTO v_row;
  RETURN QUERY SELECT CASE WHEN v_previous_status = 'generating' THEN 'owner_takeover' ELSE 'owner' END,
    v_row.id, v_row.status, v_row.lease_token, v_row.lease_epoch,
    v_row.lease_expires_at, NULL::TIMESTAMPTZ;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_insight_card_follow_up(
  p_follow_up_id UUID, p_user_id UUID, p_lease_token UUID, p_lease_epoch BIGINT,
  p_input_snapshot_json JSONB, p_answer_content_json JSONB, p_model_id TEXT,
  p_generation_metrics_json JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row insight_card_follow_ups%ROWTYPE;
  v_detail insight_card_details%ROWTYPE;
  v_ref TEXT;
BEGIN
  IF jsonb_typeof(p_input_snapshot_json) <> 'object'
     OR jsonb_typeof(p_answer_content_json) <> 'object'
     OR jsonb_typeof(p_answer_content_json->'fact_refs') <> 'array'
     OR jsonb_array_length(p_answer_content_json->'fact_refs') = 0 THEN RETURN FALSE; END IF;
  SELECT * INTO v_row FROM insight_card_follow_ups
  WHERE id = p_follow_up_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_row.model_id IS DISTINCT FROM p_model_id THEN RETURN FALSE; END IF;
  SELECT * INTO v_detail FROM insight_card_details
  WHERE id = v_row.detail_id AND user_id = p_user_id AND status = 'ready' FOR SHARE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  FOR v_ref IN SELECT jsonb_array_elements_text(p_answer_content_json->'fact_refs') LOOP
    IF NOT v_detail.fact_refs_json ? v_ref THEN RETURN FALSE; END IF;
  END LOOP;
  UPDATE insight_card_follow_ups SET status = 'ready', lease_token = NULL,
    lease_expires_at = NULL, next_attempt_at = NULL, input_snapshot_json = p_input_snapshot_json,
    answer_json = jsonb_build_object('follow_up_id', id, 'detail_id', detail_id,
      'parent_follow_up_id', parent_follow_up_id, 'question', question) || p_answer_content_json,
    model_id = p_model_id, generation_metrics_json = p_generation_metrics_json,
    provider_attempt_count = provider_attempt_count + COALESCE((p_generation_metrics_json->>'provider_calls')::INTEGER, 0),
    provider_input_bytes = provider_input_bytes + COALESCE((p_generation_metrics_json->>'input_bytes')::BIGINT, 0),
    ready_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE id = p_follow_up_id AND user_id = p_user_id AND status = 'generating'
    AND lease_token = p_lease_token AND lease_epoch = p_lease_epoch;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION retry_insight_card_content(
  p_kind TEXT, p_generation_id UUID, p_user_id UUID, p_lease_token UUID,
  p_lease_epoch BIGINT, p_retry_after_seconds INTEGER, p_error_code TEXT,
  p_error_stage TEXT, p_provider_calls INTEGER, p_provider_input_bytes BIGINT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_kind = 'detail' THEN
    UPDATE insight_card_details SET status = 'retry_wait', lease_token = NULL,
      lease_expires_at = NULL, next_attempt_at = clock_timestamp() + make_interval(secs => p_retry_after_seconds),
      provider_attempt_count = provider_attempt_count + GREATEST(p_provider_calls, 0),
      provider_input_bytes = provider_input_bytes + GREATEST(p_provider_input_bytes, 0),
      last_error_code = p_error_code, last_error_stage = p_error_stage, updated_at = clock_timestamp()
    WHERE id = p_generation_id AND user_id = p_user_id AND status = 'generating'
      AND lease_token = p_lease_token AND lease_epoch = p_lease_epoch;
  ELSIF p_kind = 'follow_up' THEN
    UPDATE insight_card_follow_ups SET status = 'retry_wait', lease_token = NULL,
      lease_expires_at = NULL, next_attempt_at = clock_timestamp() + make_interval(secs => p_retry_after_seconds),
      provider_attempt_count = provider_attempt_count + GREATEST(p_provider_calls, 0),
      provider_input_bytes = provider_input_bytes + GREATEST(p_provider_input_bytes, 0),
      last_error_code = p_error_code, last_error_stage = p_error_stage, updated_at = clock_timestamp()
    WHERE id = p_generation_id AND user_id = p_user_id AND status = 'generating'
      AND lease_token = p_lease_token AND lease_epoch = p_lease_epoch;
  ELSE RETURN FALSE; END IF;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION fail_insight_card_content(
  p_kind TEXT, p_generation_id UUID, p_user_id UUID, p_lease_token UUID,
  p_lease_epoch BIGINT, p_error_code TEXT, p_error_stage TEXT, p_provider_calls INTEGER,
  p_provider_input_bytes BIGINT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_kind = 'detail' THEN
    UPDATE insight_card_details SET status = 'failed', lease_token = NULL,
      lease_expires_at = NULL, next_attempt_at = NULL,
      provider_attempt_count = provider_attempt_count + GREATEST(p_provider_calls, 0),
      provider_input_bytes = provider_input_bytes + GREATEST(p_provider_input_bytes, 0),
      last_error_code = p_error_code, last_error_stage = p_error_stage, updated_at = clock_timestamp()
    WHERE id = p_generation_id AND user_id = p_user_id AND status = 'generating'
      AND lease_token = p_lease_token AND lease_epoch = p_lease_epoch;
  ELSIF p_kind = 'follow_up' THEN
    UPDATE insight_card_follow_ups SET status = 'failed', lease_token = NULL,
      lease_expires_at = NULL, next_attempt_at = NULL,
      provider_attempt_count = provider_attempt_count + GREATEST(p_provider_calls, 0),
      provider_input_bytes = provider_input_bytes + GREATEST(p_provider_input_bytes, 0),
      last_error_code = p_error_code, last_error_stage = p_error_stage, updated_at = clock_timestamp()
    WHERE id = p_generation_id AND user_id = p_user_id AND status = 'generating'
      AND lease_token = p_lease_token AND lease_epoch = p_lease_epoch;
  ELSE RETURN FALSE; END IF;
  RETURN FOUND;
END;
$$;

ALTER TABLE insight_card_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE insight_card_follow_ups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE insight_card_details, insight_card_follow_ups FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON insight_card_details, insight_card_follow_ups TO service_role;

REVOKE ALL ON FUNCTION claim_medium_insight_batch_v2(UUID, UUID, DATE, TIMESTAMPTZ, TEXT, JSONB, JSONB, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_insight_card_detail(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finalize_insight_card_detail(UUID, UUID, UUID, BIGINT, JSONB, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_insight_follow_up_ancestry(UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_insight_card_follow_up(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finalize_insight_card_follow_up(UUID, UUID, UUID, BIGINT, JSONB, JSONB, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION retry_insight_card_content(TEXT, UUID, UUID, UUID, BIGINT, INTEGER, TEXT, TEXT, INTEGER, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fail_insight_card_content(TEXT, UUID, UUID, UUID, BIGINT, TEXT, TEXT, INTEGER, BIGINT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION claim_medium_insight_batch_v2(UUID, UUID, DATE, TIMESTAMPTZ, TEXT, JSONB, JSONB, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION claim_insight_card_detail(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_insight_card_detail(UUID, UUID, UUID, BIGINT, JSONB, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION get_insight_follow_up_ancestry(UUID, UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION claim_insight_card_follow_up(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_insight_card_follow_up(UUID, UUID, UUID, BIGINT, JSONB, JSONB, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION retry_insight_card_content(TEXT, UUID, UUID, UUID, BIGINT, INTEGER, TEXT, TEXT, INTEGER, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION fail_insight_card_content(TEXT, UUID, UUID, UUID, BIGINT, TEXT, TEXT, INTEGER, BIGINT) TO service_role;
