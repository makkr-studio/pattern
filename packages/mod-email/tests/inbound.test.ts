/**
 * Inbound email (0.4.0): the svix verifier (constant-time, windowed,
 * multi-signature), ingestInbound (attachments → blobs, events fired), the
 * email.inbound trigger's account filter, and email.reply's threading.
 */

import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine, type OpContext, type Workflow } from "@pattern-js/core";
import { emailMod, EMAIL_CONFIG_SERVICE, EMAIL_SERVICE, verifySvix } from "../src/index.js";
import type { EmailConfigService, EmailMessage, EmailService, InboundInput } from "../src/index.js";

/* ── verifySvix ──────────────────────────────────────────────────────────── */

const SECRET_BYTES = Buffer.from("super-secret-signing-key-32bytes");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

function sign(id: string, tsSeconds: number, payload: string): string {
  return createHmac("sha256", SECRET_BYTES).update(`${id}.${tsSeconds}.${payload}`).digest("base64");
}

describe("verifySvix", () => {
  const now = 1_750_000_000_000;
  const ts = Math.floor(now / 1000);
  const payload = '{"type":"email.received","data":{}}';

  it("accepts a correctly signed payload (and multi-signature headers)", () => {
    const good = sign("msg_1", ts, payload);
    expect(verifySvix({ secret: SECRET, id: "msg_1", timestamp: String(ts), signature: `v1,${good}`, payload, now })).toBe(true);
    // Key rotation: one stale candidate + one good one.
    expect(
      verifySvix({ secret: SECRET, id: "msg_1", timestamp: String(ts), signature: `v1,${sign("other", ts, payload)} v1,${good}`, payload, now }),
    ).toBe(true);
  });

  it("rejects tampered bodies, wrong ids, skewed timestamps and junk", () => {
    const good = sign("msg_1", ts, payload);
    expect(verifySvix({ secret: SECRET, id: "msg_1", timestamp: String(ts), signature: `v1,${good}`, payload: payload + " ", now })).toBe(false);
    expect(verifySvix({ secret: SECRET, id: "msg_2", timestamp: String(ts), signature: `v1,${good}`, payload, now })).toBe(false);
    const staleTs = ts - 6 * 60; // 6 minutes old > the 5-minute window
    expect(
      verifySvix({ secret: SECRET, id: "msg_1", timestamp: String(staleTs), signature: `v1,${sign("msg_1", staleTs, payload)}`, payload, now }),
    ).toBe(false);
    expect(verifySvix({ secret: SECRET, id: "msg_1", timestamp: "not-a-number", signature: `v1,${good}`, payload, now })).toBe(false);
    expect(verifySvix({ secret: SECRET, id: "msg_1", timestamp: String(ts), signature: "v0,nope garbage", payload, now })).toBe(false);
    expect(verifySvix({ secret: "", id: "msg_1", timestamp: String(ts), signature: `v1,${good}`, payload, now })).toBe(false);
  });
});

/* ── ingest + trigger + reply ────────────────────────────────────────────── */

async function boot() {
  const dir = await mkdtemp(join(tmpdir(), "email-inbound-"));
  const engine = new Engine();
  await engine.useAsync(emailMod({ configPath: join(dir, "email-config.json") }), { deferReady: true });
  const service = engine.service<EmailService>(EMAIL_SERVICE)!;
  const config = engine.service<EmailConfigService>(EMAIL_CONFIG_SERVICE)!;
  return { engine, service, config };
}

/** ingestInbound runs op-side; tests fabricate the ctx slice it reads. */
const ctxFor = (engine: Engine, extras: Record<string, unknown> = {}): OpContext =>
  ({ services: { events: engine.events, ...extras }, env: {}, principal: { kind: "anonymous" } }) as unknown as OpContext;

const inbound = (over: Partial<InboundInput> = {}): InboundInput => ({
  account: "support",
  from: "Ada <ada@x.io>",
  to: "app@example.com",
  subject: "Need help",
  text: "It broke at 3am",
  headers: { "message-id": "<m1@x.io>" },
  messageId: "<m1@x.io>",
  ...over,
});

