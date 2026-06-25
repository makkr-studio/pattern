/**
 * @pattern-js/mod-ai — the Tier-2 "AI Providers" admin page.
 *
 * An ESM remote the admin loads at runtime, reading its deps off the shared
 * `__PATTERN_ADMIN__` global (React, the API client, the glass UI kit) — so it
 * uses the admin's exact stack, no bundler. It manages CONNECTIONS (provider +
 * vault secrets picked explicitly, with a Test check) and ALIASES (named models
 * agents/chat resolve at run time), and shows the model catalog. Provider KEYS
 * themselves are managed by the vault's Secrets screen.
 */

import { memoryFs, provideFilesystem } from "@pattern-js/runtime-node";
import type { Engine, Workflow } from "@pattern-js/core";

const REMOTE = `
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

// Normalize an api.call result that may be the array directly or { key: [...] }.
function arr(r, key) { return Array.isArray(r) ? r : ((r && r[key]) || []); }

function ConnectionsPanel({ providers, secrets, connections, reload }) {
  const blank = { id: "", label: "", provider: "openai", secrets: {}, options: {} };
  const [form, setForm] = React.useState(blank);
  const [test, setTest] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const spec = providers.find((p) => p.provider === form.provider) || { secretFields: ["apiKey"], optionFields: [], routing: "direct" };

  function edit(c) { setTest(null); setForm({ id: c.id, label: c.label || "", provider: c.provider, secrets: { ...(c.secrets || {}) }, options: { ...(c.options || {}) } }); }
  function save() {
    setBusy(true);
    api.call("POST", "/ai/connections", { id: form.id, label: form.label, provider: form.provider, routing: spec.routing, secrets: form.secrets, options: form.options })
      .then(() => { setForm(blank); setTest(null); reload(); })
      .finally(() => setBusy(false));
  }
  function del(id) { api.call("DELETE", "/ai/connections/" + encodeURIComponent(id)).then(reload); }
  function runTest() {
    setBusy(true); setTest(null);
    api.call("POST", "/ai/test", { connection: form.id, routing: spec.routing })
      .then(setTest).catch((e) => setTest({ ok: false, detail: String(e) })).finally(() => setBusy(false));
  }
  const secretOpts = (cur) => [h("option", { key: "", value: "" }, "— pick a vault secret —"),
    ...secrets.map((s) => h("option", { key: s, value: s }, s)),
    cur && !secrets.includes(cur) ? h("option", { key: cur, value: cur }, cur + " (missing)") : null];

  return h(GlassPanel, { className: "p-6 space-y-4" },
    h("div", { className: "flex items-center justify-between" },
      h("h3", { className: "font-semibold" }, "Connections"),
      h("span", { className: "text-xs text-muted" }, connections.length + " configured")),
    connections.length > 0 && h("div", { className: "space-y-1" }, connections.map((c) =>
      h("div", { key: c.id, className: "flex items-center justify-between rounded-lg px-2 py-1 hover:bg-white/5" },
        h("button", { className: "text-left text-sm flex-1", onClick: () => edit(c) },
          h("span", { className: "font-mono" }, c.id), " ",
          h(Badge, { hue: c.routing === "gateway" ? 200 : 280 }, c.provider)),
        h("button", { className: "text-xs text-muted hover:text-[var(--color-neon-pink)]", onClick: () => del(c.id) }, "Delete")))),
    h("div", { className: "space-y-3 border-t hairline pt-3" },
      h("p", { className: "text-xs text-muted" }, form.id ? "Editing — id is the upsert key." : "New connection"),
      h(Field, { label: "Provider" },
        h("select", { className: inputCls, value: form.provider, onChange: (e) => setForm({ ...form, provider: e.target.value, secrets: {}, options: {} }) },
          providers.map((p) => h("option", { key: p.provider, value: p.provider }, p.label + (p.optional ? " (needs " + p.pkg + ")" : ""))))),
      h(Field, { label: "Connection id", hint: "Referenced by aliases, e.g. openai-prod." },
        h("input", { className: inputCls, value: form.id, onChange: (e) => setForm({ ...form, id: e.target.value }), placeholder: "openai-prod" })),
      (spec.secretFields || []).map((f) => h(Field, { key: f, label: "Secret · " + f },
        h("select", { className: inputCls, value: form.secrets[f] || "", onChange: (e) => setForm({ ...form, secrets: { ...form.secrets, [f]: e.target.value } }) }, secretOpts(form.secrets[f])))),
      (spec.optionFields || []).map((f) => h(Field, { key: f, label: f },
        h("input", { className: inputCls, value: form.options[f] || "", onChange: (e) => setForm({ ...form, options: { ...form.options, [f]: e.target.value } }) }))),
      h("div", { className: "flex items-center gap-3 pt-1" },
        h(NeonButton, { onClick: save, disabled: busy || !form.id }, "Save connection"),
        form.id && h(NeonButton, { onClick: runTest, disabled: busy }, "Test"),
        form.id && h(NeonButton, { onClick: () => { setForm(blank); setTest(null); } }, "New"),
        test && h("span", { className: "text-sm", style: { color: test.ok ? "var(--color-neon-lime)" : "var(--color-neon-pink)" } },
          test.ok ? "✓ ok" : ("✗ " + (test.detail || "failed").slice(0, 90)))),
      h("p", { className: "text-xs text-muted" }, "Secrets are picked from the vault (System → Secrets) — add them there first.")));
}

function AliasesPanel({ connections, aliases, reload }) {
  const blank = { name: "", connection: "", modelId: "", modality: "language" };
  const [form, setForm] = React.useState(blank);
  function edit(a) { setForm({ name: a.name, connection: a.connection, modelId: a.modelId, modality: a.modality || "language" }); }
  function save() {
    api.call("POST", "/ai/aliases", { name: form.name, connection: form.connection, modelId: form.modelId, modality: form.modality })
      .then(() => { setForm(blank); reload(); });
  }
  function del(name) { api.call("DELETE", "/ai/aliases/" + encodeURIComponent(name)).then(reload); }

  return h(GlassPanel, { className: "p-6 space-y-4" },
    h("div", { className: "flex items-center justify-between" },
      h("h3", { className: "font-semibold" }, "Aliases"),
      h("span", { className: "text-xs text-muted" }, "agents/chat use the default alias")),
    aliases.length > 0 && h("div", { className: "space-y-1" }, aliases.map((a) =>
      h("div", { key: a.name, className: "flex items-center justify-between rounded-lg px-2 py-1 hover:bg-white/5" },
        h("button", { className: "text-left text-sm flex-1", onClick: () => edit(a) },
          h(Badge, { hue: a.name === "default" ? 140 : 200 }, a.name), " ",
          h("span", { className: "font-mono text-xs text-muted" }, a.connection + " · " + a.modelId)),
        h("button", { className: "text-xs text-muted hover:text-[var(--color-neon-pink)]", onClick: () => del(a.name) }, "Delete")))),
    h("div", { className: "space-y-3 border-t hairline pt-3" },
      h(Field, { label: "Alias name", hint: "the default alias is the fallback when no model is wired." },
        h("input", { className: inputCls, value: form.name, onChange: (e) => setForm({ ...form, name: e.target.value }), placeholder: "default" })),
      h(Field, { label: "Connection" },
        h("select", { className: inputCls, value: form.connection, onChange: (e) => setForm({ ...form, connection: e.target.value }) },
          h("option", { value: "" }, "— pick a connection —"),
          connections.map((c) => h("option", { key: c.id, value: c.id }, c.id + " (" + c.provider + ")")))),
      h(Field, { label: "Model id", hint: "direct: bare (gpt-5); gateway: provider/model." },
        h("input", { className: inputCls, value: form.modelId, onChange: (e) => setForm({ ...form, modelId: e.target.value }), placeholder: "gpt-5" })),
      h(Field, { label: "Modality" },
        h("select", { className: inputCls, value: form.modality, onChange: (e) => setForm({ ...form, modality: e.target.value }) },
          ["language", "embedding", "image", "speech", "transcription", "video"].map((m) => h("option", { key: m, value: m }, m)))),
      h("div", { className: "flex items-center gap-3 pt-1" },
        h(NeonButton, { onClick: save, disabled: !form.name || !form.connection || !form.modelId }, "Save alias"),
        form.name && h(NeonButton, { onClick: () => setForm(blank) }, "New"))));
}

function CatalogPanel({ models }) {
  return h(GlassPanel, { className: "p-6 space-y-3" },
    h("h3", { className: "font-semibold" }, "Model catalog"),
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
  const [connections, setConnections] = React.useState([]);
  const [aliases, setAliases] = React.useState([]);
  const [models, setModels] = React.useState(null);

  const reloadConns = () => api.call("GET", "/ai/connections").then((r) => setConnections(arr(r, "connections")));
  const reloadAliases = () => api.call("GET", "/ai/aliases").then((r) => setAliases(arr(r, "aliases")));

  React.useEffect(() => {
    api.call("GET", "/ai/providers").then((r) => setProviders(arr(r, "providers"))).catch(() => {});
    api.call("GET", "/vault/secrets").then((r) => setSecrets(arr(r, "secrets").map((s) => (typeof s === "string" ? s : s.name)))).catch(() => {});
    reloadConns().catch(() => {});
    reloadAliases().catch(() => {});
    api.call("GET", "/ai/models").then((r) => setModels(arr(r, "models"))).catch(() => setModels([]));
  }, []);

  return h("div", { className: "space-y-6" },
    h("div", { className: "grid gap-6 lg:grid-cols-2" },
      h(ConnectionsPanel, { providers, secrets, connections, reload: reloadConns }),
      h(AliasesPanel, { connections, aliases, reload: reloadAliases })),
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
