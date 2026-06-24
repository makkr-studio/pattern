/**
 * @pattern-js/mod-ai — the Tier-2 "AI Providers" admin page.
 *
 * An ESM remote the admin loads at runtime, reading its deps off the shared
 * `__PATTERN_ADMIN__` global (React, the API client, the glass UI kit, motion,
 * lucide) — so it uses the admin's exact stack, no bundler. It manages the
 * default model (with a Test connection check) and shows the model catalog
 * matrix. Provider KEYS are managed by the vault's Secrets screen.
 */

import { memoryFs, provideFilesystem } from "@pattern-js/runtime-node";
import type { Engine, Workflow } from "@pattern-js/core";

const REMOTE = `
const { React, api, ui } = globalThis.__PATTERN_ADMIN__;
const { GlassPanel, NeonButton, Badge } = ui;
const h = React.createElement;

function Field({ label, children }) {
  return h("label", { className: "block text-sm space-y-1" }, h("span", { className: "text-muted" }, label), children);
}

export default function AIProvidersPage() {
  const [models, setModels] = React.useState(null);
  const [routing, setRouting] = React.useState("gateway");
  const [provider, setProvider] = React.useState("");
  const [modelId, setModelId] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  const [test, setTest] = React.useState(null);
  const [testing, setTesting] = React.useState(false);

  React.useEffect(() => {
    api.call("GET", "/ai/settings").then((s) => {
      if (!s) return;
      setRouting(s.defaultRouting || "gateway");
      setProvider(s.defaultProvider || "");
      setModelId(s.defaultModelId || "");
    });
    api.call("GET", "/ai/models").then(setModels).catch(() => setModels([]));
  }, []);

  function save() {
    api.call("POST", "/ai/settings", { defaultRouting: routing, defaultProvider: provider, defaultModelId: modelId })
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); });
  }
  function runTest() {
    setTesting(true); setTest(null);
    api.call("POST", "/ai/test", { routing, provider, modelId, modality: "language" })
      .then((r) => { setTest(r); setTesting(false); })
      .catch((e) => { setTest({ ok: false, detail: String(e) }); setTesting(false); });
  }

  const inputCls = "glass w-full rounded-lg px-3 py-2";
  return h("div", { className: "space-y-6" },
    h("p", { className: "text-muted text-sm" }, "The default model agents & chat use when no ai.model node is wired. Provider keys live in the vault (System → Secrets)."),
    h("div", { className: "grid gap-6 lg:grid-cols-2" },
      h(GlassPanel, { className: "p-6 space-y-4" },
        h("h3", { className: "font-semibold" }, "Default model"),
        h(Field, { label: "Routing" },
          h("select", { className: inputCls, value: routing, onChange: (e) => setRouting(e.target.value) },
            h("option", { value: "gateway" }, "Vercel AI Gateway"),
            h("option", { value: "direct" }, "Direct provider"))),
        h(Field, { label: "Provider" },
          h("input", { className: inputCls, value: provider, onChange: (e) => setProvider(e.target.value), placeholder: "openai" })),
        h(Field, { label: routing === "direct" ? "Model id (e.g. gpt-5)" : "Model id (e.g. openai/gpt-5)" },
          h("input", { className: inputCls, value: modelId, onChange: (e) => setModelId(e.target.value), placeholder: routing === "direct" ? "gpt-5" : "openai/gpt-5" })),
        h("div", { className: "flex items-center gap-3 pt-1" },
          h(NeonButton, { onClick: save }, saved ? "Saved ✓" : "Save default"),
          h(NeonButton, { onClick: runTest, disabled: !provider || !modelId }, testing ? "Testing…" : "Test connection"),
          test && h("span", { className: "text-sm", style: { color: test.ok ? "var(--color-neon-lime)" : "var(--color-neon-pink)" } },
            test.ok ? "✓ ok" : ("✗ " + (test.detail || "failed").slice(0, 80)))),
        h("p", { className: "text-xs text-muted pt-2" }, "Direct routing uses the provider's key (e.g. OPENAI_API_KEY) from the vault; gateway uses one AI_GATEWAY_API_KEY. Add keys in System → Secrets.")),
      h(GlassPanel, { className: "p-6 space-y-3" },
        h("h3", { className: "font-semibold" }, "Model catalog"),
        !models ? h("p", { className: "text-muted text-sm" }, "Loading…") :
          h("div", { className: "overflow-auto", style: { maxHeight: "26rem" } },
            h("table", { className: "w-full text-sm" },
              h("thead", null, h("tr", { className: "text-left text-muted" },
                h("th", { className: "py-1" }, "Model"), h("th", null, "Provider"), h("th", null, "Routing"), h("th", null, "Modalities"))),
              h("tbody", null, (models || []).map((m, i) =>
                h("tr", { key: i, className: "border-t hairline" },
                  h("td", { className: "py-1 font-mono text-xs" }, m.id),
                  h("td", null, m.provider),
                  h("td", null, h(Badge, { hue: m.routing === "gateway" ? 200 : 280 }, m.routing)),
                  h("td", { className: "text-xs text-muted" }, (m.modalities || []).join(", ")))))))))
  );
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
