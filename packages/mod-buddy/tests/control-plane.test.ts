/**
 * The Pattern control plane end-to-end (0.4.0, port 5062): API-token-gated
 * /mcp/pattern serving the ten restricted pattern_* tools, with the granular
 * scopes enforced IN the admin ops (the bearer principal flows through
 * ctx.invoke into every tool sub-run).
 */

import { describe, it, expect, afterAll, vi } from "vitest";
import { Engine, IDENTITY_SERVICE, type PatternMod, type Workflow } from "@pattern-js/core";
import { createHttpHost } from "@pattern-js/runtime-node";
import { identityMod, type IdentityService } from "@pattern-js/mod-identity";
import { adminMod } from "@pattern-js/mod-admin";
import { agentsMod } from "@pattern-js/mod-agents";
import { aiMod } from "@pattern-js/mod-ai";
import { docsMod } from "@pattern-js/mod-docs";
import { buddyMod } from "../src/mod.js";
import { CONTROL_PLANE_TOOLS } from "../src/tools.js";

/** Install like loadMods does: all setups first, then readies in order. */
async function install(engine: Engine, mods: PatternMod[]) {
  for (const mod of mods) await engine.useAsync(mod, { deferReady: true });
}

const PORT = 5062;
let closer: (() => Promise<void>) | undefined;
let base = "";
let service: IdentityService;

async function boot() {
  if (closer) return;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const engine = new Engine();
  await install(engine, [
    identityMod({ storage: "memory" }),
    adminMod(),
    agentsMod(),
    aiMod(),
    docsMod(),
    buddyMod(),
  ]);
  const host = createHttpHost(engine, { defaultPort: PORT });
  const { close } = await host.start();
  closer = close;
  vi.restoreAllMocks();
  service = engine.service<IdentityService>(IDENTITY_SERVICE)!;
  base = `http://localhost:${PORT}`;
}

afterAll(async () => {
  await closer?.();
  closer = undefined;
});

let rpcId = 0;
async function mcp(token: string | undefined, method: string, params?: object): Promise<Response> {
  return fetch(`${base}/mcp/pattern`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
}

async function callTool(token: string, name: string, args: object): Promise<{ text: string; isError?: boolean }> {
  const res = await mcp(token, "tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } };
  return { text: body.result.content[0]?.text ?? "", isError: body.result.isError };
}

const validDoc: Workflow = {
  id: "hello-buddy",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["value"] } },
    { id: "out", op: "boundary.return" },
  ],
  edges: [{ from: { node: "in", port: "value" }, to: { node: "out", port: "value" } }],
};

const invalidDoc = {
  id: "broken",
  nodes: [
    { id: "in", op: "boundary.manual" },
    { id: "x", op: "core.does.not.exist" },
    { id: "out", op: "boundary.return" },
  ],
  edges: [
    { from: { node: "in", port: "value" }, to: { node: "x", port: "a" } },
    { from: { node: "x", port: "out" }, to: { node: "out", port: "value" } },
  ],
};

describe("Pattern MCP server (/mcp/pattern)", () => {
  it("is token-gated: no/garbage bearer → 401", async () => {
    await boot();
    expect((await mcp(undefined, "tools/list")).status).toBe(401);
    expect((await mcp("pat_garbage", "tools/list")).status).toBe(401);
  });

  it("tools/list shows exactly the ten pattern_* tools to an author token", async () => {
    await boot();
    const author = await service.createApiToken({ name: "author", scopes: ["workflows:read", "workflows:write"] });
    const res = await mcp(author.token, "tools/list");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((t) => t.name).sort()).toEqual([...CONTROL_PLANE_TOOLS].sort());
  });

  it("the general /mcp wildcard route never exposes the restricted pattern_* tools", async () => {
    await boot();
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((t) => t.name).filter((n) => n.startsWith("pattern_"))).toEqual([]);
  });

  it("validate refuses an invalid doc with located issues; passes a valid one", async () => {
    await boot();
    const author = await service.createApiToken({ name: "author2", scopes: ["workflows:read", "workflows:write"] });

    const bad = await callTool(author.token, "pattern_validate_workflow", { doc: invalidDoc });
    const badResult = JSON.parse(bad.text) as { ok: boolean; issues: Array<{ code: string }> };
    expect(badResult.ok).toBe(false);
    expect(badResult.issues.some((i) => i.code === "unknown_op")).toBe(true);

    const good = await callTool(author.token, "pattern_validate_workflow", { doc: validDoc });
    expect((JSON.parse(good.text) as { ok: boolean }).ok).toBe(true);
  });

  it("save-draft mints a version for an author; deploy demands the deploy scope", async () => {
    await boot();
    const author = await service.createApiToken({ name: "author3", scopes: ["workflows:read", "workflows:write"] });
    const deployer = await service.createApiToken({ name: "deployer", scopes: ["workflows:read", "deploy"] });

    const saved = await callTool(author.token, "pattern_save_workflow_draft", {
      slug: "hello-buddy",
      doc: validDoc,
      note: "first draft",
    });
    const savedResult = JSON.parse(saved.text) as { version: { id: string } | null; issues: unknown[] };
    expect(savedResult.version?.id).toBeTruthy();

    // The author token CANNOT deploy — the in-op scope check refuses.
    const denied = await callTool(author.token, "pattern_deploy_workflow", {
      slug: "hello-buddy",
      version: savedResult.version!.id,
    });
    expect(denied.text).toContain("forbidden");
    expect(denied.text).toContain("deploy");

    // The deploy-scoped token can.
    const deployed = await callTool(deployer.token, "pattern_deploy_workflow", {
      slug: "hello-buddy",
      version: savedResult.version!.id,
    });
    expect(JSON.parse(deployed.text)).toMatchObject({ ok: true });
  });

  it("save-draft refuses an invalid doc: issues, no version", async () => {
    await boot();
    // The route floor is workflows:read — every control-plane token carries it.
    const author = await service.createApiToken({ name: "author4", scopes: ["workflows:read", "workflows:write"] });
    const res = await callTool(author.token, "pattern_save_workflow_draft", { slug: "broken", doc: invalidDoc });
    const parsed = JSON.parse(res.text) as { version: unknown; issues: Array<{ code: string }> };
    expect(parsed.version ?? null).toBeNull();
    expect(parsed.issues.some((i) => i.code === "unknown_op")).toBe(true);
  });

  it("docs + knowledge tools answer through the same gate", async () => {
    await boot();
    const reader = await service.createApiToken({ name: "reader", scopes: ["workflows:read"] });

    const ops = await callTool(reader.token, "pattern_list_ops", {});
    expect(ops.text).toContain("core.string.template");

    const search = await callTool(reader.token, "pattern_search_docs", { query: "boundary.http.request routes" });
    const results = JSON.parse(search.text) as Array<{ title: string; path: string }>;
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.path.startsWith("op/") || r.path.startsWith("guide/"))).toBe(true);
  });
});
