import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
}));

import { POST as createOrderPost } from './create-order/route';
import { POST as verifyPost } from './verify/route';

const mockContext = {
  supabase: {
    from: vi.fn(() => ({
      update: mocks.update,
    })),
  },
  accountId: 'test-account-123',
  userId: 'user-123',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentAccount.mockResolvedValue(mockContext);
  mocks.update.mockReturnValue({
    eq: mocks.eq.mockResolvedValue({ error: null }),
  });
});

describe('Subscription APIs', () => {
  describe('POST /api/subscription/create-order', () => {
    it('creates an order for Growth monthly plan without promocode', async () => {
      const req = new Request('http://localhost/api/subscription/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: 'growth',
          billingCycle: 'monthly',
        }),
      });

      const res = await createOrderPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.basePrice).toBe(1499);
      expect(data.discountAmount).toBe(0);
      expect(data.gstAmount).toBe(Math.round(1499 * 0.18)); // 270
      expect(data.totalPayable).toBe(1499 + 270); // 1769
      expect(data.amount).toBe((1499 + 270) * 100);
      expect(data.keyId).toBe('rzp_test_TcdoZxzN0dIYoP');
      expect(data.orderId).toBeDefined();
    });

    it('applies 50% discount with DHI50 promocode', async () => {
      const req = new Request('http://localhost/api/subscription/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: 'pro',
          billingCycle: 'monthly',
          promoCode: 'DHI50',
        }),
      });

      const res = await createOrderPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      // Pro monthly base = 3499
      expect(data.basePrice).toBe(3499);
      const expectedDiscount = Math.round((3499 * 50) / 100); // 1750
      expect(data.discountAmount).toBe(expectedDiscount);
      const discountedBase = 3499 - expectedDiscount; // 1749
      const expectedGst = Math.round(discountedBase * 0.18); // 315
      expect(data.gstAmount).toBe(expectedGst);
      expect(data.totalPayable).toBe(discountedBase + expectedGst);
      expect(data.appliedDiscount).toBe(50);
      expect(data.appliedPromo).toBe('DHI50');
    });

    it('rejects invalid promo code with 400', async () => {
      const req = new Request('http://localhost/api/subscription/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: 'growth',
          promoCode: 'INVALIDCODE99',
        }),
      });

      const res = await createOrderPost(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('is invalid or expired');
    });

    it('rejects annual-only promo code when billed monthly', async () => {
      const req = new Request('http://localhost/api/subscription/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: 'growth',
          billingCycle: 'monthly',
          promoCode: 'ANNUAL30',
        }),
      });

      const res = await createOrderPost(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('only applicable on yearly billing');
    });
  });

  describe('POST /api/subscription/verify', () => {
    it('verifies valid HMAC SHA256 signature and activates plan', async () => {
      const orderId = 'order_test_123456';
      const paymentId = 'pay_test_987654';
      const secret = process.env.RAZORPAY_KEY_SECRET || '6wEKCUJ0UXAZm6ESRTaIY4R0';

      const validSignature = crypto
        .createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      const req = new Request('http://localhost/api/subscription/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: validSignature,
          planId: 'pro',
          billingCycle: 'yearly',
        }),
      });

      const res = await verifyPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.planId).toBe('pro');
      expect(data.billingCycle).toBe('yearly');
    });

    it('rejects invalid signature with 400', async () => {
      const req = new Request('http://localhost/api/subscription/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: 'order_test_123456',
          razorpay_payment_id: 'pay_test_987654',
          razorpay_signature: 'invalid_tampered_signature_hex',
          planId: 'pro',
        }),
      });

      const res = await verifyPost(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('verification failed');
    });
  });
});
