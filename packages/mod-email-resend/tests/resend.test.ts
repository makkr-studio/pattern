import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine, type Workflow } from "@pattern-js/core";
import { emailMod, EMAIL_CONFIG_SERVICE } from "@pattern-js/mod-email";
import type { EmailConfigService } from "@pattern-js/mod-email";
import { resendEmailMod } from "../src/index.js";

/**
 * A local fake Resend pins the wire format (bearer auth, snake_case fields,
 * base64 attachments) — the `baseUrl` option is the seam, so the real driver
 * code runs end to end through the engine with zero network.
 */

const PORT = 5104;
let server: Server;
let received: Array<{ auth: string | undefined; body: Record<string, unknown> }> = [];
let respond: { status: number; body: unknown } = { status: 200, body: { id: "re_123" } };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      received.push({
        auth: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>,
      });
      res.writeHead(respond.status, { "content-type": "application/json" });
      res.end(JSON.stringify(respond.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

const sendWorkflow: Workflow = {
  id: "resend-test",
  nodes: [
    { id: "in", op: "boundary.manual", config: { outputs: ["to", "subject", "markdown", "replyTo", "attachments"] } },
    { id: "send", op: "email.send", config: {} },
    { id: "out", op: "boundary.return.named", config: { inputs: ["result"] } },
  ],
  edges: [
    ...["to", "subject", "markdown", "replyTo", "attachments"].map((p) => ({
      from: { node: "in", port: p },
      to: { node: "send", port: p },
    })),
    { from: { node: "send", port: "result" }, to: { node: "out", port: "result" } },
  ],
};

async function boot() {
  const dir = await mkdtemp(join(tmpdir(), "email-resend-"));
  const engine = new Engine({ env: { RESEND_KEY: "re_test_key" } });
  const mods = [emailMod({ configPath: join(dir, "email-config.json") }), resendEmailMod()];
  for (const mod of mods) await engine.useAsync(mod, { deferReady: true });
  for (const mod of mods) await mod.ready?.(engine);
  const config = engine.service<EmailConfigService>(EMAIL_CONFIG_SERVICE)!;
  await config.upsertAccount({
    name: "default",
    provider: "resend",
    from: "App <app@example.com>",
    secrets: { apiKey: { source: "env", key: "RESEND_KEY" } },
    options: { baseUrl: `http://localhost:${PORT}` },
  });
  engine.registerWorkflow(sendWorkflow);
  return engine;
}

const merged = (res: { outputs: Record<string, Record<string, unknown>> }) =>
  Object.assign({}, ...Object.values(res.outputs)) as Record<string, unknown>;

describe("@pattern-js/mod-email-resend", () => {
  it("maps the message to Resend's wire format (bearer, snake_case, base64 attachments)", async () => {
    received = [];
    respond = { status: 200, body: { id: "re_123" } };
    const engine = await boot();

    const res = await engine.run("resend-test", {
      input: {
        to: ["ada@x.io", "bob@x.io"],
        subject: "Hi",
        markdown: "# Hello\n\nhttps://h.example/x",
        replyTo: "support@example.com",
        attachments: [{ filename: "note.txt", content: "hello" }],
      },
    });
    expect(res.status).toBe("ok");
    expect((merged(res as never).result as Record<string, unknown>).messageId).toBe("re_123");

    expect(received).toHaveLength(1);
    const { auth, body } = received[0]!;
    expect(auth).toBe("Bearer re_test_key");
    expect(body.from).toBe("App <app@example.com>");
    expect(body.to).toEqual(["ada@x.io", "bob@x.io"]);
    expect(body.reply_to).toBe("support@example.com");
    expect(body.subject).toBe("Hi");
    expect(String(body.html)).toContain("<h1");
    expect(String(body.text)).toContain("Hello");
    expect(body.attachments).toEqual([
      { filename: "note.txt", content: Buffer.from("hello").toString("base64"), content_type: "text/plain" },
    ]);
    expect(body).not.toHaveProperty("cc");
    expect(body).not.toHaveProperty("bcc");
  });

  it("surfaces API errors with the status and Resend's message", async () => {
    received = [];
    respond = { status: 422, body: { statusCode: 422, name: "validation_error", message: "Invalid `from` address" } };
    const engine = await boot();

    const res = await engine.run("resend-test", {
      input: { to: "ada@x.io", subject: "Hi", markdown: "x" },
    });
    expect(res.status).toBe("error");
    expect(String(res.error)).toContain("resend: 422 Invalid `from` address");
  });

  it("no-ops with an install hint when mod-email is absent", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const engine = new Engine();
    const mod = resendEmailMod();
    await engine.useAsync(mod, { deferReady: true });
    await mod.ready?.(engine);
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("add @pattern-js/mod-email");
    errSpy.mockRestore();
  });
});
