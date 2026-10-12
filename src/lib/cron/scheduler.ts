import { drainDuePendingExecutions } from '@/lib/automations/cron-drain'

const INTERVAL_MS = 30_000 // 30 seconds

const globalForScheduler = globalThis as unknown as {
  __wacrmSchedulerStarted?: boolean
  __wacrmSchedulerTimer?: NodeJS.Timeout
}

export function startBackgroundScheduler(): void {
  // Never run during tests or production build phase
  if (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST ||
    process.env.NEXT_PHASE === 'phase-production-build'
  ) {
    return
  }

  if (globalForScheduler.__wacrmSchedulerStarted) {
    return
  }
  globalForScheduler.__wacrmSchedulerStarted = true

  console.log('[scheduler] background automation worker started (30s interval)')

  const tick = async () => {
    try {
      const processed = await drainDuePendingExecutions(50)
      if (processed > 0) {
        console.log(`[scheduler] processed ${processed} due automation execution(s)`)
      }
    } catch (err) {
      console.error('[scheduler] error during tick:', err)
    }
  }

  // Initial delay of 5s on boot, then repeat every INTERVAL_MS
  setTimeout(() => {
    void tick()
    globalForScheduler.__wacrmSchedulerTimer = setInterval(() => {
      void tick()
    }, INTERVAL_MS)
  }, 5000)
}
