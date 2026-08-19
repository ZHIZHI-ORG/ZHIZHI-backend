-- ============================================================
-- 021_commerce_lifecycle_guards.sql
-- Keep membership projection monotonic and persist unrecovered consumable refunds.
-- ============================================================

ALTER TABLE commerce_memberships
  ADD COLUMN IF NOT EXISTS state_event_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS state_priority SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_notification_uuid TEXT,
  ADD COLUMN IF NOT EXISTS last_notification_type TEXT;

UPDATE commerce_memberships
SET state_event_at = COALESCE(state_event_at, revoked_at, updated_at, created_at),
    state_priority = CASE status
      WHEN 'revoked' THEN 100
      WHEN 'active' THEN 40
      WHEN 'grace_period' THEN 30
      WHEN 'billing_retry' THEN 20
      WHEN 'inactive' THEN 10
      ELSE 0
    END
WHERE state_event_at IS NULL OR state_priority = 0;

CREATE TABLE IF NOT EXISTS commerce_points_refund_debts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  points_owed INTEGER NOT NULL DEFAULT 0 CHECK (points_owed >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE commerce_points_refund_debts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "用户只能查看自己的退款积分欠额" ON commerce_points_refund_debts;
CREATE POLICY "用户只能查看自己的退款积分欠额"
  ON commerce_points_refund_debts FOR SELECT
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION apply_commerce_points_delta(
  p_user_id UUID,
  p_type TEXT,
  p_delta INTEGER,
  p_source TEXT,
  p_source_id TEXT,
  p_idempotency_key TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS commerce_points_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_row commerce_points_ledger;
  current_balance INTEGER;
  current_refund_debt INTEGER;
  next_balance INTEGER;
  inserted_row commerce_points_ledger;
BEGIN
  SELECT *
  INTO existing_row
  FROM commerce_points_ledger
  WHERE user_id = p_user_id
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN existing_row;
  END IF;

  IF p_type = 'consume' THEN
    INSERT INTO commerce_points_refund_debts (user_id, points_owed)
    VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT points_owed
    INTO current_refund_debt
    FROM commerce_points_refund_debts
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF current_refund_debt > 0 THEN
      RAISE EXCEPTION 'POINTS_REFUND_DEBT';
    END IF;
  END IF;

  INSERT INTO commerce_points_balances (user_id, balance)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance
  INTO current_balance
  FROM commerce_points_balances
  WHERE user_id = p_user_id
  FOR UPDATE;

  next_balance := current_balance + p_delta;
  IF next_balance < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_POINTS';
  END IF;

  UPDATE commerce_points_balances
  SET balance = next_balance,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  INSERT INTO commerce_points_ledger (
    user_id,
    type,
    delta,
    balance_after,
    source,
    source_id,
    idempotency_key,
    metadata
  )
  VALUES (
    p_user_id,
    p_type,
    p_delta,
    next_balance,
    p_source,
    p_source_id,
    p_idempotency_key,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO inserted_row;

  RETURN inserted_row;
END;
$$;

REVOKE ALL ON FUNCTION apply_commerce_points_delta(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_commerce_points_delta(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, JSONB)
  TO service_role;

CREATE OR REPLACE FUNCTION process_commerce_transaction(
  p_user_id UUID,
  p_transaction_id TEXT,
  p_original_transaction_id TEXT,
  p_product_id TEXT,
  p_product_type TEXT,
  p_app_account_token UUID,
  p_purchase_date TIMESTAMPTZ,
  p_environment TEXT,
  p_signed_transaction_info TEXT,
  p_verification_source TEXT,
  p_raw_payload JSONB,
  p_membership_status TEXT DEFAULT NULL,
  p_membership_tier TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_revoked_at TIMESTAMPTZ DEFAULT NULL,
  p_will_auto_renew BOOLEAN DEFAULT false,
  p_grace_period_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_points_delta INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  account_row commerce_accounts;
  existing_transaction commerce_transactions;
  membership_row commerce_memberships;
  current_membership_purchase_date TIMESTAMPTZ;
  ledger_row commerce_points_ledger;
  current_balance INTEGER;
  current_refund_debt INTEGER;
  effective_points_delta INTEGER;
  debt_repaid INTEGER := 0;
  unrecovered_points INTEGER := 0;
  incoming_event_at TIMESTAMPTZ;
  incoming_priority SMALLINT;
  should_project_membership BOOLEAN := false;
  is_duplicate BOOLEAN := false;
  points_idempotency_key TEXT;
BEGIN
  IF p_product_type NOT IN ('membership', 'points') THEN
    RAISE EXCEPTION 'UNSUPPORTED_COMMERCE_PRODUCT_TYPE';
  END IF;

  INSERT INTO commerce_accounts (user_id, app_account_token)
  VALUES (p_user_id, p_app_account_token)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT *
  INTO account_row
  FROM commerce_accounts
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF account_row.app_account_token <> p_app_account_token THEN
    RAISE EXCEPTION 'APP_ACCOUNT_TOKEN_MISMATCH';
  END IF;

  SELECT *
  INTO existing_transaction
  FROM commerce_transactions
  WHERE transaction_id = p_transaction_id
  FOR UPDATE;

  IF FOUND THEN
    is_duplicate := true;
    IF existing_transaction.user_id <> p_user_id
       OR existing_transaction.product_id <> p_product_id
       OR existing_transaction.original_transaction_id <> p_original_transaction_id
       OR existing_transaction.app_account_token <> p_app_account_token THEN
      RAISE EXCEPTION 'COMMERCE_TRANSACTION_OWNERSHIP_MISMATCH';
    END IF;

    UPDATE commerce_transactions
    SET signed_transaction_info = p_signed_transaction_info,
        verification_source = p_verification_source,
        raw_payload = COALESCE(p_raw_payload, '{}'::jsonb),
        environment = p_environment,
        processed_at = NOW()
    WHERE transaction_id = p_transaction_id;
  ELSE
    INSERT INTO commerce_transactions (
      transaction_id,
      original_transaction_id,
      user_id,
      product_id,
      product_type,
      app_account_token,
      purchase_date,
      environment,
      signed_transaction_info,
      verification_source,
      raw_payload
    )
    VALUES (
      p_transaction_id,
      p_original_transaction_id,
      p_user_id,
      p_product_id,
      p_product_type,
      p_app_account_token,
      p_purchase_date,
      p_environment,
      p_signed_transaction_info,
      p_verification_source,
      COALESCE(p_raw_payload, '{}'::jsonb)
    );
  END IF;

  IF p_product_type = 'membership' THEN
    IF p_membership_status IS NULL
       OR p_membership_status NOT IN ('inactive', 'active', 'grace_period', 'billing_retry', 'revoked') THEN
      RAISE EXCEPTION 'INVALID_MEMBERSHIP_STATUS';
    END IF;

    incoming_event_at := COALESCE(
      CASE
        WHEN COALESCE(p_raw_payload#>>'{notificationContext,signedDate}', '') ~ '^[0-9]+(\.[0-9]+)?$'
          THEN to_timestamp((p_raw_payload#>>'{notificationContext,signedDate}')::NUMERIC / 1000.0)
        ELSE NULL
      END,
      CASE
        WHEN COALESCE(p_raw_payload->>'signedDate', '') ~ '^[0-9]+(\.[0-9]+)?$'
          THEN to_timestamp((p_raw_payload->>'signedDate')::NUMERIC / 1000.0)
        ELSE NULL
      END,
      p_revoked_at,
      p_purchase_date
    );
    incoming_priority := CASE p_membership_status
      WHEN 'revoked' THEN 100
      WHEN 'active' THEN 40
      WHEN 'grace_period' THEN 30
      WHEN 'billing_retry' THEN 20
      WHEN 'inactive' THEN 10
      ELSE 0
    END;

    SELECT *
    INTO membership_row
    FROM commerce_memberships
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      should_project_membership := true;
    ELSE
      SELECT purchase_date
      INTO current_membership_purchase_date
      FROM commerce_transactions
      WHERE transaction_id = membership_row.transaction_id;

      IF membership_row.original_transaction_id IS DISTINCT FROM p_original_transaction_id THEN
        should_project_membership := p_membership_status IN ('active', 'grace_period', 'billing_retry')
          AND p_purchase_date > COALESCE(current_membership_purchase_date, '-infinity'::TIMESTAMPTZ);
      ELSIF p_purchase_date > COALESCE(current_membership_purchase_date, '-infinity'::TIMESTAMPTZ) THEN
        should_project_membership := true;
      ELSIF p_transaction_id = membership_row.transaction_id
            AND p_verification_source LIKE 'apple_server_notification:%' THEN
        should_project_membership := incoming_event_at > COALESCE(membership_row.state_event_at, '-infinity'::TIMESTAMPTZ)
          OR (
            incoming_event_at = membership_row.state_event_at
            AND incoming_priority >= membership_row.state_priority
          );
      END IF;
    END IF;

    IF should_project_membership THEN
      INSERT INTO commerce_memberships (
        user_id,
        status,
        tier,
        product_id,
        original_transaction_id,
        transaction_id,
        expires_at,
        environment,
        will_auto_renew,
        grace_period_expires_at,
        revoked_at,
        raw_transaction,
        state_event_at,
        state_priority,
        last_notification_uuid,
        last_notification_type
      )
      VALUES (
        p_user_id,
        p_membership_status,
        p_membership_tier,
        p_product_id,
        p_original_transaction_id,
        p_transaction_id,
        p_expires_at,
        p_environment,
        p_will_auto_renew,
        p_grace_period_expires_at,
        p_revoked_at,
        COALESCE(p_raw_payload, '{}'::jsonb),
        incoming_event_at,
        incoming_priority,
        p_raw_payload#>>'{notificationContext,notificationUUID}',
        p_raw_payload#>>'{notificationContext,notificationType}'
      )
      ON CONFLICT (user_id) DO UPDATE SET
        status = EXCLUDED.status,
        tier = EXCLUDED.tier,
        product_id = EXCLUDED.product_id,
        original_transaction_id = EXCLUDED.original_transaction_id,
        transaction_id = EXCLUDED.transaction_id,
        expires_at = EXCLUDED.expires_at,
        environment = EXCLUDED.environment,
        will_auto_renew = EXCLUDED.will_auto_renew,
        grace_period_expires_at = EXCLUDED.grace_period_expires_at,
        revoked_at = EXCLUDED.revoked_at,
        raw_transaction = EXCLUDED.raw_transaction,
        state_event_at = EXCLUDED.state_event_at,
        state_priority = EXCLUDED.state_priority,
        last_notification_uuid = COALESCE(EXCLUDED.last_notification_uuid, commerce_memberships.last_notification_uuid),
        last_notification_type = COALESCE(EXCLUDED.last_notification_type, commerce_memberships.last_notification_type),
        updated_at = NOW()
      RETURNING * INTO membership_row;
    END IF;

    RETURN jsonb_build_object(
      'duplicate', is_duplicate,
      'membership', to_jsonb(membership_row),
      'points', NULL
    );
  END IF;

  IF p_points_delta IS NULL OR p_points_delta = 0 THEN
    RAISE EXCEPTION 'INVALID_POINTS_DELTA';
  END IF;

  points_idempotency_key := CASE WHEN p_points_delta < 0 THEN 'refund:' ELSE 'purchase:' END || p_transaction_id;
  SELECT *
  INTO ledger_row
  FROM commerce_points_ledger
  WHERE user_id = p_user_id
    AND idempotency_key = points_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'duplicate', true,
      'membership', NULL,
      'points', to_jsonb(ledger_row)
    );
  END IF;

  INSERT INTO commerce_points_refund_debts (user_id, points_owed)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT points_owed
  INTO current_refund_debt
  FROM commerce_points_refund_debts
  WHERE user_id = p_user_id
  FOR UPDATE;

  effective_points_delta := p_points_delta;
  IF p_points_delta < 0 THEN
    INSERT INTO commerce_points_balances (user_id, balance)
    VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT balance
    INTO current_balance
    FROM commerce_points_balances
    WHERE user_id = p_user_id
    FOR UPDATE;

    effective_points_delta := -LEAST(current_balance, ABS(p_points_delta));
    unrecovered_points := ABS(p_points_delta) - ABS(effective_points_delta);
    IF unrecovered_points > 0 THEN
      UPDATE commerce_points_refund_debts
      SET points_owed = points_owed + unrecovered_points,
          updated_at = NOW()
      WHERE user_id = p_user_id;
    END IF;
  ELSIF current_refund_debt > 0 THEN
    debt_repaid := LEAST(current_refund_debt, p_points_delta);
    effective_points_delta := p_points_delta - debt_repaid;
    UPDATE commerce_points_refund_debts
    SET points_owed = points_owed - debt_repaid,
        updated_at = NOW()
    WHERE user_id = p_user_id;
  END IF;

  SELECT *
  INTO ledger_row
  FROM apply_commerce_points_delta(
    p_user_id,
    CASE WHEN p_points_delta < 0 THEN 'refund' ELSE 'purchase' END,
    effective_points_delta,
    'storekit_transaction',
    p_transaction_id,
    points_idempotency_key,
    jsonb_build_object(
      'product_id', p_product_id,
      'original_transaction_id', p_original_transaction_id,
      'requested_delta', p_points_delta,
      'debt_repaid', debt_repaid,
      'unrecovered_points', unrecovered_points
    )
  );

  RETURN jsonb_build_object(
    'duplicate', is_duplicate,
    'membership', NULL,
    'points', to_jsonb(ledger_row)
  );
END;
$$;

REVOKE ALL ON FUNCTION process_commerce_transaction(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT,
  JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION process_commerce_transaction(
  UUID, TEXT, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT,
  JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ, INTEGER
) TO service_role;
