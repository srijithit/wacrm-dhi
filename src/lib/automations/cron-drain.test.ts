import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drainDuePendingExecutions } from './cron-drain'

const h = vi.hoisted(() => ({
  resumePendingExecution: vi.fn(),
  state: {
    pendingRows: [] as Record<string, unknown>[],
    claims: [] as string[],
    expired: [] as string[],
  },
}))

vi.mock('@/lib/automations/engine', () => ({
  resumePendingExecution: h.resumePendingExecution,
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automation_pending_executions') {
        const chain: Record<string, unknown> = {
          update: (payload: { status: string }) => {
            const updateOps: Record<string, unknown> = {
              eq: (col: string, val: string) => {
                if (payload.status === 'failed') {
                  return {
                    lt: () => {
                      h.state.expired.push('expired-stale')
                      return Promise.resolve({ error: null })
                    },
                  }
                }
                return updateOps
              },
              select: () => ({
                maybeSingle: () => {
                  if (payload.status === 'running') {
                    h.state.claims.push('claimed')
                    return Promise.resolve({ data: { id: 'p-1' } })
                  }
                  return Promise.resolve({ data: null })
                },
              }),
            }
            return updateOps
          },
          select: () => {
            const selectOps: Record<string, unknown> = {
              eq: () => selectOps,
              lte: () => selectOps,
              gte: () => selectOps,
              order: () => selectOps,
              limit: () => Promise.resolve({ data: h.state.pendingRows, error: null }),
            }
            return selectOps
          },
        }
        return chain
      }
      return {}
    },
  }),
}))

describe('drainDuePendingExecutions', () => {
  beforeEach(() => {
    h.resumePendingExecution.mockReset()
    h.state.pendingRows = []
    h.state.claims = []
    h.state.expired = []
  })

  it('returns 0 when there are no due executions', async () => {
    const processed = await drainDuePendingExecutions()
    expect(processed).toBe(0)
    expect(h.resumePendingExecution).not.toHaveBeenCalled()
  })

  it('claims and resumes due executions', async () => {
    h.state.pendingRows = [
      {
        id: 'p-1',
        automation_id: 'auto-1',
        account_id: 'acct-1',
        user_id: 'user-1',
        contact_id: 'c-1',
        log_id: 'log-1',
        parent_step_id: null,
        branch: null,
        next_step_position: 1,
        context: {},
      },
    ]

    const processed = await drainDuePendingExecutions()
    expect(processed).toBe(1)
    expect(h.state.claims).toContain('claimed')
    expect(h.resumePendingExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'p-1',
        automation_id: 'auto-1',
        next_step_position: 1,
      }),
    )
  })
})
