/**
 * @pattern-js/mod-ai — the Tier-2 "AI Providers" admin page.
 *
 * Just the ESM SOURCE of the page (default export = the component), written
 * against the shared `__PATTERN_ADMIN__` global (React, the API client, the glass
 * UI kit) — the admin's exact stack, no bundler. mod-ai contributes this string
 * as `pages: [{ module: REMOTE }]`; the admin serves it same-origin and imports
 * it (no workflow, no asset mount). It manages ALIASES: a name + a provider
 * (which drives the secret + option fields), each secret from the vault or an env
 * var, plus a Test check. agents/chat resolve the "default" alias at run time.
 */

export const REMOTE = `
const { React, api, ui } = globalThis.__PATTERN_ADMIN__;
const { GlassPanel, NeonButton, Badge, Modal } = ui;
const h = React.createElement;
const inputCls = "glass w-full rounded-lg px-3 py-2 text-sm";
const MODALITIES = ["language", "embedding", "image", "speech", "transcription", "video"];

function Field({ label, hint, children }) {
  return h("label", { className: "block text-sm space-y-1" },
    h("span", { className: "text-muted" }, label),
    children,
    hint && h("span", { className: "block text-xs text-muted/70" }, hint));
}

// Normalize an api.call result that may be the array directly or { key: [...] }.
function arr(r, key) { return Array.isArray(r) ? r : ((r && r[key]) || []); }

// One secret field: a vault|env source toggle + the matching key picker/input.
function SecretRow({ field, ref, secrets, onChange }) {
  const src = (ref && ref.source) || "vault";
  const key = (ref && ref.key) || "";
  const set = (patch) => onChange({ source: src, key, ...patch });
  const vaultPicker = h("select", { className: inputCls, value: key, onChange: (e) => set({ key: e.target.value }) },
    h("option", { value: "" }, "— pick a vault secret —"),
    secrets.map((s) => h("option", { key: s, value: s }, s)),
    key && secrets.indexOf(key) < 0 ? h("option", { key: key, value: key }, key + " (missing)") : null);
  const envInput = h("input", { className: inputCls, value: key, placeholder: "ENV_VAR_NAME", onChange: (e) => set({ key: e.target.value }) });
  return h(Field, { key: field.name, label: "Secret · " + (field.label || field.name) + (field.required ? "" : " (optional)") },
    h("div", { className: "flex gap-2" },
      h("select", { className: "glass rounded-lg px-2 py-2 text-sm", style: { width: "5.5rem" }, value: src, onChange: (e) => set({ source: e.target.value }) },
        h("option", { value: "vault" }, "vault"),
        h("option", { value: "env" }, "env")),
      h("div", { className: "flex-1" }, src === "env" ? envInput : vaultPicker)));
}

// The catalog (static suggestions + live gateway) as model-id hints for the current provider+modality.
function suggestionsFor(models, provider, modality) {
  const want = provider === "gateway" ? (m) => m.routing === "gateway" : (m) => m.provider === provider;
  return (models || []).filter((m) => want(m) && (!modality || (m.modalities || []).indexOf(modality) >= 0)).map((m) => m.id);
}

function TestModal({ state, onClose }) {
  if (!state) return null;
  const ok = state.result && state.result.ok;
  return h(Modal, { open: true, onClose, title: "Connection check" },
    h("div", { className: "space-y-3" },
      h("p", { className: "text-xs text-muted" }, "Checks configuration only: resolves the secret(s) and builds the provider. It does not call the provider's API, so it can't catch a wrong or expired key."),
      state.busy
        ? h("p", { className: "text-sm" }, "Checking…")
        : h("div", { className: "space-y-2" },
            h("p", { className: "text-sm font-medium", style: { color: ok ? "var(--color-neon-lime)" : "var(--color-neon-pink)" } },
              ok ? "✓ Wiring OK — secrets resolve and the provider builds." : "✗ Failed"),
            !ok && state.result && h("pre", { className: "glass rounded-lg p-3 text-xs whitespace-pre-wrap", style: { maxHeight: "16rem", overflow: "auto" } }, state.result.detail || "unknown error"))));
}

// The form that creates/edits one alias.
function AliasForm({ providers, secrets, models, form, setForm, reload, onTest }) {
  const [busy, setBusy] = React.useState(false);
  const blank = { name: "", provider: "gateway", modelId: "", modality: "language", secrets: {}, options: {} };
  const spec = providers.find((p) => p.id === form.provider) || { secrets: [{ name: "apiKey" }], options: [], modalities: MODALITIES, optional: false, pkg: "" };

  function pickProvider(id) {
    const p = providers.find((x) => x.id === id);
    const mods = (p && p.modalities) || MODALITIES;
    setForm({ ...form, provider: id, secrets: {}, options: {}, modality: mods.indexOf(form.modality) >= 0 ? form.modality : mods[0] });
  }
  function setSecret(field, ref) { setForm({ ...form, secrets: { ...form.secrets, [field]: ref } }); }
  function setOption(field, val) { setForm({ ...form, options: { ...form.options, [field]: val } }); }

  // Drop empty secret rows so we never persist a sourceless reference.
  function payload() {
    const s = {};
    for (const k of Object.keys(form.secrets)) { const v = form.secrets[k]; if (v && v.key) s[k] = { source: v.source || "vault", key: v.key }; }
    return { name: form.name, provider: form.provider, modelId: form.modelId, modality: form.modality, secrets: s, options: form.options };
  }
  function save() {
    setBusy(true);
    api.call("POST", "/ai/aliases", payload()).then(() => { setForm(blank); reload(); }).finally(() => setBusy(false));
  }

  const mods = spec.modalities || MODALITIES;
  const suggestions = suggestionsFor(models, form.provider, form.modality);
  return h(GlassPanel, { className: "p-6 space-y-4" },
    h("div", null,
      h("h3", { className: "font-semibold" }, form.name ? "Edit alias" : "New alias"),
      h("p", { className: "text-xs text-muted mt-1" },
        "An alias is a named model — a provider, a model id and the keys it needs. Wire one with an ", h("span", { className: "font-mono" }, "ai.alias"),
        " node, or leave a node's model unset and the ", h("span", { className: "font-mono" }, "default"),
        " alias is used. Re-point an alias here and every workflow and agent using it retargets instantly.")),
    h("div", { className: "space-y-3" },
      h(Field, { label: "Alias name", hint: "the default alias is the fallback when no model is wired." },
        h("input", { className: inputCls, value: form.name, onChange: (e) => setForm({ ...form, name: e.target.value }), placeholder: "default" })),
      h(Field, { label: "Provider", hint: spec.optional && spec.pkg ? "needs " + spec.pkg : "the AI Gateway is built in" },
        h("select", { className: inputCls, value: form.provider, onChange: (e) => pickProvider(e.target.value) },
          providers.map((p) => h("option", { key: p.id, value: p.id }, p.label)))),
      h(Field, { label: "Model id", hint: form.provider === "gateway" ? "gateway: provider/model (openai/gpt-5)" : "direct: bare id (gpt-5)" },
        h("input", { className: inputCls, list: "ai-model-suggestions", value: form.modelId, onChange: (e) => setForm({ ...form, modelId: e.target.value }), placeholder: form.provider === "gateway" ? "openai/gpt-5" : "gpt-5" }),
        h("datalist", { id: "ai-model-suggestions" }, suggestions.map((id) => h("option", { key: id, value: id })))),
      h("p", { className: "text-xs text-muted/70" },
        "Browse ids: ",
        h("a", { href: "https://vercel.com/ai-gateway/models", target: "_blank", rel: "noreferrer", className: "underline hover:text-[var(--color-neon-cyan)]" }, "gateway models"),
        " · ",
        h("a", { href: "https://ai-sdk.dev/providers/ai-sdk-providers", target: "_blank", rel: "noreferrer", className: "underline hover:text-[var(--color-neon-cyan)]" }, "provider packages")),
      (spec.secrets || []).map((f) => h(SecretRow, { key: f.name, field: f, ref: form.secrets[f.name], secrets: secrets, onChange: (ref) => setSecret(f.name, ref) })),
      (spec.options || []).map((f) => h(Field, { key: f.name, label: (f.label || f.name) + (f.required ? "" : " (optional)") },
        h("input", { className: inputCls, value: form.options[f.name] || "", placeholder: f.placeholder || "", onChange: (e) => setOption(f.name, e.target.value) }))),
      h(Field, { label: "Modality" },
        h("select", { className: inputCls, value: form.modality, onChange: (e) => setForm({ ...form, modality: e.target.value }) },
          mods.map((m) => h("option", { key: m, value: m }, m)))),
      h("div", { className: "flex items-center gap-3 pt-1" },
        h(NeonButton, { onClick: save, disabled: busy || !form.name || !form.modelId }, "Save alias"),
        h(NeonButton, { onClick: () => onTest(payload()), disabled: busy || !form.modelId }, "Test"),
        form.name && h(NeonButton, { onClick: () => setForm(blank) }, "New")),
      h("p", { className: "text-xs text-muted" }, "Secrets come from the vault (System → Secrets) or an env var — pick the source per field.")));
}

// The list of saved aliases (click to edit, delete).
function AliasList({ aliases, onEdit, reload }) {
  function del(name) { api.call("DELETE", "/ai/aliases/" + encodeURIComponent(name)).then(reload); }
  return h(GlassPanel, { className: "p-6 space-y-3" },
    h("div", { className: "flex items-center justify-between" },
      h("h3", { className: "font-semibold" }, "Aliases"),
      h("span", { className: "text-xs text-muted" }, aliases.length + " configured")),
    aliases.length === 0
      ? h("p", { className: "text-sm text-muted" }, "No aliases yet. Create a default to power agents and chat.")
      : h("div", { className: "space-y-1" }, aliases.map((a) =>
          h("div", { key: a.name, className: "flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/5" },
            h("button", { className: "text-left text-sm flex-1 min-w-0", onClick: () => onEdit(a) },
              h(Badge, { hue: a.name === "default" ? 140 : 200 }, a.name), " ",
              h("span", { className: "font-mono text-xs text-muted" }, a.provider + " · " + a.modelId)),
            h("button", { className: "text-xs text-muted hover:text-[var(--color-neon-pink)] shrink-0", onClick: () => del(a.name) }, "Delete")))));
}

export default function AIProvidersPage() {
  const blank = { name: "", provider: "gateway", modelId: "", modality: "language", secrets: {}, options: {} };
  const [providers, setProviders] = React.useState([]);
  const [secrets, setSecrets] = React.useState([]);
  const [aliases, setAliases] = React.useState([]);
  const [models, setModels] = React.useState([]);
  const [form, setForm] = React.useState(blank);
  const [test, setTest] = React.useState(null);

  const reloadAliases = () => api.call("GET", "/ai/aliases").then((r) => setAliases(arr(r, "aliases")));

  React.useEffect(() => {
    api.call("GET", "/ai/providers").then((r) => setProviders(arr(r, "providers"))).catch(() => {});
    api.call("GET", "/vault/secrets").then((r) => setSecrets(arr(r, "secrets").map((s) => (typeof s === "string" ? s : s.name)))).catch(() => {});
    reloadAliases().catch(() => {});
    api.call("GET", "/ai/models").then((r) => setModels(arr(r, "models"))).catch(() => setModels([]));
  }, []);

  function runTest(payload) {
    setTest({ busy: true });
    api.call("POST", "/ai/test", payload)
      .then((r) => setTest({ busy: false, result: r }))
      .catch((e) => setTest({ busy: false, result: { ok: false, detail: String(e) } }));
  }
  function edit(a) { setForm({ name: a.name, provider: a.provider, modelId: a.modelId, modality: a.modality || "language", secrets: { ...(a.secrets || {}) }, options: { ...(a.options || {}) } }); }
  function reloadAndReset() { reloadAliases(); setForm(blank); }

  return h("div", null,
    h("div", { className: "grid gap-6 lg:grid-cols-2" },
      h(AliasForm, { providers, secrets, models, form, setForm, reload: reloadAndReset, onTest: runTest }),
      h(AliasList, { aliases, onEdit: edit, reload: reloadAliases })),
    h(TestModal, { state: test, onClose: () => setTest(null) }));
}
`;
