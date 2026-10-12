import type { SupabaseClient } from '@supabase/supabase-js'

export interface TopUpRecord {
  id: string
  amount: number
  date: string
  note?: string
  created_at: string
}

export interface WalletRates {
  marketing: number
  utility: number
  authentication: number
  service: number
}

export interface WalletConfigData {
  currency: string
  low_balance_threshold: number
  rates: WalletRates
  topups: TopUpRecord[]
}

export const DEFAULT_INR_RATES: WalletRates = {
  marketing: 0.88,
  utility: 0.13,
  authentication: 0.13,
  service: 0,
}

export const DEFAULT_USD_RATES: WalletRates = {
  marketing: 0.0107,
  utility: 0.0042,
  authentication: 0.0042,
  service: 0,
}

export const SYSTEM_WALLET_FIELD_NAME = '__system_meta_wallet'

export function getDefaultRates(currency = 'INR'): WalletRates {
  return currency.toUpperCase() === 'USD' ? DEFAULT_USD_RATES : DEFAULT_INR_RATES
}

export function getDefaultThreshold(currency = 'INR'): number {
  return currency.toUpperCase() === 'USD' ? 5 : 200
}

/**
 * Loads the wallet config for the specified account from custom_fields.
 * If none exists, returns default empty configuration.
 */
export async function loadWalletConfig(
  supabase: SupabaseClient,
  accountId: string,
  currency = 'INR',
): Promise<{ rowId: string | null; config: WalletConfigData }> {
  const { data } = await supabase
    .from('custom_fields')
    .select('id, field_options')
    .eq('account_id', accountId)
    .eq('field_name', SYSTEM_WALLET_FIELD_NAME)
    .maybeSingle()

  if (data?.field_options && typeof data.field_options === 'object') {
    const opts = data.field_options as Partial<WalletConfigData>
    const activeCurrency = opts.currency || currency || 'INR'
    return {
      rowId: data.id,
      config: {
        currency: activeCurrency,
        low_balance_threshold:
          typeof opts.low_balance_threshold === 'number'
            ? opts.low_balance_threshold
            : getDefaultThreshold(activeCurrency),
        rates: opts.rates || getDefaultRates(activeCurrency),
        topups: Array.isArray(opts.topups) ? opts.topups : [],
      },
    }
  }

  const activeCurrency = currency || 'INR'
  return {
    rowId: null,
    config: {
      currency: activeCurrency,
      low_balance_threshold: getDefaultThreshold(activeCurrency),
      rates: getDefaultRates(activeCurrency),
      topups: [],
    },
  }
}

/**
 * Saves or updates the wallet configuration in custom_fields.
 */
