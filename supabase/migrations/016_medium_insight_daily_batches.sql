-- Medium Daily Batch V1: five domains x eight immutable daily insight cards.
-- Independent of daily_fortune_artifacts and recommendation_batches.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS medium_insight_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_key TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES bazi_profiles(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  batch_revision SMALLINT NOT NULL DEFAULT 0 CHECK (batch_revision IN (0, 1)),
  supersedes_batch_id UUID REFERENCES medium_insight_batches(id) ON DELETE RESTRICT,
  generation_timezone TEXT NOT NULL CHECK (length(btrim(generation_timezone)) BETWEEN 1 AND 128),
  source_boundary_at TIMESTAMPTZ NOT NULL,
  profile_updated_at TIMESTAMPTZ NOT NULL,
  fact_hash TEXT NOT NULL CHECK (length(fact_hash) = 64),
  fact_snapshot_json JSONB NOT NULL CHECK (jsonb_typeof(fact_snapshot_json) = 'object'),
  soft_context_snapshot_json JSONB NOT NULL CHECK (jsonb_typeof(soft_context_snapshot_json) = 'object'),
  status TEXT NOT NULL CHECK (status IN ('generating', 'retry_wait', 'ready', 'failed')),
  lease_token UUID,
  lease_epoch BIGINT NOT NULL DEFAULT 1 CHECK (lease_epoch >= 1),
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 3),
  next_attempt_at TIMESTAMPTZ,
  cards_json JSONB,
  contract_version TEXT NOT NULL,
  fact_projection_version TEXT NOT NULL,
  prompt_version TEXT,
  output_schema_version TEXT,
  generator_version TEXT NOT NULL,
  model_id TEXT,
  generation_metrics_json JSONB,
  last_error_code TEXT,
  last_error_stage TEXT,
  ready_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT medium_insight_revision_shape CHECK (
    (batch_revision = 0 AND supersedes_batch_id IS NULL)
    OR (batch_revision = 1 AND supersedes_batch_id IS NOT NULL)
  ),
  CONSTRAINT medium_insight_status_shape CHECK (
    (status = 'generating' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND next_attempt_at IS NULL AND cards_json IS NULL AND ready_at IS NULL)
    OR (status = 'retry_wait' AND lease_token IS NULL AND lease_expires_at IS NULL AND next_attempt_at IS NOT NULL AND cards_json IS NULL AND ready_at IS NULL)
    OR (status = 'failed' AND lease_token IS NULL AND lease_expires_at IS NULL AND next_attempt_at IS NULL AND cards_json IS NULL AND ready_at IS NULL)
    OR (status = 'ready' AND lease_token IS NULL AND lease_expires_at IS NULL AND next_attempt_at IS NULL AND cards_json IS NOT NULL AND ready_at IS NOT NULL AND prompt_version IS NOT NULL AND output_schema_version IS NOT NULL AND model_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_medium_insight_batch_day_revision
  ON medium_insight_batches(user_id, profile_id, effective_date, batch_revision);
CREATE INDEX IF NOT EXISTS idx_medium_insight_batch_head
  ON medium_insight_batches(user_id, profile_id, effective_date DESC, batch_revision DESC);
CREATE INDEX IF NOT EXISTS idx_medium_insight_batch_ready_history
  ON medium_insight_batches(user_id, profile_id, effective_date DESC)
  WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS idx_medium_insight_batch_active
  ON medium_insight_batches(status, next_attempt_at, lease_expires_at)
  WHERE status IN ('generating', 'retry_wait');

CREATE OR REPLACE FUNCTION validate_medium_insight_supersedes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base medium_insight_batches%ROWTYPE;
BEGIN
  IF NEW.batch_revision = 0 THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_base
  FROM medium_insight_batches
  WHERE id = NEW.supersedes_batch_id
  FOR SHARE;
  IF NOT FOUND
     OR v_base.user_id <> NEW.user_id
     OR v_base.profile_id <> NEW.profile_id
     OR v_base.effective_date <> NEW.effective_date
     OR v_base.batch_revision <> 0 THEN
    RAISE EXCEPTION 'medium insight replacement must supersede its same-day revision 0'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_medium_insight_supersedes_trigger ON medium_insight_batches;
CREATE TRIGGER validate_medium_insight_supersedes_trigger
  BEFORE INSERT ON medium_insight_batches
  FOR EACH ROW EXECUTE FUNCTION validate_medium_insight_supersedes();

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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_ready_medium_insight_batch_trigger ON medium_insight_batches;
CREATE TRIGGER protect_ready_medium_insight_batch_trigger
  BEFORE UPDATE ON medium_insight_batches
  FOR EACH ROW EXECUTE FUNCTION protect_ready_medium_insight_batch();

CREATE OR REPLACE FUNCTION claim_medium_insight_batch(
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
  p_generator_version TEXT,
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
  v_revision SMALLINT;
  v_supersedes UUID;
  v_generation_key TEXT;
  v_token UUID;
  v_active_count INTEGER;
  v_previous_status TEXT;
BEGIN
  IF p_candidate_date IS NULL OR p_source_boundary_at IS NULL OR p_profile_updated_at IS NULL THEN
    RAISE EXCEPTION 'medium insight claim requires date, boundary, and profile revision' USING ERRCODE = '22023';
  END IF;
  IF p_fact_hash IS NULL OR length(p_fact_hash) <> 64 THEN
    RAISE EXCEPTION 'medium insight fact hash must be sha256' USING ERRCODE = '22023';
  END IF;
  IF p_fact_snapshot_json IS NULL OR jsonb_typeof(p_fact_snapshot_json) <> 'object'
     OR p_soft_context_snapshot_json IS NULL OR jsonb_typeof(p_soft_context_snapshot_json) <> 'object' THEN
    RAISE EXCEPTION 'medium insight snapshots must be objects' USING ERRCODE = '22023';
  END IF;
  IF p_lease_ttl_seconds NOT BETWEEN 130 AND 300 OR p_max_attempts NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'medium insight lease or attempts out of range' USING ERRCODE = '22023';
  END IF;

  -- This row lock is the per-profile serialization boundary. Date watermark,
  -- fact revision selection, and generation ownership are one transaction.
  SELECT profile.updated_at, profile.is_owner
  INTO v_profile_updated_at, v_profile_is_owner
  FROM bazi_profiles AS profile
  WHERE profile.id = p_profile_id
    AND profile.owner_user_id = p_user_id
    AND profile.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_profile_is_owner IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'medium insight profile is not the owned self profile' USING ERRCODE = '42501';
  END IF;
  IF v_profile_updated_at IS DISTINCT FROM p_profile_updated_at THEN
    RAISE EXCEPTION 'medium insight profile revision changed before claim' USING ERRCODE = '40001';
  END IF;

  SELECT batch.* INTO v_head
  FROM medium_insight_batches AS batch
  WHERE batch.user_id = p_user_id AND batch.profile_id = p_profile_id
  ORDER BY batch.effective_date DESC, batch.batch_revision DESC
  LIMIT 1
  FOR UPDATE;

  IF v_head.id IS NULL OR p_candidate_date > v_head.effective_date THEN
    v_target_date := p_candidate_date;
    v_revision := 0;
    v_supersedes := NULL;
  ELSE
    v_target_date := v_head.effective_date;
    IF v_head.fact_hash = p_fact_hash THEN
      v_batch := v_head;
    ELSIF v_head.batch_revision = 0 THEN
      v_revision := 1;
      v_supersedes := v_head.id;
    ELSE
      RETURN QUERY SELECT 'fact_revision_exhausted'::TEXT, v_head.id, v_head.status,
        v_target_date, p_candidate_date < v_target_date, NULL::UUID, v_head.lease_epoch,
        NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
  END IF;

  -- The service first reads the current head and builds facts for that date. If
  -- another request advances the head before this lock is acquired, force one
  -- bounded retry instead of storing a snapshot under the wrong day.
  IF p_fact_snapshot_json->>'effective_date' IS DISTINCT FROM v_target_date::TEXT THEN
    RAISE EXCEPTION 'medium insight target date changed during claim' USING ERRCODE = '40001';
  END IF;

  IF v_batch.id IS NOT NULL THEN
    IF v_batch.status = 'ready' THEN
      RETURN QUERY SELECT 'ready'::TEXT, v_batch.id, v_batch.status, v_target_date,
        p_candidate_date < v_target_date, NULL::UUID, v_batch.lease_epoch, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    IF v_batch.status = 'failed' THEN
      RETURN QUERY SELECT 'failed'::TEXT, v_batch.id, v_batch.status, v_target_date,
        p_candidate_date < v_target_date, NULL::UUID, v_batch.lease_epoch, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    IF v_batch.status = 'generating' AND v_batch.lease_expires_at > v_now THEN
      RETURN QUERY SELECT 'join'::TEXT, v_batch.id, v_batch.status, v_target_date,
        p_candidate_date < v_target_date, NULL::UUID, v_batch.lease_epoch, v_batch.lease_expires_at, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
    IF v_batch.status = 'retry_wait' AND v_batch.next_attempt_at > v_now THEN
      RETURN QUERY SELECT 'wait'::TEXT, v_batch.id, v_batch.status, v_target_date,
        p_candidate_date < v_target_date, NULL::UUID, v_batch.lease_epoch, NULL::TIMESTAMPTZ, v_batch.next_attempt_at;
      RETURN;
    END IF;
    IF v_batch.attempt_count >= p_max_attempts THEN
      UPDATE medium_insight_batches SET status = 'failed', lease_token = NULL,
        lease_expires_at = NULL, next_attempt_at = NULL, last_error_code = 'ATTEMPT_LIMIT',
        last_error_stage = 'claim', updated_at = v_now WHERE id = v_batch.id;
      RETURN QUERY SELECT 'failed'::TEXT, v_batch.id, 'failed'::TEXT, v_target_date,
        p_candidate_date < v_target_date, NULL::UUID, v_batch.lease_epoch, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_active_count
  FROM medium_insight_batches
  WHERE status = 'generating' AND lease_expires_at > v_now
    AND (v_batch.id IS NULL OR id <> v_batch.id);
  IF v_active_count >= p_max_active_generations THEN
    RETURN QUERY SELECT 'busy'::TEXT, v_batch.id, v_batch.status, v_target_date,
      p_candidate_date < v_target_date, NULL::UUID, COALESCE(v_batch.lease_epoch, 0), NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_token := gen_random_uuid();
  IF v_batch.id IS NULL THEN
    v_generation_key := encode(extensions.digest(
      concat_ws('|', p_user_id::TEXT, p_profile_id::TEXT, v_target_date::TEXT, p_fact_hash),
      'sha256'
    ), 'hex');
    INSERT INTO medium_insight_batches (
      generation_key, user_id, profile_id, effective_date, batch_revision,
      supersedes_batch_id, generation_timezone, source_boundary_at,
      profile_updated_at, fact_hash, fact_snapshot_json, soft_context_snapshot_json,
      status, lease_token, lease_epoch, lease_expires_at, attempt_count,
      contract_version, fact_projection_version, generator_version
    ) VALUES (
      v_generation_key, p_user_id, p_profile_id, v_target_date, v_revision,
      v_supersedes, p_generation_timezone, p_source_boundary_at,
      p_profile_updated_at, p_fact_hash, p_fact_snapshot_json, p_soft_context_snapshot_json,
      'generating', v_token, 1, v_now + make_interval(secs => p_lease_ttl_seconds), 1,
      p_contract_version, p_fact_projection_version, p_generator_version
    ) RETURNING * INTO v_batch;
    RETURN QUERY SELECT 'owner'::TEXT, v_batch.id, v_batch.status, v_target_date,
      p_candidate_date < v_target_date, v_batch.lease_token, v_batch.lease_epoch, v_batch.lease_expires_at, NULL::TIMESTAMPTZ;
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'medium insight claim state changed unexpectedly' USING ERRCODE = '40001';
  END IF;
  RETURN QUERY SELECT CASE WHEN v_previous_status = 'generating' THEN 'owner_takeover' ELSE 'owner' END,
    v_batch.id, v_batch.status, v_target_date, p_candidate_date < v_target_date,
    v_batch.lease_token, v_batch.lease_epoch, v_batch.lease_expires_at, NULL::TIMESTAMPTZ;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_medium_insight_batch(
  p_batch_id UUID,
  p_user_id UUID,
  p_lease_token UUID,
  p_lease_epoch BIGINT,
  p_cards_json JSONB,
  p_prompt_version TEXT,
  p_output_schema_version TEXT,
  p_model_id TEXT,
  p_generation_metrics_json JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_domain JSONB;
  v_profile_updated_at TIMESTAMPTZ;
  v_batch medium_insight_batches%ROWTYPE;
BEGIN
  IF p_cards_json IS NULL OR jsonb_typeof(p_cards_json) <> 'object'
     OR jsonb_typeof(p_cards_json -> 'domains') <> 'array'
     OR jsonb_array_length(p_cards_json -> 'domains') <> 5 THEN
    RETURN FALSE;
  END IF;
  FOR v_domain IN SELECT value FROM jsonb_array_elements(p_cards_json -> 'domains') LOOP
    IF jsonb_typeof(v_domain -> 'cards') <> 'array' OR jsonb_array_length(v_domain -> 'cards') <> 8 THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  SELECT * INTO v_batch FROM medium_insight_batches
  WHERE id = p_batch_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  SELECT updated_at INTO v_profile_updated_at FROM bazi_profiles
  WHERE id = v_batch.profile_id AND owner_user_id = p_user_id AND deleted_at IS NULL FOR SHARE;
  IF v_profile_updated_at IS DISTINCT FROM v_batch.profile_updated_at THEN RETURN FALSE; END IF;
  IF EXISTS (
    SELECT 1 FROM medium_insight_batches newer
    WHERE newer.user_id = v_batch.user_id AND newer.profile_id = v_batch.profile_id
      AND (newer.effective_date > v_batch.effective_date
        OR (newer.effective_date = v_batch.effective_date AND newer.batch_revision > v_batch.batch_revision))
  ) THEN RETURN FALSE; END IF;

  UPDATE medium_insight_batches SET status = 'ready', lease_token = NULL,
    lease_expires_at = NULL, next_attempt_at = NULL, cards_json = p_cards_json,
    prompt_version = p_prompt_version, output_schema_version = p_output_schema_version,
    model_id = p_model_id, generation_metrics_json = p_generation_metrics_json,
    ready_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE id = p_batch_id AND user_id = p_user_id AND status = 'generating'
    AND lease_token = p_lease_token AND lease_epoch = p_lease_epoch;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION retry_medium_insight_batch(
  p_batch_id UUID, p_user_id UUID, p_lease_token UUID, p_lease_epoch BIGINT,
  p_retry_after_seconds INTEGER, p_error_code TEXT, p_error_stage TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE medium_insight_batches SET status = 'retry_wait', lease_token = NULL,
    lease_expires_at = NULL, next_attempt_at = clock_timestamp() + make_interval(secs => p_retry_after_seconds),
    last_error_code = p_error_code, last_error_stage = p_error_stage, updated_at = clock_timestamp()
  WHERE id = p_batch_id AND user_id = p_user_id AND status = 'generating'
    AND lease_token = p_lease_token AND lease_epoch = p_lease_epoch;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION fail_medium_insight_batch(
  p_batch_id UUID, p_user_id UUID, p_lease_token UUID, p_lease_epoch BIGINT,
  p_error_code TEXT, p_error_stage TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE medium_insight_batches SET status = 'failed', lease_token = NULL,
    lease_expires_at = NULL, next_attempt_at = NULL, last_error_code = p_error_code,
    last_error_stage = p_error_stage, updated_at = clock_timestamp()
  WHERE id = p_batch_id AND user_id = p_user_id AND status = 'generating'
    AND lease_token = p_lease_token AND lease_epoch = p_lease_epoch;
  RETURN FOUND;
END;
$$;

CREATE TABLE IF NOT EXISTS medium_insight_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES bazi_profiles(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES medium_insight_batches(id) ON DELETE CASCADE,
  content_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN ('section_impression', 'batch_ready_presented', 'generation_error_presented', 'exposure', 'open')),
  session_id TEXT NOT NULL CHECK (length(session_id) BETWEEN 1 AND 128),
  domain TEXT CHECK (domain IS NULL OR domain IN ('career', 'wealth', 'love', 'health', 'study')),
  content_type TEXT CHECK (content_type IS NULL OR content_type IN ('pattern', 'self_explanation', 'strength', 'tension', 'fit')),
  position SMALLINT CHECK (position IS NULL OR position BETWEEN 0 AND 7),
  client_wait_ms INTEGER CHECK (client_wait_ms IS NULL OR client_wait_ms BETWEEN 0 AND 300000),
  rollout_cohort TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT medium_insight_event_shape CHECK (
    (event_type IN ('exposure', 'open') AND batch_id IS NOT NULL AND content_id IS NOT NULL AND domain IS NOT NULL AND content_type IS NOT NULL AND position IS NOT NULL)
    OR (event_type = 'batch_ready_presented' AND batch_id IS NOT NULL AND content_id IS NULL AND domain IS NULL AND content_type IS NULL AND position IS NULL)
    OR (event_type IN ('section_impression', 'generation_error_presented') AND batch_id IS NULL AND content_id IS NULL AND domain IS NULL AND content_type IS NULL AND position IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_medium_insight_event_card_natural
  ON medium_insight_events(user_id, batch_id, content_id, event_type, session_id)
  WHERE event_type IN ('exposure', 'open');
CREATE UNIQUE INDEX IF NOT EXISTS idx_medium_insight_event_lifecycle_natural
  ON medium_insight_events(user_id, profile_id, event_type, session_id, COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::UUID))
  WHERE event_type IN ('section_impression', 'batch_ready_presented', 'generation_error_presented');

CREATE OR REPLACE FUNCTION record_medium_insight_event(
  p_event_id UUID, p_user_id UUID, p_profile_id UUID, p_batch_id UUID,
  p_content_id UUID, p_event_type TEXT, p_session_id TEXT,
  p_client_wait_ms INTEGER, p_occurred_at TIMESTAMPTZ, p_rollout_cohort TEXT
)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_batch medium_insight_batches%ROWTYPE;
  v_card JSONB;
  v_domain TEXT;
BEGIN
  PERFORM 1 FROM bazi_profiles WHERE id = p_profile_id AND owner_user_id = p_user_id
    AND is_owner = TRUE AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'medium insight event profile mismatch' USING ERRCODE = '42501'; END IF;

  IF p_event_type IN ('exposure', 'open', 'batch_ready_presented') THEN
    SELECT * INTO v_batch FROM medium_insight_batches
    WHERE id = p_batch_id AND user_id = p_user_id AND profile_id = p_profile_id AND status = 'ready';
    IF NOT FOUND THEN RAISE EXCEPTION 'medium insight event batch mismatch' USING ERRCODE = '42501'; END IF;
  END IF;
  IF p_event_type IN ('exposure', 'open') THEN
    SELECT card, domain->>'domain' INTO v_card, v_domain
    FROM jsonb_array_elements(v_batch.cards_json -> 'domains') AS domain,
      jsonb_array_elements(domain -> 'cards') AS card
    WHERE card ->> 'content_id' = p_content_id::TEXT LIMIT 1;
    IF v_card IS NULL THEN RAISE EXCEPTION 'medium insight event content mismatch' USING ERRCODE = '42501'; END IF;
  END IF;

  INSERT INTO medium_insight_events (
    event_id, user_id, profile_id, batch_id, content_id, event_type, session_id,
    domain, content_type, position, client_wait_ms, rollout_cohort, occurred_at
  ) VALUES (
    p_event_id, p_user_id, p_profile_id, p_batch_id, p_content_id, p_event_type, p_session_id,
    CASE WHEN v_card IS NULL THEN NULL ELSE v_domain END,
    CASE WHEN v_card IS NULL THEN NULL ELSE v_card->>'content_type' END,
    CASE WHEN v_card IS NULL THEN NULL ELSE (v_card->>'position')::SMALLINT END,
    p_client_wait_ms, p_rollout_cohort, p_occurred_at
  ) ON CONFLICT DO NOTHING;
  RETURN CASE WHEN FOUND THEN 'recorded' ELSE 'duplicate' END;
END;
$$;

ALTER TABLE medium_insight_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE medium_insight_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE medium_insight_batches, medium_insight_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON medium_insight_batches, medium_insight_events TO service_role;
REVOKE ALL ON FUNCTION claim_medium_insight_batch(UUID, UUID, DATE, TIMESTAMPTZ, TEXT, JSONB, JSONB, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finalize_medium_insight_batch(UUID, UUID, UUID, BIGINT, JSONB, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION retry_medium_insight_batch(UUID, UUID, UUID, BIGINT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fail_medium_insight_batch(UUID, UUID, UUID, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_medium_insight_event(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_medium_insight_batch(UUID, UUID, DATE, TIMESTAMPTZ, TEXT, JSONB, JSONB, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_medium_insight_batch(UUID, UUID, UUID, BIGINT, JSONB, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION retry_medium_insight_batch(UUID, UUID, UUID, BIGINT, INTEGER, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fail_medium_insight_batch(UUID, UUID, UUID, BIGINT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION record_medium_insight_event(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TEXT) TO service_role;
