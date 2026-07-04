/**
 * @pattern-js/mod-email-resend — the driver.
 *
 * Resend's send API is one authenticated POST, so this driver is dependency-
 * free: plain fetch, snake_case wire fields (`reply_to`, `content_type`),
 * attachments as base64. The optional `baseUrl` option is the EU/proxy escape
 * hatch — and the test seam (point it at a local fake and nothing leaves the
 * machine).
 */

import { Buffer } from "node:buffer";
import type { EmailDriverSpec, EmailMessage } from "@pattern-js/mod-email";

const DEFAULT_BASE_URL = "https://api.resend.com";

/** The POST /emails body (https://resend.com/docs/api-reference/emails/send-email). */
function wireBody(message: EmailMessage): Record<string, unknown> {
  return {
    from: message.from,
    to: message.to,
    ...(message.cc ? { cc: message.cc } : {}),
    ...(message.bcc ? { bcc: message.bcc } : {}),
    ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    subject: message.subject,
    ...(message.html ? { html: message.html } : {}),
    ...(message.text ? { text: message.text } : {}),
    ...(message.headers && Object.keys(message.headers).length ? { headers: message.headers } : {}),
    ...(message.attachments?.length
      ? {
          attachments: message.attachments.map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.content).toString("base64"),
            content_type: a.mime,
          })),
        }
      : {}),
  };
}

export const resendDriver: EmailDriverSpec = {
  id: "resend",
  label: "Resend",
  secrets: [
    { field: "apiKey", label: "API key", required: true },
    // Inbound: the whsec_… signing secret of your Resend inbound webhook.
    { field: "webhookSecret", label: "Inbound webhook secret", required: false },
  ],
  options: [{ field: "baseUrl", label: "API base URL", required: false, placeholder: DEFAULT_BASE_URL }],
  async send(message, creds, options) {
    const base = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    const res = await fetch(`${base}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${creds.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(wireBody(message)),
    });
    if (!res.ok) {
      // Resend errors carry { statusCode, name, message }; fall back to the status line.
      const detail = await res
        .json()
        .then((b) => (b as { message?: string })?.message)
        .catch(() => undefined);
      throw new Error(`resend: ${res.status} ${detail ?? res.statusText}`);
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { messageId: body.id };
  },
};
