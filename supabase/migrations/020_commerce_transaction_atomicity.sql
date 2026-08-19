-- ============================================================
-- 020_commerce_transaction_atomicity.sql
-- Atomically persist a verified StoreKit transaction and deliver its entitlement.
-- Also closes direct PostgREST access to SECURITY DEFINER commerce functions.
-- ============================================================

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
  ledger_row commerce_points_ledger;
  current_balance INTEGER;
  effective_points_delta INTEGER;
  is_duplicate BOOLEAN := false;
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
      raw_transaction
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
      COALESCE(p_raw_payload, '{}'::jsonb)
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
      updated_at = NOW()
    RETURNING * INTO membership_row;

    RETURN jsonb_build_object(
      'duplicate', is_duplicate,
      'membership', to_jsonb(membership_row),
      'points', NULL
    );
  END IF;

  IF p_points_delta IS NULL OR p_points_delta = 0 THEN
    RAISE EXCEPTION 'INVALID_POINTS_DELTA';
  END IF;

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
  END IF;

  SELECT *
  INTO ledger_row
  FROM apply_commerce_points_delta(
    p_user_id,
    CASE WHEN p_points_delta < 0 THEN 'refund' ELSE 'purchase' END,
    effective_points_delta,
    'storekit_transaction',
    p_transaction_id,
    CASE WHEN p_points_delta < 0 THEN 'refund:' ELSE 'purchase:' END || p_transaction_id,
    jsonb_build_object(
      'product_id', p_product_id,
      'original_transaction_id', p_original_transaction_id,
      'requested_delta', p_points_delta,
      'unrecovered_points', ABS(p_points_delta) - ABS(effective_points_delta)
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
