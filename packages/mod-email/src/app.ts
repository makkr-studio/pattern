/**
 * @pattern-js/mod-email — the Tier-2 "Email" admin page.
 *
 * Just the ESM SOURCE of the page (default export = the component), written
 * against the shared `__PATTERN_ADMIN__` global (React, the API client, the
 * glass UI kit) — the admin's exact stack, no bundler. It manages ACCOUNTS:
 * a name + a driver (which drives the secret + option fields), a From address,
 * each secret from the vault or an env var — plus a Test that sends a REAL
 * email so the operator sees end-to-end delivery, not a wiring check. The
 * "default" account is what the packaged sign-in delivery workflow uses.
 */

export const REMOTE = `
const { React, api, ui } = globalThis.__PATTERN_ADMIN__;
const { GlassPanel, NeonButton, Badge, Modal } = ui;
const h = React.createElement;
const inputCls = "glass w-full rounded-lg px-3 py-2 text-sm";

function Field({ label, hint, children }) {
  return h("label", { className: "block text-sm space-y-1" },
    h("span", { className: "text-muted" }, label),
    children,
    hint && h("span", { className: "block text-xs text-muted/70" }, hint));
}

// Normalize an api.call result that may be the array directly or { key: [...] }.
function arr(r, key) { return Array.isArray(r) ? r : ((r && r[key]) || []); }

// One secret field: a vault|env source toggle + the matching key picker/input.
function SecretRow({ field, refValue, secrets, onChange }) {
  const src = (refValue && refValue.source) || "vault";
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
        h("option", { value: "vault" }, "vault"),
        h("option", { value: "env" }, "env")),
      h("div", { className: "flex-1" }, src === "env" ? envInput : vaultPicker)));
}

// The Test flow: sends a REAL email to an operator-supplied address.
function TestModal({ state, setState }) {
  const [to, setTo] = React.useState("");
  if (!state) return null;
  const result = state.result;
  function run() {
    setState({ payload: state.payload, busy: true });
    api.call("POST", "/email/test", { ...state.payload, to })
      .then((r) => setState({ payload: state.payload, result: r }))
      .catch((e) => setState({ payload: state.payload, result: { ok: false, detail: String(e) } }));
  }
  return h(Modal, { open: true, onClose: () => setState(null), title: "Send a test email" },
    h("div", { className: "space-y-3" },
      h("p", { className: "text-xs text-muted" },
        "Sends a REAL email through this account so you can verify end-to-end delivery — driver, credentials, From address and inbox placement in one go."),
      h(Field, { label: "Send to" },
        h("input", { className: inputCls, type: "email", value: to, placeholder: "you@example.com", onChange: (e) => setTo(e.target.value) })),
      h("div", { className: "flex items-center gap-3" },
        h(NeonButton, { onClick: run, disabled: state.busy || !to }, state.busy ? "Sending…" : "Send test email")),
      result && h("div", { className: "space-y-2" },
        h("p", { className: "text-sm font-medium", style: { color: result.ok ? "var(--color-neon-lime)" : "var(--color-neon-pink)" } },
          result.ok ? "✓ Sent — check the inbox." + (result.messageId ? " (id " + result.messageId + ")" : "") : "✗ Failed"),
        !result.ok && h("pre", { className: "glass rounded-lg p-3 text-xs whitespace-pre-wrap", style: { maxHeight: "16rem", overflow: "auto" } }, result.detail || "unknown error"))));
}

// The form that creates/edits one account.
function AccountForm({ providers, secrets, form, setForm, reload, onTest }) {
  const [busy, setBusy] = React.useState(false);
  const blank = { name: "", provider: (providers[0] && providers[0].id) || "", from: "", secrets: {}, options: {} };
  const spec = providers.find((p) => p.id === form.provider) || providers[0] || { secrets: [], options: [] };

  function pickProvider(id) { setForm({ ...form, provider: id, secrets: {}, options: {} }); }
  function setSecret(field, refValue) { setForm({ ...form, secrets: { ...form.secrets, [field]: refValue } }); }
  function setOption(field, val) { setForm({ ...form, options: { ...form.options, [field]: val } }); }

  // Drop empty secret rows so we never persist a sourceless reference.
  function payload() {
    const s = {};
    for (const k of Object.keys(form.secrets)) { const v = form.secrets[k]; if (v && v.key) s[k] = { source: v.source || "vault", key: v.key }; }
    const provider = form.provider || (spec && spec.id) || "";
    return { name: form.name, provider, from: form.from, secrets: s, options: form.options };
  }
  function save() {
    setBusy(true);
    api.call("POST", "/email/accounts", payload()).then(() => { setForm(blank); reload(); }).finally(() => setBusy(false));
  }

  return h(GlassPanel, { className: "p-6 space-y-4" },
    h("div", null,
      h("h3", { className: "font-semibold" }, form.name ? "Edit account" : "New account"),
      h("p", { className: "text-xs text-muted mt-1" },
        "An account is a named sender — a driver, a From address and the credentials it needs. Wire one with an ",
        h("span", { className: "font-mono" }, "email.account"),
        " node, or leave a node's account unset and the ", h("span", { className: "font-mono" }, "default"),
        " account is used. The packaged sign-in delivery workflow emails magic links the moment a default account exists.")),
    h("div", { className: "space-y-3" },
      h(Field, { label: "Account name", hint: 'the "default" account powers sign-in link delivery.' },
        h("input", { className: inputCls, value: form.name, onChange: (e) => setForm({ ...form, name: e.target.value }), placeholder: "default" })),
      h(Field, { label: "Driver" },
        h("select", { className: inputCls, value: form.provider || (spec && spec.id) || "", onChange: (e) => pickProvider(e.target.value) },
          providers.map((p) => h("option", { key: p.id, value: p.id }, p.label)))),
      h(Field, { label: "From", hint: "the default sender; email.send's from input overrides per message." },
        h("input", { className: inputCls, value: form.from, onChange: (e) => setForm({ ...form, from: e.target.value }), placeholder: "App <hello@example.com>" })),
      ((spec && spec.secrets) || []).map((f) => h(SecretRow, { key: f.field, field: f, refValue: form.secrets[f.field], secrets: secrets, onChange: (refValue) => setSecret(f.field, refValue) })),
      ((spec && spec.options) || []).map((f) => h(Field, { key: f.field, label: (f.label || f.field) + (f.required ? "" : " (optional)") },
        h("input", { className: inputCls, value: form.options[f.field] || "", placeholder: f.placeholder || "", onChange: (e) => setOption(f.field, e.target.value) }))),
      h("div", { className: "flex items-center gap-3 pt-1" },
        h(NeonButton, { onClick: save, disabled: busy || !form.name || !form.from }, "Save account"),
        h(NeonButton, { onClick: () => onTest(payload()), disabled: busy || !form.from }, "Test"),
        form.name && h(NeonButton, { onClick: () => setForm(blank) }, "New")),
      h("p", { className: "text-xs text-muted" }, "Secrets come from the vault (System → Secrets) or an env var — pick the source per field.")));
}

// The list of saved accounts (click to edit, delete).
function AccountList({ accounts, onEdit, reload }) {
  function del(name) { api.call("DELETE", "/email/accounts/" + encodeURIComponent(name)).then(reload); }
  return h(GlassPanel, { className: "p-6 space-y-3" },
    h("div", { className: "flex items-center justify-between" },
      h("h3", { className: "font-semibold" }, "Accounts"),
      h("span", { className: "text-xs text-muted" }, accounts.length + " configured")),
    accounts.length === 0
      ? h("p", { className: "text-sm text-muted" }, 'No accounts yet. Create one named "default" and sign-in links start emailing automatically.')
      : h("div", { className: "space-y-1" }, accounts.map((a) =>
          h("div", { key: a.name, className: "flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/5" },
            h("button", { className: "text-left text-sm flex-1 min-w-0", onClick: () => onEdit(a) },
              h(Badge, { hue: a.name === "default" ? 140 : 200 }, a.name), " ",
              h("span", { className: "font-mono text-xs text-muted" }, a.provider + " · " + a.from)),
            h("button", { className: "text-xs text-muted hover:text-[var(--color-neon-pink)] shrink-0", onClick: () => del(a.name) }, "Delete")))));
}

export default function EmailPage() {
  const blank = { name: "", provider: "", from: "", secrets: {}, options: {} };
  const [providers, setProviders] = React.useState([]);
  const [secrets, setSecrets] = React.useState([]);
  const [accounts, setAccounts] = React.useState([]);
  const [form, setForm] = React.useState(blank);
  const [test, setTest] = React.useState(null);

  const reloadAccounts = () => api.call("GET", "/email/accounts").then((r) => setAccounts(arr(r, "accounts")));

  React.useEffect(() => {
    api.call("GET", "/email/providers").then((r) => setProviders(arr(r, "providers"))).catch(() => {});
    api.call("GET", "/vault/secrets").then((r) => setSecrets(arr(r, "secrets").map((s) => (typeof s === "string" ? s : s.name)))).catch(() => {});
    reloadAccounts().catch(() => {});
  }, []);

  function edit(a) { setForm({ name: a.name, provider: a.provider, from: a.from, secrets: { ...(a.secrets || {}) }, options: { ...(a.options || {}) } }); }
  function reloadAndReset() { reloadAccounts(); setForm(blank); }

  if (providers.length === 0) {
    return h(GlassPanel, { className: "p-6 space-y-2" },
      h("h3", { className: "font-semibold" }, "No email drivers installed"),
      h("p", { className: "text-sm text-muted" },
        "mod-email is the contract; a driver mod does the sending. Install ",
        h("span", { className: "font-mono" }, "@pattern-js/mod-email-resend"),
        " or ", h("span", { className: "font-mono" }, "@pattern-js/mod-email-smtp"),
        " and list it in pattern.config.json, then reload this page."));
  }

  return h("div", null,
    h("div", { className: "grid gap-6 lg:grid-cols-2" },
      h(AccountForm, { providers, secrets, form, setForm, reload: reloadAndReset, onTest: (payload) => setTest({ payload }) }),
      h(AccountList, { accounts, onEdit: edit, reload: reloadAccounts })),
    h(TestModal, { state: test, setState: setTest }));
}
`;
