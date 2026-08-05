-- ============================================================
-- 015_recommendation_deck_only_pool.sql
-- Recommendation V3: one immutable 30-card AI pool projected into three
-- 10-card deck-only batches. The five-item analysis area remains independent.
-- Legacy 6+3 and 8+4 READY batches remain readable and auditable.
-- ============================================================

BEGIN;

ALTER TABLE recommendation_batches
  DROP CONSTRAINT IF EXISTS recommendation_batch_cards_shape_v2,
  DROP CONSTRAINT IF EXISTS recommendation_batch_candidate_pool_shape,
  DROP CONSTRAINT IF EXISTS recommendation_batch_generation_kind,
  DROP CONSTRAINT IF EXISTS recommendation_batch_v2_pool_consistency;

ALTER TABLE recommendation_batches
  ADD CONSTRAINT recommendation_batch_cards_shape_v3
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
      WHEN output_schema_version = 'recommendation_output_v3' THEN
        jsonb_array_length(cards_json -> 'deck_cards') = 10
        AND jsonb_array_length(cards_json -> 'center_cards') = 0
      ELSE FALSE
    END
  ),
  ADD CONSTRAINT recommendation_batch_candidate_pool_shape_v3
  CHECK (
    CASE
      WHEN candidate_pool_json IS NULL THEN TRUE
      WHEN jsonb_typeof(candidate_pool_json) IS DISTINCT FROM 'object' THEN FALSE
      WHEN jsonb_typeof(candidate_pool_json -> 'candidates') IS DISTINCT FROM 'array' THEN FALSE
      WHEN candidate_pool_json ->> 'pool_version' = 'recommendation_pool_v1' THEN
        output_schema_version = 'recommendation_output_v2'
        AND jsonb_array_length(candidate_pool_json -> 'candidates') = 24
      WHEN candidate_pool_json ->> 'pool_version' = 'recommendation_pool_v2' THEN
        output_schema_version = 'recommendation_output_v3'
        AND jsonb_array_length(candidate_pool_json -> 'candidates') = 30
      ELSE FALSE
    END
  ),
  ADD CONSTRAINT recommendation_batch_generation_kind_v3
  CHECK (
    CASE generation_kind
      WHEN 'ai' THEN pool_source_batch_id IS NULL
      WHEN 'pool' THEN
        pool_source_batch_id IS NOT NULL
        AND pool_source_batch_id <> id
        AND after_batch_id IS NOT NULL
        AND candidate_pool_json IS NULL
        AND status = 'ready'
        AND (
          (
            output_schema_version = 'recommendation_output_v2'
            AND after_batch_id IS NOT DISTINCT FROM pool_source_batch_id
          )
          OR output_schema_version = 'recommendation_output_v3'
        )
      ELSE FALSE
    END
  ),
  ADD CONSTRAINT recommendation_batch_pool_consistency_v3
  CHECK (
    output_schema_version NOT IN ('recommendation_output_v2', 'recommendation_output_v3')
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

COMMENT ON COLUMN recommendation_batches.candidate_pool_json IS
  'V2 为24张旧候选池；V3为30张上方大卡候选池。仅AI根批次保存，READY后不可修改';
COMMENT ON COLUMN recommendation_batches.pool_source_batch_id IS
  'V2续批直接指父AI根批次；V3第二、第三展示批次都指同一AI根候选池';

CREATE OR REPLACE FUNCTION finalize_recommendation_batch_v3(
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
  IF p_output_schema_version IS DISTINCT FROM 'recommendation_output_v3' THEN
    RAISE EXCEPTION 'deck-only finalize requires recommendation_output_v3'
      USING ERRCODE = '22023';
  END IF;

  IF p_generation_metrics_json IS NULL
     OR jsonb_typeof(p_generation_metrics_json) IS DISTINCT FROM 'object'
     OR p_generation_metrics_json ->> 'outcome' IS DISTINCT FROM 'success' THEN
    RAISE EXCEPTION 'generation metrics must describe one successful AI call'
      USING ERRCODE = '22023';
  END IF;

  IF p_selection_context_json IS NULL
     OR jsonb_typeof(p_selection_context_json) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'selection context must be an object'
      USING ERRCODE = '22023';
  END IF;

  IF p_candidate_pool_json IS NULL
     OR jsonb_typeof(p_candidate_pool_json) IS DISTINCT FROM 'object'
     OR p_candidate_pool_json ->> 'pool_version' IS DISTINCT FROM 'recommendation_pool_v2'
     OR jsonb_typeof(p_candidate_pool_json -> 'candidates') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_candidate_pool_json -> 'candidates') <> 30 THEN
    RAISE EXCEPTION 'candidate pool must contain exactly 30 candidates'
      USING ERRCODE = '22023';
  END IF;

  IF p_cards_json IS NULL
     OR jsonb_typeof(p_cards_json) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_cards_json -> 'deck_cards') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_cards_json -> 'deck_cards') <> 10
     OR jsonb_typeof(p_cards_json -> 'center_cards') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_cards_json -> 'center_cards') <> 0 THEN
    RAISE EXCEPTION 'first display must contain 10 deck cards and no center cards'
      USING ERRCODE = '22023';
  END IF;

  WITH pool_cards AS (
    SELECT card ->> 'candidate_id' AS candidate_id
    FROM jsonb_array_elements(p_candidate_pool_json -> 'candidates') AS card
  ),
  displayed AS (
    SELECT card ->> 'candidate_id' AS candidate_id
    FROM jsonb_array_elements(p_cards_json -> 'deck_cards') AS card
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

  IF v_pool_count <> 30
     OR v_pool_unique_count <> 30
     OR v_display_count <> 10
     OR v_display_unique_count <> 10 THEN
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
        (entry.ordinality - 1)::INTEGER AS position,
        entry.value ->> 'candidate_id' AS candidate_id,
        entry.value AS card
      FROM jsonb_array_elements(p_cards_json -> 'deck_cards')
        WITH ORDINALITY AS entry(value, ordinality)
    )
    SELECT 1
    FROM displayed
    LEFT JOIN pool_cards USING (candidate_id)
    WHERE pool_cards.candidate_id IS NULL
       OR (displayed.card - 'surface' - 'position') IS DISTINCT FROM pool_cards.card
       OR jsonb_typeof(displayed.card -> 'surface') IS DISTINCT FROM 'string'
       OR displayed.card ->> 'surface' IS DISTINCT FROM 'deck'
       OR jsonb_typeof(displayed.card -> 'position') IS DISTINCT FROM 'number'
       OR displayed.card ->> 'position' IS DISTINCT FROM displayed.position::TEXT
  ) THEN
    RAISE EXCEPTION 'first display cards must be exact deck projections of the candidate pool'
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

