/**
 * @pattern-js/mod-email — the contract surface.
 *
 * Driver mods (mod-email-resend, mod-email-smtp, …) register an
 * `EmailDriverSpec` here in their `ready()` (all setups run before any ready,
 * so the service always exists by then — mirroring how login methods register
 * on mod-identity). `send` resolves the account by NAME at send time: sourced
 * secrets (vault/env), markdown → html+text, attachments → bytes, then the
 * driver. Secret VALUES never sit in workflow values or persisted config.
 */

import type { OpContext } from "@pattern-js/core";
import { renderEmailMarkdown } from "./markdown.js";
import { DEFAULT_ACCOUNT, type EmailConfigService } from "./config.js";
import { blobStore, vaultLike } from "./well-known.js";
import type {
  AttachmentInput,
  EmailAccount,
  EmailAttachment,
  EmailDriverInfo,
  EmailDriverSpec,
  EmailMessage,
  SecretRef,
  SendInput,
} from "./types.js";

export interface SendResult {
  messageId?: string;
  provider: string;
  account: string;
}

export interface TestResult {
  ok: boolean;
  detail?: string;
  messageId?: string;
}

export interface EmailService {
  /** Driver mods call this in their `ready()`; same-id re-registration replaces. */
  registerDriver(spec: EmailDriverSpec): void;
  drivers(): EmailDriverInfo[];
  driver(id: string): EmailDriverSpec | undefined;
  /** Resolve account + secrets + bodies + attachments, then delegate to the driver. */
  send(input: SendInput, ctx: OpContext): Promise<SendResult>;
  /** REAL test send of a canned message to `to`, from an (unsaved) draft account. */
  testAccount(draft: EmailAccount, to: string, ctx: OpContext): Promise<TestResult>;
}

export class DefaultEmailService implements EmailService {
  private readonly registry = new Map<string, EmailDriverSpec>();

  constructor(private readonly config: EmailConfigService) {}

  registerDriver(spec: EmailDriverSpec): void {
    this.registry.set(spec.id, spec);
  }

  drivers(): EmailDriverInfo[] {
    return [...this.registry.values()].map(({ send: _send, ...info }) => info);
  }

  driver(id: string): EmailDriverSpec | undefined {
    return this.registry.get(id);
  }

  async send(input: SendInput, ctx: OpContext): Promise<SendResult> {
    const name = typeof input.account === "string" ? input.account : (input.account?.account ?? DEFAULT_ACCOUNT);
    const account = this.config.account(name);
    if (!account) {
      throw new Error(`mod-email: no account "${name}" is configured — add it in admin → System → Email.`);
    }
    return this.sendVia(account, input, ctx);
  }

  async testAccount(draft: EmailAccount, to: string, ctx: OpContext): Promise<TestResult> {
    try {
      const { messageId } = await this.sendVia(
        draft,
        {
          to,
          subject: "Pattern test email",
          markdown:
            `# It works\n\nThis is a test email from your Pattern admin — the ` +
            `"${draft.name}" account (${draft.provider}) delivered it.`,
        },
        ctx,
      );
      return { ok: true, messageId };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /* ── internals ─────────────────────────────────────────────────────── */

  private async sendVia(account: EmailAccount, input: SendInput, ctx: OpContext): Promise<SendResult> {
    const driver = this.registry.get(account.provider);
    if (!driver) {
      throw new Error(
        `mod-email: account "${account.name}" uses provider "${account.provider}" but no such driver is registered — ` +
          `install its mod (e.g. @pattern-js/mod-email-${account.provider}) and list it in pattern.config.json.`,
      );
    }
    const creds = await this.resolveSecrets(driver, account, ctx);
    const message = await this.normalize(input, account, ctx);
    const { messageId } = await driver.send(message, creds, account.options, ctx);
    return { messageId, provider: account.provider, account: account.name };
  }

  /** Resolve every sourced secret the account carries; enforce the driver's required fields. */
  private async resolveSecrets(
    driver: EmailDriverSpec,
    account: EmailAccount,
    ctx: OpContext,
  ): Promise<Record<string, string>> {
    for (const field of driver.secrets.filter((s) => s.required !== false)) {
      if (!account.secrets[field.field]) {
        throw new Error(
          `mod-email: account "${account.name}" is missing the "${field.field}" secret its ${driver.label} driver requires.`,
        );
      }
    }
    const creds: Record<string, string> = {};
    for (const [field, ref] of Object.entries(account.secrets)) {
      creds[field] = await this.resolveSourced(ctx, ref);
    }
    return creds;
  }

  private async resolveSourced(ctx: OpContext, ref: SecretRef): Promise<string> {
    if (ref.source === "env") {
      const v = ctx.env[ref.key];
      if (v) return v;
      throw new Error(`mod-email: env var "${ref.key}" is not set.`);
    }
    const vault = vaultLike(ctx);
    if (vault?.unlocked() && (await vault.has(ref.key).catch(() => false))) return vault.read(ref.key);
    throw new Error(`mod-email: no vault secret "${ref.key}" — add it in admin → System → Secrets (vault must be unlocked).`);
  }

  /** to/cc/bcc listed, bodies final (explicit html/text win over markdown per part), attachments as bytes. */
  private async normalize(input: SendInput, account: EmailAccount, ctx: OpContext): Promise<EmailMessage> {
    const list = (v: string | string[] | undefined): string[] | undefined =>
      v === undefined ? undefined : (Array.isArray(v) ? v : [v]).filter((s) => s.trim().length > 0);

    const to = list(input.to) ?? [];
    if (!to.length) throw new Error("mod-email: `to` must name at least one recipient.");

    let html = input.html;
    let text = input.text;
    if (input.markdown !== undefined) {
      const rendered = renderEmailMarkdown(input.markdown);
      html ??= rendered.html;
      text ??= rendered.text;
    }
    if (html === undefined && text === undefined) {
      throw new Error("mod-email: provide a body — `markdown`, `html`, or `text`.");
    }

    const attachments = input.attachments?.length
      ? await Promise.all(input.attachments.map((a, i) => this.resolveAttachment(a, i, ctx)))
      : undefined;

    return {
      from: input.from ?? account.from,
      to,
      cc: list(input.cc),
      bcc: list(input.bcc),
      replyTo: input.replyTo,
      subject: input.subject,
      html,
      text,
      attachments,
    };
  }

  private async resolveAttachment(a: AttachmentInput, index: number, ctx: OpContext): Promise<EmailAttachment> {
    if ("blobId" in a) {
      const hit = await blobStore(ctx).blobs.get(a.blobId);
      if (!hit) throw new Error(`mod-email: no blob "${a.blobId}" behind the attachment reference.`);
      const mime = a.mime ?? hit.meta.mime ?? "application/octet-stream";
      return {
        filename: a.filename ?? defaultFilename(index, mime),
        content: new Uint8Array(await new Response(hit.stream).arrayBuffer()),
        mime,
      };
    }
    if ("bytes" in a) {
      return { filename: a.filename ?? defaultFilename(index, a.mime), content: a.bytes, mime: a.mime };
    }
    const isText = typeof a.content === "string";
    return {
      filename: a.filename,
      content: isText ? new TextEncoder().encode(a.content as string) : (a.content as Uint8Array),
      mime: a.mime ?? (isText ? "text/plain" : "application/octet-stream"),
    };
  }
}

const EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "video/mp4": ".mp4",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
};

function defaultFilename(index: number, mime: string): string {
  return `attachment-${index + 1}${EXT[mime.split(";")[0]!.trim()] ?? ""}`;
}
