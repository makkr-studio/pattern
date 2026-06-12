/**
 * @pattern/mod-vault — ops.
 *
 * `vault.read` is the canvas node: name in config, decrypted value out
 * (registered into the engine's sample mask before it flows anywhere). The
 * `vault.admin.*` json ops back the Secrets screen and re-check the `admin`
 * scope in-op; list/status never return secret material.
 */

import { secret, value, z, type OpContext, type OpDefinition } from "@pattern/core";
import { vaultService } from "./well-known.js";

const recordSchema = z.record(z.string(), z.unknown());

const vaultRead: OpDefinition = {
  type: "vault.read",
  title: "vault.read",
  description:
    "Read a secret from the vault (decrypted at run time, masked out of run samples). Wire it into API-key inputs.",
  config: z.object({
    /** Secret name, as written on the admin Secrets page. */
    key: z.string().min(1),
  }),
  inputs: {},
  outputs: { value: value(secret()) },
  execute: async (ctx) => ({
    value: await vaultService(ctx).read((ctx.config as { key: string }).key),
  }),
};

/* ── admin surface ─────────────────────────────────────────────────────── */

function requireScope(ctx: OpContext, scope: string): void {
  const p = ctx.principal;
  if (p.kind !== "user" || !(p.scopes ?? []).includes(scope)) {
    throw new Error(`vault: "${scope}" scope required`);
  }
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function adminOp(
  type: string,
  description: string,
  handler: (args: Record<string, unknown>, ctx: OpContext) => unknown | Promise<unknown>,
): OpDefinition {
  return {
    type,
    title: type,
    description,
    inputs: { params: value(recordSchema), query: value(recordSchema), body: value(z.unknown()) },
    outputs: { out: value() },
    execute: async (ctx) => {
      requireScope(ctx, "admin");
      const [params, query, body] = await Promise.all([
        ctx.input.has("params") ? ctx.input.value("params") : undefined,
        ctx.input.has("query") ? ctx.input.value("query") : undefined,
        ctx.input.has("body") ? ctx.input.value("body") : undefined,
      ]);
      return { out: await handler({ ...obj(query), ...obj(params), ...obj(body) }, ctx) };
    },
  };
}

const adminList = adminOp(
  "vault.admin.list",
  "Secret names + dates (never values). Shows a setup hint when no master key is configured.",
  async (_args, ctx) => {
    const svc = vaultService(ctx);
    const rows = await svc.list();
    const mapped = rows.map((r) => ({
      name: r.name,
      version: r.version,
      created: new Date(r.createdAt).toISOString(),
      updated: new Date(r.updatedAt).toISOString(),
    }));
    if (!svc.unlocked()) {
      return [
        {
          name: "⚠ PATTERN_VAULT_KEY is not set — generate one with `openssl rand -base64 32`",
          version: "",
          created: "",
          updated: "",
        },
        ...mapped,
      ];
    }
    return mapped;
  },
);

const adminWrite = adminOp(
  "vault.admin.write",
  "Create or rotate a secret (write-only: the value is encrypted and never shown again).",
  async (args, ctx) => {
    const name = String(args.name ?? "").trim();
    const valueStr = String(args.value ?? "");
    if (!name) throw new Error("vault: a secret needs a name");
    if (!valueStr) throw new Error("vault: a secret needs a value");
    await vaultService(ctx).write(name, valueStr);
    return { ok: true, name, note: "stored encrypted — the value will not be displayed again" };
  },
);

const adminDelete = adminOp("vault.admin.delete", "Delete a secret.", async (args, ctx) => ({
  ok: await vaultService(ctx).delete(String(args.name ?? "")),
}));

export const vaultOps: OpDefinition[] = [vaultRead, adminList, adminWrite, adminDelete];
