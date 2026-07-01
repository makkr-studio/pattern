import { describe, it, expect, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { Engine, type Workflow } from "@pattern-js/core";
import { emailMod, EMAIL_CONFIG_SERVICE } from "@pattern-js/mod-email";
import type { EmailConfigService } from "@pattern-js/mod-email";
import { smtpDriver, smtpEmailMod, type SmtpTransportConfig } from "../src/index.js";

/**
 * The injected transportFactory wraps nodemailer's jsonTransport (the message
 * renders to JSON, nothing touches the network) and records every factory call
 * — proving the envelope mapping AND the per-config transport cache.
 */

function recordingFactory() {
  const configs: SmtpTransportConfig[] = [];
  const mails: Array<Record<string, unknown>> = [];
  const factory = (config: SmtpTransportConfig) => {
    configs.push(config);
    const real = nodemailer.createTransport({ jsonTransport: true });
    return {
      sendMail: async (mail: Record<string, unknown>) => {
        // Snapshot attachment objects: nodemailer normalizes them IN PLACE
        // (content → base64 string), and we assert on what the driver sent.
        const attachments = (mail.attachments as Array<Record<string, unknown>> | undefined)?.map((a) => ({ ...a }));
        mails.push({ ...mail, ...(attachments ? { attachments } : {}) });
        return real.sendMail(mail as never);
      },
    } as never;
  };
  return { factory, configs, mails };
}

const creds = { pass: "s3cret" };
const options = { host: "smtp.example.com", port: "2525", secure: "false", user: "mailer" };

describe("@pattern-js/mod-email-smtp", () => {
  it("maps the message to nodemailer's envelope (Buffer attachments, contentType)", async () => {
    const { factory, configs, mails } = recordingFactory();
    const driver = smtpDriver(factory);

    const { messageId } = await driver.send(
      {
        from: "App <app@example.com>",
        to: ["ada@x.io"],
        cc: ["c@x.io"],
        replyTo: "support@example.com",
        subject: "Hi",
        html: "<p>hello</p>",
        text: "hello",
        attachments: [{ filename: "note.txt", content: new TextEncoder().encode("hi"), mime: "text/plain" }],
      },
      creds,
      options,
      {} as never,
    );

    expect(messageId).toBeTruthy();
    expect(configs).toEqual([
      { host: "smtp.example.com", port: 2525, secure: false, auth: { user: "mailer", pass: "s3cret" } },
    ]);
    const mail = mails[0]!;
    expect(mail.from).toBe("App <app@example.com>");
    expect(mail.to).toEqual(["ada@x.io"]);
    expect(mail.cc).toEqual(["c@x.io"]);
    expect(mail.replyTo).toBe("support@example.com");
    const att = (mail.attachments as Array<Record<string, unknown>>)[0]!;
    expect(att.filename).toBe("note.txt");
    expect(att.contentType).toBe("text/plain");
    expect(Buffer.isBuffer(att.content)).toBe(true);
    expect((att.content as Buffer).toString("utf8")).toBe("hi");
  });

  it("caches the transport per config and invalidates when the config changes", async () => {
    const { factory, configs } = recordingFactory();
    const driver = smtpDriver(factory);
    const message = { from: "a@x.io", to: ["b@x.io"], subject: "s", text: "t" };

    await driver.send(message, creds, options, {} as never);
    await driver.send(message, creds, options, {} as never);
    expect(configs).toHaveLength(1); // cache hit on the second send

    await driver.send(message, creds, { ...options, host: "other.example.com" }, {} as never);
    expect(configs).toHaveLength(2); // host change → new transport

    await driver.send(message, { pass: "rotated" }, options, {} as never);
    expect(configs).toHaveLength(3); // credential rotation → new transport
  });

  it("omits auth for unauthenticated relays and requires host", async () => {
    const { factory, configs } = recordingFactory();
    const driver = smtpDriver(factory);

    await driver.send({ from: "a@x.io", to: ["b@x.io"], subject: "s", text: "t" }, {}, { host: "relay.local" }, {} as never);
    expect(configs[0]).toEqual({ host: "relay.local", port: 587, secure: false, auth: undefined });

    await expect(
      driver.send({ from: "a@x.io", to: ["b@x.io"], subject: "s", text: "t" }, {}, {}, {} as never),
    ).rejects.toThrow(/missing its "host" option/);
  });

  it("propagates sendMail failures", async () => {
    const driver = smtpDriver(
      () => ({ sendMail: async () => Promise.reject(new Error("454 TLS required")) }) as never,
    );
    await expect(
      driver.send({ from: "a@x.io", to: ["b@x.io"], subject: "s", text: "t" }, {}, { host: "h" }, {} as never),
    ).rejects.toThrow(/454 TLS required/);
  });

  it("registers on mod-email through the engine and sends via email.send (env-sourced password)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "email-smtp-"));
    const { factory, configs, mails } = recordingFactory();
    const engine = new Engine({ env: { SMTP_PASSWORD: "env-pass" } });
    const mods = [emailMod({ configPath: join(dir, "email-config.json") }), smtpEmailMod({ transportFactory: factory })];
    for (const mod of mods) await engine.useAsync(mod, { deferReady: true });
    for (const mod of mods) await mod.ready?.(engine);

    const config = engine.service<EmailConfigService>(EMAIL_CONFIG_SERVICE)!;
    await config.upsertAccount({
      name: "default",
      provider: "smtp",
      from: "App <app@example.com>",
      secrets: { pass: { source: "env", key: "SMTP_PASSWORD" } },
      options: { host: "smtp.example.com", user: "mailer" },
    });

    const wf: Workflow = {
      id: "smtp-e2e",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["to", "subject", "text"] } },
        { id: "send", op: "email.send", config: {} },
        { id: "out", op: "boundary.return.named", config: { inputs: ["result"] } },
      ],
      edges: [
        ...["to", "subject", "text"].map((p) => ({ from: { node: "in", port: p }, to: { node: "send", port: p } })),
        { from: { node: "send", port: "result" }, to: { node: "out", port: "result" } },
      ],
    };
    engine.registerWorkflow(wf);
    const res = await engine.run("smtp-e2e", { input: { to: "ada@x.io", subject: "Hi", text: "hello" } });
    expect(res.status).toBe("ok");
    expect(configs[0]!.auth).toEqual({ user: "mailer", pass: "env-pass" });
    expect(mails[0]!.subject).toBe("Hi");
  });

  it("no-ops with an install hint when mod-email is absent", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const engine = new Engine();
    const mod = smtpEmailMod();
    await engine.useAsync(mod, { deferReady: true });
    await mod.ready?.(engine);
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("add @pattern-js/mod-email");
    errSpy.mockRestore();
  });
});
