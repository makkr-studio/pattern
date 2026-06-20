import { memoryFs, provideFilesystem } from "@pattern-js/runtime-node";
import type { Engine, Workflow } from "@pattern-js/core";

/**
 * The Tier-2 custom page — an ESM remote the admin loads at runtime.
 *
 * It reads everything off the admin's shared global (`__PATTERN_ADMIN__`): the
 * host's React, the authenticated API client, the glass UI kit, plus motion.dev
 * and lucide. So the page uses the admin's *exact* stack — same React instance,
 * same design system — with no bundler and no duplicate dependencies. Tailwind
 * utility classes work too (the admin's stylesheet is global).
 *
 * Bringing your own stack instead? Build a bundle to a file, register it as a
 * filesystem below in place of this string, and keep reading React/api/ui off
 * the global — never bundle your own React, or the admin's renderer and your
 * component's hooks will disagree.
 */
const REMOTE = `
const { React, api, ui, motion, lucide } = (globalThis).__PATTERN_ADMIN__;
const { GlassPanel, PageHeader, NeonButton, Badge, JsonView } = ui;
const Icon = lucide.Boxes ?? lucide.Box;
const h = React.createElement;

export default function {{Title}}Page() {
  const [items, setItems] = React.useState(null);
  return h(
    "div",
    null,
    h(PageHeader, {
      title: "{{Title}}",
      subtitle: "A Tier-2 page from {{pkgName}} — the admin's React, UI kit, motion & lucide, no bundler.",
      actions: h(Badge, { hue: 280 }, "tier 2"),
    }),
    h(
      GlassPanel,
      { className: "p-6 space-y-4" },
      h(
        motion.div,
        { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 } },
        h(
          "p",
          { className: "text-muted text-sm flex items-center gap-2" },
          Icon && h(Icon, { size: 16 }),
          "Loaded from the admin's shared stack — replace this with your UI.",
        ),
      ),
      h(NeonButton, { onClick: () => api.call("GET", "/{{name}}/items").then(setItems) }, "Load items"),
      items && h(JsonView, { value: items, className: "max-h-64" }),
    ),
  );
}
`;

const ASSETS = "{{name}}-assets";

/** Register the remote bundle as a filesystem (served by the app mount below). */
export function provideAssets(engine: Engine): void {
  const fs = memoryFs();
  void fs.write("{{name}}.js", REMOTE);
  provideFilesystem(engine, ASSETS, fs);
}

/** The canonical app trio — serves the remote at `/ext/{{name}}.js`. */
export const appMount: Workflow = {
  id: "{{opPrefix}}.app",
  name: "{{pkgName}} · Tier-2 assets",
  nodes: [
    { id: "mount", op: "boundary.http.app", config: { mount: "/ext" } },
    { id: "assets", op: "core.app.static", config: { filesystem: ASSETS, spaFallback: "" } },
    { id: "serve", op: "boundary.http.app.serve" },
  ],
  edges: [
    { from: { node: "mount", port: "out" }, to: { node: "assets", port: "in" } },
    { from: { node: "assets", port: "app" }, to: { node: "serve", port: "app" } },
  ],
};
