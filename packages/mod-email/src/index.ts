/**
 * @pattern-js/mod-email — public surface.
 *
 * Driver mods import the service key + spec types; apps import `emailMod` (or
 * just list the package in pattern.config.json for the defaults).
 */

export { emailMod, type EmailModOptions } from "./mod.js";
export { default } from "./mod.js";

export { EMAIL_SERVICE, EMAIL_CONFIG_SERVICE, VAULT_SERVICE_KEY, STORE_SERVICE_KEY } from "./well-known.js";
export type { VaultLike, BlobStoreLike } from "./well-known.js";

export { EmailConfigService, DEFAULT_ACCOUNT, emailSettingsSchema, type EmailSettings } from "./config.js";
export { DefaultEmailService, type EmailService, type SendResult, type TestResult } from "./service.js";
export { renderEmailMarkdown } from "./markdown.js";
export { deliverTokenWorkflow } from "./delivery.js";
export { verifySvix, type VerifySvixInput } from "./webhook.js";

export {
  secretRefSchema,
  accountSchema,
  accountRefSchema,
  attachmentInputSchema,
  type SecretRef,
  type EmailAccount,
  type EmailAccountRef,
  type AttachmentInput,
  type EmailAttachment,
  type EmailMessage,
  type EmailDriverSpec,
  type EmailDriverInfo,
  type InboundAttachment,
  type InboundEmailMessage,
  type InboundInput,
  type SendInput,
} from "./types.js";
