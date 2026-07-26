-- ============================================================
-- 011_daily_fortune_artifacts.sql
-- 首页日运 V2：不可变 READY artifact 与数据库级 single-flight
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_fortune_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_key TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES bazi_profiles(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  profile_revision_hash TEXT NOT NULL,
  profile_updated_at TIMESTAMPTZ NOT NULL,
  generation_timezone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('generating', 'retry_wait', 'ready')),
  lease_token UUID,
  lease_epoch BIGINT NOT NULL DEFAULT 1 CHECK (lease_epoch >= 1),
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  next_attempt_at TIMESTAMPTZ,
  fact_contract_version TEXT,
  fact_hash TEXT,
  fact_snapshot_json JSONB,
  day_context_json JSONB,
  content_json JSONB,
  prompt_version TEXT,
  output_schema_version TEXT,
  generation_config_version TEXT,
  model_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at TIMESTAMPTZ,

  CONSTRAINT daily_fortune_generation_key_not_blank
    CHECK (length(btrim(generation_key)) BETWEEN 1 AND 256),
  CONSTRAINT daily_fortune_profile_revision_hash_not_blank
    CHECK (length(btrim(profile_revision_hash)) BETWEEN 1 AND 256),
  CONSTRAINT daily_fortune_generation_timezone_not_blank
    CHECK (length(btrim(generation_timezone)) BETWEEN 1 AND 128),
  CONSTRAINT daily_fortune_fact_snapshot_is_object
    CHECK (fact_snapshot_json IS NULL OR jsonb_typeof(fact_snapshot_json) = 'object'),
  CONSTRAINT daily_fortune_day_context_is_object
    CHECK (day_context_json IS NULL OR jsonb_typeof(day_context_json) = 'object'),
  CONSTRAINT daily_fortune_content_is_object
    CHECK (content_json IS NULL OR jsonb_typeof(content_json) = 'object'),
  CONSTRAINT daily_fortune_status_payload_consistency
    CHECK (
      (
        status = 'generating'
        AND lease_token IS NOT NULL
        AND lease_expires_at IS NOT NULL
        AND next_attempt_at IS NULL
        AND fact_contract_version IS NULL
        AND fact_hash IS NULL
        AND fact_snapshot_json IS NULL
        AND day_context_json IS NULL
        AND content_json IS NULL
        AND prompt_version IS NULL
        AND output_schema_version IS NULL
        AND generation_config_version IS NULL
        AND model_id IS NULL
        AND ready_at IS NULL
      )
      OR
      (
        status = 'retry_wait'
        AND lease_token IS NULL
        AND lease_expires_at IS NULL
        AND next_attempt_at IS NOT NULL
        AND fact_contract_version IS NULL
        AND fact_hash IS NULL
        AND fact_snapshot_json IS NULL
        AND day_context_json IS NULL
        AND content_json IS NULL
        AND prompt_version IS NULL
        AND output_schema_version IS NULL
        AND generation_config_version IS NULL
        AND model_id IS NULL
        AND ready_at IS NULL
      )
      OR
      (
        status = 'ready'
        AND lease_token IS NULL
        AND lease_expires_at IS NULL
        AND next_attempt_at IS NULL
        AND fact_contract_version IS NOT NULL
        AND length(btrim(fact_contract_version)) > 0
        AND fact_hash IS NOT NULL
        AND length(btrim(fact_hash)) > 0
        AND fact_snapshot_json IS NOT NULL
        AND day_context_json IS NOT NULL
        AND content_json IS NOT NULL
        AND prompt_version IS NOT NULL
        AND length(btrim(prompt_version)) > 0
        AND output_schema_version IS NOT NULL
        AND length(btrim(output_schema_version)) > 0
        AND generation_config_version IS NOT NULL
        AND length(btrim(generation_config_version)) > 0
        AND model_id IS NOT NULL
        AND length(btrim(model_id)) > 0
        AND ready_at IS NOT NULL
      )
    )
);

COMMENT ON TABLE daily_fortune_artifacts IS
  '首页日运 V2 artifact；同一生成身份 single-flight，READY 内容不可变';
COMMENT ON COLUMN daily_fortune_artifacts.generation_key IS
  '服务端由 user/profile/effective_date/profile_revision_hash 规范生成的稳定键';
COMMENT ON COLUMN daily_fortune_artifacts.profile_updated_at IS
  '首次 claim 时的档案并发快照，不属于内容唯一身份';
COMMENT ON COLUMN daily_fortune_artifacts.fact_snapshot_json IS
  '实际发送给日运 AI 的规范化事实快照；失败 attempt 不保存正文';
