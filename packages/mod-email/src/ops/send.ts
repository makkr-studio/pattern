/** @pattern-js/mod-email — email.send: the operational node every driver serves. */

import { required, value, z, type OpDefinition } from "@pattern-js/core";
import { accountRefSchema, attachmentInputSchema, type AttachmentInput, type EmailAccountRef } from "../types.js";
import { emailService, maybe } from "./shared.js";

const recipients = z.union([z.string(), z.array(z.string())]);

export const sendOp: OpDefinition = {
  type: "email.send",
  title: "email.send",
  description:
    "Send an email through a configured account (drivers: Resend, SMTP, …). Write the body once in " +
    "`markdown` — it renders to inline-styled HTML plus a plain-text alternative (a paragraph that is " +
    "exactly one link becomes a button) — or pass explicit `html`/`text`, which win per part. " +
    "Attachments accept in-memory media ({bytes,mime}), blob references ({blobId}), or literal files " +
    '({filename,content}). Without an `account` input it uses the "default" account.',
  config: z.object({
    /** Static account name; an `account` input (ref or name) wins over it. */
    account: z.string().optional(),
  }),
  inputs: {
    account: value(z.union([accountRefSchema, z.string()])),
    to: required(recipients),
    subject: required(z.string()),
    markdown: value(z.string()),
    html: value(z.string()),
    text: value(z.string()),
    from: value(z.string()),
    cc: value(recipients),
    bcc: value(recipients),
    replyTo: value(z.string()),
    attachments: value(z.array(attachmentInputSchema)),
  },
  outputs: {
    result: value(
      z.object({
        messageId: z.string().optional(),
        provider: z.string(),
        account: z.string(),
      }),
    ),
  },
  execute: async (ctx) => {
    const cfg = ctx.config as { account?: string };
    const [account, to, subject, markdown, html, text, from, cc, bcc, replyTo, attachments] = await Promise.all([
      maybe<EmailAccountRef | string>(ctx, "account"),
      ctx.input.value<string | string[]>("to"),
      ctx.input.value<string>("subject"),
      maybe<string>(ctx, "markdown"),
      maybe<string>(ctx, "html"),
      maybe<string>(ctx, "text"),
      maybe<string>(ctx, "from"),
      maybe<string | string[]>(ctx, "cc"),
      maybe<string | string[]>(ctx, "bcc"),
      maybe<string>(ctx, "replyTo"),
      maybe<AttachmentInput[]>(ctx, "attachments"),
    ]);
    const result = await emailService(ctx).send(
      { account: account ?? cfg.account, to, cc, bcc, replyTo, from, subject, markdown, html, text, attachments },
      ctx,
    );
    return { result };
  },
};
