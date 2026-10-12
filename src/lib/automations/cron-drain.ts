import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'

/**
 * Maximum lag for a pending execution before it is considered stale.
 * If the server was offline for several days, we don't blast customers
 * with multi-day-old overdue follow-up reminders.
 */
const MAX_PENDING_LAG_MS = 2 * 60 * 60 * 1000

export async function drainDuePendingExecutions(limit = 50): Promise<number> {
  const admin = supabaseAdmin()
  const now = new Date()
  const nowIso = now.toISOString()
  const cutoffIso = new Date(now.getTime() - MAX_PENDING_LAG_MS).toISOString()

  // 1. Expire overdue executions whose scheduled run_at is older than 2 hours
  // so stale backlogs are not blasted to customers unexpectedly.
  try {
    await admin
      .from('automation_pending_executions')
      .update({ status: 'failed' })
      .eq('status', 'pending')
      .lt('run_at', cutoffIso)
  } catch (err) {
    console.error('[cron] failed to expire stale executions:', err)
  }

  // 2. Query due executions within the valid time window
  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', nowIso)
    .gte('run_at', cutoffIso)
    .order('run_at', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[cron] failed to fetch due executions:', error.message)
    return 0
  }
  if (!due || due.length === 0) return 0

  let processed = 0
  for (const row of due) {
    const { data: claim } = await admin
      .from('automation_pending_executions')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (!claim) continue

    try {
      await resumePendingExecution({
        id: row.id as string,
        automation_id: row.automation_id as string,
        account_id: row.account_id as string,
        user_id: row.user_id as string,
        contact_id: (row.contact_id as string | null) ?? null,
        log_id: (row.log_id as string | null) ?? null,
        parent_step_id: (row.parent_step_id as string | null) ?? null,
        branch: (row.branch as 'yes' | 'no' | null) ?? null,
        next_step_position: row.next_step_position as number,
        context: (row.context as AutomationContext) ?? {},
      })
      processed++
    } catch (err) {
      console.error('[cron] resume failed for execution:', row.id, err)
    }
  }

  return processed
}
