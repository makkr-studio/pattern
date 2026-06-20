import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
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

  it("accepts an inline config object too", async () => {
    const { engine, config } = await loadProject(
      { mods: [fixture("mods/upper.mjs")], workflows: fixture("workflows") },
    );
    expect(config.http).toBeUndefined();
    expect(engine.workflows.get("greet")).toBeDefined();
  });
});
