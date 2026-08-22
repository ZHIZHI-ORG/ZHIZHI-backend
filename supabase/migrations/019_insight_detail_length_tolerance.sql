-- Detail length is a prompt target, not a delivery rejection boundary.
-- Fact identity, source ownership, safety and response-size ceilings stay hard.

CREATE OR REPLACE FUNCTION finalize_insight_card_detail(
  p_detail_id UUID, p_user_id UUID, p_lease_token UUID, p_lease_epoch BIGINT,
  p_detail_content_json JSONB, p_model_id TEXT, p_generation_metrics_json JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row insight_card_details%ROWTYPE;
  v_ref TEXT;
  v_original_refs JSONB;
BEGIN
  IF jsonb_typeof(p_detail_content_json) <> 'object'
     OR jsonb_typeof(p_detail_content_json->'title') <> 'string'
     OR jsonb_typeof(p_detail_content_json->'preview') <> 'string'
     OR jsonb_typeof(p_detail_content_json->'body') <> 'string'
     OR jsonb_typeof(p_detail_content_json->'fact_refs') <> 'array'
     OR jsonb_array_length(p_detail_content_json->'fact_refs') NOT BETWEEN 1 AND 12
     OR jsonb_typeof(p_detail_content_json->'suggested_follow_ups') <> 'array'
     OR jsonb_array_length(p_detail_content_json->'suggested_follow_ups') <> 2
     OR jsonb_typeof(p_detail_content_json->'follow_ups') <> 'array'
     OR jsonb_array_length(p_detail_content_json->'follow_ups') <> 0 THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_row FROM insight_card_details
  WHERE id = p_detail_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR v_row.contract_version <> 'insight_card_content_v2'
     OR v_row.output_schema_version <> 'insight_card_detail_output_v2'
     OR v_row.model_id IS DISTINCT FROM p_model_id THEN
    RETURN FALSE;
  END IF;

  IF p_detail_content_json->>'title' <> (CASE WHEN v_row.source_type = 'large'
      THEN v_row.source_item_snapshot_json->>'question'
      ELSE v_row.source_item_snapshot_json->>'title' END)
     OR p_detail_content_json->>'preview' <> v_row.source_item_snapshot_json->>'preview' THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_detail_content_json->'suggested_follow_ups') item
    WHERE jsonb_typeof(item) <> 'string'
      OR char_length(btrim(item #>> '{}')) NOT BETWEEN 6 AND 60
  ) OR (SELECT COUNT(*) FROM jsonb_array_elements_text(p_detail_content_json->'suggested_follow_ups'))
      <> (SELECT COUNT(DISTINCT question)
          FROM jsonb_array_elements_text(p_detail_content_json->'suggested_follow_ups')
            AS questions(question)) THEN
    RETURN FALSE;
  END IF;

  IF (SELECT COUNT(*) FROM jsonb_array_elements_text(p_detail_content_json->'fact_refs'))
      <> (SELECT COUNT(DISTINCT ref)
          FROM jsonb_array_elements_text(p_detail_content_json->'fact_refs') AS refs(ref)) THEN
    RETURN FALSE;
  END IF;
  FOR v_ref IN SELECT jsonb_array_elements_text(p_detail_content_json->'fact_refs') LOOP
    IF NOT v_row.fact_refs_json ? v_ref THEN RETURN FALSE; END IF;
  END LOOP;

  v_original_refs := CASE WHEN v_row.source_type = 'large'
    THEN v_row.source_item_snapshot_json#>'{event_hypothesis,fact_refs}'
    ELSE v_row.source_item_snapshot_json->'fact_refs' END;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_detail_content_json->'fact_refs') used(ref)
    WHERE v_original_refs ? used.ref
  ) THEN RETURN FALSE; END IF;
  IF v_row.source_type = 'large' AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_detail_content_json->'fact_refs') used(ref)
    WHERE used.ref LIKE 'time:%'
  ) THEN RETURN FALSE; END IF;

  UPDATE insight_card_details SET status = 'ready', lease_token = NULL,
    lease_expires_at = NULL, next_attempt_at = NULL,
    detail_json = jsonb_build_object(
      'detail_id', id, 'source_type', source_type,
      'source_batch_id', source_batch_id, 'source_item_id', source_item_id
    ) || p_detail_content_json,
    model_id = p_model_id, generation_metrics_json = p_generation_metrics_json,
    provider_attempt_count = provider_attempt_count
      + COALESCE((p_generation_metrics_json->>'provider_calls')::INTEGER, 0),
    provider_input_bytes = provider_input_bytes
      + COALESCE((p_generation_metrics_json->>'input_bytes')::BIGINT, 0),
    provider_prompt_tokens = provider_prompt_tokens
      + COALESCE((p_generation_metrics_json->>'prompt_tokens')::BIGINT, 0),
    provider_billed_output_tokens = provider_billed_output_tokens
      + COALESCE((p_generation_metrics_json->>'billed_output_tokens')::BIGINT, 0),
    ready_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE id = p_detail_id AND user_id = p_user_id AND status = 'generating'
    AND lease_token = p_lease_token AND lease_epoch = p_lease_epoch;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION finalize_insight_card_detail(
  UUID, UUID, UUID, BIGINT, JSONB, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finalize_insight_card_detail(
  UUID, UUID, UUID, BIGINT, JSONB, TEXT, JSONB
) TO service_role;
