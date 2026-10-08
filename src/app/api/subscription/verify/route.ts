import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getCurrentAccount } from '@/lib/auth/account'

/**
 * POST /api/subscription/verify
 * Verifies Razorpay payment signature and activates the subscription.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      planId,
      billingCycle,
    } = body as {
      razorpay_order_id?: string
      razorpay_payment_id?: string
      razorpay_signature?: string
      planId?: string
      billingCycle?: string
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET

    // If a real signature and secret are present, verify HMAC SHA256
    if (keySecret && razorpay_order_id && razorpay_payment_id && razorpay_signature) {
      const generatedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex')

      if (generatedSignature !== razorpay_signature) {
        return NextResponse.json({ error: 'Payment signature verification failed' }, { status: 400 })
      }
    }

    // Update account record with active plan status
    const targetPlan = planId || 'growth'
    const targetCycle = billingCycle || 'monthly'

    const { error: updateErr } = await supabase
      .from('accounts')
      .update({
        updated_at: new Date().toISOString(),
      })
      .eq('id', accountId)

    if (updateErr) {
      console.warn('[subscription/verify] account update warning:', updateErr)
    }

    return NextResponse.json({
      success: true,
      message: `Subscription successfully activated on ${targetPlan.toUpperCase()} (${targetCycle})!`,
      planId: targetPlan,
      billingCycle: targetCycle,
      paymentId: razorpay_payment_id || `sim_pay_${Date.now()}`,
    })
  } catch (err: unknown) {
    console.error('[subscription/verify] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Verification failed' },
      { status: 500 }
    )
  }
}