export async function saveWalletConfig(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  config: WalletConfigData,
  existingRowId: string | null = null,
): Promise<string> {
  if (existingRowId) {
    const { error } = await supabase
      .from('custom_fields')
      .update({
        field_options: config,
      })
      .eq('id', existingRowId)

    if (error) throw error
    return existingRowId
  }

  const { data, error } = await supabase
    .from('custom_fields')
    .insert({
      account_id: accountId,
      user_id: userId,
      field_name: SYSTEM_WALLET_FIELD_NAME,
      field_type: 'system_wallet',
      field_options: config,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id as string
}

export interface WalletSummary {
  currency: string
  total_topup: number
  estimated_spend: number
  estimated_balance: number
  low_balance_threshold: number
  is_low_balance: boolean
  insufficient_funds_detected: boolean
  counts: {
    marketing: number
    utility: number
    authentication: number
    service: number
    total_templates: number
  }
  spend_breakdown: {
    marketing: number
    utility: number
    authentication: number
    service: number
  }
  topups: TopUpRecord[]
  waba_id: string | null
  meta_billing_url: string | null
}

/**
 * Calculate the overall balance summary for an account.
 */
export async function computeWalletSummary(
  supabase: SupabaseClient,
  accountId: string,
  currency = 'INR',
): Promise<WalletSummary> {
  // 1. Fetch WABA ID from whatsapp_config
  const { data: waConfig } = await supabase
    .from('whatsapp_config')
    .select('waba_id')
    .eq('account_id', accountId)
    .maybeSingle()

  const wabaId = (waConfig?.waba_id as string) || null
  const metaBillingUrl = wabaId
    ? `https://business.facebook.com/billing_hub/payment_settings?asset_id=${wabaId}`
    : 'https://business.facebook.com/billing_hub/payment_settings'

  // 2. Fetch Wallet Config
  const { config } = await loadWalletConfig(supabase, accountId, currency)

  // 3. Count sent messages and check for error 131042
  // We check messages belonging to conversations in this account
  const { data: convos } = await supabase
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)

  const convoIds = (convos || []).map((c) => c.id)

  let marketingCount = 0
  let utilityCount = 0
  let authCount = 0
  let serviceCount = 0
  let insufficientFundsDetected = false

  if (convoIds.length > 0) {
    // Check for recent 131042 errors (within last 24h, without a newer top-up or newer successful message)
    const { data: recentErrors } = await supabase
      .from('messages')
      .select('id, created_at, error_code')
      .in('conversation_id', convoIds)
      .eq('error_code', 131042)
      .order('created_at', { ascending: false })
      .limit(1)

    if (recentErrors && recentErrors.length > 0) {
      const errTime = new Date(recentErrors[0].created_at).getTime()
      const now = Date.now()
      const isWithin24Hours = now - errTime < 24 * 60 * 60 * 1000

      // Check if a top-up was logged after this error
      const hasTopupAfterError = config.topups.some((t) => {
        const topupTime = new Date(t.date || t.created_at).getTime()
        return topupTime >= errTime
      })

      // Check if any template message was successfully sent after this error
      const { data: newerSent } = await supabase
        .from('messages')
        .select('id')
        .in('conversation_id', convoIds)
        .eq('content_type', 'template')
        .gt('created_at', recentErrors[0].created_at)
        .in('status', ['sent', 'delivered', 'read'])
        .limit(1)

      const hasSentAfterError = Boolean(newerSent && newerSent.length > 0)

      if (isWithin24Hours && !hasTopupAfterError && !hasSentAfterError) {
        insufficientFundsDetected = true
      }
    }

    // Load templates mapped by name to their category
    const { data: templates } = await supabase
      .from('message_templates')
      .select('name, category')
      .eq('account_id', accountId)

    const categoryMap = new Map<string, string>()
    for (const t of templates || []) {
      if (t.name) {
        categoryMap.set(t.name.toLowerCase(), (t.category || 'marketing').toLowerCase())
      }
    }

    // Query template messages sent
    const { data: templateMsgs } = await supabase
      .from('messages')
      .select('id, template_name, status')
      .in('conversation_id', convoIds)
      .eq('content_type', 'template')
      .neq('status', 'failed')

    for (const msg of templateMsgs || []) {
      const tName = (msg.template_name || '').toLowerCase()
      const category = categoryMap.get(tName) || 'marketing'
      if (category.includes('util')) {
        utilityCount++
      } else if (category.includes('auth')) {
        authCount++
      } else {
        marketingCount++
      }
    }
  }

  const rates = config.rates
  const marketingSpend = marketingCount * rates.marketing
  const utilitySpend = utilityCount * rates.utility
  const authSpend = authCount * rates.authentication
  const serviceSpend = serviceCount * rates.service

  const estimatedSpend = Number(
    (marketingSpend + utilitySpend + authSpend + serviceSpend).toFixed(2),
  )

  const totalTopup = Number(
    config.topups.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2),
  )

  const estimatedBalance = Number((totalTopup - estimatedSpend).toFixed(2))
  const isLowBalance =
    estimatedBalance <= config.low_balance_threshold || insufficientFundsDetected

  return {
    currency: config.currency,
    total_topup: totalTopup,
    estimated_spend: estimatedSpend,
    estimated_balance: estimatedBalance,
    low_balance_threshold: config.low_balance_threshold,
    is_low_balance: isLowBalance,
    insufficient_funds_detected: insufficientFundsDetected,
    counts: {
      marketing: marketingCount,
      utility: utilityCount,
      authentication: authCount,
      service: serviceCount,
      total_templates: marketingCount + utilityCount + authCount,
    },
    spend_breakdown: {
      marketing: Number(marketingSpend.toFixed(2)),
      utility: Number(utilitySpend.toFixed(2)),
      authentication: Number(authSpend.toFixed(2)),
      service: Number(serviceSpend.toFixed(2)),
    },
    topups: config.topups.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    ),
    waba_id: wabaId,
    meta_billing_url: metaBillingUrl,
  }
}
