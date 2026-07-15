/**
 * @pattern-js/mod-email — the control-plane ops + admin routes behind the
 * Email page.
 *
 * One persisted concept (see config.ts): ACCOUNTS — memorable names, each a
 * fully self-contained sender (driver + from + sourced secrets + options).
 * Credentials themselves live in mod-vault's Secrets screen (or env vars);
 * here we list the REGISTERED drivers + their field specs, manage accounts,
 * and test one. All admin-scoped. One deliberate divergence from mod-ai's
 * alias test: `email.account.test` performs a REAL send to an operator-supplied
 * address — for email, end-to-end delivery is the only check that means
 * anything.
 */

import {
  fromBody,
  fromParams,
  httpEndpoint,
  required,
  value,
  z,
  type FrontendContribution,
  type OpContext,
  type OpDefinition,
  type Workflow,
} from "@pattern-js/core";
import { accountSchema } from "./types.js";
import { emailConfig, emailService, maybe } from "./ops/shared.js";
import { REMOTE } from "./app.js";

// ───────────────────────────── Providers ──────────────────────────────

const providersList: OpDefinition = {
  type: "email.providers.list",
  effects: "pure",
  title: "email.providers.list",
  description: "List the registered email drivers + their secret/option field specs (drives the account form).",
  reusable: false,
  config: z.object({}),
  inputs: {},
  outputs: { providers: value() },
  execute: (ctx) => ({ providers: emailService(ctx).drivers() }),
};

// ────────────────────────────── Accounts ──────────────────────────────

const accountFields = {
  name: required(z.string()),
  provider: required(z.string()),
  from: required(z.string()),
  secrets: value(z.record(z.string(), z.record(z.string(), z.string()))),
  options: value(z.record(z.string(), z.string())),
};

async function readAccountFields(ctx: OpContext) {
  const [name, provider, from, secrets, options] = await Promise.all([
    ctx.input.value<string>("name"),
    ctx.input.value<string>("provider"),
    ctx.input.value<string>("from"),
    maybe<Record<string, { source?: string; key?: string }>>(ctx, "secrets"),
    maybe<Record<string, string>>(ctx, "options"),
  ]);
  return accountSchema.parse({ name, provider, from, secrets: secrets ?? {}, options: options ?? {} });
}

const accountsRead: OpDefinition = {
  type: "email.accounts.read",
  effects: "pure",
  title: "email.accounts.read",
  description: "List the configured email accounts (secret NAMES/sources only, never values).",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: {},
  outputs: { accounts: value() },
  execute: (ctx) => ({ accounts: emailConfig(ctx).accounts() }),
};

const accountsWrite: OpDefinition = {
  type: "email.accounts.write",
  effects: "idempotent",
  title: "email.accounts.write",
  description: "Create or update an email account (upsert by name).",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: accountFields,
  outputs: { result: value() },
  execute: async (ctx) => {
    const account = await readAccountFields(ctx);
    await emailConfig(ctx).upsertAccount(account);
    return { result: { ok: true, name: account.name } };
  },
};

const accountsDelete: OpDefinition = {
  type: "email.accounts.delete",
  effects: "idempotent",
  title: "email.accounts.delete",
  description: "Delete an email account by name.",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: { name: required(z.string()) },
  outputs: { result: value() },
  execute: async (ctx) => {
    await emailConfig(ctx).deleteAccount(await ctx.input.value<string>("name"));
    return { result: { ok: true } };
  },
};

const accountTest: OpDefinition = {
  type: "email.account.test",
  title: "email.account.test",
  description:
    "Test an account draft by sending a REAL canned email to `to` — the only check that proves " +
    "end-to-end delivery. Reports { ok, detail?, messageId? }.",
  reusable: false,
  sensitivity: "privileged",
  config: z.object({}),
  inputs: { ...accountFields, to: required(z.string()) },
  outputs: { result: value() },
  execute: async (ctx) => {
    const [draft, to] = await Promise.all([readAccountFields(ctx), ctx.input.value<string>("to")]);
    return { result: await emailService(ctx).testAccount(draft, to, ctx) };
  },
};

export const settingsOps: OpDefinition[] = [providersList, accountsRead, accountsWrite, accountsDelete, accountTest];

const API = "/admin/api";

export function emailAdminRoutes(): Workflow[] {
  const auth = { scopes: ["admin"] };
  const accountIn = { name: fromBody(), provider: fromBody(), from: fromBody(), secrets: fromBody(), options: fromBody() };
  return [
    httpEndpoint({ id: "email.route.providers", name: `Email · GET ${API}/email/providers`, method: "GET", path: `${API}/email/providers`, op: "email.providers.list", io: { out: "providers" }, auth }),
    httpEndpoint({ id: "email.route.accounts.read", name: `Email · GET ${API}/email/accounts`, method: "GET", path: `${API}/email/accounts`, op: "email.accounts.read", io: { out: "accounts" }, auth }),
    httpEndpoint({ id: "email.route.accounts.write", name: `Email · POST ${API}/email/accounts`, method: "POST", path: `${API}/email/accounts`, op: "email.accounts.write", io: { in: accountIn, out: "result" }, auth }),
    httpEndpoint({ id: "email.route.accounts.delete", name: `Email · DELETE ${API}/email/accounts/:name`, method: "DELETE", path: `${API}/email/accounts/:name`, op: "email.accounts.delete", io: { in: { name: fromParams() }, out: "result" }, auth }),
    httpEndpoint({ id: "email.route.test", name: `Email · POST ${API}/email/test`, method: "POST", path: `${API}/email/test`, op: "email.account.test", io: { in: { ...accountIn, to: fromBody() }, out: "result" }, auth }),
  ];
}

export function emailFrontend(): FrontendContribution {
  return {
    menu: [{ category: "System", label: "Email", icon: "mail", path: "/x/email/accounts", order: 21 }],
    // The Tier-2 page is just its source; the admin serves + imports it (no workflow).
    pages: [{ path: "/x/email/accounts", title: "Email", module: REMOTE }],
  };
}
