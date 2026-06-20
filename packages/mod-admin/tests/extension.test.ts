/**
 * admin internals M10 — the thesis proof: a sample mod extends the admin (Tier-1
 * declarative page + ⌘K command + menu + a self-served Tier-2 ESM remote) with
 * **zero admin-core changes**. We only `engine.use` the sample mod.
 */

import { describe, it, expect, afterEach } from "vitest";
import { Engine } from "@pattern-js/core";
import { createHttpHost, memoryFs } from "@pattern-js/runtime-node";
import { adminMod } from "@pattern-js/mod-admin";
import sampleMod from "@pattern-js/mod-sample";
import { createAdminClient } from "@pattern-js/admin-sdk";

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

let port = 4990;
async function start() {
  const p = ++port;
  const engine = new Engine();
  await engine.useAsync(adminMod({ storage: memoryFs(), auth: false }));
  await engine.useAsync(sampleMod); // ← the only extension point
  const host = createHttpHost(engine, { defaultPort: p });
  const { close } = await host.start();
  closer = close;
  return { api: createAdminClient({ baseUrl: `http://localhost:${p}/admin` }), p };
}

describe("M10 — sample mod extends the admin with zero core changes", () => {
  it("aggregates the mod's menu, command, and pages into the UI manifest", async () => {
    const { api } = await start();
    const manifest = await api.uiManifest();

    expect(manifest.menu.some((m) => m.path === "/x/greetings" && m.category === "Examples")).toBe(true);
    expect(manifest.commands.some((c) => c.id === "sample.greet")).toBe(true);

    const tier1 = manifest.pages.find((p) => p.path === "/x/greetings");
    expect(tier1?.view).toMatchObject({ kind: "table", route: { method: "GET", path: "/sample/greetings" } });

    const tier2 = manifest.pages.find((p) => p.path === "/x/studio");
    expect(tier2?.remote).toBe("/ext/sample-studio.js");
  });

  it("serves the mod's data-source through its own dedicated route (declarative-page data)", async () => {
    const { api } = await start();
    const rows = await api.call<Array<{ id: string }>>("GET", "/sample/greetings");
    expect(rows.map((r) => r.id)).toEqual(["ada", "linus", "yukihiro"]);
  });

  it("serves the mod's Tier-2 ESM remote bundle", async () => {
    const { p } = await start();
    const res = await fetch(`http://localhost:${p}/ext/sample-studio.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("SampleStudio");
  });

  it("lists the sample mod in the catalog of mods", async () => {
    const { api } = await start();
    const mods = await api.mods();
    const sample = mods.find((m) => m.name === "@pattern-js/mod-sample");
    expect(sample?.ops).toContain("sample.greetings.list");
    expect(sample?.frontend?.pages).toBe(2);
  });
});
