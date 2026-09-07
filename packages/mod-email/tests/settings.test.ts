import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine, defineMod, type Workflow } from "@pattern-js/core";
import { EmailConfigService } from "../src/config.js";
import { settingsOps } from "../src/settings.js";
import { EMAIL_CONFIG_SERVICE } from "../src/well-known.js";

/**
 * email.accounts.write is an UPSERT that the admin form and any workflow can
 * call with only some fields: a body that says nothing about `secrets` must
 * keep the refs already stored — an omitted field is not an empty one.
 */

async function boot() {
  const dir = await mkdtemp(join(tmpdir(), "email-settings-"));
  const config = new EmailConfigService(join(dir, "email-config.json"));
  await config.load();
  const engine = new Engine({ env: {} });
  await engine.useAsync(
    defineMod({
      name: "@pattern-js/mod-email-settings-test",
      ops: settingsOps,
      setup: (e) => e.provideService(EMAIL_CONFIG_SERVICE, config),
    }),
  );
  return { engine, config };
}

/** boundary.manual feeding email.accounts.write on exactly the named ports. */
const writeWorkflow = (ports: string[]): Workflow => ({
  id: "write-account",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ports } },
    { id: "write", op: "email.accounts.write" },
    { id: "out", op: "boundary.return.named", config: { inputs: ["result"] } },
  ],
  edges: [
    ...ports.map((p) => ({ from: { node: "in", port: p }, to: { node: "write", port: p } })),
    { from: { node: "write", port: "result" }, to: { node: "out", port: "result" } },
  ],
});

describe("email.accounts.write", () => {
  it("a write without `secrets` keeps the stored refs; an explicit {} clears them", async () => {
    const { engine, config } = await boot();
    await config.upsertAccount({
      name: "default",
      provider: "resend",
      from: "App <hello@example.com>",
      secrets: { apiKey: { source: "vault", key: "RESEND_API_KEY" } },
      options: { region: "eu" },
    });

    // Rename the sender only — secrets and options are not wired at all.
    engine.registerWorkflow(writeWorkflow(["name", "provider", "from"]));
    const res = await engine.run("write-account", { input: { name: "default", provider: "resend", from: "Ada <ada@example.com>" } });
    expect(res.status).toBe("ok");
    expect(config.account("default")).toMatchObject({
      from: "Ada <ada@example.com>",
      secrets: { apiKey: { source: "vault", key: "RESEND_API_KEY" } },
      options: { region: "eu" },
    });

    // Saying `secrets: {}` is the deliberate way to drop them.
    engine.registerWorkflow({ ...writeWorkflow(["name", "provider", "from", "secrets"]), id: "clear-secrets" });
    const cleared = await engine.run("clear-secrets", {
      input: { name: "default", provider: "resend", from: "Ada <ada@example.com>", secrets: {} },
    });
    expect(cleared.status).toBe("ok");
    expect(config.account("default")?.secrets).toEqual({});
    expect(config.account("default")?.options).toEqual({ region: "eu" });
  });

  it("a brand-new account with nothing wired starts empty (no phantom refs)", async () => {
    const { engine, config } = await boot();
    engine.registerWorkflow(writeWorkflow(["name", "provider", "from"]));
    const res = await engine.run("write-account", { input: { name: "alerts", provider: "smtp", from: "Alerts <a@example.com>" } });
    expect(res.status).toBe("ok");
    expect(config.account("alerts")).toMatchObject({ secrets: {}, options: {} });
  });
});
