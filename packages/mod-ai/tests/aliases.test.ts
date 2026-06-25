import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine, defineMod, type OpContext, type Workflow } from "@pattern-js/core";
import { AiConfigService } from "../src/config.js";
import { ProviderService } from "../src/provider.js";
import { listProviders } from "../src/registry.js";
import { aiOps } from "../src/ops/index.js";
import { AI_CONFIG_SERVICE } from "../src/well-known.js";
import type { Alias } from "../src/types.js";

/** Self-contained aliases + the provider registry — the config layer behind the settings page. */

const tmpCfg = () => new AiConfigService(join(tmpdir(), `ai-cfg-${Math.random().toString(36).slice(2)}.json`));
const ctx = (env: Record<string, string> = {}) => ({ env, services: {} }) as unknown as OpContext;
const merged = (res: { outputs: Record<string, Record<string, unknown>> }) =>
  Object.assign({}, ...Object.values(res.outputs)) as Record<string, unknown>;
const alias = (a: Partial<Alias> & Pick<Alias, "name" | "provider" | "modelId">): Alias =>
  ({ modality: "language", secrets: {}, options: {}, ...a }) as Alias;

describe("AiConfigService aliases", () => {
  it("resolves an alias to a ModelRef that points back at the alias", async () => {
    const cfg = tmpCfg();
    await cfg.upsertAlias(alias({ name: "default", provider: "openai", modelId: "gpt-5", secrets: { apiKey: { source: "env", key: "OPENAI_API_KEY" } } }));
    expect(cfg.resolveAlias("default")).toMatchObject({ kind: "model", provider: "openai", routing: "direct", modelId: "gpt-5", alias: "default" });
    // The "default" alias is what agents/chat fall back to.
    expect(cfg.defaultModel()).toMatchObject({ alias: "default", modelId: "gpt-5" });
  });

  it("derives gateway routing from the provider", async () => {
    const cfg = tmpCfg();
    await cfg.upsertAlias(alias({ name: "gw", provider: "gateway", modelId: "openai/gpt-5" }));
    expect(cfg.resolveAlias("gw")).toMatchObject({ routing: "gateway", provider: "gateway" });
  });

  it("is undefined for a missing alias", () => {
    expect(tmpCfg().resolveAlias("nope")).toBeUndefined();
  });

  it("upserts by name and deletes", async () => {
    const cfg = tmpCfg();
    await cfg.upsertAlias(alias({ name: "a", provider: "openai", modelId: "gpt-5" }));
    await cfg.upsertAlias(alias({ name: "a", provider: "anthropic", modelId: "claude-opus-4-8" })); // upsert
    expect(cfg.aliases()).toHaveLength(1);
    expect(cfg.alias("a")?.provider).toBe("anthropic");
    await cfg.deleteAlias("a");
    expect(cfg.aliases()).toHaveLength(0);
  });
});

describe("provider registry", () => {
  it("lists the gateway (built-in) + every direct provider (all optional) with their field specs", () => {
    const byId = Object.fromEntries(listProviders().map((p) => [p.id, p]));
    expect(byId.gateway.routing).toBe("gateway");
    expect(byId.gateway.optional).toBe(false);
    expect(byId.openai.optional).toBe(true); // mod-ai bundles NOTHING now
    expect(byId.azure.options.map((o) => o.name)).toContain("resourceName");
    expect(byId["amazon-bedrock"].secrets.map((s) => s.name)).toContain("accessKeyId");
    expect(byId["openai-compatible"].options.map((o) => o.name)).toContain("baseURL");
    // The full first-party catalog is offered.
    expect(listProviders().length).toBeGreaterThan(40);
  });
});

describe("ProviderService.testAlias", () => {
  it("ok for a single-key provider with an env secret", async () => {
    const r = await new ProviderService().testAlias(
      alias({ name: "x", provider: "openai", modelId: "gpt-5", secrets: { apiKey: { source: "env", key: "MY_OPENAI" } } }),
      ctx({ MY_OPENAI: "sk-test" }),
    );
    expect(r.ok).toBe(true);
  });

  it("ok for a structured provider (Azure) with a resourceName option", async () => {
    const r = await new ProviderService().testAlias(
      alias({ name: "az", provider: "azure", modelId: "gpt-5", secrets: { apiKey: { source: "env", key: "AZ" } }, options: { resourceName: "myres" } }),
      ctx({ AZ: "sk-test" }),
    );
    expect(r.ok).toBe(true);
  });

  it("fails clearly for an unknown provider", async () => {
    const r = await new ProviderService().testAlias(alias({ name: "x", provider: "nope", modelId: "x" }), ctx());
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("unknown provider");
  });

  it("names the env var when an env secret is unset", async () => {
    const r = await new ProviderService().testAlias(
      alias({ name: "x", provider: "openai", modelId: "gpt-5", secrets: { apiKey: { source: "env", key: "OPENAI_API_KEY" } } }),
      ctx(),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("OPENAI_API_KEY");
  });

  it("names the vault secret when a vault secret is missing", async () => {
    const r = await new ProviderService().testAlias(
      alias({ name: "x", provider: "openai", modelId: "gpt-5", secrets: { apiKey: { source: "vault", key: "MY_VAULT_KEY" } } }),
      ctx(),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("MY_VAULT_KEY");
  });
});

describe("ai.alias op", () => {
  it("resolves a configured alias to a ModelRef through the engine", async () => {
    const cfg = tmpCfg();
    await cfg.upsertAlias(alias({ name: "mini", provider: "openai", modelId: "gpt-5-mini" }));
    const engine = new Engine();
    await engine.useAsync(defineMod({ name: "ai-alias-test", ops: aiOps, setup: (e) => e.provideService(AI_CONFIG_SERVICE, cfg) }));
    const wf: Workflow = {
      id: "alias-wf",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: [] } },
        { id: "a", op: "ai.alias", config: { alias: "mini" } },
        { id: "out", op: "boundary.return.named", config: { inputs: ["model"] } },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "a", port: "in" } },
        { from: { node: "a", port: "model" }, to: { node: "out", port: "model" } },
      ],
    };
    engine.registerWorkflow(wf);
    const res = await engine.run("alias-wf", { input: {} });
    expect(res.status).toBe("ok");
    expect(merged(res as never).model).toMatchObject({ alias: "mini", modelId: "gpt-5-mini", provider: "openai" });
  });

  it("errors when the alias is not configured", async () => {
    const engine = new Engine();
    await engine.useAsync(defineMod({ name: "ai-alias-test2", ops: aiOps, setup: (e) => e.provideService(AI_CONFIG_SERVICE, tmpCfg()) }));
    engine.registerWorkflow({
      id: "alias-missing",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: [] } },
        { id: "a", op: "ai.alias", config: { alias: "ghost" } },
        { id: "out", op: "boundary.return.named", config: { inputs: ["model"] } },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "a", port: "in" } },
        { from: { node: "a", port: "model" }, to: { node: "out", port: "model" } },
      ],
    });
    const res = await engine.run("alias-missing", { input: {} });
    expect(res.status).toBe("error");
  });
});
