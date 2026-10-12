import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolveAccountId: vi.fn(),
  computeWalletSummary: vi.fn(),
  loadWalletConfig: vi.fn(),
  saveWalletConfig: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: mocks.getUser,
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { account_id: 'acc-1' } }),
            }),
          }),
        }
      }
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { default_currency: 'INR' } }),
            }),
          }),
        }
      }
      return {}
    },
  }),
}))

vi.mock('@/lib/whatsapp/meta-wallet', () => ({
  computeWalletSummary: mocks.computeWalletSummary,
  loadWalletConfig: mocks.loadWalletConfig,
  saveWalletConfig: mocks.saveWalletConfig,
}))

import { GET, POST } from './route'

describe('GET /api/whatsapp/wallet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when user is not authenticated', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'Unauthorized' } })

    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns wallet summary when authenticated', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    mocks.computeWalletSummary.mockResolvedValue({
      currency: 'INR',
      total_topup: 2000,
      estimated_spend: 100,
      estimated_balance: 1900,
      is_low_balance: false,
    })

    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.wallet.estimated_balance).toBe(1900)
  })
})

describe('POST /api/whatsapp/wallet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    mocks.loadWalletConfig.mockResolvedValue({
      rowId: 'row-1',
      config: {
        currency: 'INR',
        low_balance_threshold: 200,
        rates: { marketing: 0.88, utility: 0.13, authentication: 0.13, service: 0 },
        topups: [],
      },
    })
    mocks.computeWalletSummary.mockResolvedValue({
      currency: 'INR',
      total_topup: 500,
      estimated_spend: 0,
      estimated_balance: 500,
      is_low_balance: false,
    })
  })

  it('records a new top-up when valid', async () => {
    const req = new Request('http://localhost/api/whatsapp/wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'log_topup',
        amount: 500,
        note: 'UPI Payment',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(mocks.saveWalletConfig).toHaveBeenCalled()
  })

  it('rejects top-up with invalid amount', async () => {
    const req = new Request('http://localhost/api/whatsapp/wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'log_topup',
        amount: -50,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})
