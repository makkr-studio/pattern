/**
 * @pattern-js/mod-billing — the checkout return pages.
 *
 * The provider redirects the buyer to `successPath` / `cancelPath` the moment
 * payment settles — usually BEFORE the completion webhook has landed and the
 * entitlement role exists. These pages absorb that race instead of lying about
 * it: the success page greets the buyer, polls `billing.status.mine` until the
 * webhook flips `entitled`, then forwards to `next` (the gated page checkout
 * was started from). No provider round-trip, no auth requirement — an
 * anonymous return still gets a truthful thank-you.
 *
 * Apps that want their own pages: move ours (`successPath`/`cancelPath`
 * options) or turn them off (`pages: false`) and serve the paths yourself.
 * Same dark-glass shell as mod-identity's front door, hand-written for the
 * same reason: these pages must work before anything else does.
 */

import { value, z, type OpDefinition, type Workflow } from "@pattern-js/core";
import { BILLING_SERVICE } from "./well-known.js";
import type { BillingService } from "./service.js";

/* ── tiny page kit (mirrors mod-identity/pages/html.ts, deliberately unshared:
      neither mod depends on the other) ─────────────────────────────────── */

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Only relative paths survive as a forward destination (open-redirect guard). */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function layout(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; min-height: 100vh;
         display: grid; place-items: center; background: #0b0d12; color: #e6e9ef; }
  .card { width: min(92vw, 420px); padding: 2rem 2.25rem; border-radius: 16px;
          background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
          backdrop-filter: blur(12px); text-align: center; }
  h1 { font-size: 1.25rem; margin: .5rem 0 .25rem; }
  p { color: #9aa3b2; font-size: .9rem; margin: .25rem 0 1rem; }
  .btn { display: block; width: 100%; margin-top: 1rem; padding: .65rem .75rem;
         border-radius: 10px; border: 1px solid rgba(119,204,255,.4); cursor: pointer;
         background: rgba(119,204,255,.12); color: #7cf; font: inherit; font-weight: 600;
         text-align: center; text-decoration: none; box-sizing: border-box; }
  .btn:hover { background: rgba(119,204,255,.2); }
  .mark { font-size: 2rem; }
  .spin { width: 1.6rem; height: 1.6rem; margin: 0 auto; border-radius: 50%;
          border: 2px solid rgba(119,204,255,.25); border-top-color: #7cf;
          animation: r .8s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
  .hint { font-size: .78rem; color: #5d6676; margin-top: 1.25rem; }
  .brand { font-size: .75rem; letter-spacing: .14em; text-transform: uppercase;
           color: #5d6676; margin-bottom: 1rem; }
  [hidden] { display: none !important; }
</style></head>
<body><div class="card"><div class="brand">⌬ Pattern</div>
${body}
</div></body></html>`;
}

/* ── ops ──────────────────────────────────────────────────────────────── */

function billingService(ctx: { services: Record<string, unknown> }): BillingService {
  const svc = ctx.services[BILLING_SERVICE] as BillingService | undefined;
  if (!svc) throw new Error("mod-billing: billing service missing — install @pattern-js/mod-billing.");
  return svc;
}

/**
 * The caller's OWN entitlement — principal-derived, never a userId parameter,
 * so the public route can't be used to probe other users' subscription state.
 */
export const statusMineOp: OpDefinition = {
  type: "billing.status.mine",
  effects: "pure",
  title: "billing.status.mine",
  description:
    "The CALLING user's entitlement, from the local mapping: { signedIn, entitled, status }. Principal-derived " +
    "(never a userId input), so it's safe on a public route — the success page polls it while the completion " +
    "webhook lands, and any frontend can ask it to decide between 'Upgrade' and 'Manage subscription'.",
  reusable: false,
  config: z.object({}),
  inputs: {},
  outputs: { state: value() },
  execute: async (ctx) => {
    const p = ctx.principal;
    if (p.kind !== "user") return { state: { signedIn: false, entitled: false } };
    const res = await billingService(ctx).entitled({ userId: p.id }, ctx);
    return { state: { signedIn: true, entitled: res.entitled, status: res.status } };
  },
};

/** Success page states: already entitled → 302 to `next`; signed-in → poll until
 *  the webhook flips the mapping; anonymous → a truthful static thank-you. */
export const successPageOp: OpDefinition = {
  type: "billing.success.page",
  effects: "pure",
  title: "billing.success.page",
  description:
    "The checkout landing page. Payment settled, but the completion webhook may still be in flight — so this " +
    "page thanks the buyer and polls billing.status.mine until `entitled` flips, then forwards to `next` " +
    "(guarded to a relative path). Already entitled → an immediate redirect; not signed in → a static thank-you.",
  reusable: false,
  config: z.object({
    /** Where the page's poller asks for entitlement (the status route's path). */
    statusPath: z.string().default("/billing/status"),
  }),
  inputs: { next: value(z.string().optional()) },
  outputs: {
    body: value(z.string().optional()),
    redirect: value(z.string().optional()),
    status: value(z.number().optional()),
  },
  execute: async (ctx) => {
    const cfg = ctx.config as { statusPath: string };
    const rawNext = ctx.input.has("next") ? await ctx.input.value<string>("next") : undefined;
    const next = safeNextPath(rawNext);
    const p = ctx.principal;

    if (p.kind === "user") {
      const { entitled } = await billingService(ctx).entitled({ userId: p.id }, ctx);
      if (entitled) return { body: undefined, redirect: next, status: undefined };
      return {
        body: layout(
          "Payment received",
          `<div class="spin" id="spin"></div>
<h1>Payment received</h1>
<p id="msg">Unlocking your account… this takes a few seconds.</p>
<a class="btn" id="go" href="${escapeHtml(next)}" hidden>Continue</a>
<p class="hint" id="slow" hidden>Taking longer than expected — the payment provider is still
confirming. Your access appears the moment it does; you can also continue and refresh there.</p>
<script>
  const next = ${JSON.stringify(next)}, status = ${JSON.stringify(cfg.statusPath)};
  let tries = 0;
  const tick = async () => {
    try {
      const s = await (await fetch(status, { headers: { accept: "application/json" } })).json();
      if (s && s.entitled) { location.replace(next); return; }
    } catch {}
    if (++tries >= 40) {
      document.getElementById("spin").hidden = true;
      document.getElementById("slow").hidden = false;
      document.getElementById("go").hidden = false;
      return;
    }
    setTimeout(tick, 1500);
  };
  setTimeout(tick, 1200);
</script>`,
        ),
        redirect: undefined,
        status: 200,
      };
    }

    // Anonymous return (checkout started without a session, or another browser):
    // no one to poll for — thank them and point onward.
    return {
      body: layout(
        "Payment received",
        `<div class="mark">✓</div>
<h1>Payment received</h1>
<p>Thank you! Your subscription is being set up. Sign in to pick it up.</p>
<a class="btn" href="${escapeHtml(next)}">Continue</a>`,
      ),
      redirect: undefined,
      status: 200,
    };
  },
};

export const cancelPageOp: OpDefinition = {
  type: "billing.cancel.page",
  effects: "pure",
  title: "billing.cancel.page",
  description:
    "The checkout cancel landing: reassures that no charge was made and points back to `next` (relative-path " +
    "guarded) or home.",
  reusable: false,
  config: z.object({}),
  inputs: { next: value(z.string().optional()) },
  outputs: { body: value(z.string().optional()), status: value(z.number().optional()) },
  execute: async (ctx) => {
    const rawNext = ctx.input.has("next") ? await ctx.input.value<string>("next") : undefined;
    const next = safeNextPath(rawNext);
    return {
      body: layout(
        "Checkout canceled",
        `<div class="mark">↩</div>
<h1>Checkout canceled</h1>
<p>No charge was made. Come back whenever you're ready.</p>
<a class="btn" href="${escapeHtml(next)}">Back</a>`,
      ),
      status: 200,
    };
  },
};

export const pageOps: OpDefinition[] = [statusMineOp, successPageOp, cancelPageOp];

/* ── the routes (identity-style: request decomposed onto pure ops) ────── */

function htmlPage(spec: { id: string; path: string; op: string; config?: Record<string, unknown> }): Workflow {
  const nodes: Workflow["nodes"] = [
    { id: "in", op: "boundary.http.request", config: { method: "GET", path: spec.path } },
    { id: "ex_query", op: "core.object.extract", config: { keys: ["next"] } },
    { id: "call", op: spec.op, ...(spec.config ? { config: spec.config } : {}) },
    { id: "ct", op: "core.const.object", config: { value: { "content-type": "text/html; charset=utf-8" } } },
    { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
  ];
  const edges: Workflow["edges"] = [
    { from: { node: "in", port: "query" }, to: { node: "ex_query", port: "object" } },
    { from: { node: "ex_query", port: "next" }, to: { node: "call", port: "next" } },
    { from: { node: "call", port: "body" }, to: { node: "out", port: "body" } },
    { from: { node: "call", port: "status" }, to: { node: "out", port: "status" } },
    { from: { node: "ct", port: "out" }, to: { node: "out", port: "headers" } },
  ];
  if (spec.op === "billing.success.page") {
    edges.push({ from: { node: "call", port: "redirect" }, to: { node: "out", port: "redirect" } });
  }
  return { id: spec.id, name: `Billing · GET ${spec.path}`, source: "code", nodes, edges };
}

/** The return pages + the status poller. Paths come from the mod options. */
export function billingPageWorkflows(paths: { success: string; cancel: string; status: string }): Workflow[] {
  const statusRoute: Workflow = {
    id: "billing.route.status.mine",
    name: `Billing · GET ${paths.status}`,
    source: "code",
    nodes: [
      { id: "in", op: "boundary.http.request", config: { method: "GET", path: paths.status } },
      { id: "call", op: "billing.status.mine" },
      { id: "status", op: "boundary.http.status" },
      { id: "out", op: "boundary.http.response", config: { mode: "buffered" } },
    ],
    edges: [
      { from: { node: "in", port: "out" }, to: { node: "call", port: "in" } },
      { from: { node: "call", port: "state" }, to: { node: "status", port: "result" } },
      { from: { node: "status", port: "status" }, to: { node: "out", port: "status" } },
      { from: { node: "status", port: "body" }, to: { node: "out", port: "body" } },
    ],
  };
  return [
    htmlPage({ id: "billing.route.success", path: paths.success, op: "billing.success.page", config: { statusPath: paths.status } }),
    htmlPage({ id: "billing.route.cancel", path: paths.cancel, op: "billing.cancel.page" }),
    statusRoute,
  ];
}
