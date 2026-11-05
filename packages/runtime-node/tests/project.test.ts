import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject, loadWorkflowDir } from "@pattern-js/runtime-node";

const fixture = (p: string) => fileURLToPath(new URL(`./fixtures/project/${p}`, import.meta.url));

describe("project loading (mods + JSON workflows)", () => {
  it("loads an app-local mod and JSON workflows, then runs them", async () => {
    const { engine } = await loadProject(fixture("pattern.config.json"));

    // The mod's op is registered…
    expect(engine.ops.has("app.upper")).toBe(true);
    // …and the JSON workflow that uses it is loaded and runnable.
    const res = await engine.run("greet", { input: { value: "hello" } });
    expect(res.status).toBe("ok");
    expect(Object.values(res.outputs)[0]).toEqual({ value: "HELLO" });
  });

  it("reads workflow .json files from a directory", async () => {
    const workflows = await loadWorkflowDir(fixture("workflows"));
    expect(workflows.map((w) => w.id)).toContain("greet");
  });

  it("runs `ready` hooks only after the whole mod batch is installed", async () => {
    // needs-upper is listed FIRST but its `ready` registers a workflow using an
    // op from upper.mjs (listed after) — only the two-phase install makes this
    // resolve. This is the admin-bootstrap scenario in miniature.
    const { engine } = await loadProject({
      mods: [fixture("mods/needs-upper.mjs"), fixture("mods/upper.mjs")],
    });
    const res = await engine.run("ready-greet", { input: { value: "two-phase" } });
    expect(res.status).toBe("ok");
    expect(Object.values(res.outputs)[0]).toEqual({ value: "TWO-PHASE" });
  });

  it("a mod's SEEDED workflows may wire ops from a mod listed after it", async () => {
    // ships-upper-workflow ships `seeded-greet` (wiring app.upper) in its
    // `workflows`, and is listed BEFORE upper.mjs. Mod workflows are parked
    // during install and flushed once every mod's ops are in — the 0.4 scaffold
    // regression (mod-buddy's tools wire docs.* ops; mod-docs is listed last).
    const { engine } = await loadProject({
      mods: [fixture("mods/ships-upper-workflow.mjs"), fixture("mods/upper.mjs")],
    });
    const res = await engine.run("seeded-greet", { input: { value: "deferred" } });
    expect(res.status).toBe("ok");
    expect(Object.values(res.outputs)[0]).toEqual({ value: "DEFERRED" });
  });

  it("a RunLedger that can't open is a dead boot naming the fix — never 'durable without capture'", async () => {
    await expect(
      loadProject({ mods: [], trace: { persist: false }, durable: { path: "/dev/null/impossible/ledger.db" } }),
    ).rejects.toThrow(/RunLedger could not open.*"durable": \{ "persist": false \}/s);
  });

  it("durable.persist: false with durable workflows is said out loud at boot, by name", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pattern-durable-off-"));
    mkdirSync(join(dir, "workflows"));
    writeFileSync(
      join(dir, "workflows", "d.json"),
      JSON.stringify({
        id: "ledgerless",
        durable: true,
        nodes: [
          { id: "in", op: "boundary.manual", config: { outputs: ["v"] } },
          { id: "out", op: "boundary.return" },
        ],
        edges: [{ from: { node: "in", port: "v" }, to: { node: "out", port: "value" } }],
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { engine } = await loadProject({ workflows: join(dir, "workflows"), trace: { persist: false }, durable: { persist: false } });
      expect(warn.mock.calls.flat().join("\n")).toMatch(/durable: true on "ledgerless".*NOT recorded/s);
      // …and the engine repeats it once when such a run actually happens.
      warn.mockClear();
      await engine.run("ledgerless", { input: { v: 1 } });
      await engine.run("ledgerless", { input: { v: 2 } });
      expect(warn.mock.calls.filter((c) => /no RunLedger is provided/.test(String(c[0])))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("accepts an inline config object too", async () => {
    const { engine, config } = await loadProject(
      { mods: [fixture("mods/upper.mjs")], workflows: fixture("workflows") },
    );
    expect(config.http).toBeUndefined();
    expect(engine.workflows.get("greet")).toBeDefined();
  });
});
