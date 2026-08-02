-- ============================================================
-- 013_recommendation_engine.sql
-- 个性化问题推荐 V1：不可变 READY 批次、single-flight 与行为记忆
--
-- 两张产品持久化实体：recommendation_batches 和 recommendation_events。
-- 卡片不拆成第三张产品表；一批 AI 输出作为 cards_json 原子保存，事件从这份
-- 已冻结的输出反查标签，客户端不能伪造 domain/topic/position 等偏好数据。
-- 另有一张无用户、命理或卡片内容的 provider 成本账本，专门防止账户删除
-- 抹掉已预留的项目级 AI 调用配额。
-- ============================================================

CREATE TABLE IF NOT EXISTS recommendation_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_key TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES bazi_profiles(id) ON DELETE CASCADE,
  after_batch_id UUID REFERENCES recommendation_batches(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  profile_revision_hash TEXT NOT NULL,
  profile_updated_at TIMESTAMPTZ NOT NULL,
  generation_timezone TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('generating', 'retry_wait', 'ready')),
  lease_token UUID,
  lease_epoch BIGINT NOT NULL DEFAULT 1 CHECK (lease_epoch >= 1),
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  next_attempt_at TIMESTAMPTZ,
  input_snapshot_json JSONB,
  cards_json JSONB,
  prompt_version TEXT,
  output_schema_version TEXT,
  taxonomy_version TEXT,
  model_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ready_at TIMESTAMPTZ,

  CONSTRAINT recommendation_batch_generation_key_not_blank
    CHECK (length(btrim(generation_key)) BETWEEN 1 AND 256),
  CONSTRAINT recommendation_batch_timezone_not_blank
    CHECK (length(btrim(generation_timezone)) BETWEEN 1 AND 128),
  CONSTRAINT recommendation_batch_input_hash_not_blank
    CHECK (length(btrim(input_hash)) BETWEEN 1 AND 256),
  CONSTRAINT recommendation_batch_profile_revision_hash_not_blank
    CHECK (length(btrim(profile_revision_hash)) BETWEEN 1 AND 256),
  CONSTRAINT recommendation_batch_after_not_self
    CHECK (after_batch_id IS NULL OR after_batch_id <> id),
  CONSTRAINT recommendation_batch_input_snapshot_is_object
    CHECK (input_snapshot_json IS NULL OR jsonb_typeof(input_snapshot_json) = 'object'),
  CONSTRAINT recommendation_batch_cards_shape
    CHECK (
      cards_json IS NULL
      OR (
        jsonb_typeof(cards_json) = 'object'
        AND jsonb_typeof(cards_json -> 'deck_cards') = 'array'
        AND jsonb_array_length(cards_json -> 'deck_cards') = 6
        AND jsonb_typeof(cards_json -> 'center_cards') = 'array'
        AND jsonb_array_length(cards_json -> 'center_cards') = 3
      )
    ),
  CONSTRAINT recommendation_batch_status_payload_consistency
    CHECK (
      (
        status = 'generating'
        AND lease_token IS NOT NULL
        AND lease_expires_at IS NOT NULL
        AND next_attempt_at IS NULL
        AND input_snapshot_json IS NULL
        AND cards_json IS NULL
        AND prompt_version IS NULL
        AND output_schema_version IS NULL
        AND taxonomy_version IS NULL
        AND model_id IS NULL
        AND ready_at IS NULL
      )
      OR
      (
        status = 'retry_wait'
        AND lease_token IS NULL
        AND lease_expires_at IS NULL
        AND next_attempt_at IS NOT NULL
        AND input_snapshot_json IS NULL
        AND cards_json IS NULL
        AND prompt_version IS NULL
        AND output_schema_version IS NULL
        AND taxonomy_version IS NULL
        AND model_id IS NULL
        AND ready_at IS NULL
      )
      OR
      (
        status = 'ready'
        AND lease_token IS NULL
        AND lease_expires_at IS NULL
        AND next_attempt_at IS NULL
        AND input_snapshot_json IS NOT NULL
        AND cards_json IS NOT NULL
        AND prompt_version IS NOT NULL
        AND length(btrim(prompt_version)) > 0
        AND output_schema_version IS NOT NULL
        AND length(btrim(output_schema_version)) > 0
        AND taxonomy_version IS NOT NULL
        AND length(btrim(taxonomy_version)) > 0
        AND model_id IS NOT NULL
        AND length(btrim(model_id)) > 0
        AND ready_at IS NOT NULL
      )
    )
);

COMMENT ON TABLE recommendation_batches IS
  '个性化问题卡片批次：同一用户、档案、推荐日时区、日期、事实/上下文 revision、前一批次只允许一个 successor；READY 后不可修改';
COMMENT ON COLUMN recommendation_batches.generation_key IS
  '服务端由事实、行为快照、前一批次和版本组成的稳定生成键；仅在新的 retry/takeover lease 中刷新';
COMMENT ON COLUMN recommendation_batches.after_batch_id IS
  '本批次在用户读完哪一批之后生成；NULL 表示当天首次 root 批次';
COMMENT ON COLUMN recommendation_batches.profile_revision_hash IS
  '确定性出生/命盘事实与 AI 可见用户上下文的规范哈希；变更时同一天创建新的 root 链';
COMMENT ON COLUMN recommendation_batches.profile_updated_at IS
  'claim 时 bazi_profiles.updated_at 的并发快照，用于阻止编辑中的旧事实入库';
