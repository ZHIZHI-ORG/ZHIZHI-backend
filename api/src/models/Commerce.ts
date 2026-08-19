export type CommerceMembershipStatus =
  | 'inactive'
  | 'active'
  | 'grace_period'
  | 'billing_retry'
  | 'revoked';

export interface CommerceAccount {
  user_id: string;
  app_account_token: string;
  created_at: string;
  updated_at: string;
}

export interface CommerceTransaction {
  transaction_id: string;
  original_transaction_id: string;
  user_id: string;
  product_id: string;
  product_type: 'membership' | 'points';
  app_account_token: string;
  purchase_date: string;
  environment: string | null;
  signed_transaction_info: string;
  verification_source: string;
  raw_payload: Record<string, any>;
  processed_at: string;
  created_at: string;
}

export interface CommerceMembership {
  user_id: string;
  status: CommerceMembershipStatus;
  tier: string | null;
  product_id: string | null;
  original_transaction_id: string | null;
  transaction_id: string | null;
  expires_at: string | null;
  environment: string | null;
  will_auto_renew: boolean;
  grace_period_expires_at: string | null;
  revoked_at: string | null;
  state_event_at: string | null;
  state_priority: number;
  last_notification_uuid: string | null;
  last_notification_type: string | null;
  raw_transaction: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CommercePointsBalance {
  user_id: string;
  balance: number;
  updated_at: string;
}

export interface CommercePointsLedgerItem {
  id: string;
  user_id: string;
  type: 'purchase' | 'consume' | 'refund' | 'adjustment';
  delta: number;
  balance_after: number;
  source: string;
  source_id: string | null;
  idempotency_key: string;
  metadata: Record<string, any>;
  created_at: string;
}

export interface CommerceTransactionSyncInput {
  transaction_id: string;
  original_transaction_id: string;
  product_id: string;
  purchase_date: string;
  app_account_token: string;
  signed_transaction_info: string;
}

export interface CommerceTransactionProcessInput {
  transaction_id: string;
  original_transaction_id: string;
  user_id: string;
  product_id: string;
  product_type: 'membership' | 'points';
  app_account_token: string;
  purchase_date: string;
  environment: string | null;
  signed_transaction_info: string;
  verification_source: string;
  raw_payload: Record<string, any>;
  membership_status: CommerceMembershipStatus | null;
  membership_tier: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  will_auto_renew: boolean;
  grace_period_expires_at: string | null;
  points_delta: number | null;
}

export interface CommerceTransactionProcessResult {
  duplicate: boolean;
  membership: CommerceMembership | null;
  points: CommercePointsLedgerItem | null;
}

export interface CommercePointsConsumeInput {
  amount: number;
  reason: string;
  idempotency_key: string;
}
