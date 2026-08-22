#!/usr/bin/env bash

set -euo pipefail

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
initdb_bin="${INITDB_BIN:-/opt/homebrew/bin/initdb}"
pg_ctl_bin="${PG_CTL_BIN:-/opt/homebrew/bin/pg_ctl}"
psql_bin="${PSQL_BIN:-/opt/homebrew/bin/psql}"
pg_smoke_port="${INSIGHT_PG_SMOKE_PORT:-55447}"
pg_smoke_root="$(mktemp -d "${TMPDIR:-/tmp}/zhizhi-insight-pg-smoke.XXXXXX")"
pg_smoke_data="$pg_smoke_root/data"
pg_smoke_socket="$pg_smoke_root/socket"

for pg_binary in "$initdb_bin" "$pg_ctl_bin" "$psql_bin"; do
  if [[ ! -x "$pg_binary" ]]; then
    echo "PostgreSQL binary is unavailable: $pg_binary" >&2
    exit 1
  fi
done

mkdir -p "$pg_smoke_socket"

cleanup_pg_smoke() {
  "$pg_ctl_bin" -D "$pg_smoke_data" -m fast stop >/dev/null 2>&1 || true
  if [[ "$(basename "$pg_smoke_root")" == zhizhi-insight-pg-smoke.* ]]; then
    rm -rf -- "$pg_smoke_root"
  fi
}
trap cleanup_pg_smoke EXIT

"$initdb_bin" -D "$pg_smoke_data" --auth=trust --no-locale --encoding=UTF8 >/dev/null
"$pg_ctl_bin" -D "$pg_smoke_data" \
  -o "-F -p $pg_smoke_port -k $pg_smoke_socket" \
  -l "$pg_smoke_root/postgres.log" start >/dev/null

pg_smoke_psql=(
  "$psql_bin" -X -h "$pg_smoke_socket" -p "$pg_smoke_port"
  -d postgres -v ON_ERROR_STOP=1
)

"${pg_smoke_psql[@]}" -q -c "
  CREATE SCHEMA auth;
  CREATE SCHEMA extensions;
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN;
  CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT);
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE
    AS 'SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::UUID';
  CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
"

