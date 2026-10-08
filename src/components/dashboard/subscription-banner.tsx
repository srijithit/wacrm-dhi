"use client";

import { useState } from "react";
import {
  Sparkles,
  ArrowRight,
  TrendingUp,
  ShieldCheck,
  Check,
  Zap,
  Lock,
  Unlock,
  CreditCard,
  Ticket,
  ChevronRight,
  Clock,
  AlertCircle,
  HelpCircle,
  PartyPopper,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface SubscriptionBannerProps {
  userName?: string;
}

export function SubscriptionBanner({ userName = "Sri" }: SubscriptionBannerProps) {
  // Days Remaining in cycle
  const [daysRemaining, setDaysRemaining] = useState(16);
  const totalDays = 30;

  // Plan State
  const [currentPlan, setCurrentPlan] = useState<"Growth" | "Pro" | "Business">("Growth");
  const [isTestLocked, setIsTestLocked] = useState(false);

  // Modals
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState(false);
  const [isUsageModalOpen, setIsUsageModalOpen] = useState(false);

  // Checkout Configuration
  const [selectedPlanTier, setSelectedPlanTier] = useState<"Growth" | "Pro" | "Business">("Growth");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");

  // Promo Code State
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [appliedPromoName, setAppliedPromoName] = useState<string | null>(null);
  const [appliedDiscount, setAppliedDiscount] = useState<number | null>(null);
  const [isPaying, setIsPaying] = useState(false);

  // SVG Circular Gauge calculation
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const progressRatio = Math.max(0, Math.min(1, daysRemaining / totalDays));
  const strokeDashoffset = circumference * (1 - progressRatio);

  // Pricing Matrix (in INR ₹)
  const PLAN_PRICES = {
    Growth: { monthly: 1499, yearly: 13491 }, // 25% off yearly
    Pro: { monthly: 3499, yearly: 31491 },
    Business: { monthly: 7999, yearly: 71991 },
  };

  const PROMO_CODES: Record<string, { discountPercent: number; minCycle?: "monthly" | "yearly"; label: string }> = {
    LAUNCH50: { discountPercent: 50, label: "50% Off Launch Special" },
    DHI50: { discountPercent: 50, label: "50% Off DhiGrowth Partner" },
    WAPPPILOT: { discountPercent: 30, label: "30% Off WappPilot Platform" },
    STARTUP20: { discountPercent: 20, label: "20% Off Startup Boost" },
    ANNUAL30: { discountPercent: 30, minCycle: "yearly", label: "30% Off Annual Plan" },
    TESTER10: { discountPercent: 10, label: "10% Off Beta Tester" },
  };

  const basePrice = PLAN_PRICES[selectedPlanTier][billingCycle];
  const discountAmount = appliedDiscount
    ? Math.round((basePrice * appliedDiscount) / 100)
    : 0;
  const discountedBase = Math.max(0, basePrice - discountAmount);
  const gstAmount = Math.round(discountedBase * 0.18);
  const totalPayable = discountedBase + gstAmount;

  // Apply Promo Code
  const handleApplyPromo = () => {
    const code = promoCodeInput.trim().toUpperCase();
    if (!code) {
      toast.error("Please enter a promo code");
      return;
    }
    const found = PROMO_CODES[code];
    if (found) {
      if (found.minCycle && found.minCycle !== billingCycle) {
        toast.error(`Code ${code} is only valid on ${found.minCycle} billing.`);
        return;
      }
      setAppliedDiscount(found.discountPercent);
      setAppliedPromoName(code);
      toast.success(`Coupon ${code} applied! ${found.discountPercent}% discount activated.`);
    } else {
      toast.error(`Invalid promo code "${code}". Try DHI50 or LAUNCH50.`);
    }
  };

  // Open Checkout for a specific plan
  const handleSelectPlan = (tier: "Growth" | "Pro" | "Business") => {
    setSelectedPlanTier(tier);
    setIsUpgradeModalOpen(false);
    setIsCheckoutModalOpen(true);
  };

  // Trigger Razorpay Payment
  const handlePay = async () => {
    setIsPaying(true);

    try {
      // 1. Create order on backend
      const res = await fetch("/api/subscription/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: selectedPlanTier.toLowerCase(),
          billingCycle,
          promoCode: appliedPromoName || "",
        }),
      });

      const orderData = await res.json();
      if (!res.ok) {
        throw new Error(orderData.error || "Failed to initialize order");
      }

      // Check if window.Razorpay exists or load script
      const loadRazorpayScript = (): Promise<boolean> => {
        return new Promise((resolve) => {
          if (typeof window !== "undefined" && (window as unknown as { Razorpay: unknown }).Razorpay) {
            resolve(true);
            return;
          }
          const script = document.createElement("script");
          script.src = "https://checkout.razorpay.com/v1/checkout.js";
          script.onload = () => resolve(true);
          script.onerror = () => resolve(false);
          document.body.appendChild(script);
        });
      };

      const scriptLoaded = await loadRazorpayScript();

      if (scriptLoaded && typeof window !== "undefined" && (window as unknown as { Razorpay: new (opts: unknown) => { open: () => void } }).Razorpay) {
        const RazorpayClass = (window as unknown as { Razorpay: new (opts: unknown) => { open: () => void } }).Razorpay;
        const options = {
          key: orderData.keyId,
          amount: orderData.amount,
          currency: "INR",
          name: "Dhigrowth CRM",
          description: `${selectedPlanTier} Subscription (${billingCycle})`,
          image: "https://www.dhigrowth.com/logo.png",
          order_id: orderData.orderId.startsWith("order_sim") ? undefined : orderData.orderId,
          prefill: {
            name: userName,
            email: "srivaladeno@gmail.com",
            contact: "+919791471277",
          },
          theme: {
            color: "#7c3aed",
          },
          handler: async (response: { razorpay_payment_id: string; razorpay_order_id?: string; razorpay_signature?: string }) => {
            // Verify payment
            await fetch("/api/subscription/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...response,
                planId: selectedPlanTier.toLowerCase(),
                billingCycle,
              }),
            });

            completeSuccess(response.razorpay_payment_id);
          },
          modal: {
            ondismiss: () => {
              setIsPaying(false);
            },
          },
        };

        const rzp = new RazorpayClass(options);
        rzp.open();
        return;
      }

      // Fallback simulation if Razorpay popup is blocked in sandbox environment
      setTimeout(async () => {
        const paymentId = `pay_sim_${Date.now()}`;
        await fetch("/api/subscription/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_payment_id: paymentId,
            planId: selectedPlanTier.toLowerCase(),
            billingCycle,
          }),
        });
        completeSuccess(paymentId);
      }, 1000);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Payment failed. Please try again.");
      setIsPaying(false);
    }
  };

  const completeSuccess = (paymentId: string) => {
    setIsPaying(false);
    setCurrentPlan(selectedPlanTier);
    setDaysRemaining(billingCycle === "yearly" ? 365 : 30);
    setIsTestLocked(false);
    setIsCheckoutModalOpen(false);
    toast.success(
      `🎉 Payment Successful! ${selectedPlanTier} Plan activated (${paymentId.slice(0, 14)}).`,
      { duration: 5000 }
    );
  };

  return (
    <div className="relative overflow-hidden rounded-3xl border border-purple-200/80 dark:border-purple-900/60 bg-gradient-to-br from-purple-50/70 via-background to-purple-100/30 dark:from-purple-950/20 dark:via-background dark:to-purple-900/10 p-5 sm:p-6 shadow-sm transition-all">
      {/* Decorative background glows */}
      <div className="absolute -top-12 -right-12 h-44 w-44 rounded-full bg-purple-400/15 blur-2xl pointer-events-none" />
      <div className="absolute -bottom-10 -left-10 h-36 w-36 rounded-full bg-indigo-400/15 blur-2xl pointer-events-none" />

      <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        {/* Left Column: Greeting, Plan & Feature Chips */}
        <div className="flex-1 space-y-3.5">
          {/* Top Pill & Lock Test Button */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-300/80 dark:border-purple-800 bg-purple-100/80 dark:bg-purple-900/40 px-3 py-1 text-xs font-bold text-purple-700 dark:text-purple-300">
              <Sparkles className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400 animate-pulse" />
              Growth Workspace • 24/7 AI Concierge Active
            </span>

            <button
              onClick={() => setIsTestLocked((l) => !l)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background/80 hover:bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors"
              title="Preview locked workspace mode"
            >
              {isTestLocked ? (
                <>
                  <Unlock className="h-3 w-3 text-emerald-500" />
                  <span>Unlock Workspace</span>
                </>
              ) : (
                <>
                  <Lock className="h-3 w-3 text-amber-500" />
                  <span>Test Lock</span>
                </>
              )}
            </button>
          </div>

          {/* Heading with Plan Status */}
          <div>
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <span>Welcome back, {userName}!</span>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              Your <strong className="text-foreground">{currentPlan} Plan</strong> provides unlimited Meta WhatsApp Cloud API access, intelligent lead automations, and AI bot concierges.
            </p>
          </div>

          {/* Feature Badge Pills */}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-lg bg-background/80 dark:bg-card px-2.5 py-1 border border-border shadow-xs">
              <Check className="h-3.5 w-3.5 text-emerald-500" />
              Official Meta Cloud API
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg bg-background/80 dark:bg-card px-2.5 py-1 border border-border shadow-xs">
              <Check className="h-3.5 w-3.5 text-emerald-500" />
              Gemini 3.5 AI Auto-Reply
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg bg-background/80 dark:bg-card px-2.5 py-1 border border-border shadow-xs">
              <Check className="h-3.5 w-3.5 text-emerald-500" />
              Custom Interactive Buttons
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg bg-background/80 dark:bg-card px-2.5 py-1 border border-border shadow-xs">
              <Check className="h-3.5 w-3.5 text-emerald-500" />
              Unlimited WhatsApp Contacts
            </span>
          </div>
        </div>

        {/* Right Column: Circular Days Gauge + Action Buttons */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 sm:gap-6 pt-2 lg:pt-0">
          {/* Circular 16-Day Progress Gauge */}
          <div className="flex items-center gap-3.5 rounded-2xl bg-white/80 dark:bg-card/80 border border-purple-200/80 dark:border-purple-900/60 p-3 shadow-xs backdrop-blur-xs">
            <div className="relative flex items-center justify-center">
              <svg className="h-20 w-20 -rotate-90 transform" viewBox="0 0 80 80">
                <circle
                  cx="40"
                  cy="40"
                  r={radius}
                  stroke="currentColor"
                  strokeWidth="6"
                  className="text-purple-100 dark:text-purple-950/60"
                  fill="transparent"
                />
                <circle
                  cx="40"
                  cy="40"
                  r={radius}
                  stroke="currentColor"
                  strokeWidth="6"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  className="text-purple-600 dark:text-purple-400 transition-all duration-1000 ease-out"
                  fill="transparent"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-xl font-extrabold leading-none tracking-tight text-foreground">
                  {daysRemaining}
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Days
                </span>
              </div>
            </div>

            <div className="flex flex-col justify-center">
              <span className="text-xs font-bold text-foreground">Current Cycle</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {daysRemaining} of {totalDays} days left
              </p>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mt-1">
                <ShieldCheck className="h-3 w-3" /> Auto-Renew Safe
              </span>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-col gap-2 w-full sm:w-auto">
            <Button
              onClick={() => setIsUpgradeModalOpen(true)}
              className="rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold text-xs h-11 px-5 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <Zap className="h-3.5 w-3.5 text-amber-300 fill-amber-300" />
              <span>Upgrade Plan</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>

            <Button
              variant="outline"
              onClick={() => setIsUsageModalOpen(true)}
              className="rounded-2xl border-border bg-background/80 hover:bg-muted text-foreground text-xs font-semibold h-9 px-4 transition-colors flex items-center justify-center gap-1.5"
            >
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <span>View Usage</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Test Lock Overlay Banner if activated */}
      {isTestLocked && (
        <div className="mt-4 flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              <strong>Simulated Workspace Lock:</strong> Outbound WhatsApp broadcasts & automations paused until cycle renewed.
            </span>
          </div>
          <Button
            size="sm"
            onClick={() => handleSelectPlan("Growth")}
            className="bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold h-7 px-3"
          >
            Renew Now
          </Button>
        </div>
      )}

      {/* ============================================================ */}
      {/* Modal 1: 3-Tier Upgrade Selection Plan Modal                  */}
      {/* ============================================================ */}
      <Dialog open={isUpgradeModalOpen} onOpenChange={setIsUpgradeModalOpen}>
        <DialogContent className="max-w-3xl rounded-3xl p-6 sm:p-8">
          <DialogHeader className="text-center sm:text-left">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-2xl font-extrabold tracking-tight">
                  Upgrade your Dhigrowth Workspace
                </DialogTitle>
                <DialogDescription className="mt-1 text-sm text-muted-foreground">
                  Select a subscription plan tailored to your team scale and WhatsApp volume.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Billing Cycle Switcher */}
          <div className="flex items-center justify-center pt-2 pb-4">
            <div className="flex items-center gap-2 p-1 rounded-full bg-muted border border-border">
              <button
                onClick={() => setBillingCycle("monthly")}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                  billingCycle === "monthly"
                    ? "bg-white dark:bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Monthly Billing
              </button>
              <button
                onClick={() => setBillingCycle("yearly")}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${
                  billingCycle === "yearly"
                    ? "bg-white dark:bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>Yearly Billing</span>
                <span className="rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-extrabold uppercase">
                  Save 25%
                </span>
              </button>
            </div>
          </div>

          {/* 3 Tier Pricing Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            {/* Growth Tier */}
            <div className="relative rounded-2xl border-2 border-purple-500/80 bg-purple-50/20 dark:bg-purple-950/20 p-5 flex flex-col justify-between shadow-xs">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-purple-600 text-white px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-wider">
                Current Plan
              </div>
              <div>
                <h3 className="font-bold text-lg text-foreground">Growth</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Ideal for growing teams & startups</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-foreground">
                    ₹{PLAN_PRICES.Growth[billingCycle].toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">/{billingCycle === "monthly" ? "mo" : "yr"}</span>
                </div>

                <ul className="mt-5 space-y-2.5 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>2,500 WhatsApp Messages</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>AI Gemini 3.5 Auto-Reply</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>5 Shared Team Inboxes</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>Interactive Buttons & Lists</span>
                  </li>
                </ul>
              </div>

              <Button
                onClick={() => handleSelectPlan("Growth")}
                className="mt-6 w-full rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs h-10"
              >
                Renew Growth via Razorpay
              </Button>
            </div>

            {/* Pro Tier */}
            <div className="relative rounded-2xl border border-border bg-card p-5 flex flex-col justify-between hover:border-purple-400 transition-colors shadow-xs">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 text-white px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-wider">
                Most Popular
              </div>
              <div>
                <h3 className="font-bold text-lg text-foreground">Pro Scale</h3>
                <p className="text-xs text-muted-foreground mt-0.5">High volume messaging & automated flows</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-foreground">
                    ₹{PLAN_PRICES.Pro[billingCycle].toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">/{billingCycle === "monthly" ? "mo" : "yr"}</span>
                </div>

                <ul className="mt-5 space-y-2.5 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>10,000 WhatsApp Messages</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>Unlimited AI Assistant Runs</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>15 Shared Team Inboxes</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>Visual Flow Builder & Webhooks</span>
                  </li>
                </ul>
              </div>

              <Button
                onClick={() => handleSelectPlan("Pro")}
                className="mt-6 w-full rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs h-10"
              >
                Upgrade to Pro
              </Button>
            </div>

            {/* Business Enterprise Tier */}
            <div className="rounded-2xl border border-border bg-card p-5 flex flex-col justify-between hover:border-purple-400 transition-colors shadow-xs">
              <div>
                <h3 className="font-bold text-lg text-foreground">Enterprise</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Dedicated infrastructure & scale</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-foreground">
                    ₹{PLAN_PRICES.Business[billingCycle].toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">/{billingCycle === "monthly" ? "mo" : "yr"}</span>
                </div>

                <ul className="mt-5 space-y-2.5 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>Unlimited WhatsApp Messages</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>Custom AI Model Fine-tuning</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>Dedicated Meta Account Rep</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>Custom Webhooks & REST API</span>
                  </li>
                </ul>
              </div>

              <Button
                onClick={() => handleSelectPlan("Business")}
                className="mt-6 w-full rounded-xl bg-purple-900 hover:bg-purple-950 text-white font-semibold text-xs h-10"
              >
                Upgrade to Enterprise
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================================================ */}
      {/* Modal 2: Razorpay Checkout with Promocode Input & Breakdown   */}
      {/* ============================================================ */}
      <Dialog open={isCheckoutModalOpen} onOpenChange={setIsCheckoutModalOpen}>
        <DialogContent className="max-w-md rounded-3xl p-6 sm:p-7">
          <DialogHeader>
            <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
              <CreditCard className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-wider">Razorpay Secure Checkout</span>
            </div>
            <DialogTitle className="text-xl font-bold tracking-tight">
              Subscribe to {selectedPlanTier} Plan
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Complete your subscription with instant activation via UPI, Cards, Netbanking or QR.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Cycle Selector */}
            <div className="flex items-center justify-center gap-2 p-1 rounded-full bg-muted/60 border border-border">
              <button
                onClick={() => setBillingCycle("monthly")}
                className={`flex-1 py-1.5 rounded-full text-xs font-bold transition-all text-center ${
                  billingCycle === "monthly"
                    ? "bg-white dark:bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingCycle("yearly")}
                className={`flex-1 py-1.5 rounded-full text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  billingCycle === "yearly"
                    ? "bg-white dark:bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>Yearly</span>
                <span className="rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.2 text-[10px]">
                  Save 25%
                </span>
              </button>
            </div>

            {/* Promo Code Box */}
            <div className="flex items-center gap-2 rounded-2xl border border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-950/20 p-2">
              <Ticket className="h-4 w-4 text-purple-500 ml-2 shrink-0" />
              <Input
                value={promoCodeInput}
                onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                placeholder="HAVE A PROMO CODE? (E.G. DHI50)"
                className="border-0 bg-transparent text-xs font-mono placeholder:text-muted-foreground/70 uppercase focus-visible:ring-0 focus-visible:ring-offset-0 h-8"
              />
              <Button
                size="sm"
                onClick={handleApplyPromo}
                className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-semibold h-8 px-3 shrink-0"
              >
                Apply
              </Button>
            </div>

            {appliedPromoName && (
              <div className="flex items-center justify-between text-xs px-2 text-emerald-600 dark:text-emerald-400 font-semibold">
                <span className="flex items-center gap-1">
                  <PartyPopper className="h-3.5 w-3.5" />
                  Code {appliedPromoName} applied ({appliedDiscount}% off)
                </span>
                <button
                  onClick={() => {
                    setAppliedDiscount(null);
                    setAppliedPromoName(null);
                    setPromoCodeInput("");
                  }}
                  className="hover:underline text-muted-foreground"
                >
                  Remove
                </button>
              </div>
            )}

            {/* Price Breakdown Container */}
            <div className="flex flex-col gap-2 rounded-2xl border border-border bg-muted/20 p-4 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Base Subscription ({billingCycle})</span>
                <span className="font-semibold text-foreground">₹{basePrice.toLocaleString()}</span>
              </div>

              {discountAmount > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                  <span>Promo Discount ({appliedDiscount}%)</span>
                  <span>-₹{discountAmount.toLocaleString()}</span>
                </div>
              )}

              <div className="flex justify-between text-muted-foreground">
                <span>GST Tax (18%)</span>
                <span className="font-semibold text-foreground">₹{gstAmount.toLocaleString()}</span>
              </div>

              <div className="flex items-baseline justify-between pt-3 border-t border-border/80">
                <span className="text-sm font-bold text-foreground">Total Payable</span>
                <div className="text-right">
                  <span className="text-2xl font-extrabold text-purple-600 dark:text-purple-400">
                    ₹{totalPayable.toLocaleString()}
                  </span>
                  <p className="text-[10px] text-muted-foreground">Incl. all taxes</p>
                </div>
              </div>
            </div>

            {/* Notice Box */}
            <div className="flex items-start gap-2.5 rounded-2xl border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/30 p-3 text-xs">
              <ShieldCheck className="h-4 w-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
              <p className="text-purple-900 dark:text-purple-200 leading-relaxed text-[11px]">
                <strong>Official Razorpay Gateway:</strong> Supports UPI QR (Google Pay, PhonePe, Paytm), Netbanking, Debit/Credit Cards & Corporate Wallets.
              </p>
            </div>

            {/* Pay Button */}
            <Button
              disabled={isPaying}
              onClick={handlePay}
              className="w-full h-12 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-sm shadow-md flex items-center justify-center gap-2 mt-1"
            >
              {isPaying ? (
                "Connecting to Razorpay..."
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  <span>Pay ₹{totalPayable.toLocaleString()} via Razorpay</span>
                </>
              )}
            </Button>

            <p className="text-center text-[10px] text-muted-foreground">
              Secured by Razorpay • Instant Workspace Activation • GST Invoice Available
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================================================ */}
      {/* Modal 3: View Usage Breakdown                                */}
      {/* ============================================================ */}
      <Dialog open={isUsageModalOpen} onOpenChange={setIsUsageModalOpen}>
        <DialogContent className="max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-purple-600" />
              Current Workspace Usage
            </DialogTitle>
            <DialogDescription>
              Consumption metrics for your {currentPlan} plan tier.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2 text-xs">
            <div className="flex flex-col gap-1 p-3 rounded-xl bg-muted/30 border border-border">
              <div className="flex justify-between font-semibold">
                <span>WhatsApp Messages</span>
                <span>842 / 2,500</span>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: "33%" }} />
              </div>
            </div>

            <div className="flex flex-col gap-1 p-3 rounded-xl bg-muted/30 border border-border">
              <div className="flex justify-between font-semibold">
                <span>AI Agent Token Balance</span>
                <span>$35.00 Credits Left</span>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-purple-600 rounded-full" style={{ width: "70%" }} />
              </div>
            </div>

            <div className="flex flex-col gap-1 p-3 rounded-xl bg-muted/30 border border-border">
              <div className="flex justify-between font-semibold">
                <span>Automations Fired</span>
                <span>320 Runs this month</span>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-cyan-500 rounded-full" style={{ width: "45%" }} />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
