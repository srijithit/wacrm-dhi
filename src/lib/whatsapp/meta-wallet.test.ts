import { describe, it, expect, vi } from 'vitest'
import {
  computeWalletSummary,
  getDefaultRates,
  getDefaultThreshold,
  loadWalletConfig,
  saveWalletConfig,
  DEFAULT_INR_RATES,
  DEFAULT_USD_RATES,
} from './meta-wallet'

describe('meta-wallet', () => {
  describe('defaults', () => {
    it('returns INR rates by default', () => {
      expect(getDefaultRates('INR')).toEqual(DEFAULT_INR_RATES)
      expect(getDefaultThreshold('INR')).toBe(200)
    })

    it('returns USD rates when currency is USD', () => {
      expect(getDefaultRates('USD')).toEqual(DEFAULT_USD_RATES)
      expect(getDefaultThreshold('USD')).toBe(5)
    })
  })

  describe('loadWalletConfig', () => {
    it('returns default config when no custom field is found', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }

      const res = await loadWalletConfig(mockSupabase as any, 'acc-1', 'INR')
      expect(res.rowId).toBeNull()
      expect(res.config.currency).toBe('INR')
      expect(res.config.topups).toEqual([])
      expect(res.config.rates).toEqual(DEFAULT_INR_RATES)
    })

    it('returns stored config when row exists', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'row-1',
              field_options: {
                currency: 'INR',
                low_balance_threshold: 300,
                rates: DEFAULT_INR_RATES,
                topups: [{ id: '1', amount: 500, date: '2026-10-12', created_at: '2026-10-12' }],
              },
            },
            error: null,
          }),
        }),
      }

      const res = await loadWalletConfig(mockSupabase as any, 'acc-1', 'INR')
      expect(res.rowId).toBe('row-1')
      expect(res.config.low_balance_threshold).toBe(300)
      expect(res.config.topups).toHaveLength(1)
      expect(res.config.topups[0].amount).toBe(500)
    })
  })

  describe('computeWalletSummary', () => {
    it('computes balance, spend and insufficient funds correctly', async () => {
      const mockSupabase = {
        from: (table: string) => {
          if (table === 'whatsapp_config') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { waba_id: '123456789' } }),
                }),
              }),
            }
          }
          if (table === 'custom_fields') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: {
                          id: 'row-1',
                          field_options: {
                            currency: 'INR',
                            low_balance_threshold: 100,
                            rates: DEFAULT_INR_RATES,
                            topups: [
                              { id: 't1', amount: 1000, date: '2026-10-10', created_at: '2026-10-10' },
                            ],
                          },
                        },
                      }),
                  }),
                }),
              }),
            }
          }
          if (table === 'conversations') {
            return {
              select: () => ({
                eq: () => Promise.resolve({ data: [{ id: 'c-1' }] }),
              }),
            }
          }
          if (table === 'messages') {
            return {
              select: (cols: string) => ({
                in: () => {
                  if (cols.includes('error_code')) {
                    return {
                      eq: () => ({
                        limit: () => Promise.resolve({ data: [{ id: 'm-err', error_code: 131042 }] }),
                      }),
                    }
                  }
                  return {
                    eq: () => ({
                      neq: () =>
                        Promise.resolve({
                          data: [
                            { id: 'm-1', template_name: 'welcome_lead', status: 'delivered' },
                            { id: 'm-2', template_name: 'otp_verification', status: 'sent' },
                          ],
                        }),
                    }),
                  }
                },
              }),
            }
          }
          if (table === 'message_templates') {
            return {
              select: () => ({
                eq: () =>
                  Promise.resolve({
                    data: [
                      { name: 'welcome_lead', category: 'marketing' },
                      { name: 'otp_verification', category: 'utility' },
                    ],
                  }),
              }),
            }
          }
          return {}
        },
      }

      const summary = await computeWalletSummary(mockSupabase as any, 'acc-1', 'INR')
      expect(summary.waba_id).toBe('123456789')
      expect(summary.total_topup).toBe(1000)
      // 1 marketing (0.88) + 1 utility (0.13) = 1.01
      expect(summary.estimated_spend).toBe(1.01)
      expect(summary.estimated_balance).toBe(998.99)
      expect(summary.counts.marketing).toBe(1)
      expect(summary.counts.utility).toBe(1)
      expect(summary.insufficient_funds_detected).toBe(true)
      expect(summary.meta_billing_url).toContain('asset_id=123456789')
    })
  })
})
