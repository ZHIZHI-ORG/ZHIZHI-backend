-- ============================================================
-- 014_recommendation_candidate_pool.sql
-- Recommendation V2: one immutable 24-card AI pool, projected into two
-- client-compatible display batches. Legacy V1 READY rows remain readable.
-- ============================================================

ALTER TABLE recommendation_batches
  ADD COLUMN IF NOT EXISTS candidate_pool_json JSONB,
  ADD COLUMN IF NOT EXISTS generation_kind TEXT NOT NULL DEFAULT 'ai',
  ADD COLUMN IF NOT EXISTS pool_source_batch_id UUID
    REFERENCES recommendation_batches(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS selection_context_json JSONB,
  ADD COLUMN IF NOT EXISTS generation_metrics_json JSONB;

ALTER TABLE recommendation_events
  ADD COLUMN IF NOT EXISTS primary_time_window_key TEXT,
  ADD COLUMN IF NOT EXISTS referenced_window_keys TEXT[]
    NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE recommendation_batches
  DROP CONSTRAINT IF EXISTS recommendation_batch_cards_shape;

ALTER TABLE recommendation_batches
  ADD CONSTRAINT recommendation_batch_cards_shape_v2
  CHECK (
    CASE
      WHEN cards_json IS NULL THEN TRUE
      WHEN jsonb_typeof(cards_json) IS DISTINCT FROM 'object' THEN FALSE
      WHEN jsonb_typeof(cards_json -> 'deck_cards') IS DISTINCT FROM 'array' THEN FALSE
      WHEN jsonb_typeof(cards_json -> 'center_cards') IS DISTINCT FROM 'array' THEN FALSE
      WHEN output_schema_version = 'recommendation_output_v1' THEN
        jsonb_array_length(cards_json -> 'deck_cards') = 6
        AND jsonb_array_length(cards_json -> 'center_cards') = 3
      WHEN output_schema_version = 'recommendation_output_v2' THEN
        jsonb_array_length(cards_json -> 'deck_cards') = 8
        AND jsonb_array_length(cards_json -> 'center_cards') = 4
      ELSE FALSE
    END
  ),
  ADD CONSTRAINT recommendation_batch_candidate_pool_shape
  CHECK (
    CASE
      WHEN candidate_pool_json IS NULL THEN TRUE
      WHEN jsonb_typeof(candidate_pool_json) IS DISTINCT FROM 'object' THEN FALSE
      WHEN candidate_pool_json ->> 'pool_version' IS DISTINCT FROM 'recommendation_pool_v1' THEN FALSE
      WHEN jsonb_typeof(candidate_pool_json -> 'candidates') IS DISTINCT FROM 'array' THEN FALSE
      ELSE jsonb_array_length(candidate_pool_json -> 'candidates') = 24
    END
  ),
  ADD CONSTRAINT recommendation_batch_selection_context_shape
  CHECK (
    selection_context_json IS NULL
    OR jsonb_typeof(selection_context_json) IS NOT DISTINCT FROM 'object'
  ),
  ADD CONSTRAINT recommendation_batch_generation_metrics_shape
  CHECK (
    generation_metrics_json IS NULL
    OR jsonb_typeof(generation_metrics_json) IS NOT DISTINCT FROM 'object'
  ),
  ADD CONSTRAINT recommendation_batch_generation_kind
  CHECK (
    CASE generation_kind
      WHEN 'ai' THEN pool_source_batch_id IS NULL
      WHEN 'pool' THEN
        pool_source_batch_id IS NOT NULL
        AND pool_source_batch_id <> id
        AND after_batch_id IS NOT NULL
        AND after_batch_id IS NOT DISTINCT FROM pool_source_batch_id
        AND candidate_pool_json IS NULL
        AND status = 'ready'
        AND output_schema_version = 'recommendation_output_v2'
      ELSE FALSE
    END
  ),
  ADD CONSTRAINT recommendation_batch_v2_pool_consistency
  CHECK (
    output_schema_version IS DISTINCT FROM 'recommendation_output_v2'
    OR status <> 'ready'
    OR (
      generation_kind = 'ai'
      AND candidate_pool_json IS NOT NULL
      AND selection_context_json IS NOT NULL
      AND generation_metrics_json IS NOT NULL
    )
    OR (
      generation_kind = 'pool'
      AND candidate_pool_json IS NULL
      AND selection_context_json IS NOT NULL
      AND generation_metrics_json IS NULL
    )
  );

ALTER TABLE recommendation_events
  ADD CONSTRAINT recommendation_event_primary_time_window_shape
  CHECK (
    primary_time_window_key IS NULL
    OR (
      length(btrim(primary_time_window_key)) BETWEEN 1 AND 256
      AND primary_time_window_key = ANY(referenced_window_keys)
    )
  ),
  ADD CONSTRAINT recommendation_event_referenced_windows_shape
  CHECK (
    cardinality(referenced_window_keys) <= 6
    AND array_position(referenced_window_keys, NULL) IS NULL
  );

CREATE INDEX IF NOT EXISTS idx_recommendation_batches_pool_source
  ON recommendation_batches(pool_source_batch_id)
  WHERE pool_source_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recommendation_events_primary_time_window
  ON recommendation_events(user_id, profile_id, primary_time_window_key, created_at DESC)
  WHERE primary_time_window_key IS NOT NULL;

COMMENT ON COLUMN recommendation_batches.candidate_pool_json IS
  'AI 一次生成的 24 张完整 surface-neutral 候选；仅 AI 根批次保存，READY 后不可修改';
COMMENT ON COLUMN recommendation_batches.generation_kind IS
  'ai 表示发生一次 provider 生成；pool 表示从既有候选池派生展示批次且不调用 AI';
COMMENT ON COLUMN recommendation_batches.pool_source_batch_id IS
  'pool 展示批次所消费的不可变 AI 根候选池批次';
COMMENT ON COLUMN recommendation_batches.selection_context_json IS
  '服务端展示编排版本和当时可见的兴趣快照，用于回放顺序，不参与命理事实判断';
COMMENT ON COLUMN recommendation_batches.generation_metrics_json IS
  '本次成功 AI 调用的模型、字节、token、延迟与 finish reason；不保存额外用户或命理内容';
COMMENT ON COLUMN recommendation_events.primary_time_window_key IS
  '从冻结卡片反查的主要时间窗口；NULL 表示原局长期卡，客户端不能提交';
COMMENT ON COLUMN recommendation_events.referenced_window_keys IS
  '从冻结卡片 fact_refs 机械派生的全部时间窗口，只用于追溯与推荐记忆';

CREATE OR REPLACE FUNCTION prevent_recommendation_pool_identity_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.generation_kind IS DISTINCT FROM OLD.generation_kind
     OR NEW.pool_source_batch_id IS DISTINCT FROM OLD.pool_source_batch_id THEN
    RAISE EXCEPTION 'Recommendation pool identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_recommendation_pool_identity ON recommendation_batches;
CREATE TRIGGER protect_recommendation_pool_identity
  BEFORE UPDATE ON recommendation_batches
  FOR EACH ROW
  EXECUTE FUNCTION prevent_recommendation_pool_identity_update();

-- Keep the V1 ten-argument overload from migration 013 during rollout. This
-- lets the database migrate before the V2 backend without breaking an old
-- worker that is already finishing a 6+3 generation.
CREATE OR REPLACE FUNCTION finalize_recommendation_batch(
  p_batch_id UUID,
  p_user_id UUID,
  p_lease_token UUID,
  p_lease_epoch BIGINT,
  p_input_snapshot_json JSONB,
  p_cards_json JSONB,
  p_candidate_pool_json JSONB,
  p_selection_context_json JSONB,
  p_generation_metrics_json JSONB,
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
  v_pool_count INTEGER;
  v_pool_unique_count INTEGER;
  v_display_count INTEGER;
  v_display_unique_count INTEGER;
BEGIN
  IF p_output_schema_version IS DISTINCT FROM 'recommendation_output_v2' THEN
    RAISE EXCEPTION 'candidate-pool finalize requires recommendation_output_v2'
      USING ERRCODE = '22023';
  END IF;

  IF p_generation_metrics_json IS NULL
     OR jsonb_typeof(p_generation_metrics_json) IS DISTINCT FROM 'object'
     OR p_generation_metrics_json ->> 'outcome' IS DISTINCT FROM 'success' THEN
    RAISE EXCEPTION 'generation metrics must describe one successful AI call'
      USING ERRCODE = '22023';
  END IF;

  IF p_candidate_pool_json IS NULL
     OR jsonb_typeof(p_candidate_pool_json) IS DISTINCT FROM 'object'
     OR p_candidate_pool_json ->> 'pool_version' IS DISTINCT FROM 'recommendation_pool_v1'
     OR jsonb_typeof(p_candidate_pool_json -> 'candidates') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_candidate_pool_json -> 'candidates') <> 24 THEN
    RAISE EXCEPTION 'candidate pool must contain exactly 24 candidates'
      USING ERRCODE = '22023';
  END IF;

  IF p_cards_json IS NULL
     OR jsonb_typeof(p_cards_json) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_cards_json -> 'deck_cards') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_cards_json -> 'deck_cards') <> 8
     OR jsonb_typeof(p_cards_json -> 'center_cards') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_cards_json -> 'center_cards') <> 4 THEN
    RAISE EXCEPTION 'first display must contain 8 deck and 4 center cards'
      USING ERRCODE = '22023';
  END IF;

  WITH pool_cards AS (
    SELECT card ->> 'candidate_id' AS candidate_id
    FROM jsonb_array_elements(p_candidate_pool_json -> 'candidates') AS card
  ),
  displayed AS (
    SELECT card ->> 'candidate_id' AS candidate_id
    FROM jsonb_array_elements(p_cards_json -> 'deck_cards') AS card
    UNION ALL
    SELECT card ->> 'candidate_id' AS candidate_id
    FROM jsonb_array_elements(p_cards_json -> 'center_cards') AS card
  )
  SELECT
    (SELECT COUNT(*) FROM pool_cards),
    (SELECT COUNT(DISTINCT candidate_id) FROM pool_cards),
    (SELECT COUNT(*) FROM displayed),
    (SELECT COUNT(DISTINCT candidate_id) FROM displayed)
  INTO
    v_pool_count,
    v_pool_unique_count,
    v_display_count,
    v_display_unique_count;

  IF v_pool_count <> 24
     OR v_pool_unique_count <> 24
     OR v_display_count <> 12
     OR v_display_unique_count <> 12 THEN
    RAISE EXCEPTION 'candidate pool and first display ids must be unique'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_candidate_pool_json -> 'candidates')
      WITH ORDINALITY AS entry(value, ordinality)
    WHERE jsonb_typeof(entry.value -> 'candidate_id') IS DISTINCT FROM 'string'
       OR entry.value ->> 'candidate_id' IS NULL
       OR length(btrim(entry.value ->> 'candidate_id')) NOT BETWEEN 1 AND 128
       OR entry.value ->> 'candidate_id' IS DISTINCT FROM btrim(entry.value ->> 'candidate_id')
       OR jsonb_typeof(entry.value -> 'pool_position') IS DISTINCT FROM 'number'
       OR entry.value ->> 'pool_position' IS DISTINCT FROM (entry.ordinality - 1)::TEXT
       OR CASE
         WHEN jsonb_typeof(entry.value -> 'referenced_window_keys') IS DISTINCT FROM 'array'
           THEN TRUE
         WHEN jsonb_array_length(entry.value -> 'referenced_window_keys') > 6
           THEN TRUE
         WHEN EXISTS (
           SELECT 1
           FROM jsonb_array_elements(entry.value -> 'referenced_window_keys') AS key(value)
           WHERE jsonb_typeof(key.value) IS DISTINCT FROM 'string'
              OR length(btrim(key.value #>> '{}')) NOT BETWEEN 1 AND 256
              OR key.value #>> '{}' IS DISTINCT FROM btrim(key.value #>> '{}')
         ) THEN TRUE
         WHEN (
           SELECT COUNT(*) <> COUNT(DISTINCT key.value #>> '{}')
           FROM jsonb_array_elements(entry.value -> 'referenced_window_keys') AS key(value)
         ) THEN TRUE
         WHEN jsonb_array_length(entry.value -> 'referenced_window_keys') = 0
           THEN jsonb_typeof(entry.value -> 'primary_time_window_key') IS DISTINCT FROM 'null'
         WHEN jsonb_typeof(entry.value -> 'primary_time_window_key') IS DISTINCT FROM 'string'
           THEN TRUE
         ELSE
           length(btrim(entry.value ->> 'primary_time_window_key')) NOT BETWEEN 1 AND 256
           OR entry.value ->> 'primary_time_window_key'
             IS DISTINCT FROM btrim(entry.value ->> 'primary_time_window_key')
           OR NOT (entry.value -> 'referenced_window_keys')
             ? (entry.value ->> 'primary_time_window_key')
       END
  ) THEN
    RAISE EXCEPTION 'candidate ids, positions, or time-window identities are invalid'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    WITH pool_cards AS (
      SELECT card ->> 'candidate_id' AS candidate_id, card
      FROM jsonb_array_elements(p_candidate_pool_json -> 'candidates') AS card
    ),
    displayed AS (
      SELECT
        'deck'::TEXT AS surface,
        (entry.ordinality - 1)::INTEGER AS position,
        entry.value ->> 'candidate_id' AS candidate_id,
        entry.value AS card
      FROM jsonb_array_elements(p_cards_json -> 'deck_cards')
        WITH ORDINALITY AS entry(value, ordinality)
      UNION ALL
      SELECT
        'center'::TEXT AS surface,
        (entry.ordinality - 1)::INTEGER AS position,
        entry.value ->> 'candidate_id' AS candidate_id,
        entry.value AS card
      FROM jsonb_array_elements(p_cards_json -> 'center_cards')
        WITH ORDINALITY AS entry(value, ordinality)
    )
    SELECT 1
    FROM displayed
    LEFT JOIN pool_cards USING (candidate_id)
    WHERE pool_cards.candidate_id IS NULL
       OR (displayed.card - 'surface' - 'position') IS DISTINCT FROM pool_cards.card
       OR jsonb_typeof(displayed.card -> 'surface') IS DISTINCT FROM 'string'
       OR displayed.card ->> 'surface' IS DISTINCT FROM displayed.surface
       OR jsonb_typeof(displayed.card -> 'position') IS DISTINCT FROM 'number'
       OR displayed.card ->> 'position' IS DISTINCT FROM displayed.position::TEXT
  ) THEN
    RAISE EXCEPTION 'first display cards must be exact projections of the candidate pool'
      USING ERRCODE = '22023';
  END IF;

  UPDATE recommendation_batches AS batch
  SET
    status = 'ready',
    lease_token = NULL,
    lease_expires_at = NULL,
    next_attempt_at = NULL,
    input_snapshot_json = p_input_snapshot_json,
    cards_json = p_cards_json,
    candidate_pool_json = p_candidate_pool_json,
    selection_context_json = p_selection_context_json,
    generation_metrics_json = p_generation_metrics_json,
    prompt_version = p_prompt_version,
    output_schema_version = p_output_schema_version,
    taxonomy_version = p_taxonomy_version,
    model_id = p_model_id,
    ready_at = clock_timestamp()
  FROM bazi_profiles AS profile
  WHERE batch.id = p_batch_id
    AND batch.user_id = p_user_id
    AND batch.generation_kind = 'ai'
    AND batch.status = 'generating'
    AND batch.lease_token = p_lease_token
    AND batch.lease_epoch = p_lease_epoch
    AND batch.valid_until > clock_timestamp()
    AND profile.id = batch.profile_id
    AND profile.owner_user_id = batch.user_id
    AND profile.deleted_at IS NULL
    AND profile.updated_at = batch.profile_updated_at
  RETURNING batch.id INTO v_updated_id;

  RETURN v_updated_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION create_recommendation_pool_continuation(
  p_user_id UUID,
  p_source_batch_id UUID,
  p_cards_json JSONB,
  p_selection_context_json JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source recommendation_batches%ROWTYPE;
  v_existing recommendation_batches%ROWTYPE;
  v_created_id UUID;
  v_pool_count INTEGER;
  v_pool_unique_count INTEGER;
  v_source_display_count INTEGER;
  v_source_display_unique_count INTEGER;
  v_selected_count INTEGER;
  v_selected_unique_count INTEGER;
BEGIN
  IF p_user_id IS NULL OR p_source_batch_id IS NULL THEN
    RAISE EXCEPTION 'user_id and source_batch_id are required'
      USING ERRCODE = '22023';
  END IF;

  IF p_selection_context_json IS NULL
     OR jsonb_typeof(p_selection_context_json) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'selection_context_json must be an object'
      USING ERRCODE = '22023';
  END IF;

  IF p_cards_json IS NULL
     OR jsonb_typeof(p_cards_json) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_cards_json -> 'deck_cards') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_cards_json -> 'deck_cards') <> 8
     OR jsonb_typeof(p_cards_json -> 'center_cards') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_cards_json -> 'center_cards') <> 4 THEN
    RAISE EXCEPTION 'pool continuation must contain 8 deck and 4 center cards'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_batch_id::TEXT, 20260803));

  SELECT batch.*
  INTO v_source
  FROM recommendation_batches AS batch
  WHERE batch.id = p_source_batch_id
    AND batch.user_id = p_user_id
    AND batch.status = 'ready'
    AND batch.generation_kind = 'ai'
    AND batch.output_schema_version = 'recommendation_output_v2'
    AND batch.valid_until > clock_timestamp()
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'source is not an owned live V2 AI batch'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM bazi_profiles AS profile
  WHERE profile.id = v_source.profile_id
    AND profile.owner_user_id = p_user_id
    AND profile.deleted_at IS NULL
    AND profile.updated_at = v_source.profile_updated_at
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile revision changed before pool continuation'
      USING ERRCODE = '40001';
  END IF;

  SELECT batch.*
  INTO v_existing
  FROM recommendation_batches AS batch
  WHERE batch.user_id = p_user_id
    AND batch.profile_id = v_source.profile_id
    AND batch.effective_date = v_source.effective_date
    AND batch.profile_revision_hash = v_source.profile_revision_hash
    AND batch.generation_timezone = v_source.generation_timezone
    AND batch.after_batch_id = v_source.id;

  IF FOUND THEN
    IF v_existing.generation_kind <> 'pool'
       OR v_existing.pool_source_batch_id <> v_source.id
       OR v_existing.status <> 'ready' THEN
      RAISE EXCEPTION 'source successor slot belongs to another generation'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  WITH pool_cards AS (
    SELECT card ->> 'candidate_id' AS candidate_id
    FROM jsonb_array_elements(v_source.candidate_pool_json -> 'candidates') AS card
  ),
  source_display AS (
    SELECT card ->> 'candidate_id' AS candidate_id
    FROM jsonb_array_elements(v_source.cards_json -> 'deck_cards') AS card
    UNION ALL
    SELECT card ->> 'candidate_id' AS candidate_id
    FROM jsonb_array_elements(v_source.cards_json -> 'center_cards') AS card
  ),
  selected AS (
    SELECT card ->> 'candidate_id' AS candidate_id
    FROM jsonb_array_elements(p_cards_json -> 'deck_cards') AS card
    UNION ALL
    SELECT card ->> 'candidate_id' AS candidate_id
    FROM jsonb_array_elements(p_cards_json -> 'center_cards') AS card
  )
  SELECT
    (SELECT COUNT(*) FROM pool_cards),
    (SELECT COUNT(DISTINCT candidate_id) FROM pool_cards),
    (SELECT COUNT(*) FROM source_display),
    (SELECT COUNT(DISTINCT candidate_id) FROM source_display),
    (SELECT COUNT(*) FROM selected),
    (SELECT COUNT(DISTINCT candidate_id) FROM selected)
  INTO
    v_pool_count,
    v_pool_unique_count,
    v_source_display_count,
    v_source_display_unique_count,
    v_selected_count,
    v_selected_unique_count;

  IF v_pool_count <> 24
     OR v_pool_unique_count <> 24
     OR v_source_display_count <> 12
     OR v_source_display_unique_count <> 12
     OR v_selected_count <> 12
     OR v_selected_unique_count <> 12 THEN
    RAISE EXCEPTION 'candidate pool or display candidate ids are invalid'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    WITH pool_cards AS (
      SELECT card ->> 'candidate_id' AS candidate_id
      FROM jsonb_array_elements(v_source.candidate_pool_json -> 'candidates') AS card
    ),
    source_display AS (
      SELECT card ->> 'candidate_id' AS candidate_id
      FROM jsonb_array_elements(v_source.cards_json -> 'deck_cards') AS card
      UNION
      SELECT card ->> 'candidate_id' AS candidate_id
      FROM jsonb_array_elements(v_source.cards_json -> 'center_cards') AS card
    ),
    remaining AS (
      SELECT candidate_id FROM pool_cards
      EXCEPT
      SELECT candidate_id FROM source_display
    ),
    selected AS (
      SELECT card ->> 'candidate_id' AS candidate_id
      FROM jsonb_array_elements(p_cards_json -> 'deck_cards') AS card
      UNION
      SELECT card ->> 'candidate_id' AS candidate_id
      FROM jsonb_array_elements(p_cards_json -> 'center_cards') AS card
    )
    (SELECT candidate_id FROM remaining EXCEPT SELECT candidate_id FROM selected)
    UNION ALL
    (SELECT candidate_id FROM selected EXCEPT SELECT candidate_id FROM remaining)
  ) THEN
    RAISE EXCEPTION 'pool continuation must contain every and only remaining candidate'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    WITH pool_cards AS (
      SELECT card ->> 'candidate_id' AS candidate_id, card
      FROM jsonb_array_elements(v_source.candidate_pool_json -> 'candidates') AS card
    ),
    selected AS (
      SELECT
        'deck'::TEXT AS surface,
        (entry.ordinality - 1)::INTEGER AS position,
        entry.value ->> 'candidate_id' AS candidate_id,
        entry.value AS card
      FROM jsonb_array_elements(p_cards_json -> 'deck_cards')
        WITH ORDINALITY AS entry(value, ordinality)
      UNION ALL
      SELECT
        'center'::TEXT AS surface,
        (entry.ordinality - 1)::INTEGER AS position,
        entry.value ->> 'candidate_id' AS candidate_id,
        entry.value AS card
      FROM jsonb_array_elements(p_cards_json -> 'center_cards')
        WITH ORDINALITY AS entry(value, ordinality)
    )
    SELECT 1
    FROM selected
    LEFT JOIN pool_cards USING (candidate_id)
    WHERE pool_cards.candidate_id IS NULL
       OR (selected.card - 'surface' - 'position') IS DISTINCT FROM pool_cards.card
       OR jsonb_typeof(selected.card -> 'surface') IS DISTINCT FROM 'string'
       OR selected.card ->> 'surface' IS DISTINCT FROM selected.surface
       OR jsonb_typeof(selected.card -> 'position') IS DISTINCT FROM 'number'
       OR selected.card ->> 'position' IS DISTINCT FROM selected.position::TEXT
  ) THEN
    RAISE EXCEPTION 'pool continuation cards must be exact projections of the candidate pool'
      USING ERRCODE = '22023';
  END IF;

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
    attempt_count,
    next_attempt_at,
    input_snapshot_json,
    cards_json,
    candidate_pool_json,
    generation_kind,
    pool_source_batch_id,
    selection_context_json,
    generation_metrics_json,
    prompt_version,
    output_schema_version,
    taxonomy_version,
    model_id,
    ready_at
  ) VALUES (
    v_source.generation_key || ':pool:2',
    v_source.user_id,
    v_source.profile_id,
    v_source.id,
    v_source.effective_date,
    v_source.profile_revision_hash,
    v_source.profile_updated_at,
    v_source.generation_timezone,
    v_source.input_hash,
    v_source.valid_until,
    'ready',
    NULL,
    1,
    NULL,
    1,
    NULL,
    v_source.input_snapshot_json,
    p_cards_json,
    NULL,
    'pool',
    v_source.id,
    p_selection_context_json,
    NULL,
    v_source.prompt_version,
    v_source.output_schema_version,
    v_source.taxonomy_version,
    v_source.model_id,
    clock_timestamp()
  )
  RETURNING id INTO v_created_id;

  RETURN v_created_id;
