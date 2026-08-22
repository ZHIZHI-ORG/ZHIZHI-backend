-- Forward-only compatibility for evidence-gated Prompt VNext.
-- Prompt versions remain content identities, not authorization boundaries.
BEGIN;

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
  v_structure_facts JSONB;
  v_ref TEXT;
  v_structure_source TEXT;
  v_structure_ref TEXT;
  v_structure_count INTEGER;
  v_valid_structure_count INTEGER;
  v_profile_id UUID;
  v_token UUID;
  v_previous_status TEXT;
  v_quota_day DATE;
  v_daily_count INTEGER;
  v_active_count INTEGER;
BEGIN
  IF p_source_type NOT IN ('medium', 'large')
     OR p_contract_version <> 'insight_card_content_v2'
     OR p_output_schema_version <> 'insight_card_detail_output_v2'
     OR (p_source_type = 'medium' AND p_prompt_version NOT IN (
       'insight_medium_detail_prompt_v2', 'insight_medium_detail_prompt_v3', 'insight_medium_detail_prompt_v4'
     ))
     OR (p_source_type = 'large' AND p_prompt_version NOT IN (
       'insight_large_detail_prompt_v2', 'insight_large_detail_prompt_v3', 'insight_large_detail_prompt_v4'
     ))
     OR length(p_generation_key) <> 64
     OR length(btrim(p_model_identity)) = 0
     OR p_lease_ttl_seconds NOT BETWEEN 130 AND 300
     OR p_max_attempts NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'invalid insight detail V2 claim' USING ERRCODE = '22023';
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
        AND generator_version = 'medium_generator_v5'
        AND prompt_version IN ('medium_insight_prompt_v5', 'medium_insight_prompt_v6', 'medium_insight_prompt_v7')
        AND output_schema_version = 'medium_insight_output_v1'
        AND fact_snapshot_json->>'version' = 'medium_fact_snapshot_v2'
        AND soft_context_snapshot_json->>'version' = 'medium_context_snapshot_v2';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'owned medium V2 source batch not found' USING ERRCODE = '42501';
      END IF;

      SELECT card INTO v_item
      FROM jsonb_array_elements(v_medium.cards_json->'domains') domain_row,
        jsonb_array_elements(domain_row->'cards') card
      WHERE card->>'content_id' = p_source_item_id LIMIT 1;
      IF v_item IS NULL THEN
        RAISE EXCEPTION 'medium source item not found' USING ERRCODE = '42501';
      END IF;

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
        RAISE EXCEPTION 'medium source card has invalid hard fact references'
          USING ERRCODE = '22023';
      END IF;

      v_structure_refs := '[]'::JSONB;
      FOREACH v_structure_source IN ARRAY ARRAY[
        'month_command', 'day_master_capacity', 'pattern_candidates', 'yongshen_basis'
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
          RAISE EXCEPTION 'medium structural foundation is missing or duplicated'
            USING ERRCODE = '22023';
        END IF;
        v_structure_refs := v_structure_refs || jsonb_build_array(v_structure_ref);
      END LOOP;

      v_refs := v_structure_refs;
      FOR v_ref IN
        SELECT card_ref.ref
        FROM jsonb_array_elements_text(v_card_refs) WITH ORDINALITY AS card_ref(ref, position)
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
      FROM jsonb_array_elements_text(v_refs) WITH ORDINALITY AS requested(ref, position)
      JOIN LATERAL (
        SELECT fact
        FROM jsonb_array_elements(v_medium.fact_snapshot_json->'facts') fact
        WHERE fact->>'ref' = requested.ref
      ) AS resolved ON TRUE;
      IF jsonb_array_length(v_selected->'facts') <> jsonb_array_length(v_refs)
         OR (SELECT COUNT(DISTINCT fact->>'ref')
             FROM jsonb_array_elements(v_selected->'facts') fact)
            <> jsonb_array_length(v_refs) THEN
        RAISE EXCEPTION 'medium detail facts do not resolve uniquely'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      SELECT * INTO v_large FROM recommendation_batches
      WHERE id = p_source_batch_id AND user_id = p_user_id AND status = 'ready'
        AND prompt_version IN ('recommendation_prompt_v8', 'recommendation_prompt_v9', 'recommendation_prompt_v10')
        AND output_schema_version = 'recommendation_output_v3'
        AND taxonomy_version = 'recommendation_taxonomy_v2';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'owned large V2 source batch not found' USING ERRCODE = '42501';
      END IF;

      SELECT card INTO v_item FROM (
        SELECT value AS card FROM jsonb_array_elements(COALESCE(v_large.cards_json->'deck_cards', '[]'::JSONB))
        UNION ALL
        SELECT value AS card FROM jsonb_array_elements(COALESCE(v_large.cards_json->'center_cards', '[]'::JSONB))
      ) cards WHERE card->>'candidate_id' = p_source_item_id LIMIT 1;
      IF v_item IS NULL THEN
        RAISE EXCEPTION 'large source item not found' USING ERRCODE = '42501';
      END IF;

      IF v_large.generation_kind = 'ai' THEN
        v_root := v_large;
      ELSIF v_large.generation_kind = 'pool' THEN
        SELECT * INTO v_root FROM recommendation_batches
        WHERE id = v_large.pool_source_batch_id AND user_id = p_user_id
          AND profile_id = v_large.profile_id AND status = 'ready'
          AND generation_kind = 'ai'
          AND prompt_version IN ('recommendation_prompt_v8', 'recommendation_prompt_v9', 'recommendation_prompt_v10')
          AND output_schema_version = 'recommendation_output_v3'
          AND taxonomy_version = 'recommendation_taxonomy_v2';
      ELSE
        RAISE EXCEPTION 'large source generation kind is unsupported' USING ERRCODE = '42501';
      END IF;

      IF v_root.input_snapshot_json IS NULL
         OR v_root.input_snapshot_json->>'contract_version' <> 'recommendation_ai_v8'
         OR v_root.input_snapshot_json->>'taxonomy_version' <> 'recommendation_taxonomy_v2'
         OR v_root.user_id <> p_user_id
         OR v_root.profile_id <> v_large.profile_id
         OR v_root.prompt_version <> v_large.prompt_version
         OR v_root.profile_revision_hash <> v_large.profile_revision_hash
         OR v_root.profile_updated_at <> v_large.profile_updated_at
         OR v_root.generation_timezone <> v_large.generation_timezone
         OR v_root.effective_date <> v_large.effective_date THEN
        RAISE EXCEPTION 'large source grounding snapshot not found' USING ERRCODE = '42501';
      END IF;

      v_profile_id := v_large.profile_id;
      v_context := COALESCE(v_root.input_snapshot_json->'reality_context', '{}'::JSONB);
      v_card_refs := v_item#>'{event_hypothesis,fact_refs}';
      v_structure_facts := v_root.input_snapshot_json->'structure_facts';
      IF jsonb_typeof(v_item->'question') <> 'string' OR length(btrim(v_item->>'question')) = 0
         OR jsonb_typeof(v_item->'preview') <> 'string' OR length(btrim(v_item->>'preview')) = 0
         OR jsonb_typeof(v_item->'body') <> 'string' OR length(btrim(v_item->>'body')) = 0
         OR jsonb_typeof(v_card_refs) <> 'array'
         OR jsonb_array_length(v_card_refs) NOT BETWEEN 1 AND 6
         OR NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(v_card_refs) AS refs(ref)
           WHERE refs.ref LIKE 'time:%'
         )
         OR (SELECT COUNT(*) FROM jsonb_array_elements_text(v_card_refs))
            <> (SELECT COUNT(DISTINCT ref)
                FROM jsonb_array_elements_text(v_card_refs) AS refs(ref)) THEN
        RAISE EXCEPTION 'large source card is incomplete or lacks time facts'
          USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v_structure_facts) <> 'array' THEN
        RAISE EXCEPTION 'large structure foundation is missing' USING ERRCODE = '22023';
      END IF;

      v_structure_refs := '[]'::JSONB;
      FOREACH v_structure_source IN ARRAY ARRAY[
        'month_command', 'day_master_capacity', 'pattern_candidates', 'yongshen_basis'
      ]::TEXT[] LOOP
        SELECT COUNT(*),
          COUNT(*) FILTER (
            WHERE jsonb_typeof(fact->'ref') = 'string'
              AND length(btrim(fact->>'ref')) BETWEEN 1 AND 256
          ),
          MIN(fact->>'ref')
        INTO v_structure_count, v_valid_structure_count, v_structure_ref
        FROM jsonb_array_elements(v_structure_facts) fact
        WHERE fact->>'source' = v_structure_source;
        IF v_structure_count <> 1 OR v_valid_structure_count <> 1
           OR v_structure_refs ? v_structure_ref THEN
          RAISE EXCEPTION 'large structural foundation is missing or duplicated'
            USING ERRCODE = '22023';
        END IF;
        v_structure_refs := v_structure_refs || jsonb_build_array(v_structure_ref);
      END LOOP;

      v_refs := v_structure_refs;
      FOR v_ref IN
        SELECT card_ref.ref
        FROM jsonb_array_elements_text(v_card_refs) WITH ORDINALITY AS card_ref(ref, position)
        ORDER BY card_ref.position
      LOOP
        IF NOT v_refs ? v_ref THEN
          v_refs := v_refs || jsonb_build_array(v_ref);
        END IF;
      END LOOP;

      SELECT jsonb_agg(resolved.fact ORDER BY requested.position)
      INTO v_structure_facts
      FROM jsonb_array_elements_text(v_structure_refs) WITH ORDINALITY AS requested(ref, position)
      JOIN LATERAL (
        SELECT fact FROM jsonb_array_elements(v_root.input_snapshot_json->'structure_facts') fact
        WHERE fact->>'ref' = requested.ref
      ) AS resolved ON TRUE;
      IF jsonb_array_length(v_structure_facts) <> 4 THEN
        RAISE EXCEPTION 'large structure references do not resolve uniquely'
          USING ERRCODE = '22023';
      END IF;

      v_selected := jsonb_build_object(
        'contract_version', v_root.input_snapshot_json->'contract_version',
        'effective_date', v_root.input_snapshot_json->'effective_date',
        'structure_facts', v_structure_facts,
        'fortune_facts', jsonb_build_object(
          'contract_version', v_root.input_snapshot_json#>'{fortune_facts,contract_version}',
          'effective_date', v_root.input_snapshot_json#>'{fortune_facts,effective_date}',
          'natal', jsonb_build_object(
            'day_master', v_root.input_snapshot_json#>'{fortune_facts,natal,day_master}',
            'pillars', COALESCE((SELECT jsonb_agg(pillar)
              FROM jsonb_array_elements(COALESCE(v_root.input_snapshot_json#>'{fortune_facts,natal,pillars}', '[]'::JSONB)) pillar
              WHERE v_card_refs ? ('natal:pillar:' || (pillar->>'position'))), '[]'::JSONB)
          ),
          'mingli_interactions', jsonb_build_object(
            'rule_version', v_root.input_snapshot_json#>'{fortune_facts,mingli_interactions,rule_version}',
            'natal', COALESCE((SELECT jsonb_agg(interaction)
              FROM jsonb_array_elements(COALESCE(v_root.input_snapshot_json#>'{fortune_facts,mingli_interactions,natal}', '[]'::JSONB)) interaction
              WHERE v_card_refs ? ('natal:interaction:' || (interaction->>'id'))), '[]'::JSONB)
          )
        ),
        'time_windows', COALESCE((SELECT jsonb_agg(jsonb_set(
          CASE WHEN v_card_refs ? ('time:' || (window_row->>'window_key') || ':timing')
            THEN window_row ELSE window_row - 'timing' END,
          '{interactions}',
          COALESCE((SELECT jsonb_agg(interaction)
            FROM jsonb_array_elements(COALESCE(window_row->'interactions', '[]'::JSONB)) interaction
            WHERE v_card_refs ? ('time:' || (window_row->>'window_key') || ':interaction:' || (interaction->>'id'))
          ), '[]'::JSONB)
        ))
          FROM jsonb_array_elements(COALESCE(v_root.input_snapshot_json->'time_windows', '[]'::JSONB)) window_row
          WHERE window_row->>'window_key' IN (
            SELECT jsonb_array_elements_text(COALESCE(v_item->'referenced_window_keys', '[]'::JSONB))
          )), '[]'::JSONB),
        'available_fact_refs', COALESCE((SELECT jsonb_agg(ref_row)
          FROM jsonb_array_elements(COALESCE(v_root.input_snapshot_json->'available_fact_refs', '[]'::JSONB)) ref_row
          WHERE ref_row->>'ref' IN (SELECT jsonb_array_elements_text(v_card_refs))), '[]'::JSONB)
      );

      IF jsonb_array_length(v_selected->'available_fact_refs') <> jsonb_array_length(v_card_refs)
         OR (SELECT COUNT(DISTINCT ref_row->>'ref')
             FROM jsonb_array_elements(v_selected->'available_fact_refs') ref_row)
            <> jsonb_array_length(v_card_refs) THEN
        RAISE EXCEPTION 'large source card refs do not resolve uniquely'
          USING ERRCODE = '22023';
      END IF;

      FOR v_ref IN SELECT jsonb_array_elements_text(v_card_refs) LOOP
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
          RAISE EXCEPTION 'large source fact ref has no selected entity' USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;

    IF jsonb_typeof(v_refs) <> 'array' OR jsonb_array_length(v_refs) = 0
       OR jsonb_array_length(v_refs) > 12
       OR octet_length(v_selected::TEXT) > 196608 THEN
      RAISE EXCEPTION 'selected insight facts are invalid or exceed byte ceiling'
        USING ERRCODE = '22023';
    END IF;

    v_quota_day := ((v_now AT TIME ZONE 'Asia/Hong_Kong') + interval '1 hour')::DATE;
    PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws('|',
      'insight-detail-active', p_user_id::TEXT), 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws('|',
      'insight-detail-quota', p_user_id::TEXT, v_quota_day::TEXT), 0));
    SELECT COUNT(*) INTO v_daily_count FROM insight_card_details
    WHERE user_id = p_user_id AND quota_day = v_quota_day
      AND contract_version = 'insight_card_content_v2';
    IF v_daily_count >= 10 THEN
      RAISE EXCEPTION 'insight detail daily limit reached' USING ERRCODE = 'P4291';
    END IF;
    SELECT COUNT(*) INTO v_active_count FROM insight_card_details
    WHERE user_id = p_user_id AND status = 'generating'
      AND lease_expires_at > v_now
      AND contract_version = 'insight_card_content_v2';
    IF v_active_count >= 2 THEN
      RAISE EXCEPTION 'insight detail active limit reached' USING ERRCODE = 'P4292';
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

  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws('|',
    'insight-detail-active', p_user_id::TEXT), 0));
  SELECT COUNT(*) INTO v_active_count FROM insight_card_details AS detail
  WHERE detail.user_id = p_user_id AND detail.id <> v_row.id
    AND detail.status = 'generating' AND detail.lease_expires_at > v_now
    AND detail.contract_version = 'insight_card_content_v2';
  IF v_active_count >= 2 THEN
    RAISE EXCEPTION 'insight detail active limit reached' USING ERRCODE = 'P4292';
  END IF;

  v_previous_status := v_row.status;
  v_token := gen_random_uuid();
  UPDATE insight_card_details SET status = 'generating', lease_token = v_token,
    lease_epoch = lease_epoch + 1,
    lease_expires_at = v_now + make_interval(secs => p_lease_ttl_seconds),
    attempt_count = attempt_count + 1, next_attempt_at = NULL,
    last_error_code = NULL, last_error_stage = NULL, updated_at = v_now
  WHERE id = v_row.id RETURNING * INTO v_row;
  RETURN QUERY SELECT CASE WHEN v_previous_status = 'generating'
      THEN 'owner_takeover' ELSE 'owner' END,
    v_row.id, v_row.status, v_row.lease_token, v_row.lease_epoch,
    v_row.lease_expires_at, NULL::TIMESTAMPTZ;
END;
$$;

COMMIT;