COMMENT ON COLUMN recommendation_batches.input_hash IS
  '当前生成 attempt 的规范化事实、长期偏好、近期行为、会话行为与历史摘要哈希；READY 后冻结';
COMMENT ON COLUMN recommendation_batches.input_snapshot_json IS
  '实际送入 AI 的完整结构化输入，仅 READY 批次保存，用于解释和离线评估';
COMMENT ON COLUMN recommendation_batches.cards_json IS
  '一次 AI 调用生成的 {deck_cards, center_cards}；事件标签必须从此不可变 JSON 反查';

-- generation_key records the current canonical-input attempt. This second
-- unique index is the product invariant: a late open cannot create a second
-- successor for the same user/profile/timezone/date/previous-batch slot. The all-zero
-- UUID represents a same-day root batch because normal UNIQUE treats NULL
-- values as distinct.
CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendation_batches_generation_key
  ON recommendation_batches(generation_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendation_batches_successor_slot
  ON recommendation_batches (
    user_id,
    profile_id,
    generation_timezone,
    effective_date,
    profile_revision_hash,
    COALESCE(after_batch_id, '00000000-0000-0000-0000-000000000000'::UUID)
  );

CREATE INDEX IF NOT EXISTS idx_recommendation_batches_user_profile_ready
  ON recommendation_batches(user_id, profile_id, effective_date DESC, ready_at DESC)
  WHERE status = 'ready';

CREATE INDEX IF NOT EXISTS idx_recommendation_batches_user_status
  ON recommendation_batches(user_id, status, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_recommendation_batches_created_at
  ON recommendation_batches(created_at DESC);

-- This is deliberately not a user-memory or card table. It contains no user,
-- profile, fact, or card data: it is an append-only provider-cost reservation
-- that survives account/profile deletion so the global budget remains real.
CREATE TABLE IF NOT EXISTS recommendation_provider_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_provider_attempts_attempted_at
  ON recommendation_provider_attempts(attempted_at DESC);

COMMENT ON TABLE recommendation_provider_attempts IS
  '项目级 AI 调用成本账本；无用户或命理内容，只用于滚动 provider 预算，不能随账号删除而消失';

CREATE OR REPLACE FUNCTION prevent_ready_recommendation_batch_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'ready' THEN
    RAISE EXCEPTION 'READY recommendation batches are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.profile_id IS DISTINCT FROM OLD.profile_id
     OR NEW.after_batch_id IS DISTINCT FROM OLD.after_batch_id
     OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
     OR NEW.profile_revision_hash IS DISTINCT FROM OLD.profile_revision_hash
     OR NEW.generation_timezone IS DISTINCT FROM OLD.generation_timezone THEN
    RAISE EXCEPTION 'Recommendation batch successor slot is immutable'
      USING ERRCODE = '55000';
  END IF;

  -- Input metadata may change only when a failed/expired attempt is fenced by
  -- a new lease. The slot still remains the same, so a late open cannot create
  -- a second successor; it can only affect a genuinely new AI invocation.
  IF (
    NEW.generation_key IS DISTINCT FROM OLD.generation_key
    OR NEW.profile_updated_at IS DISTINCT FROM OLD.profile_updated_at
    OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
    OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
  )
  AND NOT (
    NEW.status = 'generating'
    AND NEW.lease_epoch = OLD.lease_epoch + 1
    AND (
      OLD.status = 'retry_wait'
      OR (
        OLD.status = 'generating'
        AND OLD.lease_expires_at <= clock_timestamp()
      )
    )
  ) THEN
    RAISE EXCEPTION 'Recommendation input snapshot can change only with a new retry/takeover lease'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'generating'
     AND NEW.status NOT IN ('generating', 'retry_wait', 'ready') THEN
    RAISE EXCEPTION 'Invalid recommendation batch transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'retry_wait' AND NEW.status <> 'generating' THEN
    RAISE EXCEPTION 'Invalid recommendation batch transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_ready_recommendation_batch ON recommendation_batches;

CREATE TRIGGER protect_ready_recommendation_batch
  BEFORE UPDATE ON recommendation_batches
  FOR EACH ROW
  EXECUTE FUNCTION prevent_ready_recommendation_batch_update();

CREATE OR REPLACE FUNCTION claim_recommendation_batch(
  p_generation_key TEXT,
  p_user_id UUID,
  p_profile_id UUID,
  p_after_batch_id UUID,
  p_effective_date DATE,
  p_profile_revision_hash TEXT,
  p_profile_updated_at TIMESTAMPTZ,
  p_generation_timezone TEXT,
  p_input_hash TEXT,
  p_valid_until TIMESTAMPTZ,
  p_lease_ttl_seconds INTEGER DEFAULT 150,
  p_max_active_generations INTEGER DEFAULT 20,
  p_max_new_batches_per_24h INTEGER DEFAULT 6,
  p_max_attempts_per_batch INTEGER DEFAULT 3,
  p_max_provider_attempts_global_per_24h INTEGER DEFAULT 100
)
RETURNS TABLE (
  claim_outcome TEXT,
  batch_id UUID,
  batch_status TEXT,
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
  v_batch recommendation_batches%ROWTYPE;
  v_key_batch recommendation_batches%ROWTYPE;
  v_active_count INTEGER;
  v_user_active_count INTEGER;
  v_user_new_batch_count INTEGER;
  v_global_provider_attempt_count BIGINT;
  v_profile_updated_at TIMESTAMPTZ;
  v_new_token UUID;
  v_previous_status TEXT;
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

  IF p_input_hash IS NULL
     OR length(btrim(p_input_hash)) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION 'input_hash is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_effective_date IS NULL OR p_valid_until IS NULL THEN
    RAISE EXCEPTION 'effective_date and valid_until are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_lease_ttl_seconds IS NULL
     OR p_lease_ttl_seconds < 130
     OR p_lease_ttl_seconds > 300 THEN
    RAISE EXCEPTION 'lease_ttl_seconds must be between 130 and 300'
      USING ERRCODE = '22023';
  END IF;

  IF p_max_active_generations IS NULL
     OR p_max_active_generations < 1
     OR p_max_active_generations > 10000 THEN
    RAISE EXCEPTION 'max_active_generations must be between 1 and 10000'
      USING ERRCODE = '22023';
  END IF;

  IF p_max_new_batches_per_24h IS NULL
     OR p_max_new_batches_per_24h < 1
     OR p_max_new_batches_per_24h > 50 THEN
    RAISE EXCEPTION 'max_new_batches_per_24h must be between 1 and 50'
      USING ERRCODE = '22023';
  END IF;

  IF p_max_attempts_per_batch IS NULL
     OR p_max_attempts_per_batch < 1
     OR p_max_attempts_per_batch > 10 THEN
    RAISE EXCEPTION 'max_attempts_per_batch must be between 1 and 10'
      USING ERRCODE = '22023';
  END IF;

  IF p_max_provider_attempts_global_per_24h IS NULL
     OR p_max_provider_attempts_global_per_24h < 1
     OR p_max_provider_attempts_global_per_24h > 1000000 THEN
    RAISE EXCEPTION 'max_provider_attempts_global_per_24h must be between 1 and 1000000'
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
    RAISE EXCEPTION 'Profile revision changed before recommendation claim'
      USING ERRCODE = '40001';
  END IF;

  IF p_after_batch_id IS NOT NULL THEN
    -- A successor must remain in the same still-live local recommendation day.
    -- Without this check, an old READY batch could be used after its expiry to
    -- create a second chain alongside today's root batch.
    PERFORM 1
    FROM recommendation_batches AS prior
    WHERE prior.id = p_after_batch_id
      AND prior.user_id = p_user_id
      AND prior.profile_id = p_profile_id
      AND prior.status = 'ready'
      AND prior.effective_date = p_effective_date
      AND prior.profile_revision_hash = p_profile_revision_hash
      AND prior.generation_timezone = p_generation_timezone
      AND prior.valid_until > clock_timestamp()
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Previous recommendation batch is not an owned READY batch'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Short transaction-wide serialization protects capacity and the successor
  -- slot across concurrent serverless workers. It does not cover the AI call.
  PERFORM pg_advisory_xact_lock(72451020260803::BIGINT);
  v_now := clock_timestamp();

  IF p_valid_until <= v_now THEN
    RAISE EXCEPTION 'valid_until must be in the future when claiming a recommendation batch'
      USING ERRCODE = '22023';
  END IF;

  SELECT batch.*
  INTO v_key_batch
  FROM recommendation_batches AS batch
  WHERE batch.generation_key = p_generation_key
  FOR UPDATE;

  IF FOUND AND (
    v_key_batch.user_id <> p_user_id
    OR v_key_batch.profile_id <> p_profile_id
    OR v_key_batch.effective_date <> p_effective_date
    OR v_key_batch.profile_revision_hash <> p_profile_revision_hash
    OR v_key_batch.generation_timezone <> p_generation_timezone
    OR v_key_batch.after_batch_id IS DISTINCT FROM p_after_batch_id
  ) THEN
    RAISE EXCEPTION 'generation_key belongs to a different recommendation batch identity'
      USING ERRCODE = '23505';
  END IF;

  IF FOUND THEN
    v_batch := v_key_batch;
  ELSE
    -- Deliberately look up by successor slot rather than input_hash. If a user
    -- opens a card after prefetch starts, the newer behavior snapshot must join
    -- this existing slot instead of producing another "next" batch.
    SELECT batch.*
    INTO v_batch
    FROM recommendation_batches AS batch
    WHERE batch.user_id = p_user_id
      AND batch.profile_id = p_profile_id
      AND batch.effective_date = p_effective_date
      AND batch.profile_revision_hash = p_profile_revision_hash
      AND batch.generation_timezone = p_generation_timezone
      AND batch.after_batch_id IS NOT DISTINCT FROM p_after_batch_id
    FOR UPDATE;
  END IF;

  IF v_batch.id IS NOT NULL AND v_batch.status = 'ready' THEN
    RETURN QUERY SELECT
      'ready'::TEXT,
      v_batch.id,
      v_batch.status,
      NULL::UUID,
      v_batch.lease_epoch,
      NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_batch.id IS NOT NULL
     AND v_batch.status = 'generating'
     AND v_batch.lease_expires_at > v_now THEN
    RETURN QUERY SELECT
      'join'::TEXT,
      v_batch.id,
      v_batch.status,
      NULL::UUID,
      v_batch.lease_epoch,
      v_batch.lease_expires_at,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  IF v_batch.id IS NOT NULL
     AND v_batch.status = 'retry_wait'
     AND v_batch.next_attempt_at > v_now THEN
    RETURN QUERY SELECT
      'wait'::TEXT,
      v_batch.id,
      v_batch.status,
      NULL::UUID,
      v_batch.lease_epoch,
      NULL::TIMESTAMPTZ,
      v_batch.next_attempt_at;
    RETURN;
  END IF;

  -- A failed profile-fence must not let a caller repeatedly re-run the exact
  -- same slot forever. Facts revisions create a new slot (and use the 24-hour
  -- new-batch budget); harmless metadata edits stay in this slot and get only
  -- this bounded number of provider attempts.
  IF v_batch.id IS NOT NULL
     AND v_batch.attempt_count >= p_max_attempts_per_batch THEN
    RETURN QUERY SELECT
      'attempt_limit'::TEXT,
      v_batch.id,
      v_batch.status,
      NULL::UUID,
      v_batch.lease_epoch,
      NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- The global advisory lock above makes this one project-wide spending gate
  -- atomic. The append-only ledger is deliberately detached from user/profile
  -- FKs, so account deletion cannot erase already reserved provider cost.
  SELECT COUNT(*)
  INTO v_global_provider_attempt_count
  FROM recommendation_provider_attempts AS attempt
  WHERE attempt.attempted_at > v_now - INTERVAL '24 hours';

  IF v_global_provider_attempt_count >= p_max_provider_attempts_global_per_24h THEN
    RETURN QUERY SELECT
      'global_limit'::TEXT,
      CASE WHEN v_batch.id IS NULL THEN NULL::UUID ELSE v_batch.id END,
      CASE WHEN v_batch.id IS NULL THEN NULL::TEXT ELSE v_batch.status END,
      NULL::UUID,
      CASE WHEN v_batch.id IS NULL THEN 0::BIGINT ELSE v_batch.lease_epoch END,
      NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- This is a product-cost guard, not a semantic recommendation rule. It
  -- counts only genuinely new batch rows across all profiles and timezones;
  -- joining or retrying an existing slot remains available.
  IF v_batch.id IS NULL THEN
    SELECT COUNT(*)
    INTO v_user_new_batch_count
    FROM recommendation_batches AS batch
    WHERE batch.user_id = p_user_id
      AND batch.created_at > v_now - INTERVAL '24 hours';

    IF v_user_new_batch_count >= p_max_new_batches_per_24h THEN
      RETURN QUERY SELECT
        'daily_limit'::TEXT,
        NULL::UUID,
        NULL::TEXT,
        NULL::UUID,
        0::BIGINT,
        NULL::TIMESTAMPTZ,
        NULL::TIMESTAMPTZ;
      RETURN;
    END IF;
  END IF;

  SELECT COUNT(*)
  INTO v_user_active_count
  FROM recommendation_batches AS batch
  WHERE batch.user_id = p_user_id
    AND batch.status = 'generating'
    AND batch.lease_expires_at > v_now
    AND (v_batch.id IS NULL OR batch.id <> v_batch.id);

  IF v_user_active_count > 0 THEN
    RETURN QUERY SELECT
      'busy'::TEXT,
      CASE WHEN v_batch.id IS NULL THEN NULL::UUID ELSE v_batch.id END,
      CASE WHEN v_batch.id IS NULL THEN NULL::TEXT ELSE v_batch.status END,
      NULL::UUID,
      CASE WHEN v_batch.id IS NULL THEN 0::BIGINT ELSE v_batch.lease_epoch END,
      NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO v_active_count
  FROM recommendation_batches AS batch
  WHERE batch.status = 'generating'
    AND batch.lease_expires_at > v_now
    AND (v_batch.id IS NULL OR batch.id <> v_batch.id);

  IF v_active_count >= p_max_active_generations THEN
    RETURN QUERY SELECT
      'busy'::TEXT,
      CASE WHEN v_batch.id IS NULL THEN NULL::UUID ELSE v_batch.id END,
      CASE WHEN v_batch.id IS NULL THEN NULL::TEXT ELSE v_batch.status END,
      NULL::UUID,
      CASE WHEN v_batch.id IS NULL THEN 0::BIGINT ELSE v_batch.lease_epoch END,
      NULL::TIMESTAMPTZ,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_new_token := gen_random_uuid();

  IF v_batch.id IS NULL THEN
    INSERT INTO recommendation_batches (
      generation_key,
      user_id,
      profile_id,
      after_batch_id,
      effective_date,
      profile_revision_hash,
      profile_updated_at,
      generation_timezone,
      input_hash,
      valid_until,
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
      p_after_batch_id,
      p_effective_date,
      p_profile_revision_hash,
      p_profile_updated_at,
      p_generation_timezone,
      p_input_hash,
      p_valid_until,
      'generating',
      v_new_token,
      1,
      v_now + make_interval(secs => p_lease_ttl_seconds),
      1
    )
    RETURNING * INTO v_batch;

    INSERT INTO recommendation_provider_attempts (attempted_at)
    VALUES (v_now);

    RETURN QUERY SELECT
      'owner'::TEXT,
      v_batch.id,
      v_batch.status,
      v_batch.lease_token,
      v_batch.lease_epoch,
      v_batch.lease_expires_at,
      NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  v_previous_status := v_batch.status;

  UPDATE recommendation_batches AS batch
  SET
    generation_key = p_generation_key,
    profile_updated_at = p_profile_updated_at,
    generation_timezone = p_generation_timezone,
    input_hash = p_input_hash,
    valid_until = p_valid_until,
    status = 'generating',
    lease_token = v_new_token,
    lease_epoch = batch.lease_epoch + 1,
    lease_expires_at = v_now + make_interval(secs => p_lease_ttl_seconds),
    attempt_count = batch.attempt_count + 1,
    next_attempt_at = NULL
  WHERE batch.id = v_batch.id
    AND (
      (
        batch.status = 'generating'
        AND batch.lease_expires_at <= v_now
      )
      OR
      (
        batch.status = 'retry_wait'
        AND batch.next_attempt_at <= v_now
      )
    )
  RETURNING batch.* INTO v_batch;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'recommendation batch claim state changed unexpectedly'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO recommendation_provider_attempts (attempted_at)
  VALUES (v_now);

  RETURN QUERY SELECT
    CASE
      WHEN v_previous_status = 'generating' THEN 'owner_takeover'::TEXT
      ELSE 'owner'::TEXT
    END,
    v_batch.id,
    v_batch.status,
    v_batch.lease_token,
    v_batch.lease_epoch,
    v_batch.lease_expires_at,
    NULL::TIMESTAMPTZ;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_recommendation_batch(
  p_batch_id UUID,
  p_user_id UUID,
  p_lease_token UUID,
  p_lease_epoch BIGINT,
  p_input_snapshot_json JSONB,
  p_cards_json JSONB,
  p_prompt_version TEXT,
  p_output_schema_version TEXT,
  p_taxonomy_version TEXT,
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
  UPDATE recommendation_batches AS batch
  SET
    status = 'ready',
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = NULL,
    input_snapshot_json = p_input_snapshot_json,
    cards_json = p_cards_json,
    prompt_version = p_prompt_version,
    output_schema_version = p_output_schema_version,
    taxonomy_version = p_taxonomy_version,
    model_id = p_model_id,
    ready_at = clock_timestamp()
  FROM bazi_profiles AS profile
  WHERE batch.id = p_batch_id
    AND batch.user_id = p_user_id
    AND batch.status = 'generating'
    AND batch.lease_token = p_lease_token
    AND batch.lease_epoch = p_lease_epoch
    AND batch.valid_until > clock_timestamp()
    -- A profile edit while Gemini is running invalidates this attempt. The
    -- next request creates a new revision slot; this old worker must never
    -- persist its stale fact interpretation as READY.
    AND profile.id = batch.profile_id
    AND profile.owner_user_id = batch.user_id
    AND profile.deleted_at IS NULL
    AND profile.updated_at = batch.profile_updated_at
  RETURNING batch.id INTO v_updated_id;

  RETURN v_updated_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION mark_recommendation_batch_retry_wait(
  p_batch_id UUID,
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

  UPDATE recommendation_batches AS batch
  SET
    status = 'retry_wait',
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = clock_timestamp() + make_interval(secs => p_retry_after_seconds)
  WHERE batch.id = p_batch_id
    AND batch.user_id = p_user_id
    AND batch.status = 'generating'
    AND batch.lease_token = p_lease_token
    AND batch.lease_epoch = p_lease_epoch
  RETURNING batch.id INTO v_updated_id;

  RETURN v_updated_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION release_recommendation_batch_generation(
  p_batch_id UUID,
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
  v_updated_id UUID;
BEGIN
  -- Keep the claimed row. A user must not be able to spend a provider call,
  -- force its finalize to fence out by editing the profile, then erase the row
  -- and evade the rolling new-batch budget. The existing slot can be retried
  -- later, but it remains auditable and continues to count as a claimed batch.
  UPDATE recommendation_batches AS batch
  SET
    status = 'retry_wait',
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = clock_timestamp()
  WHERE batch.id = p_batch_id
    AND batch.user_id = p_user_id
    AND batch.status = 'generating'
    AND batch.lease_token = p_lease_token
    AND batch.lease_epoch = p_lease_epoch
  RETURNING batch.id INTO v_updated_id;

  RETURN v_updated_id IS NOT NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS recommendation_events (
  event_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES bazi_profiles(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES recommendation_batches(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('deck', 'center')),
  position INTEGER NOT NULL CHECK (position >= 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('exposure', 'open')),
  domain TEXT NOT NULL,
  topic_key TEXT NOT NULL,
  question_job TEXT NOT NULL,
  content_horizon TEXT NOT NULL,
  selection_role TEXT NOT NULL,
  event_family TEXT NOT NULL,
  semantic_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT recommendation_event_session_not_blank
    CHECK (length(btrim(session_id)) BETWEEN 1 AND 128),
  CONSTRAINT recommendation_event_candidate_not_blank
    CHECK (length(btrim(candidate_id)) BETWEEN 1 AND 128),
  CONSTRAINT recommendation_event_labels_not_blank
    CHECK (
      length(btrim(domain)) > 0
      AND length(btrim(topic_key)) > 0
      AND length(btrim(question_job)) > 0
      AND length(btrim(content_horizon)) > 0
      AND length(btrim(selection_role)) > 0
      AND length(btrim(event_family)) > 0
      AND length(btrim(semantic_key)) > 0
    ),
  CONSTRAINT recommendation_event_once_per_card_type
    UNIQUE (user_id, batch_id, candidate_id, event_type)
);

COMMENT ON TABLE recommendation_events IS
  '真实展示与打开行为；未打开、划走和停留时间均不写入负反馈';
COMMENT ON COLUMN recommendation_events.event_id IS
  '客户端为一次离线可重试行为生成的 UUID；同一卡片行为的全局自然键共同防重复计数';
COMMENT ON COLUMN recommendation_events.domain IS
  '由 record_recommendation_event 从 READY cards_json 反查，客户端不能提交';

CREATE INDEX IF NOT EXISTS idx_recommendation_events_user_profile_created
  ON recommendation_events(user_id, profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_recommendation_events_user_batch
  ON recommendation_events(user_id, batch_id, created_at DESC);

CREATE OR REPLACE FUNCTION record_recommendation_event(
  p_event_id UUID,
  p_user_id UUID,
  p_batch_id UUID,
  p_session_id TEXT,
  p_candidate_id TEXT,
  p_event_type TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch recommendation_batches%ROWTYPE;
  v_existing recommendation_events%ROWTYPE;
  v_card JSONB;
  v_surface TEXT;
  v_position INTEGER;
  v_domain TEXT;
  v_topic_key TEXT;
  v_question_job TEXT;
  v_content_horizon TEXT;
  v_selection_role TEXT;
  v_event_family TEXT;
  v_semantic_key TEXT;
  v_inserted_id UUID;
BEGIN
  IF p_event_id IS NULL
     OR p_user_id IS NULL
     OR p_batch_id IS NULL THEN
    RAISE EXCEPTION 'event_id, user_id, and batch_id are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_session_id IS NULL
     OR length(btrim(p_session_id)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'session_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_candidate_id IS NULL
     OR length(btrim(p_candidate_id)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'candidate_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_event_type IS NULL OR p_event_type NOT IN ('exposure', 'open') THEN
    RAISE EXCEPTION 'event_type must be exposure or open'
      USING ERRCODE = '22023';
  END IF;

  -- Event-id idempotency is checked before the batch read. A reused id may
  -- only describe exactly the same user action, never another user's data.
  SELECT event.*
  INTO v_existing
  FROM recommendation_events AS event
  WHERE event.event_id = p_event_id;

  IF FOUND THEN
    IF v_existing.user_id = p_user_id
       AND v_existing.batch_id = p_batch_id
       AND v_existing.session_id = btrim(p_session_id)
       AND v_existing.candidate_id = btrim(p_candidate_id)
       AND v_existing.event_type = p_event_type THEN
      RETURN 'duplicate';
    END IF;

    RAISE EXCEPTION 'event_id belongs to a different recommendation event'
      USING ERRCODE = '23505';
  END IF;

  SELECT batch.*
  INTO v_batch
  FROM recommendation_batches AS batch
  WHERE batch.id = p_batch_id
    AND batch.user_id = p_user_id
    AND batch.status = 'ready'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recommendation batch is not an owned READY batch'
      USING ERRCODE = '42501';
  END IF;

  SELECT cards.surface, cards.position, cards.card
  INTO v_surface, v_position, v_card
  FROM (
    SELECT
      'deck'::TEXT AS surface,
      (entry.ordinality - 1)::INTEGER AS position,
      entry.value AS card
    FROM jsonb_array_elements(v_batch.cards_json -> 'deck_cards')
      WITH ORDINALITY AS entry(value, ordinality)

    UNION ALL

    SELECT
      'center'::TEXT AS surface,
      (entry.ordinality - 1)::INTEGER AS position,
      entry.value AS card
    FROM jsonb_array_elements(v_batch.cards_json -> 'center_cards')
      WITH ORDINALITY AS entry(value, ordinality)
  ) AS cards
  WHERE cards.card ->> 'candidate_id' = btrim(p_candidate_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate_id does not belong to recommendation batch'
      USING ERRCODE = '22023';
  END IF;

  -- These values all come from the frozen card, never from the client. The
  -- checks below verify only structural completeness, not AI semantics.
  v_domain := v_card #>> '{content_profile,domain}';
  v_topic_key := v_card #>> '{content_profile,topic_key}';
  v_question_job := v_card #>> '{content_profile,question_job}';
  v_content_horizon := v_card #>> '{content_profile,content_horizon}';
  v_selection_role := v_card ->> 'selection_role';
  v_event_family := v_card #>> '{event_hypothesis,event_family}';
  v_semantic_key := v_card ->> 'semantic_key';

  IF v_domain IS NULL
     OR v_topic_key IS NULL
     OR v_question_job IS NULL
     OR v_content_horizon IS NULL
     OR v_selection_role IS NULL
     OR v_event_family IS NULL
     OR v_semantic_key IS NULL THEN
    RAISE EXCEPTION 'Recommendation batch card lacks event metadata'
      USING ERRCODE = '22023';
  END IF;

  -- A replay with a fresh event UUID is still one real behavior per card/type,
  -- regardless of session. Session is useful to explain the next AI call, not
  -- to multiply a card into a stronger long-term preference signal.
  SELECT event.*
  INTO v_existing
  FROM recommendation_events AS event
  WHERE event.user_id = p_user_id
    AND event.batch_id = p_batch_id
    AND event.candidate_id = btrim(p_candidate_id)
    AND event.event_type = p_event_type;

  IF FOUND THEN
    RETURN 'duplicate';
  END IF;

  INSERT INTO recommendation_events (
    event_id,
    user_id,
    profile_id,
    batch_id,
    session_id,
    candidate_id,
    surface,
    position,
    event_type,
    domain,
    topic_key,
    question_job,
    content_horizon,
    selection_role,
    event_family,
    semantic_key
  )
  VALUES (
    p_event_id,
    p_user_id,
    v_batch.profile_id,
    p_batch_id,
    btrim(p_session_id),
    btrim(p_candidate_id),
    v_surface,
    v_position,
    p_event_type,
    v_domain,
    v_topic_key,
    v_question_job,
    v_content_horizon,
    v_selection_role,
    v_event_family,
    v_semantic_key
  )
  ON CONFLICT DO NOTHING
  RETURNING event_id INTO v_inserted_id;

  IF v_inserted_id IS NOT NULL THEN
    RETURN 'recorded';
  END IF;

  -- A concurrent retry may have won either unique constraint. Inspect the
  -- event-id collision so an accidentally reused UUID cannot be mislabeled as
  -- a harmless duplicate.
  SELECT event.*
  INTO v_existing
  FROM recommendation_events AS event
  WHERE event.event_id = p_event_id;

  IF FOUND AND (
    v_existing.user_id <> p_user_id
    OR v_existing.batch_id <> p_batch_id
    OR v_existing.session_id <> btrim(p_session_id)
    OR v_existing.candidate_id <> btrim(p_candidate_id)
    OR v_existing.event_type <> p_event_type
  ) THEN
    RAISE EXCEPTION 'event_id belongs to a different recommendation event'
      USING ERRCODE = '23505';
  END IF;

  RETURN 'duplicate';
END;
$$;

-- This is intentionally an aggregate read, not a recommendation scorer. It
-- returns the same bounded memory contract that Gemini receives, while doing
-- the 14/90-day scan inside PostgreSQL so a busy user's newest 500 rows cannot
-- erase an older but still-in-window open.
CREATE OR REPLACE FUNCTION get_recommendation_preference_snapshot(
  p_user_id UUID,
  p_profile_id UUID,
  p_session_id TEXT,
  p_now TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recent_cutoff TIMESTAMPTZ;
  v_long_term_cutoff TIMESTAMPTZ;
  v_snapshot JSONB;
BEGIN
  IF p_user_id IS NULL OR p_profile_id IS NULL THEN
    RAISE EXCEPTION 'user_id and profile_id are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_session_id IS NULL
     OR length(btrim(p_session_id)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'session_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_now IS NULL THEN
    RAISE EXCEPTION 'now is required'
      USING ERRCODE = '22023';
  END IF;

  -- The backend has already authenticated the user; the RPC repeats profile
  -- ownership so service-role use cannot accidentally mix memory between two
  -- different people or profiles.
  PERFORM 1
  FROM bazi_profiles AS profile
  WHERE profile.id = p_profile_id
    AND profile.owner_user_id = p_user_id
    AND profile.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile is not owned by user'
      USING ERRCODE = '42501';
  END IF;

  v_recent_cutoff := p_now - INTERVAL '14 days';
  v_long_term_cutoff := p_now - INTERVAL '90 days';

  WITH scoped_events AS MATERIALIZED (
    SELECT
      event.event_id,
      event.session_id,
      event.candidate_id,
      event.surface,
      event.event_type,
      event.domain,
      event.topic_key,
      event.question_job,
      event.content_horizon,
      event.semantic_key,
      event.created_at
    FROM recommendation_events AS event
    WHERE event.user_id = p_user_id
      AND event.profile_id = p_profile_id
      AND event.created_at >= v_long_term_cutoff
      AND event.created_at <= p_now
  ),
  dimension_events AS (
    SELECT
      event.event_type,
      event.created_at,
      labels.dimension,
      labels.key
    FROM scoped_events AS event
    CROSS JOIN LATERAL (
      VALUES
        ('domain'::TEXT, event.domain),
        ('topic_key'::TEXT, event.topic_key),
        ('question_job'::TEXT, event.question_job),
        ('content_horizon'::TEXT, event.content_horizon)
    ) AS labels(dimension, key)
  ),
  signal_windows AS (
    SELECT 'recent_14d'::TEXT AS window_name, v_recent_cutoff AS cutoff
    UNION ALL
    SELECT 'long_term_90d'::TEXT AS window_name, v_long_term_cutoff AS cutoff
  ),
  aggregated_signals AS (
    SELECT
      window_row.window_name,
      event.dimension,
      event.key,
      ROUND(SUM(
        CASE WHEN event.event_type = 'exposure' THEN
          POWER(
            0.5::DOUBLE PRECISION,
            GREATEST(
              0::DOUBLE PRECISION,
              EXTRACT(EPOCH FROM (p_now - event.created_at))::DOUBLE PRECISION / 2592000.0
            )
          )
        ELSE 0::DOUBLE PRECISION END
      )::NUMERIC, 3)::DOUBLE PRECISION AS exposures,
      ROUND(SUM(
        CASE WHEN event.event_type = 'open' THEN
          POWER(
            0.5::DOUBLE PRECISION,
            GREATEST(
              0::DOUBLE PRECISION,
              EXTRACT(EPOCH FROM (p_now - event.created_at))::DOUBLE PRECISION / 2592000.0
            )
          )
        ELSE 0::DOUBLE PRECISION END
      )::NUMERIC, 3)::DOUBLE PRECISION AS opens
    FROM dimension_events AS event
    INNER JOIN signal_windows AS window_row
      ON event.created_at >= window_row.cutoff
    GROUP BY window_row.window_name, event.dimension, event.key
  ),
  ranked_signals AS (
    SELECT
      signal.*,
      ROW_NUMBER() OVER (
        PARTITION BY signal.window_name
        ORDER BY signal.opens DESC, signal.exposures DESC, signal.dimension ASC, signal.key ASC
      ) AS signal_rank
    FROM aggregated_signals AS signal
  ),
  session_opens AS (
    SELECT
      event.event_id,
      event.candidate_id,
      event.domain,
      event.topic_key,
      event.question_job,
      event.content_horizon,
      event.created_at
    FROM scoped_events AS event
    WHERE event.event_type = 'open'
      AND event.session_id = btrim(p_session_id)
    ORDER BY event.created_at DESC, event.event_id DESC
    LIMIT 20
  ),
  semantic_history AS (
    SELECT
      event.semantic_key,
      (ARRAY_AGG(event.surface ORDER BY event.created_at DESC, event.event_id DESC))[1] AS surface,
      BOOL_OR(event.event_type = 'exposure') AS exposed,
      BOOL_OR(event.event_type = 'open') AS opened,
      MAX(event.created_at) AS last_seen_at
    FROM scoped_events AS event
    GROUP BY event.semantic_key
  ),
  bounded_history AS (
    SELECT
      history.semantic_key,
      history.surface,
      history.exposed,
      history.opened,
      history.last_seen_at
    FROM semantic_history AS history
    ORDER BY history.last_seen_at DESC, history.semantic_key ASC
    LIMIT 60
  )
  SELECT JSONB_BUILD_OBJECT(
    'recent_14d',
    COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'dimension', signal.dimension,
        'key', signal.key,
        'exposures', signal.exposures,
        'opens', signal.opens
      ) ORDER BY signal.opens DESC, signal.exposures DESC, signal.dimension ASC, signal.key ASC)
      FROM ranked_signals AS signal
      WHERE signal.window_name = 'recent_14d'
        AND signal.signal_rank <= 40
    ), '[]'::JSONB),
    'long_term_90d',
    COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'dimension', signal.dimension,
        'key', signal.key,
        'exposures', signal.exposures,
        'opens', signal.opens
      ) ORDER BY signal.opens DESC, signal.exposures DESC, signal.dimension ASC, signal.key ASC)
      FROM ranked_signals AS signal
      WHERE signal.window_name = 'long_term_90d'
        AND signal.signal_rank <= 40
    ), '[]'::JSONB),
    'current_session_opens',
    COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'candidate_id', event.candidate_id,
        'content_profile', JSONB_BUILD_OBJECT(
          'domain', event.domain,
          'topic_key', event.topic_key,
          'question_job', event.question_job,
          'content_horizon', event.content_horizon
        ),
        'opened_at', event.created_at
      ) ORDER BY event.created_at DESC, event.event_id DESC)
      FROM session_opens AS event
    ), '[]'::JSONB),
    'content_history',
    COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'semantic_key', history.semantic_key,
        'surface', history.surface,
        'exposed', history.exposed,
        'opened', history.opened,
        'last_seen_at', history.last_seen_at
      ) ORDER BY history.last_seen_at DESC, history.semantic_key ASC)
      FROM bounded_history AS history
    ), '[]'::JSONB)
  ) INTO v_snapshot;

  RETURN v_snapshot;
