import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import {
  engineSendText,
  loadAccountMetaCredentials,
} from '@/lib/flows/meta-send'
import { sendTypingIndicator } from '@/lib/whatsapp/meta-api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { triggerMatches } from '@/lib/automations/engine'
import type { Automation } from '@/types'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
  /** Meta's wamid of the customer message we're replying to. When set,
   *  a typing indicator (which also marks it read) is shown while the
   *  reply is generated. Optional so older callers keep working. */
  inboundMessageId?: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    inboundMessageId,
  } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Stand down only if
    // an automation triggered by this message actually sends an immediate
    // response. Delayed follow-ups (e.g. Follow-up Reminder starting with
    // a `wait` step) or non-message automations (tagging, deals) must not
    // suppress the AI assistant.
    const { data: autoResponders } = await db
      .from('automations')
      .select('id, trigger_type, trigger_config')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(50)

    if (autoResponders && autoResponders.length > 0) {
      const userText = latestUserMessage(messages)
      const matchingAutomations = autoResponders.filter((a) => {
        if (a.trigger_type === 'keyword_match') {
          return triggerMatches(a as Automation, { message_text: userText })
        }
        return a.trigger_type === 'new_message_received' || !a.trigger_type
      })

      if (matchingAutomations.length > 0) {
        const candidateIds = matchingAutomations.map((a) => a.id)
        const { data: steps, error: stepsErr } = await db
          .from('automation_steps')
          .select('id, automation_id, step_type, position, parent_step_id, branch')
          .in('automation_id', candidateIds)
          .order('position', { ascending: true })

        if (stepsErr) {
          console.warn('[ai auto-reply] failed to load automation steps:', stepsErr)
        }

        const stepsByAutoId = new Map<string, StepSummary[]>()
        for (const step of steps ?? []) {
          const list = stepsByAutoId.get(step.automation_id) ?? []
          list.push(step)
          stepsByAutoId.set(step.automation_id, list)
        }

        const matchesImmediateResponder = matchingAutomations.some((a) => {
          const autoSteps = stepsByAutoId.get(a.id) ?? []
          return automationHasImmediateSend(autoSteps)
        })

        if (matchesImmediateResponder) return
      }
    }

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Every gate has passed — we're committed to attempting a reply, so
    // show the customer "typing…" (and mark their message read) while the
    // retrieval + LLM round trips run. Meta clears the indicator after
    // 25 s or when our reply lands, whichever is first, so there's
    // nothing to undo on the handoff / no-text path. Strictly
    // best-effort: a failed indicator must never cost us the reply.
    if (inboundMessageId) {
      await showTypingIndicator(db, accountId, inboundMessageId)
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
    })

    const { text, handoff, usage } = await generateReply({
      config,
      systemPrompt,
      messages,
    })

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (handoff || !text) {
      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread and hand it to a human. We (a) pause the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent — null leaves it in the shared queue —
      // and (c) leave a short internal note so whoever picks it up has
      // context. Assigning fires the `on_conversation_assigned` trigger,
      // which notifies the agent.
      const summary = buildHandoffSummary({
        messages,
        replyCount: conv.ai_reply_count ?? 0,
      })
      const update: Record<string, unknown> = {
        ai_autoreply_disabled: true,
        ai_handoff_summary: summary,
      }
      // Only set the assignee when a target is configured AND the thread
      // isn't already owned — never stomp an existing human assignment.
      if (config.handoffAgentId && !conv.assigned_agent_id) {
        update.assigned_agent_id = config.handoffAgentId
      }
      await db.from('conversations').update(update).eq('id', conversationId)
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

/**
 * Best-effort "typing…" for the inbound we're about to answer. Swallows
 * every failure (no WhatsApp config, bad token, Meta 4xx) with a warning
 * — the indicator is cosmetic, the reply is not.
 */
async function showTypingIndicator(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  inboundMessageId: string,
): Promise<void> {
  try {
    const { phoneNumberId, accessToken } = await loadAccountMetaCredentials(
      db,
      accountId,
    )
    await sendTypingIndicator({
      phoneNumberId,
      accessToken,
      messageId: inboundMessageId,
    })
  } catch (err) {
    console.warn('[ai auto-reply] typing indicator failed (continuing):', err)
  }
}

const IMMEDIATE_SEND_STEP_TYPES = new Set([
  'send_message',
  'send_buttons',
  'send_list',
  'send_template',
])

export interface StepSummary {
  id?: string
  automation_id?: string
  step_type: string
  position: number
  parent_step_id?: string | null
  branch?: string | null
}

/**
 * Returns true if the automation will attempt to send an outbound message to
 * the contact in its very first tick, before any `wait` step pauses execution.
 *
 * Delayed automations (such as a Follow-up Reminder whose position 0 is a
 * `wait` step) do not send any message right now, so they must not suppress
 * the AI assistant from replying to the incoming inquiry.
 */
export function automationHasImmediateSend(steps: StepSummary[]): boolean {
  if (!steps || steps.length === 0) return false

  const rootSteps = steps
    .filter((s) => !s.parent_step_id)
    .sort((a, b) => a.position - b.position)

  for (const step of rootSteps) {
    // If execution hits a `wait` step before any message was sent,
    // execution halts and enqueues for later — no message is sent now.
    if (step.step_type === 'wait') {
      return false
    }

    if (IMMEDIATE_SEND_STEP_TYPES.has(step.step_type)) {
      return true
    }

    if (step.step_type === 'condition' && step.id) {
      const childSteps = steps.filter((s) => s.parent_step_id === step.id)
      const yesSteps = childSteps
        .filter((s) => s.branch === 'yes')
        .sort((a, b) => a.position - b.position)
      const noSteps = childSteps
        .filter((s) => s.branch === 'no')
        .sort((a, b) => a.position - b.position)

      const branchHasSend = (bSteps: StepSummary[]) => {
        for (const child of bSteps) {
          if (child.step_type === 'wait') return false
          if (IMMEDIATE_SEND_STEP_TYPES.has(child.step_type)) return true
        }
        return false
      }

      if (branchHasSend(yesSteps) || branchHasSend(noSteps)) {
        return true
      }
    }
  }

  return false
}

