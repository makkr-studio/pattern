import { type LucideIcon, BellRing, CreditCard, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { SectionShell } from "../components/SectionShell";
import { GlassPanel } from "../components/ui";

interface Beat {
  icon: LucideIcon;
  hue: number;
  title: string;
  body: string;
  /** The receipt line — the claim, in terminal voice. */
  receipt: string;
}

const BEATS: Beat[] = [
  {
    icon: CreditCard,
    hue: 120,
    title: "Take money",
    body:
      "Checkout and the customer portal are one node each — Stripe hosts the cards and 3DS. The completion webhook is verified, deduped, and projected into a role, so an active plan becomes a scope and the paid feature is one requireAuth away. The return page even absorbs the webhook race: pay, watch it unlock, land on the feature.",
    receipt: '"requireAuth": { "scopes": ["pro"] }',
  },
  {
    icon: RotateCcw,
    hue: 190,
    title: "Keep promises",
    body:
      "Mark a workflow durable and every node's exact inputs and outputs land in the RunLedger. A failed run resumes from the failing node — completed work is seeded, never re-executed — and provider calls carry idempotency seals, so even a retry can't double-charge. Kill a webhook run mid-flight, fix the bug, resume.",
    receipt: "email.send ×1 — resumed — still ×1",
  },
  {
    icon: BellRing,
    hue: 22,
    title: "Hear about it first",
    body:
      "A run that exhausts its retries emits run.failed, and a seeded, editable workflow emails the operator with a link straight to the failing run. AI usage meters itself into your billing meter the same way — as an ordinary workflow edge you can open and change, not a hook you can't see.",
    receipt: "run.failed → email.send → /admin/runs/:id",
  },
];

/** 0.5: everything a product needs the day it starts taking money. */
export function OpenForBusiness() {
  return (
    <SectionShell
      id="business"
      eyebrow="Open for business"
      title="Take money. Keep promises."
      subtitle="Payments demand durability — so they shipped together. Billing that turns subscriptions into scopes, durable execution that resumes instead of repeating, and failure alerts that reach you before your customers do."
    >
      <div className="grid gap-5 lg:grid-cols-3">
        {BEATS.map((b, i) => (
          <motion.div
            key={b.title}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.4, delay: i * 0.08 }}
          >
            <GlassPanel className="flex h-full flex-col p-7">
              <div
                className="grid h-10 w-10 place-items-center rounded-xl"
                style={{ background: `hsl(${b.hue} 80% 60% / 0.16)`, color: `hsl(${b.hue} 80% 72%)` }}
              >
                <b.icon size={19} />
              </div>
              <h3 className="mt-4 text-lg font-semibold">{b.title}</h3>
              <p className="mt-2 flex-1 text-sm text-muted">{b.body}</p>
              <div
                className="mt-5 overflow-x-auto whitespace-nowrap rounded-lg px-3 py-2 font-mono text-xs"
                style={{ background: `hsl(${b.hue} 80% 60% / 0.08)`, color: `hsl(${b.hue} 60% 70%)`, border: `1px solid hsl(${b.hue} 80% 60% / 0.2)` }}
              >
                {b.receipt}
              </div>
            </GlassPanel>
          </motion.div>
        ))}
      </div>
      <p className="mt-8 text-center text-sm text-muted">
        Scaffold it wired: <span className="font-mono text-xs">npm create pattern@latest my-saas</span> — the{" "}
        <span className="font-semibold">SaaS starter</span> ships sign-in, Stripe billing, a gated members area, and
        durable payment workflows, with a five-minute walkthrough to your first test subscription.
      </p>
    </SectionShell>
  );
}
