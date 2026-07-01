/**
 * @pattern-js/mod-email-smtp — the driver.
 *
 * nodemailer does the protocol work (STARTTLS vs implicit TLS, AUTH, MIME) —
 * hand-rolling SMTP is a correctness-and-security tarpit this mod deliberately
 * avoids. Transports pool connections, so they're cached per CONFIG: the key
 * is a sha256 of {host,port,secure,user,pass}, which is functionally
 * per-account and self-invalidates when credentials rotate (only the digest is
 * ever retained). The `transportFactory` option is the test seam.
 */

import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import nodemailer, { type Transporter } from "nodemailer";
import type { EmailDriverSpec } from "@pattern-js/mod-email";

export interface SmtpTransportConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass?: string };
}

export type TransportFactory = (config: SmtpTransportConfig) => Transporter;

export function smtpDriver(factory: TransportFactory = (config) => nodemailer.createTransport(config)): EmailDriverSpec {
  const cache = new Map<string, Transporter>();

  function transportFor(creds: Record<string, string>, options: Record<string, string>): Transporter {
    if (!options.host) throw new Error('smtp: the account is missing its "host" option.');
    const config: SmtpTransportConfig = {
      host: options.host,
      port: Number(options.port || 587),
      secure: options.secure === "true",
      auth: options.user ? { user: options.user, pass: creds.pass } : undefined,
    };
    const key = createHash("sha256").update(JSON.stringify(config)).digest("hex");
    let transport = cache.get(key);
    if (!transport) {
      transport = factory(config);
      cache.set(key, transport);
    }
    return transport;
  }

  return {
    id: "smtp",
    label: "SMTP",
    // Optional on purpose: unauthenticated relays (and local catchers) exist.
    secrets: [{ field: "pass", label: "Password", required: false }],
    options: [
      { field: "host", label: "Host", required: true, placeholder: "smtp.example.com" },
      { field: "port", label: "Port", required: false, placeholder: "587" },
      { field: "secure", label: "Implicit TLS (true/false)", required: false, placeholder: "false = STARTTLS on 587" },
      { field: "user", label: "Username", required: false, placeholder: "" },
    ],
    async send(message, creds, options) {
      const info = await transportFor(creds, options).sendMail({
        from: message.from,
        to: message.to,
        cc: message.cc,
        bcc: message.bcc,
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content),
          contentType: a.mime,
        })),
      });
      return { messageId: (info as { messageId?: string })?.messageId };
    },
  };
}