END;
$$;

-- The client continues to submit only event identity. This trigger derives
-- time-window memory from the immutable card selected by the existing event
-- RPC, so primary/referenced window labels cannot be forged over the API.
CREATE OR REPLACE FUNCTION derive_recommendation_event_time_windows()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card JSONB;
  v_output_schema_version TEXT;
  v_referenced_window_keys TEXT[];
  v_primary_time_window_key TEXT;
BEGIN
  SELECT cards.card, batch.output_schema_version
  INTO v_card, v_output_schema_version
  FROM recommendation_batches AS batch
  CROSS JOIN LATERAL (
    SELECT entry.value AS card
    FROM jsonb_array_elements(batch.cards_json -> 'deck_cards') AS entry(value)
    WHERE entry.value ->> 'candidate_id' = NEW.candidate_id
    UNION ALL
    SELECT entry.value AS card
    FROM jsonb_array_elements(batch.cards_json -> 'center_cards') AS entry(value)
    WHERE entry.value ->> 'candidate_id' = NEW.candidate_id
  ) AS cards
  WHERE batch.id = NEW.batch_id
    AND batch.user_id = NEW.user_id
    AND batch.status = 'ready';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recommendation event card cannot be resolved'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_card -> 'referenced_window_keys') = 'array' THEN
    SELECT COALESCE(
      ARRAY_AGG(entry.value ORDER BY entry.ordinality),
      ARRAY[]::TEXT[]
    )
    INTO v_referenced_window_keys
    FROM jsonb_array_elements_text(v_card -> 'referenced_window_keys')
      WITH ORDINALITY AS entry(value, ordinality);
  ELSE
    v_referenced_window_keys := ARRAY[]::TEXT[];
  END IF;

  IF jsonb_typeof(v_card -> 'primary_time_window_key') = 'string' THEN
    v_primary_time_window_key := v_card ->> 'primary_time_window_key';
  ELSE
    v_primary_time_window_key := NULL;
  END IF;

  IF v_output_schema_version = 'recommendation_output_v2'
     AND (
       NOT (v_card ? 'primary_time_window_key')
       OR jsonb_typeof(v_card -> 'referenced_window_keys') IS DISTINCT FROM 'array'
       OR cardinality(v_referenced_window_keys) > 6
       OR EXISTS (
         SELECT 1
         FROM unnest(v_referenced_window_keys) AS key(value)
         WHERE length(btrim(key.value)) NOT BETWEEN 1 AND 256
            OR key.value IS DISTINCT FROM btrim(key.value)
       )
       OR EXISTS (
         SELECT 1
         FROM unnest(v_referenced_window_keys) AS key(value)
         GROUP BY key.value
         HAVING COUNT(*) > 1
       )
       OR (
         cardinality(v_referenced_window_keys) = 0
         AND v_primary_time_window_key IS NOT NULL
       )
       OR (
         cardinality(v_referenced_window_keys) > 0
         AND v_primary_time_window_key IS NULL
       )
       OR (
         v_primary_time_window_key IS NOT NULL
         AND NOT (v_primary_time_window_key = ANY(v_referenced_window_keys))
       )
     ) THEN
    RAISE EXCEPTION 'Recommendation V2 card has invalid time-window metadata'
      USING ERRCODE = '22023';
  END IF;

  NEW.primary_time_window_key := v_primary_time_window_key;
  NEW.referenced_window_keys := v_referenced_window_keys;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS derive_recommendation_event_time_windows_on_insert
  ON recommendation_events;
