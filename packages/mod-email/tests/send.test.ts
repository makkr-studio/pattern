import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine, defineMod, type Workflow } from "@pattern-js/core";
import { EmailConfigService } from "../src/config.js";
import { DefaultEmailService } from "../src/service.js";
import { EMAIL_CONFIG_SERVICE, EMAIL_SERVICE, STORE_SERVICE_KEY } from "../src/well-known.js";
import { accountOp } from "../src/ops/account.js";
import { sendOp } from "../src/ops/send.js";
import type { EmailAccount, EmailMessage } from "../src/types.js";

type Sent = { message: EmailMessage; creds: Record<string, string>; options: Record<string, string> };

const account = (over: Partial<EmailAccount> = {}): EmailAccount => ({
  name: "default",
  provider: "test",
  from: "App <app@example.com>",
  secrets: { apiKey: { source: "env", key: "TEST_EMAIL_KEY" } },
  options: { region: "eu" },
  ...over,
});

async function boot(opts: { env?: Record<string, string>; withStore?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "email-send-"));
  const config = new EmailConfigService(join(dir, "email-config.json"));
  const service = new DefaultEmailService(config);
  const sent: Sent[] = [];
  service.registerDriver({
    id: "test",
    label: "Test driver",
    secrets: [{ field: "apiKey", label: "API key", required: true }],
    options: [],
    send: async (message, creds, options) => {
      sent.push({ message, creds, options });
      return { messageId: `t-${sent.length}` };
    },
  });
  const engine = new Engine({ env: opts.env ?? { TEST_EMAIL_KEY: "k-123" } });
  await engine.useAsync(
    defineMod({
      name: "@pattern-js/mod-email-test",
      ops: [sendOp, accountOp],
      setup: (e) => {
        e.provideService(EMAIL_CONFIG_SERVICE, config);
        e.provideService(EMAIL_SERVICE, service);
        if (opts.withStore) {
          e.provideService(STORE_SERVICE_KEY, {
            blobs: {
              get: async (id: string) =>
                id === "b1"
                  ? { meta: { mime: "image/png" }, stream: new Response(new Uint8Array([1, 2, 3])).body! }
                  : null,
            },
          });
        }
      },
    }),
  );
  return { engine, config, service, sent };
}

/** boundary.manual feeding email.send on the named ports; result returned. */
function sendWorkflow(ports: string[], nodeConfig: Record<string, unknown> = {}): Workflow {
  return {
    id: "send-test",
    nodes: [
      { id: "in", op: "boundary.manual", config: { outputs: ports } },
      { id: "send", op: "email.send", config: nodeConfig },
      { id: "out", op: "boundary.return.named", config: { inputs: ["result"] } },
    ],
    edges: [
      ...ports.map((p) => ({ from: { node: "in", port: p }, to: { node: "send", port: p } })),
      { from: { node: "send", port: "result" }, to: { node: "out", port: "result" } },
    ],
  };
}

const merged = (res: { outputs: Record<string, Record<string, unknown>> }) =>
  Object.assign({}, ...Object.values(res.outputs)) as Record<string, unknown>;

