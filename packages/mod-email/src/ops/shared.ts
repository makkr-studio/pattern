/** @pattern-js/mod-email — shared op helpers. */

import type { OpContext } from "@pattern-js/core";
import type { EmailService } from "../service.js";
import type { EmailConfigService } from "../config.js";
import { EMAIL_CONFIG_SERVICE, EMAIL_SERVICE } from "../well-known.js";

export async function maybe<T>(ctx: OpContext, port: string): Promise<T | undefined> {
  return ctx.input.has(port) ? ((await ctx.input.value(port)) as T) : undefined;
}

export function emailService(ctx: OpContext): EmailService {
  const svc = ctx.services[EMAIL_SERVICE] as EmailService | undefined;
  if (!svc) throw new Error("mod-email: email service missing — install @pattern-js/mod-email.");
  return svc;
}

export function emailConfig(ctx: OpContext): EmailConfigService {
  const svc = ctx.services[EMAIL_CONFIG_SERVICE] as EmailConfigService | undefined;
  if (!svc) throw new Error("mod-email: email config missing — install @pattern-js/mod-email.");
  return svc;
}
