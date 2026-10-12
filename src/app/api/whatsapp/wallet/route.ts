import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  computeWalletSummary,
  loadWalletConfig,
  saveWalletConfig,
  type TopUpRecord,
  type WalletRates,
} from '@/lib/whatsapp/meta-wallet'

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ accountId: string; currency: string } | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (!profile?.account_id) return null

  const { data: account } = await supabase
    .from('accounts')
    .select('default_currency')
    .eq('id', profile.account_id)
    .maybeSingle()

  return {
    accountId: profile.account_id as string,
    currency: (account?.default_currency as string) || 'INR',
  }
}

/**
 * GET /api/whatsapp/wallet
 * Returns the estimated balance, topup history, spend breakdown, and Meta billing URL.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const resolved = await resolveAccountId(supabase, user.id)
    if (!resolved) {
      return NextResponse.json({ error: 'No account linked to user' }, { status: 404 })
    }

    const summary = await computeWalletSummary(
      supabase,
      resolved.accountId,
      resolved.currency,
    )

    return NextResponse.json({ ok: true, wallet: summary })
  } catch (err) {
    console.error('[whatsapp/wallet] GET failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/whatsapp/wallet
 * Handles logging a topup, deleting a topup, or updating rates/thresholds.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const resolved = await resolveAccountId(supabase, user.id)
    if (!resolved) {
      return NextResponse.json({ error: 'No account linked to user' }, { status: 404 })
    }

    const body = await request.json()
    const { action } = body

    const { rowId, config } = await loadWalletConfig(
      supabase,
      resolved.accountId,
      resolved.currency,
    )

    if (action === 'log_topup') {
      const amount = Number(body.amount)
      if (isNaN(amount) || amount <= 0) {
        return NextResponse.json(
          { error: 'Valid positive top-up amount is required' },
          { status: 400 },
        )
      }

      const dateStr = body.date
        ? new Date(body.date).toISOString()
        : new Date().toISOString()

      const newRecord: TopUpRecord = {
        id: crypto.randomUUID(),
        amount: Number(amount.toFixed(2)),
        date: dateStr,
        note: (body.note as string)?.trim() || '',
        created_at: new Date().toISOString(),
      }

      config.topups.push(newRecord)
      await saveWalletConfig(supabase, resolved.accountId, user.id, config, rowId)

      const summary = await computeWalletSummary(
        supabase,
        resolved.accountId,
        resolved.currency,
      )

      return NextResponse.json({ ok: true, wallet: summary, added: newRecord })
    }

    if (action === 'delete_topup') {
      const { topupId } = body
      if (!topupId) {
        return NextResponse.json({ error: 'topupId is required' }, { status: 400 })
      }

      config.topups = config.topups.filter((t) => t.id !== topupId)
      await saveWalletConfig(supabase, resolved.accountId, user.id, config, rowId)

      const summary = await computeWalletSummary(
        supabase,
        resolved.accountId,
        resolved.currency,
      )

      return NextResponse.json({ ok: true, wallet: summary })
    }

    if (action === 'update_settings') {
      if (typeof body.low_balance_threshold === 'number' && body.low_balance_threshold >= 0) {
        config.low_balance_threshold = body.low_balance_threshold
      }
      if (body.rates && typeof body.rates === 'object') {
        config.rates = {
          ...config.rates,
          ...(body.rates as Partial<WalletRates>),
        }
      }

      await saveWalletConfig(supabase, resolved.accountId, user.id, config, rowId)

      const summary = await computeWalletSummary(
        supabase,
        resolved.accountId,
        resolved.currency,
      )

      return NextResponse.json({ ok: true, wallet: summary })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err) {
    console.error('[whatsapp/wallet] POST failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}