describe("ingestInbound + the email.inbound trigger", () => {
  it("fires the account-filtered trigger with the message on its ports", async () => {
    const { engine, service } = await boot();
    const seen: unknown[] = [];
    engine.registerOp({
      type: "test.capture",
      inputs: { message: { kind: "value" }, account: { kind: "value" } },
      outputs: {},
      execute: async (ctx) => {
        seen.push({ message: await ctx.input.value("message"), account: await ctx.input.value("account") });
        return {};
      },
    });
    const listener: Workflow = {
      id: "on-support-mail",
      nodes: [
        { id: "in", op: "email.inbound", config: { account: "support" } },
        { id: "grab", op: "test.capture" },
      ],
      edges: [
        { from: { node: "in", port: "message" }, to: { node: "grab", port: "message" } },
        { from: { node: "in", port: "account" }, to: { node: "grab", port: "account" } },
      ],
    };
    engine.registerWorkflow(listener); // validates WITHOUT an out-gate (outgateOptional)

    await service.ingestInbound(inbound(), ctxFor(engine));
    await service.ingestInbound(inbound({ account: "billing", from: "bob@x.io" }), ctxFor(engine));
    await new Promise((r) => setTimeout(r, 30));

    expect(seen).toHaveLength(1); // the billing message never reached the support listener
    expect(seen[0]).toMatchObject({ account: "support", message: { from: "Ada <ada@x.io>", subject: "Need help" } });
  });

  it("stores attachments as blobs when a store is present; keeps meta (and warns) when not", async () => {
    const { engine, service } = await boot();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bytes = new TextEncoder().encode("PDFDATA");

    const bare = await service.ingestInbound(inbound({ attachments: [{ filename: "a.pdf", mime: "application/pdf", content: bytes }] }), ctxFor(engine));
    expect(bare.attachments).toEqual([{ blobId: undefined, filename: "a.pdf", mime: "application/pdf", size: 7 }]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();

    const put = vi.fn(async (data: Uint8Array, opts?: { mime?: string }) => ({ id: "blob-9", mime: opts?.mime ?? "x", size: data.byteLength }));
    const stored = await service.ingestInbound(
      inbound({ attachments: [{ filename: "a.pdf", mime: "application/pdf", content: bytes }] }),
      ctxFor(engine, { storeService: { blobs: { put, get: async () => null } } }),
    );
    expect(stored.attachments[0]).toMatchObject({ blobId: "blob-9", size: 7 });
    expect(put).toHaveBeenCalledOnce();
  });
});

describe("email.reply", () => {
  it("threads In-Reply-To/References, prefixes Re: once, and answers the sender via the arrival account", async () => {
    const { engine, service, config } = await boot();
    const sent: EmailMessage[] = [];
    service.registerDriver({
      id: "fake",
      label: "Fake",
      secrets: [],
      options: [],
      send: async (message) => {
        sent.push(message);
        return { messageId: "out-1" };
      },
    });
    await config.upsertAccount({ name: "support", provider: "fake", from: "Support <support@example.com>", secrets: {}, options: {} });

    const reply: Workflow = {
      id: "auto-reply",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["message", "markdown"] } },
        { id: "re", op: "email.reply" },
        { id: "out", op: "boundary.return.named", config: { inputs: ["result"] } },
      ],
      edges: [
        { from: { node: "in", port: "message" }, to: { node: "re", port: "message" } },
        { from: { node: "in", port: "markdown" }, to: { node: "re", port: "markdown" } },
        { from: { node: "re", port: "result" }, to: { node: "out", port: "result" } },
      ],
    };
    engine.registerWorkflow(reply);

    const message = await service.ingestInbound(
      inbound({ references: ["<m0@x.io>"], headers: { "reply-to": "ada.replies@x.io" } }),
      ctxFor(engine),
    );
    const res = await engine.run("auto-reply", { input: { message, markdown: "On it — thanks for the trace!" } });
    expect(res.status).toBe("ok");

    expect(sent).toHaveLength(1);
    const out = sent[0]!;
    expect(out.to).toEqual(["ada.replies@x.io"]); // reply-to beats from
    expect(out.from).toBe("Support <support@example.com>"); // the arrival account
    expect(out.subject).toBe("Re: Need help");
    expect(out.headers).toMatchObject({ "In-Reply-To": "<m1@x.io>", References: "<m0@x.io> <m1@x.io>" });
    expect(out.text).toContain("On it");

    // Re: is idempotent.
    await engine.run("auto-reply", { input: { message: { ...message, subject: "Re: Need help" }, markdown: "again" } });
    expect(sent[1]!.subject).toBe("Re: Need help");
  });
});