CREATE TRIGGER derive_recommendation_event_time_windows_on_insert
  BEFORE INSERT ON recommendation_events
  FOR EACH ROW
  EXECUTE FUNCTION derive_recommendation_event_time_windows();

-- Time-window novelty is a separate memory axis from semantic interest. This
-- bounded RPC returns primary-window exposure/open history plus the exact
-- windows opened in the current browsing session. It never scores astrology.
CREATE OR REPLACE FUNCTION get_recommendation_time_window_snapshot(
  p_user_id UUID,
  p_profile_id UUID,
  p_session_id TEXT,
  p_now TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_snapshot JSONB;
BEGIN
  IF p_user_id IS NULL OR p_profile_id IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'user_id, profile_id, and now are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_session_id IS NULL
     OR length(btrim(p_session_id)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'session_id is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM bazi_profiles AS profile
  WHERE profile.id = p_profile_id
    AND profile.owner_user_id = p_user_id
    AND profile.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile is not owned by user'
      USING ERRCODE = '42501';
  END IF;

  WITH scoped_events AS MATERIALIZED (
    SELECT event.*
    FROM recommendation_events AS event
    WHERE event.user_id = p_user_id
      AND event.profile_id = p_profile_id
      AND event.created_at >= p_now - INTERVAL '90 days'
      AND event.created_at <= p_now
  ),
  window_history AS (
    SELECT
      event.primary_time_window_key AS window_key,
      COUNT(*) FILTER (WHERE event.event_type = 'exposure') AS primary_exposures,
      COUNT(*) FILTER (WHERE event.event_type = 'open') AS primary_opens,
      MAX(event.created_at) FILTER (
        WHERE event.event_type = 'exposure'
      ) AS last_primary_exposed_at,
      MAX(event.created_at) FILTER (
        WHERE event.event_type = 'open'
      ) AS last_primary_opened_at
    FROM scoped_events AS event
    WHERE event.primary_time_window_key IS NOT NULL
    GROUP BY event.primary_time_window_key
  ),
  bounded_history AS (
    SELECT history.*
    FROM window_history AS history
    ORDER BY
      GREATEST(history.last_primary_exposed_at, history.last_primary_opened_at) DESC NULLS LAST,
      history.window_key ASC
    LIMIT 100
  ),
  session_windows AS (
    SELECT
      event.candidate_id,
      event.primary_time_window_key,
      event.referenced_window_keys,
      event.created_at
    FROM scoped_events AS event
    WHERE event.event_type = 'open'
      AND event.session_id = btrim(p_session_id)
      AND event.created_at >= p_now - INTERVAL '12 hours'
    ORDER BY event.created_at DESC, event.event_id DESC
    LIMIT 20
  )
  SELECT JSONB_BUILD_OBJECT(
    'time_window_history',
    COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'window_key', history.window_key,
        'primary_exposures', history.primary_exposures,
        'primary_opens', history.primary_opens,
        'last_primary_exposed_at', history.last_primary_exposed_at,
        'last_primary_opened_at', history.last_primary_opened_at
      ) ORDER BY
        GREATEST(history.last_primary_exposed_at, history.last_primary_opened_at) DESC NULLS LAST,
        history.window_key ASC)
      FROM bounded_history AS history
    ), '[]'::JSONB),
    'current_session_windows',
    COALESCE((
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'candidate_id', event.candidate_id,
        'primary_time_window_key', event.primary_time_window_key,
        'referenced_window_keys', TO_JSONB(event.referenced_window_keys)
      ) ORDER BY event.created_at DESC, event.candidate_id ASC)
      FROM session_windows AS event
    ), '[]'::JSONB)
  ) INTO v_snapshot;

  RETURN v_snapshot;
