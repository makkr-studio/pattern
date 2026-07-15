import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineMod, Engine, type Workflow } from "@pattern-js/core";
import { emailMod } from "../src/mod.js";
import { EMAIL_CONFIG_SERVICE, EMAIL_SERVICE } from "../src/well-known.js";
import type { EmailConfigService } from "../src/config.js";
import type { EmailMessage, EmailService } from "../src/types.js";

/**
 * The packaged failure-alert workflow: run.failed → email to
 * PATTERN_ALERTS_TO. With the env unset it gates out silently — installing
 * mod-email changes nothing until the operator opts in.
 */

const failing: Workflow = {
  id: "flaky",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["v"] } },
    { id: "boom", op: "core.flow.assert", config: { message: "deliberate failure" } },
    { id: "out", op: "boundary.return" },
  ],
  edges: [
    { from: { node: "in", port: "v" }, to: { node: "boom", port: "condition" } },
    { from: { node: "in", port: "v" }, to: { node: "out", port: "value" } },
  ],
} as Workflow;

async function boot(env: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "email-alerts-"));
  const sent: EmailMessage[] = [];
  const driverMod = defineMod({
    name: "test-email-driver",
    ready: (engine: Engine) => {
      engine.service<EmailService>(EMAIL_SERVICE)!.registerDriver({
        id: "test",
        label: "Test driver",
        secrets: [],
        options: [],
        send: async (message) => {
          sent.push(message);
          return { messageId: "m-1" };
        },
      });
    },
  });
  const engine = new Engine({ env });
  const mods = [emailMod({ configPath: join(dir, "email-config.json") }), driverMod];
  for (const mod of mods) await engine.useAsync(mod, { deferReady: true });
  for (const mod of mods) await mod.ready?.(engine);
  await engine
    .service<EmailConfigService>(EMAIL_CONFIG_SERVICE)!
    .upsertAccount({ name: "default", provider: "test", from: "App <app@example.com>", secrets: {}, options: {} });
  engine.registerWorkflow(failing);
  return { engine, sent };
}

async function until(read: () => number, ms = 2000): Promise<void> {
  const start = Date.now();
  while (read() === 0 && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 15));
}

describe("email.alert-failed-run", () => {
  it("emails the operator with the workflow, the error, and a deep link", async () => {
    const { engine, sent } = await boot({
      PATTERN_ALERTS_TO: "ops@example.com",
      PATTERN_PUBLIC_URL: "https://app.example",
    });
    const res = await engine.run("flaky", { input: { v: false } });
    expect(res.status).toBe("error");
    await until(() => sent.length);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toContain("ops@example.com");
    expect(sent[0]!.subject).toBe("Run failed: flaky");
    // markdown normalizes into html + text before the driver sees it.
    const body = `${sent[0]!.text ?? ""}${sent[0]!.html ?? ""}`;
    expect(body).toContain("deliberate failure");
    expect(body).toContain(`https://app.example/admin/runs/${res.runId}`);
  });

  it("PATTERN_ALERTS_TO unset → the alert gates out silently", async () => {
    const { engine, sent } = await boot({});
    const res = await engine.run("flaky", { input: { v: false } });
    expect(res.status).toBe("error");
    await new Promise((r) => setTimeout(r, 200));
    expect(sent).toHaveLength(0);
  });
});
