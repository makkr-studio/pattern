/** @pattern-js/mod-email — email.account: resolve a named account to a ref value (like ai.alias). */

import { value, z, type OpDefinition } from "@pattern-js/core";
import { accountRefSchema } from "../types.js";
import { DEFAULT_ACCOUNT } from "../config.js";
import { emailConfig, maybe } from "./shared.js";

export const accountOp: OpDefinition = {
  type: "email.account",
  title: "email.account",
  description:
    "Resolve a named email account (configured in admin → System → Email) to an account reference. " +
    "Re-pointing the account in admin instantly re-targets every workflow using it. Defaults to " +
    '"default". With required=false it probes instead of throwing: `configured` reports whether the ' +
    "account exists — the packaged delivery workflow branches on it.",
  config: z.object({
    account: z.string().min(1).default(DEFAULT_ACCOUNT),
    required: z.boolean().default(true),
  }),
  configInputs: { account: value(z.string()) },
  inputs: {},
  outputs: {
    account: value(accountRefSchema.nullable()),
    configured: value(z.boolean()),
  },
  execute: async (ctx) => {
    const cfg = ctx.config as { account: string; required: boolean };
    const name = (await maybe<string>(ctx, "account")) ?? cfg.account;
    const ref = emailConfig(ctx).resolveAccount(name);
    if (!ref && cfg.required) {
      throw new Error(`email.account: no account "${name}" is configured — add it in admin → System → Email.`);
    }
    return { account: ref ?? null, configured: Boolean(ref) };
  },
};
