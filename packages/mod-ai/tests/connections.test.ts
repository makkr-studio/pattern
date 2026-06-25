import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine, defineMod, type OpContext, type Workflow } from "@pattern-js/core";
import { AiConfigService } from "../src/config.js";
import { ProviderService, listProviders } from "../src/provider.js";
import { aiOps } from "../src/ops/index.js";
import { AI_CONFIG_SERVICE } from "../src/well-known.js";

/** Connections + aliases + the provider registry — the config layer behind the settings page. */

const tmpCfg = () => new AiConfigService(join(tmpdir(), `ai-cfg-${Math.random().toString(36).slice(2)}.json`));
const ctx = (env: Record<string, string> = {}) => ({ env, services: {} }) as unknown as OpContext;
const merged = (res: { outputs: Record<string, Record<string, unknown>> }) =>
  Object.assign({}, ...Object.values(res.outputs)) as Record<string, unknown>;

describe("AiConfigService connections + aliases", () => {
  it("resolves an alias to a connection-backed ModelRef", async () => {
    const cfg = tmpCfg();
    await cfg.upsertConnection({ id: "oa", provider: "openai", routing: "direct", secrets: { apiKey: "OPENAI_API_KEY" }, options: {} });
    await cfg.upsertAlias({ name: "default", connection: "oa", modelId: "gpt-5", modality: "language" });
    expect(cfg.resolveAlias("default")).toMatchObject({ kind: "model", provider: "openai", routing: "direct", modelId: "gpt-5", connection: "oa" });
    // The "default" alias is what agents/chat fall back to.
    expect(cfg.defaultModel()).toMatchObject({ connection: "oa", modelId: "gpt-5" });
  });

  it("is undefined for a missing alias or a dangling connection", async () => {
    const cfg = tmpCfg();
    expect(cfg.resolveAlias("nope")).toBeUndefined();
    await cfg.upsertAlias({ name: "x", connection: "ghost", modelId: "m", modality: "language" });
    expect(cfg.resolveAlias("x")).toBeUndefined();
  });

  it("upserts by key and deletes", async () => {
    const cfg = tmpCfg();
    await cfg.upsertConnection({ id: "a", provider: "openai", routing: "direct", secrets: {}, options: {} });
    await cfg.upsertConnection({ id: "a", provider: "anthropic", routing: "direct", secrets: {}, options: {} }); // upsert
    expect(cfg.connections()).toHaveLength(1);
    expect(cfg.connection("a")?.provider).toBe("anthropic");
    await cfg.deleteConnection("a");
    expect(cfg.connections()).toHaveLength(0);
  });
});

describe("provider registry", () => {
  it("lists the gateway + baseline (bundled) + optional providers with their fields", () => {
    const byId = Object.fromEntries(listProviders().map((p) => [p.provider, p]));
    expect(byId.gateway.routing).toBe("gateway");
    expect(byId.openai.optional).toBe(false);
    expect(byId.azure.optional).toBe(true);
    expect(byId.azure.optionFields).toContain("resourceName");
    expect(byId["amazon-bedrock"].secretFields).toContain("accessKeyId");
  });
});

describe("ProviderService.testConnection", () => {
  it("ok for a connection-backed provider with a resolvable key", async () => {
    const cfg = tmpCfg();
    await cfg.upsertConnection({ id: "oa", provider: "openai", routing: "direct", secrets: { apiKey: "MY_OPENAI" }, options: {} });
    const ps = new ProviderService((id) => cfg.connection(id));
    const r = await ps.testConnection(
      { kind: "model", routing: "direct", modality: "language", provider: "openai", modelId: "gpt-5", connection: "oa" },
      ctx({ MY_OPENAI: "sk-test" }),
    );
    expect(r.ok).toBe(true);
  });

  it("fails clearly for an unknown direct provider", async () => {
    const r = await new ProviderService().testConnection(
      { kind: "model", routing: "direct", modality: "language", provider: "nope", modelId: "x" },
      ctx(),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("unknown direct provider");
  });

  it("requires a connection for structured-credential providers used inline", async () => {
    const r = await new ProviderService().testConnection(
      { kind: "model", routing: "direct", modality: "language", provider: "azure", modelId: "x" },
      ctx(),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("structured credentials");
  });

  it("names the missing secret when no key resolves", async () => {
    const r = await new ProviderService().testConnection(
      { kind: "model", routing: "direct", modality: "language", provider: "openai", modelId: "gpt-5" },
      ctx(),
    );
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("OPENAI_API_KEY");
  });
});

describe("ai.alias op", () => {
  it("resolves a configured alias to a ModelRef through the engine", async () => {
    const cfg = tmpCfg();
    await cfg.upsertConnection({ id: "oa", provider: "openai", routing: "direct", secrets: { apiKey: "OPENAI_API_KEY" }, options: {} });
    await cfg.upsertAlias({ name: "mini", connection: "oa", modelId: "gpt-5-mini", modality: "language" });
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
    expect(merged(res as never).model).toMatchObject({ connection: "oa", modelId: "gpt-5-mini", provider: "openai" });
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
