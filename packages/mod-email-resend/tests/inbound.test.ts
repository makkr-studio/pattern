/**
 * The Resend inbound flow end-to-end (0.4.0): a SIGNED webhook hits the
 * seeded stream-mode route (app on port 5065) → signature verified over the
 * raw bytes → email.inbound fires → an auto-reply workflow answers through
 * the driver into a fake Resend (port 5106) with proper threading. Tampered
 * signatures and stale timestamps bounce with 401.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine, type Workflow } from "@pattern-js/core";
import { createHttpHost } from "@pattern-js/runtime-node";
import { emailMod, EMAIL_CONFIG_SERVICE, type EmailConfigService } from "@pattern-js/mod-email";
import { resendEmailMod } from "../src/index.js";

const APP_PORT = 5065;
const FAKE_RESEND_PORT = 5106;

const SECRET_BYTES = Buffer.from("resend-inbound-signing-key-32b!!");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

let fakeResend: Server;
let outbound: Array<Record<string, unknown>> = [];
let closer: (() => Promise<void>) | undefined;
let base = "";

beforeAll(async () => {
  fakeResend = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      outbound.push(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "re_out_1" }));
    });
  });
  await new Promise<void>((resolve) => fakeResend.listen(FAKE_RESEND_PORT, resolve));

  const dir = await mkdtemp(join(tmpdir(), "resend-inbound-"));
  const engine = new Engine({ env: { RESEND_KEY: "re_test", RESEND_WEBHOOK_SECRET: SECRET } });
  const mods = [emailMod({ configPath: join(dir, "email-config.json") }), resendEmailMod()];
  for (const mod of mods) await engine.useAsync(mod, { deferReady: true });
  for (const mod of mods) await mod.ready?.(engine);
  const config = engine.service<EmailConfigService>(EMAIL_CONFIG_SERVICE)!;
  await config.upsertAccount({
    name: "default",
    provider: "resend",
    from: "App <app@example.com>",
    secrets: {
      apiKey: { source: "env", key: "RESEND_KEY" },
      webhookSecret: { source: "env", key: "RESEND_WEBHOOK_SECRET" },
    },
    options: { baseUrl: `http://localhost:${FAKE_RESEND_PORT}` },
  });

  // The demo workflow: every inbound email gets a threaded auto-reply.
  const autoReply: Workflow = {
    id: "inbound-auto-reply",
    nodes: [
      { id: "in", op: "email.inbound", config: {} },
      { id: "re", op: "email.reply", config: {} },
    ],
    edges: [{ from: { node: "in", port: "message" }, to: { node: "re", port: "message" } }],
  };
  // email.reply needs a body — wire a constant markdown via template on the message.
  autoReply.nodes.push({ id: "body", op: "core.string.template", config: { template: "Thanks {{from}} — on it!" } });
  autoReply.edges.push(
    { from: { node: "in", port: "message" }, to: { node: "body", port: "data" } },
    { from: { node: "body", port: "out" }, to: { node: "re", port: "markdown" } },
  );
  engine.registerWorkflow(autoReply);

  const host = createHttpHost(engine, { defaultPort: APP_PORT });
  const { close } = await host.start();
  closer = close;
  base = `http://localhost:${APP_PORT}`;
});

afterAll(async () => {
  await closer?.();
  await new Promise<void>((resolve, reject) => fakeResend.close((e) => (e ? reject(e) : resolve())));
});

const payload = JSON.stringify({
  type: "email.received",
  created_at: "2026-07-04T12:00:00.000Z",
  data: {
    from: "Ada <ada@x.io>",
    to: ["app@example.com"],
    subject: "Broken at 3am",
    text: "The nightly run failed, help!",
    headers: [{ name: "Message-Id", value: "<in-1@x.io>" }],
    attachments: [{ filename: "trace.txt", content_type: "text/plain", content: Buffer.from("boom").toString("base64") }],
  },
});

function svixHeaders(body: string, over: Partial<{ id: string; ts: number; sig: string }> = {}) {
  const id = over.id ?? "msg_webhook_1";
  const ts = over.ts ?? Math.floor(Date.now() / 1000);
  const sig = over.sig ?? createHmac("sha256", SECRET_BYTES).update(`${id}.${ts}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": `v1,${sig}` };
}

const post = (body: string, headers: Record<string, string>) =>
  fetch(`${base}/email/inbound/resend`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

describe("Resend inbound webhook (ports 5065 + fake Resend 5106)", () => {
  it("rejects tampered signatures and stale timestamps with 401", async () => {
    outbound = [];
    const tampered = await post(payload.replace("3am", "4am"), svixHeaders(payload)); // signed bytes ≠ sent bytes
    expect(tampered.status).toBe(401);

    const stale = Math.floor(Date.now() / 1000) - 10 * 60;
    const staleRes = await post(payload, svixHeaders(payload, { ts: stale }));
    expect(staleRes.status).toBe(401);
    expect(outbound).toHaveLength(0); // nothing leaked through
  });

  it("accepts a signed webhook → email.inbound fires → threaded auto-reply goes out", async () => {
    outbound = [];
    const res = await post(payload, svixHeaders(payload));
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({ ok: true });

    // The trigger runs fire-and-forget; give the auto-reply a beat.
    await new Promise((r) => setTimeout(r, 150));
    expect(outbound).toHaveLength(1);
    const reply = outbound[0]!;
    expect(reply.to).toEqual(["Ada <ada@x.io>"]);
    expect(reply.subject).toBe("Re: Broken at 3am");
    expect(reply.headers).toMatchObject({ "In-Reply-To": "<in-1@x.io>", References: "<in-1@x.io>" });
    expect(String(reply.text)).toContain("on it");
  });

  it("acknowledges non-inbound event types without firing anything", async () => {
    outbound = [];
    const other = JSON.stringify({ type: "email.delivered", data: {} });
    const res = await post(other, svixHeaders(other, { id: "msg_other" }));
    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({ ignored: "email.delivered" });
    await new Promise((r) => setTimeout(r, 80));
    expect(outbound).toHaveLength(0);
  });
});
