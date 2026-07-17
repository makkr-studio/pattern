/**
 * @pattern-js/mod-billing — the Tier-2 "Billing" admin page.
 *
 * Same construction as mod-email's page: the ESM SOURCE of the component,
 * written against the shared `__PATTERN_ADMIN__` global. Four panels:
 *
 *  1. The SETUP CHECKLIST — how far this installation is from its first
 *     subscription, each unmet step with the exact next action (dashboard
 *     step, the `stripe listen` command with the real forward URL, the test
 *     card). "Last event received" closes the loop: when the webhook lands,
 *     the row flips green in front of the operator.
 *  2. Accounts — driver-spec-driven form (per-field secret refs from vault or
 *     env, options incl. the default price), click an account to EDIT it.
 *  3. Customers — the user ↔ provider mapping the webhooks maintain.
 *  4. Recent events — what the provider actually delivered.
 */

export const REMOTE = `
const { React, api, ui } = globalThis.__PATTERN_ADMIN__;
const { GlassPanel, NeonButton, Badge } = ui;
const h = React.createElement;
const inputCls = "glass w-full rounded-lg px-3 py-2 text-sm";

function Field({ label, hint, children }) {
  return h("label", { className: "block text-sm space-y-1" },
    h("span", { className: "text-muted" }, label),
    children,
    hint && h("span", { className: "block text-xs text-muted/70" }, hint));
}

function arr(r, key) { return Array.isArray(r) ? r : ((r && r[key]) || []); }
function obj(r, key) { return (r && typeof r === "object" && !Array.isArray(r) && key in r) ? r[key] : r; }

function ago(ts) {
  if (!ts) return "";
  var s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return Math.round(s) + "s ago";
  if (s < 5400) return Math.round(s / 60) + "m ago";
  if (s < 129600) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

// ── The setup checklist ──────────────────────────────────────────────────
function Checklist({ status }) {
  if (!status) return null;
  var a = status.account;
  var steps = [
    { ok: (status.drivers || []).length > 0, label: "A billing driver is installed",
      how: "Install one and list it in pattern.config.json — e.g. @pattern-js/mod-billing-stripe (or run: pattern add billing)." },
    { ok: Boolean(a), label: "An account exists",
      how: 'Save the form below as "default" — the ops and the starter workflows fall back to it.' },
    { ok: Boolean(a) && a.missingSecrets.length === 0, label: "API key connected",
      how: "Stripe dashboard (TEST mode) → Developers → API keys: put sk_test_… in .env as STRIPE_API_KEY, then set the account's apiKey to env / STRIPE_API_KEY." },
    { ok: Boolean(a && a.defaultPriceKey), label: "A price to sell",
      how: "Create a product with a recurring price (test mode) and paste its price_… id into the account's Default price field." },
    { ok: Boolean(a && a.hasWebhookSecret), label: "Webhook secret set",
      how: "Run: stripe listen --forward-to " + status.webhookUrl + "  — copy the printed whsec_… into .env as STRIPE_WEBHOOK_SECRET and set the account's webhookSecret to env / STRIPE_WEBHOOK_SECRET." },
    { ok: Boolean(status.lastEvent), label: "First event received",
      how: "Subscribe on your landing page with the test card 4242 4242 4242 4242 (any future date/CVC) — or fire one with: stripe trigger checkout.session.completed.",
      detail: status.lastEvent ? String(status.lastEvent.kind) + " · " + ago(status.lastEvent.at) : null },
  ];
  var done = steps.filter(function (s) { return s.ok; }).length;
  var next = steps.find(function (s) { return !s.ok; });
  return h(GlassPanel, { className: "p-6 space-y-3" },
    h("div", { className: "flex items-center justify-between" },
      h("h3", { className: "font-semibold" }, "From zero to your first subscription"),
      h(Badge, { hue: done === steps.length ? 140 : 45 }, done + "/" + steps.length)),
    done === steps.length
      ? h("p", { className: "text-sm", style: { color: "var(--color-neon-lime)" } },
          "✓ Fully wired — money in, roles out. Cancel flows, renewals and failures all land as events below.")
      : null,
    h("div", { className: "space-y-2" }, steps.map(function (s, i) {
      var active = s === next;
      return h("div", { key: i, className: "rounded-lg px-3 py-2 " + (active ? "bg-white/5" : "") },
        h("div", { className: "flex items-center gap-2 text-sm" },
          h("span", { style: { color: s.ok ? "var(--color-neon-lime)" : active ? "var(--color-neon-amber)" : "var(--color-muted)" } }, s.ok ? "✓" : active ? "→" : "○"),
          h("span", { className: s.ok ? "" : active ? "font-medium" : "text-muted" }, s.label),
          s.detail && h("span", { className: "text-xs text-muted font-mono" }, s.detail)),
        !s.ok && active && h("p", { className: "mt-1 pl-6 text-xs text-muted", style: { userSelect: "text" } }, s.how));
    })),
    !status.publicUrlSet && h("p", { className: "text-xs text-muted/70" },
      "Behind a proxy or deployed? Set PATTERN_PUBLIC_URL so checkout redirects and the webhook URL use your real origin."));
}

// ── One secret field: vault|env source + key (the email page's control) ──
function SecretRow({ field, refValue, secrets, onChange }) {
  const src = (refValue && refValue.source) || "env";
  const key = (refValue && refValue.key) || "";
  const set = (patch) => onChange({ source: src, key, ...patch });
  const vaultPicker = h("select", { className: inputCls, value: key, onChange: (e) => set({ key: e.target.value }) },
    h("option", { value: "" }, "— pick a vault secret —"),
    secrets.map((s) => h("option", { key: s, value: s }, s)),
    key && secrets.indexOf(key) < 0 ? h("option", { key: key, value: key }, key + " (missing)") : null);
  const envInput = h("input", { className: inputCls, value: key, placeholder: "ENV_VAR_NAME", onChange: (e) => set({ key: e.target.value }) });
  return h(Field, { key: field.field, label: "Secret · " + (field.label || field.field) + (field.required === false ? " (optional)" : "") },
    h("div", { className: "flex gap-2" },
      h("select", { className: "glass rounded-lg px-2 py-2 text-sm", style: { width: "5.5rem" }, value: src, onChange: (e) => set({ source: e.target.value }) },
        h("option", { value: "env" }, "env"),
        h("option", { value: "vault" }, "vault")),
      h("div", { className: "flex-1" }, src === "env" ? envInput : vaultPicker)));
}

// ── The account form (create + edit — same form, prefilled on edit) ─────
function AccountForm({ providers, secrets, form, setForm, reload }) {
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const blank = { name: "", provider: (providers[0] && providers[0].id) || "", secrets: {}, options: {} };
  const spec = providers.find((p) => p.id === form.provider) || providers[0] || { secrets: [], options: [] };

  function pickProvider(id) { setForm({ ...form, provider: id, secrets: {}, options: {} }); }
  function setSecret(field, refValue) { setForm({ ...form, secrets: { ...form.secrets, [field]: refValue } }); }
  function setOption(field, val) { setForm({ ...form, options: { ...form.options, [field]: val } }); }

  function payload() {
    const s = {};
    for (const k of Object.keys(form.secrets)) { const v = form.secrets[k]; if (v && v.key) s[k] = { source: v.source || "env", key: v.key }; }
    const o = {};
    for (const k of Object.keys(form.options)) { if (form.options[k]) o[k] = form.options[k]; }
    return { name: form.name, provider: form.provider || (spec && spec.id) || "", secrets: s, options: o };
  }
  function save() {
    setBusy(true); setSaved(false);
    api.call("POST", "/billing/api/accounts", payload())
      .then(() => { setSaved(true); reload(); })
      .finally(() => setBusy(false));
  }

  return h(GlassPanel, { className: "p-6 space-y-4" },
    h("div", null,
      h("h3", { className: "font-semibold" }, form.editing ? "Edit account · " + form.name : "New account"),
      h("p", { className: "text-xs text-muted mt-1" },
        'The "default" account is what the checkout/portal workflows use. Secrets are references — the values stay in .env or the vault, never in this config.')),
    h("div", { className: "space-y-3" },
      h(Field, { label: "Account name" },
        h("input", { className: inputCls, value: form.name, disabled: Boolean(form.editing), onChange: (e) => setForm({ ...form, name: e.target.value }), placeholder: "default" })),
      h(Field, { label: "Provider" },
        h("select", { className: inputCls, value: form.provider || (spec && spec.id) || "", onChange: (e) => pickProvider(e.target.value) },
          providers.map((p) => h("option", { key: p.id, value: p.id }, p.label)))),
      ((spec && spec.secrets) || []).map((f) => h(SecretRow, { key: f.field, field: f, refValue: form.secrets[f.field], secrets: secrets, onChange: (refValue) => setSecret(f.field, refValue) })),
      ((spec && spec.options) || []).map((f) => h(Field, { key: f.field, label: (f.label || f.field) + (f.required ? "" : " (optional)") },
        h("input", { className: inputCls, value: form.options[f.field] || "", placeholder: f.placeholder || "", onChange: (e) => setOption(f.field, e.target.value) }))),
      h("div", { className: "flex items-center gap-3 pt-1" },
        h(NeonButton, { onClick: save, disabled: busy || !form.name }, busy ? "Saving…" : form.editing ? "Save changes" : "Create account"),
        form.editing && h(NeonButton, { onClick: () => setForm(blank) }, "New account"),
        saved && h("span", { className: "text-xs", style: { color: "var(--color-neon-lime)" } }, "✓ saved"))));
}

function AccountList({ accounts, onEdit, reload }) {
  function del(name) { api.call("DELETE", "/billing/api/accounts/" + encodeURIComponent(name)).then(reload); }
  if (accounts.length === 0) return null;
  return h(GlassPanel, { className: "p-6 space-y-3" },
    h("h3", { className: "font-semibold" }, "Accounts"),
    h("div", { className: "space-y-1" }, accounts.map((a) =>
      h("div", { key: a.name, className: "flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/5" },
        h("button", { className: "text-left text-sm flex-1 min-w-0", onClick: () => onEdit(a), title: "Edit" },
          h(Badge, { hue: a.name === "default" ? 140 : 200 }, a.name), " ",
          h("span", { className: "font-mono text-xs text-muted" },
            a.provider + ((a.options && a.options.defaultPriceKey) ? " · " + a.options.defaultPriceKey : " · no default price"))),
        h("button", { className: "text-xs text-muted hover:text-[var(--color-neon-pink)] shrink-0", onClick: () => del(a.name) }, "Delete")))));
}

// ── Simple data tables (customers / events) ─────────────────────────────
function DataTable({ title, empty, cols, rows }) {
  return h(GlassPanel, { className: "p-6 space-y-3" },
    h("h3", { className: "font-semibold" }, title),
    rows.length === 0
      ? h("p", { className: "text-sm text-muted" }, empty)
      : h("div", { className: "overflow-x-auto" },
          h("table", { className: "w-full text-sm" },
            h("thead", null, h("tr", { className: "text-left text-xs text-muted" }, cols.map((c) => h("th", { key: c.key, className: "py-1 pr-4 font-normal" }, c.label)))),
            h("tbody", null, rows.map((r, i) =>
              h("tr", { key: i, className: "border-t border-white/5" },
                cols.map((c) => h("td", { key: c.key, className: "py-1.5 pr-4 font-mono text-xs" }, String(r[c.key] == null ? "—" : r[c.key])))))))));
}

export default function BillingPage() {
  const blank = { name: "", provider: "", secrets: {}, options: {} };
  const [status, setStatus] = React.useState(null);
  const [providers, setProviders] = React.useState([]);
  const [secrets, setSecrets] = React.useState([]);
  const [accounts, setAccounts] = React.useState([]);
  const [customers, setCustomers] = React.useState([]);
  const [events, setEvents] = React.useState([]);
  const [form, setForm] = React.useState(blank);

  const reload = () => Promise.all([
    api.call("GET", "/billing/api/status").then((r) => setStatus(obj(r, "status"))),
    api.call("GET", "/billing/api/accounts").then((r) => setAccounts(arr(r, "accounts"))),
    api.call("GET", "/billing/api/customers").then((r) => setCustomers(arr(r, "customers"))),
    api.call("GET", "/billing/api/events").then((r) => setEvents(arr(r, "events"))),
  ]).catch(() => {});

  React.useEffect(() => {
    api.call("GET", "/billing/api/providers").then((r) => setProviders(arr(r, "providers"))).catch(() => {});
    api.call("GET", "/vault/secrets").then((r) => setSecrets(arr(r, "secrets").map((s) => (typeof s === "string" ? s : s.name)))).catch(() => {});
    reload();
    // The checklist's payoff: the "first event" row flips while you watch.
    const t = setInterval(() => { api.call("GET", "/billing/api/status").then((r) => setStatus(obj(r, "status"))).catch(() => {}); }, 5000);
    return () => clearInterval(t);
  }, []);

  function edit(a) { setForm({ name: a.name, provider: a.provider, secrets: { ...(a.secrets || {}) }, options: { ...(a.options || {}) }, editing: true }); }

  if (providers.length === 0) {
    return h(GlassPanel, { className: "p-6 space-y-2" },
      h("h3", { className: "font-semibold" }, "No billing drivers installed"),
      h("p", { className: "text-sm text-muted" },
        "mod-billing is the contract; a driver mod talks to the processor. Install ",
        h("span", { className: "font-mono" }, "@pattern-js/mod-billing-stripe"),
        " and list it in pattern.config.json (or run ", h("span", { className: "font-mono" }, "pattern add billing"),
        "), then reload this page."));
  }

  return h("div", { className: "space-y-6" },
    h(Checklist, { status }),
    h("div", { className: "grid gap-6 lg:grid-cols-2" },
      h(AccountForm, { providers, secrets, form, setForm, reload }),
      h(AccountList, { accounts, onEdit: edit, reload })),
    h(DataTable, {
      title: "Customers", empty: "No customers yet — they appear when the first checkout completes.",
      cols: [
        { key: "userId", label: "User" }, { key: "customerId", label: "Customer" }, { key: "status", label: "Status" },
        { key: "priceKeys", label: "Prices" }, { key: "entitled", label: "Entitled" }, { key: "updatedAt", label: "Updated" },
      ],
      rows: customers,
    }),
    h(DataTable, {
      title: "Recent events", empty: "Nothing delivered yet — this fills the moment stripe listen forwards the first webhook.",
      cols: [
        { key: "at", label: "At" }, { key: "kind", label: "Kind" }, { key: "eventId", label: "Event" }, { key: "account", label: "Account" },
      ],
      rows: events,
    }));
}
`;