COMMENT ON COLUMN daily_fortune_artifacts.content_json IS
  '一次 AI 请求生成的完整 overall + exactly two scenes 内容，仅 READY 存在';

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_fortune_generation_key
  ON daily_fortune_artifacts(generation_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_fortune_generation_identity
  ON daily_fortune_artifacts(
    user_id,
    profile_id,
    effective_date,
    profile_revision_hash
  );

CREATE INDEX IF NOT EXISTS idx_daily_fortune_user_status
  ON daily_fortune_artifacts(user_id, status, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_daily_fortune_profile_date
  ON daily_fortune_artifacts(user_id, profile_id, effective_date DESC);

CREATE OR REPLACE FUNCTION prevent_ready_daily_fortune_artifact_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'ready' THEN
    RAISE EXCEPTION 'READY daily fortune artifacts are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.generation_key IS DISTINCT FROM OLD.generation_key
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
     OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
     OR NEW.profile_revision_hash IS DISTINCT FROM OLD.profile_revision_hash
     OR NEW.profile_updated_at IS DISTINCT FROM OLD.profile_updated_at THEN
    RAISE EXCEPTION 'Daily fortune artifact identity and profile snapshot are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'generating'
     AND NEW.status NOT IN ('generating', 'retry_wait', 'ready') THEN
    RAISE EXCEPTION 'Invalid daily fortune transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'retry_wait' AND NEW.status <> 'generating' THEN
    RAISE EXCEPTION 'Invalid daily fortune transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_ready_daily_fortune_artifact
  ON daily_fortune_artifacts;

CREATE TRIGGER protect_ready_daily_fortune_artifact
  BEFORE UPDATE ON daily_fortune_artifacts
  FOR EACH ROW
  EXECUTE FUNCTION prevent_ready_daily_fortune_artifact_update();

CREATE OR REPLACE FUNCTION claim_daily_fortune_artifact(
  p_generation_key TEXT,
  p_user_id UUID,
  p_profile_id UUID,
  p_effective_date DATE,
  p_profile_revision_hash TEXT,
  p_profile_updated_at TIMESTAMPTZ,
  p_generation_timezone TEXT,
  p_lease_ttl_seconds INTEGER DEFAULT 45,
  p_max_active_generations INTEGER DEFAULT 20
)
RETURNS TABLE (
  claim_outcome TEXT,
  artifact_id UUID,
  artifact_status TEXT,
  claim_lease_token UUID,
  claim_lease_epoch BIGINT,
  claim_lease_expires_at TIMESTAMPTZ,
  claim_next_attempt_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now TIMESTAMPTZ;
  v_artifact daily_fortune_artifacts%ROWTYPE;
  v_active_count INTEGER;
  v_user_active_count INTEGER;
  v_new_token UUID;
  v_previous_status TEXT;
  v_profile_updated_at TIMESTAMPTZ;
BEGIN
  IF p_generation_key IS NULL
     OR length(btrim(p_generation_key)) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'generation_key is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_profile_revision_hash IS NULL
     OR length(btrim(p_profile_revision_hash)) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'profile_revision_hash is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_profile_updated_at IS NULL THEN
    RAISE EXCEPTION 'profile_updated_at is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_generation_timezone IS NULL
     OR length(btrim(p_generation_timezone)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'generation_timezone is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_lease_ttl_seconds IS NULL
     OR p_lease_ttl_seconds < 5
     OR p_lease_ttl_seconds > 300 THEN
    RAISE EXCEPTION 'lease_ttl_seconds must be between 5 and 300'
      USING ERRCODE = '22023';
  END IF;

  IF p_max_active_generations IS NULL
     OR p_max_active_generations < 1
     OR p_max_active_generations > 10000 THEN
    RAISE EXCEPTION 'max_active_generations must be between 1 and 10000'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.updated_at
  INTO v_profile_updated_at
  FROM bazi_profiles AS profile
  WHERE profile.id = p_profile_id
    AND profile.owner_user_id = p_user_id
    AND profile.deleted_at IS NULL
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile is not owned by user'
      USING ERRCODE = '42501';
  END IF;

  IF v_profile_updated_at IS NULL
     OR v_profile_updated_at <> p_profile_updated_at THEN
    RAISE EXCEPTION 'Profile revision changed before daily fortune claim'
      USING ERRCODE = '40001';
  END IF;

  -- Capacity checks and identity creation/takeover must be serialized across
  -- serverless workers. The lock is held only for this short transaction.
  PERFORM pg_advisory_xact_lock(72451020260723::BIGINT);
  v_now := clock_timestamp();

  SELECT artifact.*
  INTO v_artifact
  FROM daily_fortune_artifacts AS artifact
  WHERE artifact.generation_key = p_generation_key
  FOR UPDATE;

  IF FOUND AND (
    v_artifact.user_id <> p_user_id
    OR v_artifact.profile_id <> p_profile_id
    OR v_artifact.effective_date <> p_effective_date
    OR v_artifact.profile_revision_hash <> p_profile_revision_hash
  ) THEN
    RAISE EXCEPTION 'generation_key belongs to a different identity'
      USING ERRCODE = '23505';
  END IF;

  IF NOT FOUND THEN
    SELECT artifact.*
    INTO v_artifact
    FROM daily_fortune_artifacts AS artifact
    WHERE artifact.user_id = p_user_id
      AND artifact.profile_id = p_profile_id
      AND artifact.effective_date = p_effective_date
      AND artifact.profile_revision_hash = p_profile_revision_hash
    FOR UPDATE;
  END IF;

  IF FOUND AND v_artifact.generation_key <> p_generation_key THEN
    RAISE EXCEPTION 'Daily fortune identity metadata is inconsistent'
      USING ERRCODE = '23505';
  END IF;

  IF FOUND AND v_artifact.status = 'ready' THEN
    RETURN QUERY SELECT
      'ready'::TEXT,
      v_artifact.id,
      v_artifact.status,
      NULL::UUID,
      v_artifact.lease_epoch,
      NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF FOUND
     AND v_artifact.status = 'generating'
     AND v_artifact.lease_expires_at > v_now THEN
    RETURN QUERY SELECT
      'join'::TEXT,
      v_artifact.id,
      v_artifact.status,
      NULL::UUID,
      v_artifact.lease_epoch,
      v_artifact.lease_expires_at,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF FOUND
     AND v_artifact.status = 'retry_wait'
     AND v_artifact.next_attempt_at > v_now THEN
    RETURN QUERY SELECT
      'wait'::TEXT,
      v_artifact.id,
      v_artifact.status,
      NULL::UUID,
      v_artifact.lease_epoch,
      NULL::TIMESTAMPTZ,
      v_artifact.next_attempt_at;
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO v_user_active_count
  FROM daily_fortune_artifacts AS artifact
  WHERE artifact.user_id = p_user_id
    AND artifact.status = 'generating'
    AND artifact.lease_expires_at > v_now
    AND (v_artifact.id IS NULL OR artifact.id <> v_artifact.id);

  IF v_user_active_count > 0 THEN
    RETURN QUERY SELECT
      'busy'::TEXT,
      CASE WHEN v_artifact.id IS NULL THEN NULL::UUID ELSE v_artifact.id END,
      CASE WHEN v_artifact.id IS NULL THEN NULL::TEXT ELSE v_artifact.status END,
      NULL::UUID,
      CASE WHEN v_artifact.id IS NULL THEN 0::BIGINT ELSE v_artifact.lease_epoch END,
      NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO v_active_count
  FROM daily_fortune_artifacts AS artifact
  WHERE artifact.status = 'generating'
    AND artifact.lease_expires_at > v_now
    AND (v_artifact.id IS NULL OR artifact.id <> v_artifact.id);

  IF v_active_count >= p_max_active_generations THEN
    RETURN QUERY SELECT
      'busy'::TEXT,
      CASE WHEN v_artifact.id IS NULL THEN NULL::UUID ELSE v_artifact.id END,
      CASE WHEN v_artifact.id IS NULL THEN NULL::TEXT ELSE v_artifact.status END,
      NULL::UUID,
      CASE WHEN v_artifact.id IS NULL THEN 0::BIGINT ELSE v_artifact.lease_epoch END,
      NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_new_token := gen_random_uuid();

  IF v_artifact.id IS NULL THEN
    INSERT INTO daily_fortune_artifacts (
      generation_key,
      user_id,
      profile_id,
      effective_date,
      profile_revision_hash,
      profile_updated_at,
      generation_timezone,
      status,
      lease_token,
      lease_epoch,
      lease_expires_at,
      attempt_count
    )
    VALUES (
      p_generation_key,
      p_user_id,
      p_profile_id,
      p_effective_date,
      p_profile_revision_hash,
      p_profile_updated_at,
      p_generation_timezone,
      'generating',
      v_new_token,
      1,
      v_now + make_interval(secs => p_lease_ttl_seconds),
      1
    )
    RETURNING * INTO v_artifact;

    RETURN QUERY SELECT
      'owner'::TEXT,
      v_artifact.id,
      v_artifact.status,
      v_artifact.lease_token,
      v_artifact.lease_epoch,
      v_artifact.lease_expires_at,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_previous_status := v_artifact.status;

  UPDATE daily_fortune_artifacts AS artifact
  SET
    generation_timezone = p_generation_timezone,
    status = 'generating',
    lease_token = v_new_token,
    lease_epoch = artifact.lease_epoch + 1,
    lease_expires_at = v_now + make_interval(secs => p_lease_ttl_seconds),
    attempt_count = artifact.attempt_count + 1,
    next_attempt_at = NULL
  WHERE artifact.id = v_artifact.id
    AND (
      (
        artifact.status = 'generating'
        AND artifact.lease_expires_at <= v_now
      )
      OR
      (
        artifact.status = 'retry_wait'
        AND artifact.next_attempt_at <= v_now
      )
    )
  RETURNING artifact.* INTO v_artifact;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'daily fortune claim state changed unexpectedly'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT
    CASE
      WHEN v_previous_status = 'generating' THEN 'owner_takeover'::TEXT
      ELSE 'owner'::TEXT
    END,
    v_artifact.id,
    v_artifact.status,
    v_artifact.lease_token,
    v_artifact.lease_epoch,
    v_artifact.lease_expires_at,
    NULL::TIMESTAMPTZ;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_daily_fortune_artifact(
  p_artifact_id UUID,
  p_user_id UUID,
  p_lease_token UUID,
  p_lease_epoch BIGINT,
  p_fact_contract_version TEXT,
  p_fact_hash TEXT,
  p_fact_snapshot_json JSONB,
  p_day_context_json JSONB,
  p_content_json JSONB,
  p_prompt_version TEXT,
  p_output_schema_version TEXT,
  p_generation_config_version TEXT,
  p_model_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_id UUID;
BEGIN
  UPDATE daily_fortune_artifacts AS artifact
  SET
    status = 'ready',
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = NULL,
    fact_contract_version = p_fact_contract_version,
    fact_hash = p_fact_hash,
    fact_snapshot_json = p_fact_snapshot_json,
    day_context_json = p_day_context_json,
    content_json = p_content_json,
    prompt_version = p_prompt_version,
    output_schema_version = p_output_schema_version,
    generation_config_version = p_generation_config_version,
    model_id = p_model_id,
    ready_at = clock_timestamp()
  WHERE artifact.id = p_artifact_id
    AND artifact.user_id = p_user_id
    AND artifact.status = 'generating'
    AND artifact.lease_token = p_lease_token
    AND artifact.lease_epoch = p_lease_epoch
  RETURNING artifact.id INTO v_updated_id;

  RETURN v_updated_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION mark_daily_fortune_retry_wait(
  p_artifact_id UUID,
  p_user_id UUID,
  p_lease_token UUID,
  p_lease_epoch BIGINT,
  p_retry_after_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_id UUID;
BEGIN
  IF p_retry_after_seconds IS NULL
     OR p_retry_after_seconds < 1
     OR p_retry_after_seconds > 86400 THEN
    RAISE EXCEPTION 'retry_after_seconds must be between 1 and 86400'
      USING ERRCODE = '22023';
  END IF;

  UPDATE daily_fortune_artifacts AS artifact
  SET
    status = 'retry_wait',
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = clock_timestamp() + make_interval(secs => p_retry_after_seconds)
  WHERE artifact.id = p_artifact_id
    AND artifact.user_id = p_user_id
    AND artifact.status = 'generating'
    AND artifact.lease_token = p_lease_token
    AND artifact.lease_epoch = p_lease_epoch
  RETURNING artifact.id INTO v_updated_id;

  RETURN v_updated_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION release_daily_fortune_generation(
  p_artifact_id UUID,
  p_user_id UUID,
  p_lease_token UUID,
  p_lease_epoch BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_id UUID;
BEGIN
  DELETE FROM daily_fortune_artifacts AS artifact
  WHERE artifact.id = p_artifact_id
    AND artifact.user_id = p_user_id
    AND artifact.status = 'generating'
    AND artifact.lease_token = p_lease_token
    AND artifact.lease_epoch = p_lease_epoch
  RETURNING artifact.id INTO v_deleted_id;

  RETURN v_deleted_id IS NOT NULL;
END;
$$;

ALTER TABLE daily_fortune_artifacts ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policy is intentional. The app can only reach these
-- rows through authenticated backend endpoints, which still scope every
-- service-role query by user_id.
REVOKE ALL ON TABLE daily_fortune_artifacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE daily_fortune_artifacts TO service_role;

REVOKE ALL ON FUNCTION claim_daily_fortune_artifact(
  TEXT, UUID, UUID, DATE, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finalize_daily_fortune_artifact(
  UUID, UUID, UUID, BIGINT, TEXT, TEXT, JSONB, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mark_daily_fortune_retry_wait(
  UUID, UUID, UUID, BIGINT, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_daily_fortune_generation(
  UUID, UUID, UUID, BIGINT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION claim_daily_fortune_artifact(
  TEXT, UUID, UUID, DATE, TEXT, TIMESTAMPTZ, TEXT, INTEGER, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_daily_fortune_artifact(
  UUID, UUID, UUID, BIGINT, TEXT, TEXT, JSONB, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION mark_daily_fortune_retry_wait(
  UUID, UUID, UUID, BIGINT, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION release_daily_fortune_generation(
  UUID, UUID, UUID, BIGINT
) TO service_role;