"${pg_smoke_psql[@]}" -q -f "$backend_dir/supabase/schema.sql" >/dev/null
for migration_file in "$backend_dir"/supabase/migrations/*.sql; do
  "${pg_smoke_psql[@]}" -q -f "$migration_file" >/dev/null
done

"${pg_smoke_psql[@]}" -q -c "
  DO \$security\$
  DECLARE
    v_function_oid OID := 'claim_insight_card_detail(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER)'::REGPROCEDURE;
    v_public_execute BOOLEAN;
    v_search_path TEXT[];
  BEGIN
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc AS function_row,
        LATERAL aclexplode(COALESCE(
          function_row.proacl,
          acldefault('f', function_row.proowner)
        )) AS privilege
      WHERE function_row.oid = v_function_oid
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) INTO v_public_execute;
    SELECT proconfig INTO v_search_path FROM pg_proc WHERE oid = v_function_oid;

    IF v_public_execute
       OR has_function_privilege('anon', v_function_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_function_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'VNext detail claim ACL drifted';
    END IF;
    IF NOT COALESCE(v_search_path @> ARRAY['search_path=public, extensions, pg_temp'], FALSE) THEN
      RAISE EXCEPTION 'VNext detail claim search_path drifted: %', v_search_path;
    END IF;
    IF has_schema_privilege('anon', 'public', 'CREATE')
       OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
      RAISE EXCEPTION 'untrusted application role can create objects in public schema';
    END IF;
  END
  \$security\$;
"

"${pg_smoke_psql[@]}" -q -c "
  INSERT INTO auth.users(id, email)
  VALUES ('10000000-0000-0000-0000-000000000001', 'resume-smoke@example.com');
  INSERT INTO users(id, email)
  VALUES ('10000000-0000-0000-0000-000000000001', 'resume-smoke@example.com');
  INSERT INTO bazi_profiles(
    id, owner_user_id, is_owner, name, gender, birth_year, birth_month, birth_day
  ) VALUES (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    TRUE, 'resume-smoke', 'unknown', 1990, 1, 1
  );
  INSERT INTO insight_card_details(
    id, generation_key, user_id, profile_id, source_type, source_batch_id,
    source_item_id, quota_day, source_item_snapshot_json, selected_fact_snapshot_json,
    grounding_context_snapshot_json, fact_refs_json, status, lease_token, lease_epoch,
    lease_expires_at, attempt_count, next_attempt_at, contract_version, prompt_version,
    output_schema_version, model_id
  ) VALUES
  (
    '40000000-0000-0000-0000-000000000001', repeat('1', 64),
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'medium', '30000000-0000-0000-0000-000000000001', 'resume-card-1',
    ((clock_timestamp() AT TIME ZONE 'Asia/Hong_Kong') + interval '1 hour')::DATE,
    '{}'::JSONB,
    jsonb_build_object('facts', jsonb_build_array(jsonb_build_object('ref', 'F1'))),
    '{}'::JSONB, jsonb_build_array('F1'),
    'retry_wait', NULL, 1, NULL, 1, clock_timestamp() - interval '1 second',
    'insight_card_content_v2', 'insight_medium_detail_prompt_v2',
    'insight_card_detail_output_v2', 'gemini-smoke'
  ),
  (
    '40000000-0000-0000-0000-000000000002', repeat('2', 64),
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'medium', '30000000-0000-0000-0000-000000000001', 'resume-card-2',
    ((clock_timestamp() AT TIME ZONE 'Asia/Hong_Kong') + interval '1 hour')::DATE,
    '{}'::JSONB,
    jsonb_build_object('facts', jsonb_build_array(jsonb_build_object('ref', 'F1'))),
    '{}'::JSONB, jsonb_build_array('F1'),
    'retry_wait', NULL, 1, NULL, 1, clock_timestamp() - interval '1 second',
    'insight_card_content_v2', 'insight_medium_detail_prompt_v2',
    'insight_card_detail_output_v2', 'gemini-smoke'
  ),
  (
    '40000000-0000-0000-0000-000000000003', repeat('3', 64),
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'medium', '30000000-0000-0000-0000-000000000001', 'resume-card-3',
    ((clock_timestamp() AT TIME ZONE 'Asia/Hong_Kong') + interval '1 hour')::DATE,
    '{}'::JSONB,
    jsonb_build_object('facts', jsonb_build_array(jsonb_build_object('ref', 'F1'))),
    '{}'::JSONB, jsonb_build_array('F1'),
    'generating', '50000000-0000-0000-0000-000000000003', 1,
    clock_timestamp() - interval '1 second', 1, NULL,
    'insight_card_content_v2', 'insight_medium_detail_prompt_v2',
    'insight_card_detail_output_v2', 'gemini-smoke'
  );

  WITH fixture(mode, batch_id, effective_date, content_id, batch_key) AS (
    VALUES
      ('valid',
        '31000000-0000-0000-0000-000000000001'::UUID,
        '2026-08-14'::DATE,
        '61000000-0000-0000-0000-000000000001'::TEXT,
        repeat('d', 64)),
      ('missing',
        '31000000-0000-0000-0000-000000000002'::UUID,
        '2026-08-15'::DATE,
        '61000000-0000-0000-0000-000000000002'::TEXT,
        repeat('e', 64)),
      ('duplicate',
        '31000000-0000-0000-0000-000000000003'::UUID,
        '2026-08-16'::DATE,
        '61000000-0000-0000-0000-000000000003'::TEXT,
        repeat('f', 64)),
      ('legacy',
        '31000000-0000-0000-0000-000000000004'::UUID,
        '2026-08-17'::DATE,
        '61000000-0000-0000-0000-000000000004'::TEXT,
        repeat('0', 64))
  )
  INSERT INTO medium_insight_batches(
    id, generation_key, user_id, profile_id, effective_date, batch_revision,
    supersedes_batch_id, generation_timezone, source_boundary_at,
    profile_updated_at, fact_hash, fact_snapshot_json,
    soft_context_snapshot_json, status, lease_token, lease_epoch,
    lease_expires_at, attempt_count, next_attempt_at, cards_json,
    contract_version, fact_projection_version, context_projection_version,
    prompt_version, output_schema_version, generator_version, model_id, ready_at
  )
  SELECT
    fixture.batch_id,
    fixture.batch_key,
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    fixture.effective_date,
    0,
    NULL,
    'Asia/Hong_Kong',
    clock_timestamp(),
    (SELECT updated_at FROM bazi_profiles
      WHERE id = '20000000-0000-0000-0000-000000000001'),
    repeat('a', 64),
    jsonb_build_object(
      'version', 'medium_fact_snapshot_v2',
      'effective_date', fixture.effective_date::TEXT,
      'profile_id', '20000000-0000-0000-0000-000000000001',
      'facts',
        jsonb_build_array(
          jsonb_build_object('ref', 'F1', 'source', 'natal_pillar',
            'canonical_text', '月柱丁卯'),
          jsonb_build_object('ref', 'F2', 'source', 'month_command',
            'fact_payload', jsonb_build_object('value', jsonb_build_object('month_branch', '卯'))),
          jsonb_build_object('ref', 'F3', 'source', 'day_master_capacity',
            'fact_payload', jsonb_build_object('value', jsonb_build_object('day_master', '庚'))),
          jsonb_build_object('ref', 'F4', 'source', 'pattern_candidates',
            'fact_payload', jsonb_build_object('value', jsonb_build_object('regular', jsonb_build_array())))
        )
        || CASE WHEN fixture.mode = 'missing' THEN jsonb_build_array()
          ELSE jsonb_build_array(jsonb_build_object(
            'ref', 'F5', 'source', 'yongshen_basis',
            'fact_payload', jsonb_build_object('value', jsonb_build_object('notes', jsonb_build_array('依据材料')))
          )) END
        || CASE WHEN fixture.mode = 'duplicate' THEN jsonb_build_array(jsonb_build_object(
          'ref', 'F7', 'source', 'month_command',
          'fact_payload', jsonb_build_object('value', jsonb_build_object('month_branch', '卯'))
        )) ELSE jsonb_build_array() END
        || jsonb_build_array(jsonb_build_object(
          'ref', 'F6', 'source', 'dayun',
          'fact_payload', jsonb_build_object('lifecycle', '长生')
        ))
    ),
    jsonb_build_object('version', 'medium_context_snapshot_v2', 'user_context', jsonb_build_object()),
    'ready', NULL, 1, NULL, 1, NULL,
    jsonb_build_object('domains', jsonb_build_array(jsonb_build_object(
      'domain', 'career',
      'cards', jsonb_build_array(jsonb_build_object(
        'content_id', fixture.content_id,
        'title', '普通柱位卡',
        'preview', '这张卡只引用一个普通柱位事实。',
        'content_type', 'pattern',
        'fact_refs', jsonb_build_array('F1')
      ))
    ))),
    'medium_insight_v2',
    'medium_fact_snapshot_v2',
    'medium_context_snapshot_v2',
    CASE WHEN fixture.mode = 'legacy'
      THEN 'medium_insight_prompt_v5'
      ELSE 'medium_insight_prompt_v7' END,
    'medium_insight_output_v1',
    'medium_generator_v5',
    'gemini-smoke',
    clock_timestamp()
  FROM fixture;

  WITH candidate AS (
    SELECT number, jsonb_build_object(
      'candidate_id', 'large-card-' || number::TEXT,
      'pool_position', number - 1,
      'semantic_key', 'career:direction:' || number::TEXT,
      'primary_time_window_key', 'liuyue:smoke',
      'referenced_window_keys', jsonb_build_array('liuyue:smoke'),
      'content_profile', jsonb_build_object(
        'domain', 'career', 'topic_key', 'career_direction',
        'question_job', 'forecast', 'content_horizon', 'month'
      ),
      'selection_role', CASE WHEN number = 1 THEN 'p1_mingli_change' ELSE 'p3_diversity' END,
      'event_hypothesis', jsonb_build_object(
        'event_family', 'adjustment', 'claim_mode', 'conditional',
        'summary', '当前时间窗口下值得观察工作节奏。',
        'fact_refs', jsonb_build_array('natal:pillar:day', 'time:liuyue:smoke:timing')
      ),
      'validity', jsonb_build_object('valid_from', '2026-08-01', 'valid_until', '2026-09-01'),
      'question', '未来一个月我该怎样安排工作重点？',
      'preview', '当前时间窗口让工作资源和节奏更值得重新确认。',
      'body', repeat('短', 120)
    ) AS card
    FROM generate_series(1, 30) number
  )
  INSERT INTO recommendation_batches(
    id, generation_key, user_id, profile_id, after_batch_id, effective_date,
    profile_revision_hash, profile_updated_at, generation_timezone, input_hash,
    valid_until, status, lease_token, lease_epoch, lease_expires_at,
    attempt_count, next_attempt_at, input_snapshot_json, cards_json,
    prompt_version, output_schema_version, taxonomy_version, model_id,
    candidate_pool_json, generation_kind, pool_source_batch_id,
    selection_context_json, generation_metrics_json, ready_at
  )
  SELECT
    '32000000-0000-0000-0000-000000000001', repeat('8', 64),
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001', NULL, '2026-08-16',
    repeat('7', 64),
    (SELECT updated_at FROM bazi_profiles WHERE id = '20000000-0000-0000-0000-000000000001'),
    'Asia/Hong_Kong', repeat('6', 64), clock_timestamp() + interval '1 day',
    'ready', NULL, 1, NULL, 1, NULL,
    jsonb_build_object(
      'contract_version', 'recommendation_ai_v8',
      'taxonomy_version', 'recommendation_taxonomy_v2',
      'effective_date', '2026-08-16',
      'structure_facts', jsonb_build_array(
        jsonb_build_object('ref', 'S1', 'source', 'month_command', 'fact_payload', jsonb_build_object('value', jsonb_build_object())),
        jsonb_build_object('ref', 'S2', 'source', 'day_master_capacity', 'fact_payload', jsonb_build_object('value', jsonb_build_object())),
        jsonb_build_object('ref', 'S3', 'source', 'pattern_candidates', 'fact_payload', jsonb_build_object('value', jsonb_build_object())),
        jsonb_build_object('ref', 'S4', 'source', 'yongshen_basis', 'fact_payload', jsonb_build_object('value', jsonb_build_object()))
      ),
      'reality_context', jsonb_build_object('current_goal', '产品上线'),
      'fortune_facts', jsonb_build_object(
        'contract_version', 'daily_fortune_ai_first_v3',
        'effective_date', '2026-08-16',
        'natal', jsonb_build_object(
          'day_master', jsonb_build_object('stem', '庚'),
          'pillars', jsonb_build_array(jsonb_build_object('position', 'day', 'stem', '庚', 'branch', '申'))
        ),
        'mingli_interactions', jsonb_build_object('rule_version', 'v1', 'natal', jsonb_build_array())
      ),
      'time_windows', jsonb_build_array(jsonb_build_object(
        'window_key', 'liuyue:smoke',
        'timing', jsonb_build_object('gan_zhi', '丙申'),
        'interactions', jsonb_build_array()
      )),
      'available_fact_refs', jsonb_build_array(
        jsonb_build_object('ref', 'natal:pillar:day'),
        jsonb_build_object('ref', 'time:liuyue:smoke:timing')
      )
    ),
    jsonb_build_object(
      'deck_cards', (SELECT jsonb_agg(card ORDER BY number) FROM candidate WHERE number <= 10),
      'center_cards', jsonb_build_array()
    ),
    'recommendation_prompt_v10', 'recommendation_output_v3',
    'recommendation_taxonomy_v2', 'gemini-smoke',
    jsonb_build_object(
      'pool_version', 'recommendation_pool_v2',
      'candidates', (SELECT jsonb_agg(card ORDER BY number) FROM candidate)
    ),
    'ai', NULL, jsonb_build_object(), jsonb_build_object(), clock_timestamp()
  FROM candidate
  LIMIT 1;
"

"${pg_smoke_psql[@]}" -q -c "
  DO \$smoke\$
  DECLARE
    v_claim RECORD;
    v_detail insight_card_details%ROWTYPE;
    v_sources JSONB;
  BEGIN
    SELECT * INTO v_claim
    FROM claim_insight_card_detail(
      '10000000-0000-0000-0000-000000000001',
      'medium',
      '31000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000001',
      repeat('a', 64),
      'insight_card_content_v2',
      'insight_medium_detail_prompt_v2',
      'insight_card_detail_output_v2',
      'gemini-smoke',
      150,
      3
    );
    IF v_claim.claim_outcome <> 'owner' THEN
      RAISE EXCEPTION 'expected foundation fixture owner, got %', v_claim.claim_outcome;
    END IF;

    SELECT * INTO v_detail
    FROM insight_card_details
    WHERE id = v_claim.generation_id;
    IF v_detail.source_item_snapshot_json->'fact_refs' <> jsonb_build_array('F1') THEN
      RAISE EXCEPTION 'fixture source card must remain pillar-only';
    END IF;
    IF v_detail.fact_refs_json <> jsonb_build_array('F2', 'F3', 'F4', 'F5', 'F1') THEN
      RAISE EXCEPTION 'unexpected merged refs: %', v_detail.fact_refs_json;
    END IF;
    SELECT jsonb_agg(fact->>'source' ORDER BY position)
    INTO v_sources
    FROM jsonb_array_elements(v_detail.selected_fact_snapshot_json->'facts')
      WITH ORDINALITY AS selected(fact, position);
    IF v_sources <> jsonb_build_array(
      'month_command', 'day_master_capacity', 'pattern_candidates',
      'yongshen_basis', 'natal_pillar'
    ) THEN
      RAISE EXCEPTION 'unexpected selected source order: %', v_sources;
    END IF;
    IF v_detail.selected_fact_snapshot_json::TEXT LIKE '%lifecycle%'
       OR v_detail.selected_fact_snapshot_json::TEXT LIKE '%长生%' THEN
      RAISE EXCEPTION 'unreferenced twelve-lifecycle material leaked into detail';
    END IF;
    DELETE FROM insight_card_details WHERE id = v_detail.id;

    SELECT * INTO v_claim
    FROM claim_insight_card_detail(
      '10000000-0000-0000-0000-000000000001',
      'medium',
      '31000000-0000-0000-0000-000000000001',
      '61000000-0000-0000-0000-000000000001',
      repeat('0', 64),
      'insight_card_content_v2',
      'insight_medium_detail_prompt_v4',
      'insight_card_detail_output_v2',
      'gemini-smoke',
      150,
      3
    );
    IF v_claim.claim_outcome <> 'owner' THEN
      RAISE EXCEPTION 'expected v4 detail owner on v6 source, got %', v_claim.claim_outcome;
    END IF;
    DELETE FROM insight_card_details WHERE id = v_claim.generation_id;

    SELECT * INTO v_claim
    FROM claim_insight_card_detail(
      '10000000-0000-0000-0000-000000000001',
      'medium',
      '31000000-0000-0000-0000-000000000004',
      '61000000-0000-0000-0000-000000000004',
      repeat('4', 64),
      'insight_card_content_v2',
      'insight_medium_detail_prompt_v2',
      'insight_card_detail_output_v2',
      'gemini-smoke',
      150,
      3
    );
    IF v_claim.claim_outcome <> 'owner' THEN
      RAISE EXCEPTION 'expected v2 detail owner on legacy v5 source, got %', v_claim.claim_outcome;
    END IF;
    DELETE FROM insight_card_details WHERE id = v_claim.generation_id;

    BEGIN
      PERFORM claim_insight_card_detail(
        '10000000-0000-0000-0000-000000000001',
        'medium',
        '31000000-0000-0000-0000-000000000002',
        '61000000-0000-0000-0000-000000000002',
        repeat('b', 64),
        'insight_card_content_v2',
        'insight_medium_detail_prompt_v2',
        'insight_card_detail_output_v2',
        'gemini-smoke',
        150,
        3
      );
      RAISE EXCEPTION 'missing structural foundation unexpectedly succeeded';
    EXCEPTION WHEN SQLSTATE '22023' THEN
      NULL;
    END;

    BEGIN
      PERFORM claim_insight_card_detail(
        '10000000-0000-0000-0000-000000000001',
        'medium',
        '31000000-0000-0000-0000-000000000003',
        '61000000-0000-0000-0000-000000000003',
        repeat('c', 64),
        'insight_card_content_v2',
        'insight_medium_detail_prompt_v2',
        'insight_card_detail_output_v2',
        'gemini-smoke',
        150,
        3
      );
      RAISE EXCEPTION 'duplicate structural foundation unexpectedly succeeded';
    EXCEPTION WHEN SQLSTATE '22023' THEN
      NULL;
    END;
  END
  \$smoke\$;
"

"${pg_smoke_psql[@]}" -q -c "
  DO \$smoke\$
  DECLARE
    v_claim RECORD;
    v_detail insight_card_details%ROWTYPE;
    v_finalized BOOLEAN;
    v_second_outcome TEXT;
    v_payload JSONB;
  BEGIN
    SELECT * INTO v_claim FROM claim_insight_card_detail(
      '10000000-0000-0000-0000-000000000001', 'large',
      '32000000-0000-0000-0000-000000000001', 'large-card-1',
      repeat('9', 64), 'insight_card_content_v2',
      'insight_large_detail_prompt_v2', 'insight_card_detail_output_v2',
      'gemini-smoke', 150, 3
    );
    IF v_claim.claim_outcome <> 'owner' THEN
      RAISE EXCEPTION 'expected large detail owner, got %', v_claim.claim_outcome;
    END IF;
    SELECT * INTO v_detail FROM insight_card_details WHERE id = v_claim.generation_id;

    v_payload := jsonb_build_object(
      'title', v_detail.source_item_snapshot_json->>'question',
      'preview', v_detail.source_item_snapshot_json->>'preview',
      'body', repeat('长', 600),
      'fact_refs', jsonb_build_array('natal:pillar:day', 'time:liuyue:smoke:timing'),
      'suggested_follow_ups', jsonb_build_array('现实里怎样验证这条判断？', '我现在最值得先做哪一步？'),
      'follow_ups', jsonb_build_array()
    );

    SELECT finalize_insight_card_detail(
      v_claim.generation_id,
      '10000000-0000-0000-0000-000000000001',
      v_claim.claim_lease_token,
      v_claim.claim_lease_epoch,
      v_payload,
      'gemini-smoke',
      jsonb_build_object(
        'provider_calls', 1, 'input_bytes', 74000,
        'prompt_tokens', 123, 'billed_output_tokens', 456
      )
    ) INTO v_finalized;
    IF NOT v_finalized THEN
      RAISE EXCEPTION 'large detail finalize failed status=% model=% refs=% source_refs=% lease_match=% title_match=% preview_match=% body_len=% suggestion_lengths=%',
        v_detail.status,
        v_detail.model_id,
        v_detail.fact_refs_json,
        v_detail.source_item_snapshot_json#>'{event_hypothesis,fact_refs}',
        v_detail.lease_token = v_claim.claim_lease_token,
        v_payload->>'title' = v_detail.source_item_snapshot_json->>'question',
        v_payload->>'preview' = v_detail.source_item_snapshot_json->>'preview',
        char_length(v_payload->>'body'),
        (SELECT jsonb_agg(char_length(value)) FROM jsonb_array_elements_text(v_payload->'suggested_follow_ups'));
    END IF;

    SELECT * INTO v_detail FROM insight_card_details WHERE id = v_claim.generation_id;
    IF v_detail.status <> 'ready' OR char_length(v_detail.detail_json->>'body') <> 600
       OR v_detail.provider_attempt_count <> 1
       OR v_detail.provider_prompt_tokens <> 123
       OR v_detail.provider_billed_output_tokens <> 456
       OR v_detail.quota_day IS NULL THEN
      RAISE EXCEPTION 'large detail persistence/cost contract failed';
    END IF;

    SELECT claim_outcome INTO v_second_outcome FROM claim_insight_card_detail(
      '10000000-0000-0000-0000-000000000001', 'large',
      '32000000-0000-0000-0000-000000000001', 'large-card-1',
      repeat('9', 64), 'insight_card_content_v2',
      'insight_large_detail_prompt_v2', 'insight_card_detail_output_v2',
      'gemini-smoke', 150, 3
    );
    IF v_second_outcome <> 'ready' THEN
      RAISE EXCEPTION 'expected cached large detail READY, got %', v_second_outcome;
    END IF;
  END
  \$smoke\$;
"

"${pg_smoke_psql[@]}" -q -c "
  CREATE TABLE smoke_detail_resume_results(
    item_no INTEGER PRIMARY KEY,
    outcome TEXT NOT NULL
  );
  CREATE FUNCTION smoke_claim_detail_resume(p_item_no INTEGER)
  RETURNS VOID
  LANGUAGE plpgsql
  AS \$smoke\$
  DECLARE
    v_outcome TEXT;
  BEGIN
    SELECT claim_outcome INTO v_outcome
    FROM claim_insight_card_detail(
      '10000000-0000-0000-0000-000000000001',
      'medium',
      '30000000-0000-0000-0000-000000000001',
      'resume-card-' || p_item_no::TEXT,
      repeat(p_item_no::TEXT, 64),
      'insight_card_content_v2',
      'insight_medium_detail_prompt_v2',
      'insight_card_detail_output_v2',
      'gemini-smoke',
      150,
      3
    );
    INSERT INTO smoke_detail_resume_results(item_no, outcome)
    VALUES (p_item_no, v_outcome);
  EXCEPTION
    WHEN SQLSTATE 'P4292' THEN
      INSERT INTO smoke_detail_resume_results(item_no, outcome)
      VALUES (p_item_no, 'P4292');
  END
  \$smoke\$;
"

claim_resume() {
  local item_no="$1"
  "${pg_smoke_psql[@]}" -Atq -c "SELECT smoke_claim_detail_resume($item_no);"
}

claim_resume 1 &
resume_pid_1=$!
claim_resume 2 &
resume_pid_2=$!
claim_resume 3 &
resume_pid_3=$!
wait "$resume_pid_1"
wait "$resume_pid_2"
wait "$resume_pid_3"

"${pg_smoke_psql[@]}" -q -c "
  DO \$smoke\$
  DECLARE
    v_active INTEGER;
    v_owner_count INTEGER;
    v_limit_count INTEGER;
    v_outcome TEXT;
    v_target insight_card_details%ROWTYPE;
  BEGIN
    SELECT COUNT(*) FILTER (WHERE outcome IN ('owner', 'owner_takeover')),
      COUNT(*) FILTER (WHERE outcome = 'P4292')
    INTO v_owner_count, v_limit_count
    FROM smoke_detail_resume_results;
    IF v_owner_count <> 2 OR v_limit_count <> 1 THEN
      RAISE EXCEPTION 'expected two owners and one P4292; got owners %, limits %',
        v_owner_count, v_limit_count;
    END IF;

    SELECT COUNT(*) INTO v_active
    FROM insight_card_details
    WHERE user_id = '10000000-0000-0000-0000-000000000001'
      AND source_type = 'medium'
      AND status = 'generating'
      AND lease_expires_at > clock_timestamp();
    IF v_active <> 2 THEN
      RAISE EXCEPTION 'expected two active resumed details, got %', v_active;
    END IF;

    SELECT * INTO v_target
    FROM insight_card_details
    WHERE user_id = '10000000-0000-0000-0000-000000000001'
      AND source_type = 'medium'
      AND status = 'generating'
      AND lease_expires_at > clock_timestamp()
    ORDER BY source_item_id
    LIMIT 1;

    SELECT claim_outcome INTO v_outcome
    FROM claim_insight_card_detail(
      v_target.user_id, v_target.source_type, v_target.source_batch_id,
      v_target.source_item_id, v_target.generation_key,
      v_target.contract_version, v_target.prompt_version,
      v_target.output_schema_version, v_target.model_id, 150, 3
    );
    IF v_outcome <> 'join' THEN
      RAISE EXCEPTION 'expected active owner retry to join, got %', v_outcome;
    END IF;
  END
  \$smoke\$;
"

active_count="$("${pg_smoke_psql[@]}" -Atq -c "
  SELECT COUNT(*)
  FROM insight_card_details
  WHERE user_id = '10000000-0000-0000-0000-000000000001'
    AND source_type = 'medium'
    AND status = 'generating'
    AND lease_expires_at > clock_timestamp();
")"
resume_outcomes="$("${pg_smoke_psql[@]}" -Atq -c "
  SELECT string_agg(item_no::TEXT || ':' || outcome, ',' ORDER BY item_no)
  FROM smoke_detail_resume_results;
")"

echo "PG22 detail smoke passed: medium_v5_v7+detail_v2_v3 recommendation_v10=600chars+time_ref+cost+cached invalid=22023/22023 outcomes=$resume_outcomes active=$active_count self_retry=join"
