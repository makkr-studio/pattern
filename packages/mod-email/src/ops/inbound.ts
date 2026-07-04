/**
 * @pattern-js/mod-email — inbound: the `email.inbound` trigger + `email.reply`.
 *
 * The trigger rides core's generic trigger seam (0.4.0): it declares its
 * event subscriptions via `triggerEvents` and tolerates a missing out-gate
 * via `outgateOptional` — no host wiring anywhere. A webhook driver verifies
 * + parses + calls `EmailService.ingestInbound`, which emits the events; a
 * workflow starting with `email.inbound` runs once per message.
 */

import { value, z, type OpDefinition } from "@pattern-js/core";
import type { InboundEmailMessage } from "../types.js";
import { emailService, maybe } from "./shared.js";

export const inboundTrigger: OpDefinition = {
  type: "email.inbound",
  title: "email.inbound",
  description:
    "Inbound email trigger: fires once per received message. config.account narrows to one receiving account " +
    "(empty = every account). Outputs { message, account } — attachments arrive as blob references.",
  boundary: "trigger",
  pair: "boundary.return",
  // The sender's mail server never reads the run result — fire-and-forget.
  outgateOptional: true,
  triggerEvents: (config: { account?: string }) => [
    {
      event: config.account?.trim() ? `email.inbound.${config.account.trim()}` : "email.inbound",
      map: (payload: unknown) => ({
        message: payload,
        account: (payload as InboundEmailMessage).account,
      }),
    },
  ],
  inputs: {},
  configInputs: { account: value(z.string()) },
  outputs: { message: value(), account: value(z.string()) },
  config: z.object({ account: z.string().optional() }),
  execute: () => ({}),
};

const replyBodyDoc =
  "Write the body once in `markdown` (rendered to styled HTML + text) or pass explicit `html`/`text`.";

export const replyOp: OpDefinition = {
  type: "email.reply",
  title: "email.reply",
  description:
    `Reply to an inbound message with proper threading: wires In-Reply-To/References from the original and ` +
    `prefixes "Re:" when needed. Wire \`message\` from email.inbound; the reply goes to its sender ` +
    `(reply-to header respected). ${replyBodyDoc}`,
  config: z.object({
    /** Account to send through; default = the account the message arrived on. */
    account: z.string().optional(),
  }),
  inputs: {
    message: value(),
    markdown: value(z.string()),
    html: value(z.string()),
    text: value(z.string()),
    subject: value(z.string()),
  },
  outputs: {
    result: value(z.object({ messageId: z.string().optional(), provider: z.string(), account: z.string() })),
  },
  execute: async (ctx) => {
    const cfg = ctx.config as { account?: string };
    const [message, markdown, html, text, subjectIn] = await Promise.all([
      ctx.input.value<InboundEmailMessage>("message"),
      maybe<string>(ctx, "markdown"),
      maybe<string>(ctx, "html"),
      maybe<string>(ctx, "text"),
      maybe<string>(ctx, "subject"),
    ]);
    if (!message?.from) throw new Error("email.reply: wire `message` from an email.inbound trigger");

    // Threading per RFC 5322: References = the original's references + its id.
    const headers: Record<string, string> = {};
    if (message.messageId) {
      headers["In-Reply-To"] = message.messageId;
      headers["References"] = [...(message.references ?? []), message.messageId].join(" ");
    } else if (message.references?.length) {
      headers["References"] = message.references.join(" ");
    }

    const baseSubject = subjectIn ?? message.subject ?? "";
    const subject = /^re:/i.test(baseSubject.trim()) ? baseSubject : `Re: ${baseSubject}`.trim();
    const to = message.headers["reply-to"]?.trim() || message.from;

    const result = await emailService(ctx).send(
      {
        account: cfg.account ?? message.account,
        to,
        subject,
        markdown,
        html,
        text,
        headers: Object.keys(headers).length ? headers : undefined,
      },
      ctx,
    );
    return { result };
  },
};

export const inboundOps: OpDefinition[] = [inboundTrigger, replyOp];
