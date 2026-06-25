/**
 * @pattern-js/mod-ai — the Tier-2 "AI Providers" admin page.
 *
 * An ESM remote the admin loads at runtime, reading its deps off the shared
 * `__PATTERN_ADMIN__` global (React, the API client, the glass UI kit) — so it
 * uses the admin's exact stack, no bundler. It manages ALIASES: a name + a
 * provider (which drives the exact secret + option fields it needs), each
 * secret sourced from the vault or an env var, plus a Test check; and it shows
 * the model catalog. agents/chat resolve the "default" alias at run time.
 */

import { memoryFs, provideFilesystem } from "@pattern-js/runtime-node";
import type { Engine, Workflow } from "@pattern-js/core";

const REMOTE = `
const { React, api, ui } = globalThis.__PATTERN_ADMIN__;
const { GlassPanel, NeonButton, Badge } = ui;
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

function AliasesPanel({ providers, secrets, aliases, reload }) {
  const blank = { name: "", provider: "gateway", modelId: "", modality: "language", secrets: {}, options: {} };
  const [form, setForm] = React.useState(blank);
  const [test, setTest] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const spec = providers.find((p) => p.id === form.provider) || { secrets: [{ name: "apiKey" }], options: [], modalities: MODALITIES, optional: false, pkg: "" };

  function reset() { setForm(blank); setTest(null); }
  function edit(a) {
    setTest(null);
    setForm({ name: a.name, provider: a.provider, modelId: a.modelId, modality: a.modality || "language", secrets: { ...(a.secrets || {}) }, options: { ...(a.options || {}) } });
  }
  function pickProvider(id) {
    const p = providers.find((x) => x.id === id);
    const mods = (p && p.modalities) || MODALITIES;
    setTest(null);
    setForm({ ...form, provider: id, secrets: {}, options: {}, modality: mods.indexOf(form.modality) >= 0 ? form.modality : mods[0] });
  }
  function setSecret(field, ref) { setForm((f) => ({ ...f, secrets: { ...f.secrets, [field]: ref } })); }
  function setOption(field, val) { setForm((f) => ({ ...f, options: { ...f.options, [field]: val } })); }

  // Drop empty secret rows so we never persist a sourceless reference.
  function payload() {
    const s = {};
    for (const k of Object.keys(form.secrets)) { const v = form.secrets[k]; if (v && v.key) s[k] = { source: v.source || "vault", key: v.key }; }
    return { name: form.name, provider: form.provider, modelId: form.modelId, modality: form.modality, secrets: s, options: form.options };
  }
  function save() {
    setBusy(true);
    api.call("POST", "/ai/aliases", payload()).then(() => { reset(); reload(); }).finally(() => setBusy(false));
  }
  function del(name) { api.call("DELETE", "/ai/aliases/" + encodeURIComponent(name)).then(reload); }
  function runTest() {
    setBusy(true); setTest(null);
    api.call("POST", "/ai/test", payload()).then(setTest).catch((e) => setTest({ ok: false, detail: String(e) })).finally(() => setBusy(false));
  }

  const mods = spec.modalities || MODALITIES;
  return h(GlassPanel, { className: "p-6 space-y-4" },
    h("div", { className: "flex items-center justify-between" },
      h("h3", { className: "font-semibold" }, "Model aliases"),
      h("span", { className: "text-xs text-muted" }, "agents/chat use the default alias")),
    aliases.length > 0 && h("div", { className: "space-y-1" }, aliases.map((a) =>
      h("div", { key: a.name, className: "flex items-center justify-between rounded-lg px-2 py-1 hover:bg-white/5" },
        h("button", { className: "text-left text-sm flex-1", onClick: () => edit(a) },
          h(Badge, { hue: a.name === "default" ? 140 : 200 }, a.name), " ",
          h("span", { className: "font-mono text-xs text-muted" }, a.provider + " · " + a.modelId)),
        h("button", { className: "text-xs text-muted hover:text-[var(--color-neon-pink)]", onClick: () => del(a.name) }, "Delete")))),
    h("div", { className: "space-y-3 border-t hairline pt-3" },
      h("p", { className: "text-xs text-muted" }, form.name ? "Editing — name is the upsert key." : "New alias"),
      h(Field, { label: "Alias name", hint: "the default alias is the fallback when no model is wired." },
        h("input", { className: inputCls, value: form.name, onChange: (e) => setForm({ ...form, name: e.target.value }), placeholder: "default" })),
      h(Field, { label: "Provider", hint: spec.optional && spec.pkg ? "needs " + spec.pkg : "the AI Gateway is built in" },
        h("select", { className: inputCls, value: form.provider, onChange: (e) => pickProvider(e.target.value) },
          providers.map((p) => h("option", { key: p.id, value: p.id }, p.label)))),
      h(Field, { label: "Model id", hint: form.provider === "gateway" ? "gateway: provider/model (openai/gpt-5)" : "direct: bare id (gpt-5)" },
        h("input", { className: inputCls, value: form.modelId, onChange: (e) => setForm({ ...form, modelId: e.target.value }), placeholder: form.provider === "gateway" ? "openai/gpt-5" : "gpt-5" })),
      (spec.secrets || []).map((f) => h(SecretRow, { key: f.name, field: f, ref: form.secrets[f.name], secrets: secrets, onChange: (ref) => setSecret(f.name, ref) })),
      (spec.options || []).map((f) => h(Field, { key: f.name, label: (f.label || f.name) + (f.required ? "" : " (optional)") },
        h("input", { className: inputCls, value: form.options[f.name] || "", placeholder: f.placeholder || "", onChange: (e) => setOption(f.name, e.target.value) }))),
      h(Field, { label: "Modality" },
        h("select", { className: inputCls, value: form.modality, onChange: (e) => setForm({ ...form, modality: e.target.value }) },
          mods.map((m) => h("option", { key: m, value: m }, m)))),
      h("div", { className: "flex items-center gap-3 pt-1" },
        h(NeonButton, { onClick: save, disabled: busy || !form.name || !form.modelId }, "Save alias"),
        h(NeonButton, { onClick: runTest, disabled: busy || !form.modelId }, "Test"),
        form.name && h(NeonButton, { onClick: reset }, "New"),
        test && h("span", { className: "text-sm", style: { color: test.ok ? "var(--color-neon-lime)" : "var(--color-neon-pink)" } },
          test.ok ? "✓ ok" : ("✗ " + (test.detail || "failed").slice(0, 90)))),
      h("p", { className: "text-xs text-muted" }, "Secrets come from the vault (System → Secrets) or an env var — pick the source per field.")));
}

function CatalogPanel({ models }) {
  return h(GlassPanel, { className: "p-6 space-y-3" },
    h("h3", { className: "font-semibold" }, "Model catalog"),
    h("p", { className: "text-xs text-muted" }, "Suggestions — model ids are free text. The live gateway listing merges in when a gateway key is set."),
    !models ? h("p", { className: "text-muted text-sm" }, "Loading…") :
      h("div", { className: "overflow-auto", style: { maxHeight: "24rem" } },
        h("table", { className: "w-full text-sm" },
          h("thead", null, h("tr", { className: "text-left text-muted" },
            h("th", { className: "py-1" }, "Model"), h("th", null, "Provider"), h("th", null, "Routing"), h("th", null, "Modalities"))),
          h("tbody", null, models.map((m, i) =>
            h("tr", { key: i, className: "border-t hairline" },
              h("td", { className: "py-1 font-mono text-xs" }, m.id),
              h("td", null, m.provider),
              h("td", null, h(Badge, { hue: m.routing === "gateway" ? 200 : 280 }, m.routing)),
              h("td", { className: "text-xs text-muted" }, (m.modalities || []).join(", "))))))));
}

export default function AIProvidersPage() {
  const [providers, setProviders] = React.useState([]);
  const [secrets, setSecrets] = React.useState([]);
  const [aliases, setAliases] = React.useState([]);
  const [models, setModels] = React.useState(null);

  const reloadAliases = () => api.call("GET", "/ai/aliases").then((r) => setAliases(arr(r, "aliases")));

  React.useEffect(() => {
    api.call("GET", "/ai/providers").then((r) => setProviders(arr(r, "providers"))).catch(() => {});
    api.call("GET", "/vault/secrets").then((r) => setSecrets(arr(r, "secrets").map((s) => (typeof s === "string" ? s : s.name)))).catch(() => {});
    reloadAliases().catch(() => {});
    api.call("GET", "/ai/models").then((r) => setModels(arr(r, "models"))).catch(() => setModels([]));
  }, []);

  return h("div", { className: "grid gap-6 lg:grid-cols-2" },
    h(AliasesPanel, { providers, secrets, aliases, reload: reloadAliases }),
    h(CatalogPanel, { models }));
}
`;

const ASSETS = "ai-assets";

/** Register the page bundle as a filesystem (served by the app mount below). */
export function provideAiAssets(engine: Engine): void {
  const fs = memoryFs();
  void fs.write("ai-providers.js", REMOTE);
  provideFilesystem(engine, ASSETS, fs);
}

/** The app trio serving the remote at `/ai-ext/ai-providers.js` (unique mount). */
export const aiAppMount: Workflow = {
  id: "ai.app",
  name: "@pattern-js/mod-ai · Tier-2 assets",
  nodes: [
    { id: "mount", op: "boundary.http.app", config: { mount: "/ai-ext" } },
    { id: "assets", op: "core.app.static", config: { filesystem: ASSETS, spaFallback: "" } },
    { id: "serve", op: "boundary.http.app.serve" },
  ],
  edges: [
    { from: { node: "mount", port: "out" }, to: { node: "assets", port: "in" } },
    { from: { node: "assets", port: "app" }, to: { node: "serve", port: "app" } },
  ],
};
