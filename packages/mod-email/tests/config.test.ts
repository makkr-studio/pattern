import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EmailConfigService, DEFAULT_ACCOUNT } from "../src/config.js";
import type { EmailAccount } from "../src/types.js";

const acct = (over: Partial<EmailAccount> = {}): EmailAccount => ({
  name: DEFAULT_ACCOUNT,
  provider: "resend",
  from: "App <hello@example.com>",
  secrets: { apiKey: { source: "env", key: "RESEND_API_KEY" } },
  options: {},
  ...over,
});

describe("EmailConfigService", () => {
  it("upserts by name, lists, resolves, deletes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "email-config-"));
    const svc = new EmailConfigService(join(dir, "email-config.json"));
    await svc.load();
    expect(svc.accounts()).toEqual([]);
    expect(svc.defaultAccount()).toBeUndefined();

    await svc.upsertAccount(acct());
    await svc.upsertAccount(acct({ name: "alerts", provider: "smtp", from: "Alerts <a@example.com>" }));
    expect(svc.accounts().map((a) => a.name).sort()).toEqual(["alerts", "default"]);

    // Upsert replaces the record of the same name.
    await svc.upsertAccount(acct({ from: "New <new@example.com>" }));
    expect(svc.accounts()).toHaveLength(2);
    expect(svc.account(DEFAULT_ACCOUNT)?.from).toBe("New <new@example.com>");

    // The ref carries the NAME, never the secrets.
    const ref = svc.resolveAccount("alerts");
    expect(ref).toEqual({ kind: "emailAccount", account: "alerts", provider: "smtp" });
    expect(JSON.stringify(ref)).not.toContain("RESEND");

    expect(svc.defaultAccount()?.account).toBe(DEFAULT_ACCOUNT);

    await svc.deleteAccount(DEFAULT_ACCOUNT);
    expect(svc.defaultAccount()).toBeUndefined();
    expect(svc.accounts().map((a) => a.name)).toEqual(["alerts"]);
  });

  it("persists to disk and reloads in a fresh instance", async () => {
    const dir = await mkdtemp(join(tmpdir(), "email-config-"));
    const path = join(dir, "nested", "email-config.json");
    const a = new EmailConfigService(path);
    await a.load();
    await a.upsertAccount(acct({ options: { baseUrl: "https://api.example" } }));

    const b = new EmailConfigService(path);
    await b.load();
    expect(b.account(DEFAULT_ACCOUNT)?.options).toEqual({ baseUrl: "https://api.example" });
    expect(b.account(DEFAULT_ACCOUNT)?.secrets.apiKey).toEqual({ source: "env", key: "RESEND_API_KEY" });
  });

  it("rejects malformed accounts (schema-validated writes)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "email-config-"));
    const svc = new EmailConfigService(join(dir, "email-config.json"));
    await svc.load();
    await expect(svc.upsertAccount({ name: "", provider: "resend", from: "x", secrets: {}, options: {} })).rejects.toThrow();
    await expect(
      svc.upsertAccount({ name: "x", provider: "resend", from: "x", secrets: { k: { source: "nope" as never, key: "K" } }, options: {} }),
    ).rejects.toThrow();
  });
});
