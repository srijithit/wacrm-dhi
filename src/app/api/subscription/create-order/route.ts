import { NextResponse } from 'next/server'
import { getCurrentAccount } from '@/lib/auth/account'

export interface PlanConfig {
  id: string
  name: string
  monthlyPrice: number
  yearlyPrice: number // with 25% discount
  features: string[]
}

export const PLANS: Record<string, PlanConfig> = {
  growth: {
    id: 'growth',
    name: 'Growth Plan',
    monthlyPrice: 1499,
    yearlyPrice: 13491,
    features: ['2,500 WhatsApp Messages', 'AI Smart Bot Concierge', '5 Team Inboxes', 'Basic Automations'],
  },
  pro: {
    id: 'pro',
    name: 'Pro Scale',
    monthlyPrice: 3499,
    yearlyPrice: 31491,
    features: ['10,000 WhatsApp Messages', 'Unlimited AI Assistant Runs', '15 Team Inboxes', 'Flow Builder & Webhooks'],
  },
  business: {
    id: 'business',
    name: 'Enterprise Scale',
    monthlyPrice: 7999,
    yearlyPrice: 71991,
    features: ['Unlimited WhatsApp Messages', 'Dedicated Meta Account Manager', 'Custom AI Fine-tuning', 'Full API Access'],
  },
}

export const PROMO_CODES: Record<string, { discountPercent: number; minCycle?: 'monthly' | 'yearly'; label: string }> = {
  LAUNCH50: { discountPercent: 50, label: '50% Off Launch Special' },
  DHI50: { discountPercent: 50, label: '50% Off DhiGrowth Partner' },
  WAPPPILOT: { discountPercent: 30, label: '30% Off WappPilot Platform' },
  STARTUP20: { discountPercent: 20, label: '20% Off Startup Boost' },
  ANNUAL30: { discountPercent: 30, minCycle: 'yearly', label: '30% Off Annual Plan' },
  TESTER10: { discountPercent: 10, label: '10% Off Beta Tester' },
}

/**
 * POST /api/subscription/create-order
 * Creates a Razorpay order with server-validated promocode discount.
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await getCurrentAccount()
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const planId = (body.planId as string)?.toLowerCase() || 'growth'
    const billingCycle = (body.billingCycle as 'monthly' | 'yearly') || 'monthly'
    const promoCode = (body.promoCode as string)?.trim().toUpperCase() || ''

    const plan = PLANS[planId] || PLANS.growth
    const basePrice = billingCycle === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice

    let appliedDiscount = 0
    let appliedPromoLabel = ''

    if (promoCode) {
      const promo = PROMO_CODES[promoCode]
      if (!promo) {
        return NextResponse.json({ error: `Promo code "${promoCode}" is invalid or expired.` }, { status: 400 })
      }
      if (promo.minCycle && promo.minCycle !== billingCycle) {
        return NextResponse.json({ error: `Promo code "${promoCode}" is only applicable on ${promo.minCycle} billing.` }, { status: 400 })
      }
      appliedDiscount = promo.discountPercent
      appliedPromoLabel = promo.label
    }

    const discountAmount = Math.round((basePrice * appliedDiscount) / 100)
    const discountedBase = Math.max(0, basePrice - discountAmount)
    const gstAmount = Math.round(discountedBase * 0.18)
    const totalPayable = discountedBase + gstAmount

    const amountInPaise = totalPayable * 100
    const keyId = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || 'rzp_test_TcdoZxzN0dIYoP'
    const keySecret = process.env.RAZORPAY_KEY_SECRET

    let orderId = `order_sim_${Date.now()}`

    // Attempt live Razorpay order creation if secret is present
    if (keySecret && keyId) {
      try {
        const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
        const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: amountInPaise,
            currency: 'INR',
            receipt: `rcpt_${accountId.slice(0, 8)}_${Date.now()}`,
            notes: {
              accountId,
              planId: plan.id,
              billingCycle,
              promoCode: promoCode || 'NONE',
            },
          }),
        })

        if (rzpRes.ok) {
          const rzpData = await rzpRes.json()
          if (rzpData?.id) {
            orderId = rzpData.id
          }
        } else {
          const errData = await rzpRes.json().catch(() => null)
          console.warn('[razorpay] order creation returned non-200, falling back to simulated orderId:', errData)
        }
      } catch (err) {
        console.warn('[razorpay] live order creation call failed, falling back:', err)
      }
    }

    return NextResponse.json({
      orderId,
      keyId,
      amount: amountInPaise,
      currency: 'INR',
      planName: plan.name,
      billingCycle,
      basePrice,
      discountAmount,
      appliedDiscount,
      appliedPromo: promoCode || null,
      appliedPromoLabel,
      gstAmount,
      totalPayable,
    })
  } catch (err: unknown) {
    console.error('[subscription/create-order] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create subscription order' },
      { status: 500 }
    )
  }
}