END;
$$;

ALTER TABLE recommendation_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_provider_attempts ENABLE ROW LEVEL SECURITY;

-- Profile deletion is a backend soft-delete operation. Do not leave a direct
-- authenticated hard-delete policy that could erase recommendation rows and
-- reset a caller's cost accounting through Supabase REST.
DROP POLICY IF EXISTS "用户只能删除自己的八字档案" ON bazi_profiles;

-- The mobile app reaches this data only through authenticated backend routes.
-- Service-role queries still scope every read and RPC by p_user_id.
REVOKE ALL ON TABLE recommendation_batches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE recommendation_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE recommendation_provider_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON recommendation_batches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON recommendation_events TO service_role;

REVOKE ALL ON FUNCTION claim_recommendation_batch(
  TEXT, UUID, UUID, UUID, DATE, TEXT, TIMESTAMPTZ, TEXT, TEXT, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finalize_recommendation_batch(
  UUID, UUID, UUID, BIGINT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mark_recommendation_batch_retry_wait(
  UUID, UUID, UUID, BIGINT, INTEGER
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_recommendation_batch_generation(
  UUID, UUID, UUID, BIGINT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_recommendation_event(
  UUID, UUID, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_recommendation_preference_snapshot(
  UUID, UUID, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION claim_recommendation_batch(
  TEXT, UUID, UUID, UUID, DATE, TEXT, TIMESTAMPTZ, TEXT, TEXT, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_recommendation_batch(
  UUID, UUID, UUID, BIGINT, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION mark_recommendation_batch_retry_wait(
  UUID, UUID, UUID, BIGINT, INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION release_recommendation_batch_generation(
  UUID, UUID, UUID, BIGINT
) TO service_role;
GRANT EXECUTE ON FUNCTION record_recommendation_event(
  UUID, UUID, UUID, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION get_recommendation_preference_snapshot(
  UUID, UUID, TEXT, TIMESTAMPTZ
) TO service_role;