END;
$$;

-- The existing semantic-memory RPC is also read-only. Marking both inner
-- functions STABLE makes every SELECT inside the wrapper use the snapshot of
-- the outer statement instead of independently refreshing under READ COMMITTED.
ALTER FUNCTION get_recommendation_preference_snapshot(
  UUID, UUID, TEXT, TIMESTAMPTZ
) STABLE;

-- One RPC gives the service a single database snapshot for content interest
-- and time-window memory. The server-side 12-hour guard prevents a reused
-- client session id from turning weeks of behavior into "this browsing session".
CREATE OR REPLACE FUNCTION get_recommendation_memory_snapshot(
  p_user_id UUID,
  p_profile_id UUID,
  p_session_id TEXT,
  p_now TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_preference JSONB;
  v_time_windows JSONB;
  v_current_session JSONB;
BEGIN
  SELECT
    get_recommendation_preference_snapshot(
      p_user_id,
      p_profile_id,
      p_session_id,
      p_now
    ),
    get_recommendation_time_window_snapshot(
      p_user_id,
      p_profile_id,
      p_session_id,
      p_now
    )
  INTO v_preference, v_time_windows;

  SELECT COALESCE(
    JSONB_AGG(entry.value ORDER BY entry.ordinality),
    '[]'::JSONB
  )
  INTO v_current_session
  FROM jsonb_array_elements(
    COALESCE(v_preference -> 'current_session_opens', '[]'::JSONB)
  ) WITH ORDINALITY AS entry(value, ordinality)
  WHERE (entry.value ->> 'opened_at')::TIMESTAMPTZ
    >= p_now - INTERVAL '12 hours';

  RETURN COALESCE(v_preference, '{}'::JSONB)
    || COALESCE(v_time_windows, '{}'::JSONB)
    || JSONB_BUILD_OBJECT('current_session_opens', v_current_session);
END;
$$;

REVOKE ALL ON FUNCTION finalize_recommendation_batch(
  UUID, UUID, UUID, BIGINT, JSONB, JSONB, JSONB, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION create_recommendation_pool_continuation(
  UUID, UUID, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_recommendation_time_window_snapshot(
  UUID, UUID, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_recommendation_memory_snapshot(
  UUID, UUID, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION finalize_recommendation_batch(
  UUID, UUID, UUID, BIGINT, JSONB, JSONB, JSONB, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION create_recommendation_pool_continuation(
  UUID, UUID, JSONB, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION get_recommendation_time_window_snapshot(
  UUID, UUID, TEXT, TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION get_recommendation_memory_snapshot(
  UUID, UUID, TEXT, TIMESTAMPTZ
) TO service_role;
