import { describe, expect, it } from "vitest";
import type { OpContext } from "@pattern-js/core";
import { resolveApiKey } from "../src/ops.js";

function ctxWith(env: Record<string, string | undefined>, services: Record<string, unknown> = {}): OpContext {
  return { env, services } as unknown as OpContext;
}

const vault = (secrets: Record<string, string>, unlocked = true) => ({
  unlocked: () => unlocked,
  has: async (name: string) => name in secrets,
  read: async (name: string) => secrets[name]!,
});

describe("resolveApiKey", () => {
  it("explicit input wins over everything", async () => {
    const ctx = ctxWith({ OPENAI_API_KEY: "env-key" }, { vaultService: vault({ OPENAI_API_KEY: "vault-key" }) });
    expect(await resolveApiKey(ctx, "wired-key")).toBe("wired-key");
  });

  it("env outranks the vault", async () => {
    const ctx = ctxWith({ OPENAI_API_KEY: "env-key" }, { vaultService: vault({ OPENAI_API_KEY: "vault-key" }) });
    expect(await resolveApiKey(ctx)).toBe("env-key");
  });

  it("falls back to a vault secret named OPENAI_API_KEY", async () => {
    const ctx = ctxWith({}, { vaultService: vault({ OPENAI_API_KEY: "vault-key" }) });
    expect(await resolveApiKey(ctx)).toBe("vault-key");
  });

  it("ignores a locked vault and missing secrets", async () => {
    expect(await resolveApiKey(ctxWith({}, { vaultService: vault({ OPENAI_API_KEY: "x" }, false) }))).toBeUndefined();
    expect(await resolveApiKey(ctxWith({}, { vaultService: vault({}) }))).toBeUndefined();
    expect(await resolveApiKey(ctxWith({}))).toBeUndefined();
  });
});
