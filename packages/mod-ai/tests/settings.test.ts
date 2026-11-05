import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine, defineMod, type Workflow } from "@pattern-js/core";
import { AiConfigService } from "../src/config.js";
import { settingsOps } from "../src/settings.js";
import { AI_CONFIG_SERVICE } from "../src/well-known.js";

/**
 * ai.aliases.write is an UPSERT the settings page and any workflow can call
 * with only some fields: a body that says nothing about `secrets` must keep
 * the refs already stored — an omitted field is not an empty one.
 */

async function boot() {
  const config = new AiConfigService(join(tmpdir(), `ai-settings-${Math.random().toString(36).slice(2)}.json`));
  await config.load();
  const engine = new Engine({ env: {} });
  await engine.useAsync(
    defineMod({
      name: "@pattern-js/mod-ai-settings-test",
      ops: settingsOps,
      setup: (e) => e.provideService(AI_CONFIG_SERVICE, config),
    }),
  );
  return { engine, config };
}

/** boundary.manual feeding ai.aliases.write on exactly the named ports. */
const writeWorkflow = (id: string, ports: string[]): Workflow => ({
  id,
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ports } },
    { id: "write", op: "ai.aliases.write" },
    { id: "out", op: "boundary.return.named", config: { inputs: ["result"] } },
  ],
  edges: [
    ...ports.map((p) => ({ from: { node: "in", port: p }, to: { node: "write", port: p } })),
    { from: { node: "write", port: "result" }, to: { node: "out", port: "result" } },
  ],
});

describe("ai.aliases.write", () => {
  it("a write without `secrets` keeps the stored refs (and modality); an explicit {} clears them", async () => {
    const { engine, config } = await boot();
    await config.upsertAlias({
      name: "default",
      provider: "openai",
      modelId: "gpt-5",
      modality: "language",
      secrets: { apiKey: { source: "vault", key: "OPENAI_API_KEY" } },
      options: { baseURL: "https://proxy.example" },
    } as never);

    // Switch the model only — secrets, options and modality are not wired.
    engine.registerWorkflow(writeWorkflow("swap-model", ["name", "provider", "modelId"]));
    const res = await engine.run("swap-model", { input: { name: "default", provider: "openai", modelId: "gpt-5-mini" } });
    expect(res.status).toBe("ok");
    expect(config.alias("default")).toMatchObject({
      modelId: "gpt-5-mini",
      modality: "language",
      secrets: { apiKey: { source: "vault", key: "OPENAI_API_KEY" } },
      options: { baseURL: "https://proxy.example" },
    });

    engine.registerWorkflow(writeWorkflow("clear-secrets", ["name", "provider", "modelId", "secrets"]));
    const cleared = await engine.run("clear-secrets", { input: { name: "default", provider: "openai", modelId: "gpt-5-mini", secrets: {} } });
    expect(cleared.status).toBe("ok");
    expect(config.alias("default")?.secrets).toEqual({});
    expect(config.alias("default")?.options).toEqual({ baseURL: "https://proxy.example" });
  });

  it("a brand-new alias with nothing wired starts empty (no phantom refs)", async () => {
    const { engine, config } = await boot();
    engine.registerWorkflow(writeWorkflow("fresh", ["name", "provider", "modelId"]));
    const res = await engine.run("fresh", { input: { name: "fast", provider: "anthropic", modelId: "claude-haiku-4-5-20251001" } });
    expect(res.status).toBe("ok");
    expect(config.alias("fast")).toMatchObject({ modality: "language", secrets: {}, options: {} });
  });
});