describe("email.send", () => {
  it("sends via the default account: from fallback, markdown → html+text, creds from env", async () => {
    const { engine, config, sent } = await boot();
    await config.upsertAccount(account());
    engine.registerWorkflow(sendWorkflow(["to", "subject", "markdown"]));

    const res = await engine.run("send-test", {
      input: { to: "ada@x.io", subject: "Hi", markdown: "# Hello\n\n[Open](https://h.example/x)" },
    });
    expect(res.status).toBe("ok");
    const result = merged(res as never).result as Record<string, unknown>;
    expect(result.account).toBe("default");
    expect(result.provider).toBe("test");
    expect(result.messageId).toBe("t-1");

    const { message, creds, options } = sent[0]!;
    expect(message.from).toBe("App <app@example.com>");
    expect(message.to).toEqual(["ada@x.io"]);
    expect(message.html).toContain("<h1");
    expect(message.html).toContain("display:inline-block"); // sole-link paragraph → button
    expect(message.text).toContain("Hello");
    expect(creds).toEqual({ apiKey: "k-123" });
    expect(options).toEqual({ region: "eu" });
  });

  it("explicit html/text win over markdown per part; recipients accept arrays", async () => {
    const { engine, config, sent } = await boot();
    await config.upsertAccount(account());
    engine.registerWorkflow(sendWorkflow(["to", "subject", "markdown", "html", "cc"]));

    const res = await engine.run("send-test", {
      input: {
        to: ["a@x.io", "b@x.io"],
        cc: "c@x.io",
        subject: "Hi",
        markdown: "plain body",
        html: "<p>custom</p>",
      },
    });
    expect(res.status).toBe("ok");
    const { message } = sent[0]!;
    expect(message.html).toBe("<p>custom</p>"); // explicit wins
    expect(message.text).toContain("plain body"); // markdown still fills the missing part
    expect(message.to).toEqual(["a@x.io", "b@x.io"]);
    expect(message.cc).toEqual(["c@x.io"]);
  });

  it("account precedence: input (name or ref) beats node config beats default", async () => {
    const { engine, config, sent } = await boot();
    await config.upsertAccount(account());
    await config.upsertAccount(account({ name: "second", from: "Second <s@example.com>" }));

    engine.registerWorkflow(sendWorkflow(["to", "subject", "text", "account"], { account: "default" }));
    const res = await engine.run("send-test", {
      input: { to: "a@x.io", subject: "Hi", text: "b", account: "second" },
    });
    expect(res.status).toBe("ok");
    expect((merged(res as never).result as Record<string, unknown>).account).toBe("second");
    expect(sent[0]!.message.from).toBe("Second <s@example.com>");
  });

  it("email.account resolves a ref that email.send honors; the ref carries no secrets", async () => {
    const { engine, config, sent } = await boot();
    await config.upsertAccount(account({ name: "alerts", from: "Alerts <al@example.com>" }));

    const wf: Workflow = {
      id: "ref-test",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["to", "subject", "text"] } },
        { id: "acct", op: "email.account", config: { account: "alerts" } },
        { id: "send", op: "email.send" },
        { id: "out", op: "boundary.return.named", config: { inputs: ["result"] } },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "acct", port: "in" } },
        { from: { node: "acct", port: "account" }, to: { node: "send", port: "account" } },
        { from: { node: "in", port: "to" }, to: { node: "send", port: "to" } },
        { from: { node: "in", port: "subject" }, to: { node: "send", port: "subject" } },
        { from: { node: "in", port: "text" }, to: { node: "send", port: "text" } },
        { from: { node: "send", port: "result" }, to: { node: "out", port: "result" } },
      ],
    };
    engine.registerWorkflow(wf);
    const res = await engine.run("ref-test", { input: { to: "a@x.io", subject: "s", text: "t" } });
    expect(res.status).toBe("ok");
    expect(sent[0]!.message.from).toBe("Alerts <al@example.com>");
  });

  it("email.account: required (default) throws with an admin hint; required=false probes", async () => {
    const { engine } = await boot();
    const probe: Workflow = {
      id: "probe",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: [] } },
        { id: "acct", op: "email.account", config: { account: "missing", required: false } },
        { id: "out", op: "boundary.return.named", config: { inputs: ["account", "configured"] } },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "acct", port: "in" } },
        { from: { node: "acct", port: "account" }, to: { node: "out", port: "account" } },
        { from: { node: "acct", port: "configured" }, to: { node: "out", port: "configured" } },
      ],
    };
    engine.registerWorkflow(probe);
    const res = await engine.run("probe", { input: {} });
    expect(res.status).toBe("ok");
    const out = merged(res as never);
    expect(out.configured).toBe(false);
    expect(out.account).toBeNull();

    const strict: Workflow = {
      ...probe,
      id: "strict",
      nodes: probe.nodes.map((n) => (n.id === "acct" ? { ...n, config: { account: "missing" } } : n)),
    };
    engine.registerWorkflow(strict);
    const err = await engine.run("strict", { input: {} });
    expect(err.status).toBe("error");
    expect(String(err.error)).toContain('no account "missing"');
    expect(String(err.error)).toContain("admin → System → Email");
  });

  it("normalizes all three attachment shapes (literal text, media bytes, blob ref)", async () => {
    const { engine, config, sent } = await boot({ withStore: true });
    await config.upsertAccount(account());
    engine.registerWorkflow(sendWorkflow(["to", "subject", "text", "attachments"]));

    const res = await engine.run("send-test", {
      input: {
        to: "a@x.io",
        subject: "s",
        text: "t",
        attachments: [
          { filename: "note.txt", content: "hello" },
          { bytes: new Uint8Array([9, 9]), mime: "audio/mpeg" },
          { blobId: "b1" },
        ],
      },
    });
    expect(res.status).toBe("ok");
    const atts = sent[0]!.message.attachments!;
    expect(atts).toHaveLength(3);
    expect(atts[0]).toMatchObject({ filename: "note.txt", mime: "text/plain" });
    expect(new TextDecoder().decode(atts[0]!.content)).toBe("hello");
    expect(atts[1]).toMatchObject({ filename: "attachment-2.mp3", mime: "audio/mpeg" });
    expect(atts[2]).toMatchObject({ filename: "attachment-3.png", mime: "image/png" });
    expect([...atts[2]!.content]).toEqual([1, 2, 3]);
  });

  it("fails with clear errors: unknown account, unregistered driver, missing secret, no body", async () => {
    const { engine, config } = await boot({ env: {} });
    engine.registerWorkflow(sendWorkflow(["to", "subject", "text"]));

    const missing = await engine.run("send-test", { input: { to: "a@x.io", subject: "s", text: "t" } });
    expect(String(missing.error)).toContain('no account "default"');

    await config.upsertAccount(account({ provider: "ghost" }));
    const noDriver = await engine.run("send-test", { input: { to: "a@x.io", subject: "s", text: "t" } });
    expect(String(noDriver.error)).toContain('provider "ghost"');
    expect(String(noDriver.error)).toContain("mod-email-ghost");

    await config.upsertAccount(account());
    const noEnv = await engine.run("send-test", { input: { to: "a@x.io", subject: "s", text: "t" } });
    expect(String(noEnv.error)).toContain('env var "TEST_EMAIL_KEY"');

    const bodyless = await boot();
    await bodyless.config.upsertAccount(account());
    bodyless.engine.registerWorkflow(sendWorkflow(["to", "subject"]));
    const noBody = await bodyless.engine.run("send-test", { input: { to: "a@x.io", subject: "s" } });
    expect(String(noBody.error)).toContain("provide a body");
  });
});
