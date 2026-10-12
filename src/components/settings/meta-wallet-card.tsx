'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Wallet,
  ExternalLink,
  Plus,
  Trash2,
  RefreshCw,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  CreditCard,
  MessageSquare,
  ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { WalletSummary } from '@/lib/whatsapp/meta-wallet'

interface MetaWalletCardProps {
  wabaId?: string
  canEdit?: boolean
}

export function MetaWalletCard({ wabaId: propWabaId, canEdit = true }: MetaWalletCardProps) {
  const [summary, setSummary] = useState<WalletSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [dismissedAlert, setDismissedAlert] = useState(false)

  // Form fields
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')

  const fetchWallet = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/whatsapp/wallet')
      if (!res.ok) {
        throw new Error('Failed to load wallet data')
      }
      const data = await res.json()
      if (data.ok && data.wallet) {
        setSummary(data.wallet)
      }
    } catch (err) {
      console.error('Wallet fetch error:', err)
      toast.error('Could not load Meta wallet data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchWallet()
  }, [fetchWallet])

  const handleLogTopup = async (e: React.FormEvent) => {
    e.preventDefault()
    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error('Please enter a valid amount greater than 0')
      return
    }

    try {
      setSubmitting(true)
      const res = await fetch('/api/whatsapp/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'log_topup',
          amount: numAmount,
          date,
          note,
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to record top-up')
      }

      setSummary(data.wallet)
      toast.success(`Logged top-up of ${data.wallet.currency} ${numAmount.toFixed(2)}`)
      setIsDialogOpen(false)
      setAmount('')
      setNote('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record top-up')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteTopup = async (topupId: string) => {
    if (!confirm('Are you sure you want to remove this top-up record?')) return

    try {
      const res = await fetch('/api/whatsapp/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_topup',
          topupId,
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to remove top-up')
      }

      setSummary(data.wallet)
      toast.success('Top-up record removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove top-up')
    }
  }

  const currency = summary?.currency || 'INR'
  const currencySymbol = currency === 'USD' ? '$' : '₹'
  const activeWabaId = propWabaId || summary?.waba_id
  const metaBillingUrl =
    summary?.meta_billing_url ||
    (activeWabaId
      ? `https://business.facebook.com/billing_hub/payment_settings?asset_id=${activeWabaId}`
      : 'https://business.facebook.com/billing_hub/payment_settings')

  const estimatedBalance = summary?.estimated_balance ?? 0
  const isDepleted =
    (summary?.insufficient_funds_detected || estimatedBalance <= 0) &&
    (summary?.total_topup ?? 0) > 0
  const isLow = summary?.is_low_balance && !isDepleted

  return (
    <>
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                <Wallet className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-semibold text-foreground">
                  Meta WhatsApp Balance & Billing
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Track your estimated prepaid balance, log top-ups, and add funds directly on Meta.
                </CardDescription>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchWallet}
                disabled={loading}
                className="h-8 gap-1.5 text-xs"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(metaBillingUrl, '_blank', 'noopener,noreferrer')}
                className="h-8 gap-1.5 text-xs text-primary border-primary/30 hover:bg-primary/5"
              >
                <CreditCard className="h-3.5 w-3.5" />
                Add Funds on Meta
                <ExternalLink className="h-3 w-3 opacity-70" />
              </Button>

              {canEdit && (
                <Button
                  size="sm"
                  onClick={() => setIsDialogOpen(true)}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Log Top-Up
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-0">
          {/* Critical Alerts */}
          {summary?.insufficient_funds_detected && !dismissedAlert && (
            <Alert variant="destructive" className="border-red-500/30 bg-red-500/10 text-red-400">
              <ShieldAlert className="h-4 w-4" />
              <div className="flex items-center justify-between">
                <AlertTitle className="font-semibold">Meta Balance Empty (Error 131042)</AlertTitle>
                <button
                  type="button"
                  onClick={() => setDismissedAlert(true)}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Dismiss
                </button>
              </div>
              <AlertDescription className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs">
                <span>
                  Meta has rejected template messages because your prepaid balance is ₹0.
                  Please top up on Meta immediately to resume message delivery.
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => window.open(metaBillingUrl, '_blank', 'noopener,noreferrer')}
                    className="h-7 shrink-0 text-xs gap-1 font-semibold"
                  >
                    Top Up on Meta ↗
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {!summary?.insufficient_funds_detected && isLow && (
            <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-300">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <AlertTitle className="font-semibold">Low Balance Warning</AlertTitle>
              <AlertDescription className="text-xs">
                Estimated balance is low ({currencySymbol}
                {estimatedBalance.toFixed(2)}). Consider adding funds on Meta to avoid message delivery interruption.
              </AlertDescription>
            </Alert>
          )}

          {/* Key Metrics Cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* Estimated Balance */}
            <div className="rounded-xl border border-border bg-muted/40 p-3.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Estimated Balance</span>
                {summary && (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      isDepleted
                        ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                        : isLow
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    }`}
                  >
                    {isDepleted ? 'Depleted' : isLow ? 'Low Balance' : 'Healthy'}
                  </span>
                )}
              </div>
              <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
                {currencySymbol}
                {summary ? estimatedBalance.toFixed(2) : '0.00'}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {summary?.total_topup === 0
                  ? 'No top-ups logged yet — click "Log Top-Up"'
                  : `Threshold alert at ${currencySymbol}${summary?.low_balance_threshold}`}
              </div>
            </div>

            {/* Total Top-ups */}
            <div className="rounded-xl border border-border bg-muted/40 p-3.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Total Top-Ups Logged</span>
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
                {currencySymbol}
                {summary ? summary.total_topup.toFixed(2) : '0.00'}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {summary?.topups.length || 0} top-up transaction(s) recorded
              </div>
            </div>

            {/* Estimated Spend */}
            <div className="rounded-xl border border-border bg-muted/40 p-3.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Estimated Spend</span>
                <TrendingDown className="h-3.5 w-3.5 text-blue-400" />
              </div>
              <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
                {currencySymbol}
                {summary ? summary.estimated_spend.toFixed(2) : '0.00'}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {summary?.counts.total_templates || 0} template messages sent
              </div>
            </div>
          </div>

          {/* Breakdown Section */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Template Spend Breakdown */}
            <div className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="h-4 w-4 text-primary" />
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Template Spend Breakdown
                </h4>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between py-1 border-b border-border/50">
                  <span className="text-muted-foreground">
                    Marketing ({summary?.counts.marketing ?? 0} msgs @ ~{currencySymbol}0.88)
                  </span>
                  <span className="font-semibold text-foreground">
                    {currencySymbol}
                    {summary?.spend_breakdown.marketing.toFixed(2) ?? '0.00'}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1 border-b border-border/50">
                  <span className="text-muted-foreground">
                    Utility ({summary?.counts.utility ?? 0} msgs @ ~{currencySymbol}0.13)
                  </span>
                  <span className="font-semibold text-foreground">
                    {currencySymbol}
                    {summary?.spend_breakdown.utility.toFixed(2) ?? '0.00'}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1 border-b border-border/50">
                  <span className="text-muted-foreground">
                    Authentication ({summary?.counts.authentication ?? 0} msgs @ ~{currencySymbol}0.13)
                  </span>
                  <span className="font-semibold text-foreground">
                    {currencySymbol}
                    {summary?.spend_breakdown.authentication.toFixed(2) ?? '0.00'}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1">
                  <span className="text-muted-foreground">Customer Service Replies (within 24h)</span>
                  <span className="font-medium text-emerald-400">Free</span>
                </div>
              </div>
            </div>

            {/* Top-Up History */}
            <div className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    Recent Top-Up History
                  </h4>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setIsDialogOpen(true)}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" /> Add
                  </button>
                )}
              </div>

              {!summary?.topups || summary.topups.length === 0 ? (
                <div className="flex h-28 items-center justify-center text-center text-xs text-muted-foreground">
                  No top-ups recorded yet.
                  <br />
                  Click &ldquo;Log Top-Up&rdquo; after adding funds on Meta.
                </div>
              ) : (
                <div className="max-h-36 overflow-y-auto space-y-2 pr-1">
                  {summary.topups.slice(0, 5).map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between rounded-lg bg-muted/30 px-2.5 py-1.5 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-foreground">
                          +{currencySymbol}
                          {t.amount.toFixed(2)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {new Date(t.date).toLocaleDateString()} {t.note ? `• ${t.note}` : ''}
                        </div>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleDeleteTopup(t.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-400 transition-colors"
                          title="Delete record"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Log Top-Up Modal */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleLogTopup}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                Log Meta WhatsApp Top-Up
              </DialogTitle>
              <DialogDescription className="text-xs">
                Record the amount you added in your Meta Business Manager wallet so ChatIQ can track your remaining balance.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="topup-amount" className="text-xs font-medium">
                  Amount Added ({currencySymbol})
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-muted-foreground">
                    {currencySymbol}
                  </span>
                  <Input
                    id="topup-amount"
                    type="number"
                    step="0.01"
                    min="1"
                    placeholder="e.g. 2000"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    className="pl-7"
                    autoFocus
                  />
                </div>
                {/* Quick amount chips */}
                <div className="flex gap-2 pt-1">
                  {[500, 1000, 2000, 5000].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setAmount(val.toString())}
                      className="rounded border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      +{currencySymbol}{val}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="topup-date" className="text-xs font-medium">
                  Date of Payment
                </Label>
                <Input
                  id="topup-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="topup-note" className="text-xs font-medium">
                  Note / Reference (Optional)
                </Label>
                <Input
                  id="topup-note"
                  placeholder="e.g. Added via UPI on Meta Manager"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsDialogOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? 'Saving...' : 'Save Top-Up'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
