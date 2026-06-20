import { describe, expect, it, vi } from "vitest";
import { Engine, REDACTED, type SpanData, type Workflow } from "@pattern-js/core";
import { vaultMod } from "../src/mod.js";
import { VAULT_SERVICE } from "../src/well-known.js";
import { makeVaultCrypto } from "../src/crypto.js";
import { memoryVaultStore, sqliteVaultStore, type VaultStore } from "../src/store.js";
import type { VaultService } from "../src/service.js";

// A fixed 32-byte test key (base64) — never reuse outside tests.
const TEST_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");

const drivers: Array<[string, () => Promise<VaultStore>]> = [["memory", async () => memoryVaultStore()]];
if (process.getBuiltinModule?.("node:sqlite")) {
  drivers.push(["sqlite", () => sqliteVaultStore(":memory:")]);
}

describe("vault crypto", () => {
  it("encrypt/decrypt round-trips with a fresh IV per call", async () => {
    const c = await makeVaultCrypto(TEST_KEY);
    const a = await c.encrypt("sk-super-secret");
    const b = await c.encrypt("sk-super-secret");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(await c.decrypt(a.ciphertext, a.iv)).toBe("sk-super-secret");
  });

  it("rejects a malformed master key", async () => {
    await expect(makeVaultCrypto("dG9vLXNob3J0")).rejects.toThrow(/32 bytes/);
  });

  it("tampered ciphertext fails loudly (GCM auth tag)", async () => {
    const c = await makeVaultCrypto(TEST_KEY);
    const { ciphertext, iv } = await c.encrypt("payload");
    const tampered = ciphertext.slice(0, -4) + (ciphertext.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(c.decrypt(tampered, iv)).rejects.toThrow();
  });
});

describe.each(drivers)("vault store (%s)", (_name, open) => {
  it("put/get/list/delete; list carries no secret material", async () => {
    const s = await open();
    await s.put("API_KEY", "ct-1", "iv-1");
    await s.put("API_KEY", "ct-2", "iv-2"); // rotate
    const row = await s.get("API_KEY");
    expect(row?.ciphertext).toBe("ct-2");
    expect(row?.version).toBe(2);
    const list = await s.list();
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("ct-2");
    expect(await s.delete("API_KEY")).toBe(true);
  });
});

async function bootEngine(masterKey?: string) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const engine = new Engine();
  await engine.useAsync(vaultMod({ storage: "memory", masterKey }));
  warn.mockRestore();
  return { engine, svc: engine.service<VaultService>(VAULT_SERVICE)! };
}

const readWorkflow: Workflow = {
  id: "read-secret",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["go"] } },
    { id: "read", op: "vault.read", config: { key: "OPENAI_API_KEY" } },
    { id: "out", op: "boundary.return" },
  ],
  edges: [
    { from: { node: "in", port: "out" }, to: { node: "read", port: "in" } }, // control pulse
    { from: { node: "read", port: "value" }, to: { node: "out", port: "value" } },
  ],
};

describe("vault service + ops", () => {
  it("write → read round-trips through the engine", async () => {
    const { engine, svc } = await bootEngine(TEST_KEY);
    await svc.write("OPENAI_API_KEY", "sk-test-123456789");
    engine.registerWorkflow(readWorkflow);
    const res = await engine.run("read-secret", { input: { go: true } });
    expect(res.status).toBe("ok");
    const merged = Object.assign({}, ...Object.values(res.outputs));
    expect(merged.value).toBe("sk-test-123456789");
  });

  it("THE money test: a vault value is REDACTED in sampled run I/O", async () => {
    const { engine, svc } = await bootEngine(TEST_KEY);
    await svc.write("OPENAI_API_KEY", "sk-live-abcdef-mask-me");
    engine.registerWorkflow(readWorkflow);

    const spans: SpanData[] = [];
    engine.onTrace({ onSpanEnd: (s) => spans.push(s) });
    const res = await engine.run("read-secret", { input: { go: true }, sampleIo: true });
    expect(res.status).toBe("ok");

    const readSpan = spans.find((s) => s.attributes["pattern.node.id"] === "read")!;
    expect(readSpan.io?.outputs?.value).toMatchObject({ kind: "value", preview: REDACTED });
    // Nothing sampled anywhere may carry the plaintext.
    expect(JSON.stringify(spans)).not.toContain("sk-live-abcdef-mask-me");
  });

  it("locked vault (no master key): loads fine, read fails with the setup hint", async () => {
    const { engine, svc } = await bootEngine(undefined);
    expect(svc.unlocked()).toBe(false);
    engine.registerWorkflow(readWorkflow);
    const res = await engine.run("read-secret", { input: { go: true } });
    expect(res.status).toBe("error");
    expect(String(res.error)).toContain("PATTERN_VAULT_KEY");
  });

  it("missing secret name fails with a pointer to the Secrets page", async () => {
    const { engine } = await bootEngine(TEST_KEY);
    engine.registerWorkflow(readWorkflow);
    const res = await engine.run("read-secret", { input: { go: true } });
    expect(res.status).toBe("error");
    expect(String(res.error)).toContain("Secrets page");
  });

  it("admin ops are pure (gated by their route, not in-op) and never leak values", async () => {
    const { engine, svc } = await bootEngine(TEST_KEY);
    await svc.write("HIDDEN", "value-never-shown");
    engine.registerWorkflow({
      id: "list-secrets",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["go"] } },
        { id: "list", op: "vault.admin.list" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "list", port: "in" } }, // control pulse
        { from: { node: "list", port: "secrets" }, to: { node: "out", port: "value" } },
      ],
    });
    // The op is PURE now — no in-op scope check (the gate lives on its route).
    // It runs whatever the principal (here anonymous), and still never returns
    // secret material — only names + dates.
    const ok = await engine.run("list-secrets", { input: { go: true } });
    expect(ok.status).toBe("ok");
    const merged = Object.assign({}, ...Object.values(ok.outputs));
    expect(JSON.stringify(merged.value)).toContain("HIDDEN");
    expect(JSON.stringify(merged.value)).not.toContain("value-never-shown");
  });
});
