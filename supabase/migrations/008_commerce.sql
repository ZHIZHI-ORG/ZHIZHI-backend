-- ============================================================
-- 008_commerce.sql
-- StoreKit 2 commerce ledger: membership entitlement, point wallet, idempotent transactions
-- ============================================================

CREATE TABLE IF NOT EXISTS commerce_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  app_account_token UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commerce_transactions (
  transaction_id TEXT PRIMARY KEY,
  original_transaction_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (product_type IN ('membership', 'points')),
  app_account_token UUID NOT NULL,
  purchase_date TIMESTAMPTZ NOT NULL,
  environment TEXT,
  signed_transaction_info TEXT NOT NULL,
  verification_source TEXT NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commerce_transactions_user_created
  ON commerce_transactions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_commerce_transactions_original
  ON commerce_transactions(original_transaction_id);

CREATE TABLE IF NOT EXISTS commerce_memberships (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('inactive', 'active', 'grace_period', 'billing_retry', 'revoked')),
  tier TEXT,
  product_id TEXT,
  original_transaction_id TEXT,
  transaction_id TEXT REFERENCES commerce_transactions(transaction_id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  environment TEXT,
  will_auto_renew BOOLEAN NOT NULL DEFAULT false,
  grace_period_expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  raw_transaction JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commerce_points_balances (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commerce_points_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('purchase', 'consume', 'refund', 'adjustment')),
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  source TEXT NOT NULL,
  source_id TEXT,
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_commerce_points_ledger_user_created
  ON commerce_points_ledger(user_id, created_at DESC);

CREATE TRIGGER update_commerce_accounts_updated_at
  BEFORE UPDATE ON commerce_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_commerce_memberships_updated_at
  BEFORE UPDATE ON commerce_memberships
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

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

ALTER TABLE commerce_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_points_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_points_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户只能查看自己的商业账号"
  ON commerce_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "用户只能查看自己的交易记录"
  ON commerce_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "用户只能查看自己的会员权益"
  ON commerce_memberships FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "用户只能查看自己的积分余额"
  ON commerce_points_balances FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "用户只能查看自己的积分流水"
  ON commerce_points_ledger FOR SELECT
  USING (auth.uid() = user_id);