CREATE OR REPLACE FUNCTION create_recommendation_pool_continuation_v3(
  p_user_id UUID,
  p_parent_batch_id UUID,
  p_root_batch_id UUID,
  p_cards_json JSONB,
  p_selection_context_json JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_root recommendation_batches%ROWTYPE;
  v_parent recommendation_batches%ROWTYPE;
  v_existing recommendation_batches%ROWTYPE;
  v_created_id UUID;
  v_pool_count INTEGER;
  v_pool_unique_count INTEGER;
  v_consumed_count INTEGER;
  v_consumed_unique_count INTEGER;
  v_selected_count INTEGER;
  v_selected_unique_count INTEGER;
BEGIN
  IF p_user_id IS NULL OR p_parent_batch_id IS NULL OR p_root_batch_id IS NULL THEN
    RAISE EXCEPTION 'user_id, parent_batch_id, and root_batch_id are required'
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
     OR jsonb_array_length(p_cards_json -> 'deck_cards') <> 10
     OR jsonb_typeof(p_cards_json -> 'center_cards') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_cards_json -> 'center_cards') <> 0 THEN
    RAISE EXCEPTION 'pool continuation must contain 10 deck cards and no center cards'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_root_batch_id::TEXT, 20260805));

  SELECT batch.*
  INTO v_root
  FROM recommendation_batches AS batch
  WHERE batch.id = p_root_batch_id
    AND batch.user_id = p_user_id
    AND batch.status = 'ready'
    AND batch.generation_kind = 'ai'
    AND batch.output_schema_version = 'recommendation_output_v3'
    AND batch.candidate_pool_json ->> 'pool_version' = 'recommendation_pool_v2'
    AND batch.valid_until > clock_timestamp()
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'root is not an owned live V3 AI batch'
      USING ERRCODE = '42501';
  END IF;

  SELECT batch.*
  INTO v_parent
  FROM recommendation_batches AS batch
  WHERE batch.id = p_parent_batch_id
    AND batch.user_id = p_user_id
    AND batch.status = 'ready'
    AND batch.output_schema_version = 'recommendation_output_v3'
    AND batch.valid_until > clock_timestamp()
  FOR SHARE;

  IF NOT FOUND
     OR v_parent.profile_id IS DISTINCT FROM v_root.profile_id
     OR v_parent.profile_revision_hash IS DISTINCT FROM v_root.profile_revision_hash
     OR v_parent.effective_date IS DISTINCT FROM v_root.effective_date
     OR v_parent.generation_timezone IS DISTINCT FROM v_root.generation_timezone
     OR NOT (
       v_parent.id = v_root.id
       OR (
         v_parent.generation_kind = 'pool'
         AND v_parent.pool_source_batch_id = v_root.id
       )
     ) THEN
    RAISE EXCEPTION 'parent is not part of the V3 root display chain'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM bazi_profiles AS profile
  WHERE profile.id = v_root.profile_id
    AND profile.owner_user_id = p_user_id
    AND profile.deleted_at IS NULL
    AND profile.updated_at = v_root.profile_updated_at
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile revision changed before pool continuation'
      USING ERRCODE = '40001';
  END IF;

  SELECT batch.*
  INTO v_existing
  FROM recommendation_batches AS batch
  WHERE batch.user_id = p_user_id
    AND batch.profile_id = v_root.profile_id
    AND batch.effective_date = v_root.effective_date
    AND batch.profile_revision_hash = v_root.profile_revision_hash
    AND batch.generation_timezone = v_root.generation_timezone
    AND batch.after_batch_id = v_parent.id;

  IF FOUND THEN
    IF v_existing.generation_kind <> 'pool'
       OR v_existing.pool_source_batch_id <> v_root.id
       OR v_existing.output_schema_version <> 'recommendation_output_v3'
       OR v_existing.status <> 'ready' THEN
      RAISE EXCEPTION 'parent successor slot belongs to another generation'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  WITH pool_cards AS (
    SELECT card ->> 'candidate_id' AS candidate_id
    FROM jsonb_array_elements(v_root.candidate_pool_json -> 'candidates') AS card
  ),
  consumed AS (
    SELECT card ->> 'candidate_id' AS candidate_id
    FROM jsonb_array_elements(v_root.cards_json -> 'deck_cards') AS card
    UNION ALL
    SELECT entry.value ->> 'candidate_id' AS candidate_id
    FROM recommendation_batches AS batch
    CROSS JOIN LATERAL jsonb_array_elements(batch.cards_json -> 'deck_cards') AS entry(value)
    WHERE batch.user_id = p_user_id
      AND batch.pool_source_batch_id = v_root.id
      AND batch.generation_kind = 'pool'
      AND batch.output_schema_version = 'recommendation_output_v3'
      AND batch.status = 'ready'
  ),
  selected AS (
    SELECT card ->> 'candidate_id' AS candidate_id
    FROM jsonb_array_elements(p_cards_json -> 'deck_cards') AS card
  )
  SELECT
    (SELECT COUNT(*) FROM pool_cards),
    (SELECT COUNT(DISTINCT candidate_id) FROM pool_cards),
    (SELECT COUNT(*) FROM consumed),
    (SELECT COUNT(DISTINCT candidate_id) FROM consumed),
    (SELECT COUNT(*) FROM selected),
    (SELECT COUNT(DISTINCT candidate_id) FROM selected)
  INTO
    v_pool_count,
    v_pool_unique_count,
    v_consumed_count,
    v_consumed_unique_count,
    v_selected_count,
    v_selected_unique_count;

  IF v_pool_count <> 30
     OR v_pool_unique_count <> 30
     OR v_consumed_count NOT IN (10, 20)
     OR v_consumed_unique_count <> v_consumed_count
     OR v_selected_count <> 10
     OR v_selected_unique_count <> 10 THEN
    RAISE EXCEPTION 'candidate pool or display candidate ids are invalid'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    WITH pool_cards AS (
      SELECT card ->> 'candidate_id' AS candidate_id
      FROM jsonb_array_elements(v_root.candidate_pool_json -> 'candidates') AS card
    ),
    consumed AS (
      SELECT card ->> 'candidate_id' AS candidate_id
      FROM jsonb_array_elements(v_root.cards_json -> 'deck_cards') AS card
      UNION
      SELECT entry.value ->> 'candidate_id' AS candidate_id
      FROM recommendation_batches AS batch
      CROSS JOIN LATERAL jsonb_array_elements(batch.cards_json -> 'deck_cards') AS entry(value)
      WHERE batch.user_id = p_user_id
        AND batch.pool_source_batch_id = v_root.id
        AND batch.generation_kind = 'pool'
        AND batch.output_schema_version = 'recommendation_output_v3'
        AND batch.status = 'ready'
    ),
    selected AS (
      SELECT card ->> 'candidate_id' AS candidate_id
      FROM jsonb_array_elements(p_cards_json -> 'deck_cards') AS card
    )
    SELECT 1
    FROM selected
    LEFT JOIN pool_cards USING (candidate_id)
    LEFT JOIN consumed USING (candidate_id)
    WHERE pool_cards.candidate_id IS NULL
       OR consumed.candidate_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'pool continuation must contain only unconsumed candidates'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    WITH pool_cards AS (
      SELECT card ->> 'candidate_id' AS candidate_id, card
      FROM jsonb_array_elements(v_root.candidate_pool_json -> 'candidates') AS card
    ),
    selected AS (
      SELECT
        (entry.ordinality - 1)::INTEGER AS position,
        entry.value ->> 'candidate_id' AS candidate_id,
        entry.value AS card
      FROM jsonb_array_elements(p_cards_json -> 'deck_cards')
        WITH ORDINALITY AS entry(value, ordinality)
    )
    SELECT 1
    FROM selected
    LEFT JOIN pool_cards USING (candidate_id)
    WHERE pool_cards.candidate_id IS NULL
       OR (selected.card - 'surface' - 'position') IS DISTINCT FROM pool_cards.card
       OR jsonb_typeof(selected.card -> 'surface') IS DISTINCT FROM 'string'
       OR selected.card ->> 'surface' IS DISTINCT FROM 'deck'
       OR jsonb_typeof(selected.card -> 'position') IS DISTINCT FROM 'number'
       OR selected.card ->> 'position' IS DISTINCT FROM selected.position::TEXT
  ) THEN
    RAISE EXCEPTION 'pool continuation cards must be exact deck projections of the pool'
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
    v_root.generation_key || ':pool:' || ((v_consumed_count / 10) + 1)::TEXT,
    v_root.user_id,
    v_root.profile_id,
    v_parent.id,
    v_root.effective_date,
    v_root.profile_revision_hash,
    v_root.profile_updated_at,
    v_root.generation_timezone,
    v_root.input_hash,
    v_root.valid_until,
    'ready',
    NULL,
    1,
    NULL,
    1,
    NULL,
    v_root.input_snapshot_json,
    p_cards_json,
    NULL,
    'pool',
    v_root.id,
    p_selection_context_json,
    NULL,
    v_root.prompt_version,
    v_root.output_schema_version,
    v_root.taxonomy_version,
    v_root.model_id,
    clock_timestamp()
  )
  RETURNING id INTO v_created_id;

  RETURN v_created_id;
END;
$$;

-- Recommendation memory now belongs only to the upper deck. Historical
-- center-card events remain stored for audit, but cannot influence deck
-- interests or session intent after this migration.
CREATE OR REPLACE FUNCTION get_recommendation_preference_snapshot(
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
      AND event.surface = 'deck'
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
      AND event.surface = 'deck'
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

REVOKE ALL ON FUNCTION finalize_recommendation_batch_v3(
  UUID, UUID, UUID, BIGINT, JSONB, JSONB, JSONB, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION create_recommendation_pool_continuation_v3(
  UUID, UUID, UUID, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_recommendation_preference_snapshot(
  UUID, UUID, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_recommendation_time_window_snapshot(
  UUID, UUID, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION finalize_recommendation_batch_v3(
  UUID, UUID, UUID, BIGINT, JSONB, JSONB, JSONB, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION create_recommendation_pool_continuation_v3(
  UUID, UUID, UUID, JSONB, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION get_recommendation_preference_snapshot(
  UUID, UUID, TEXT, TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION get_recommendation_time_window_snapshot(
  UUID, UUID, TEXT, TIMESTAMPTZ
) TO service_role;

COMMIT;
