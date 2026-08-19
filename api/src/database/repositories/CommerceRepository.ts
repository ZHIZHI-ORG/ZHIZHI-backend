import { supabase } from '../supabase';
import {
  CommerceAccount,
  CommerceMembership,
  CommercePointsLedgerItem,
  CommerceTransaction,
  CommerceTransactionProcessInput,
  CommerceTransactionProcessResult,
} from '../../models/Commerce';

export class CommerceRepository {
  async findAccountByUser(userId: string): Promise<CommerceAccount | null> {
    const { data, error } = await supabase
      .from('commerce_accounts')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) return null;
    return data as CommerceAccount;
  }

  async findAccountByToken(appAccountToken: string): Promise<CommerceAccount | null> {
    const { data, error } = await supabase
      .from('commerce_accounts')
      .select('*')
      .eq('app_account_token', appAccountToken)
      .single();

    if (error || !data) return null;
    return data as CommerceAccount;
  }

  async upsertAccountToken(userId: string, appAccountToken: string): Promise<CommerceAccount> {
    const { data, error } = await supabase
      .from('commerce_accounts')
      .upsert({
        user_id: userId,
        app_account_token: appAccountToken,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      throw new Error(`保存 App Account Token 失败: ${error.message}`);
    }

    return data as CommerceAccount;
  }

  async findTransactionById(transactionId: string): Promise<CommerceTransaction | null> {
    const { data, error } = await supabase
      .from('commerce_transactions')
      .select('*')
      .eq('transaction_id', transactionId)
      .single();

    if (error || !data) return null;
    return data as CommerceTransaction;
  }

  async findTransactionByOriginalId(originalTransactionId: string): Promise<CommerceTransaction | null> {
    const { data, error } = await supabase
      .from('commerce_transactions')
      .select('*')
      .eq('original_transaction_id', originalTransactionId)
      .order('purchase_date', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;
    return data as CommerceTransaction;
  }

  async createTransaction(input: Omit<CommerceTransaction, 'processed_at' | 'created_at'>): Promise<CommerceTransaction> {
    const { data, error } = await supabase
      .from('commerce_transactions')
      .insert(input)
      .select()
      .single();

    if (error) {
      throw new Error(`保存交易失败: ${error.message}`);
    }

    return data as CommerceTransaction;
  }

  async processTransaction(input: CommerceTransactionProcessInput): Promise<CommerceTransactionProcessResult> {
    const { data, error } = await supabase.rpc('process_commerce_transaction', {
      p_user_id: input.user_id,
      p_transaction_id: input.transaction_id,
      p_original_transaction_id: input.original_transaction_id,
      p_product_id: input.product_id,
      p_product_type: input.product_type,
      p_app_account_token: input.app_account_token,
      p_purchase_date: input.purchase_date,
      p_environment: input.environment,
      p_signed_transaction_info: input.signed_transaction_info,
      p_verification_source: input.verification_source,
      p_raw_payload: input.raw_payload,
      p_membership_status: input.membership_status,
      p_membership_tier: input.membership_tier,
      p_expires_at: input.expires_at,
      p_revoked_at: input.revoked_at,
      p_will_auto_renew: input.will_auto_renew,
      p_grace_period_expires_at: input.grace_period_expires_at,
      p_points_delta: input.points_delta,
    });

    if (error) {
      throw new Error(`原子处理商业交易失败: ${error.message}`);
    }

    if (!data || typeof data !== 'object') {
      throw new Error('原子处理商业交易失败: 数据库未返回处理结果');
    }

    return data as CommerceTransactionProcessResult;
  }

  async getLatestMembership(userId: string): Promise<CommerceMembership | null> {
    const { data, error } = await supabase
      .from('commerce_memberships')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) return null;
    return data as CommerceMembership;
  }

  async upsertMembership(input: Omit<CommerceMembership, 'created_at' | 'updated_at'>): Promise<CommerceMembership> {
    const { data, error } = await supabase
      .from('commerce_memberships')
      .upsert({
        ...input,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      throw new Error(`保存会员权益失败: ${error.message}`);
    }

    return data as CommerceMembership;
  }

  async getPointsBalance(userId: string): Promise<{ balance: number; updated_at: string | null }> {
    const { data, error } = await supabase
      .from('commerce_points_balances')
      .select('balance, updated_at')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return { balance: 0, updated_at: null };
    }

    return {
      balance: Number(data.balance || 0),
      updated_at: data.updated_at || null,
    };
  }

  async applyPointsDelta(input: {
    userId: string;
    type: 'purchase' | 'consume' | 'refund' | 'adjustment';
    delta: number;
    source: string;
    sourceId?: string | null;
    idempotencyKey: string;
    metadata?: Record<string, any>;
  }): Promise<CommercePointsLedgerItem> {
    const { data, error } = await supabase.rpc('apply_commerce_points_delta', {
      p_user_id: input.userId,
      p_type: input.type,
      p_delta: input.delta,
      p_source: input.source,
      p_source_id: input.sourceId || null,
      p_idempotency_key: input.idempotencyKey,
      p_metadata: input.metadata || {},
    });

    if (error) {
      throw new Error(`更新积分账本失败: ${error.message}`);
    }

    return data as CommercePointsLedgerItem;
  }

  async listPointsLedger(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: CommercePointsLedgerItem[]; total: number }> {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await supabase
      .from('commerce_points_ledger')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(`查询积分账本失败: ${error.message}`);
    }

    return {
      items: (data || []) as CommercePointsLedgerItem[],
      total: count || 0,
    };
  }
}

export const commerceRepository = new CommerceRepository();
