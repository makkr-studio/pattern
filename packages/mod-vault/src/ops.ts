/**
 * @pattern-js/mod-vault — ops.
 *
 * `vault.read` is the canvas node: name in config, decrypted value out
 * (registered into the engine's sample mask before it flows anywhere). The
 * `vault.admin.*` json ops back the Secrets screen; they're PURE (no in-op
 * scope check) and `privileged`-tagged — their routes carry the admin gate.
 * list/status never return secret material.
 */

import { secret, value, z, type OpContext, type OpDefinition } from "@pattern-js/core";
import { vaultService } from "./well-known.js";

const recordSchema = z.record(z.string(), z.unknown());

const vaultRead: OpDefinition = {
  type: "vault.read",
  effects: "pure",
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

/**
 * An admin data op: a PURE domain function (discrete named inputs, a named
 * output). It never checks scopes in-op — authorization is the trigger's job
 * (the Secrets routes stamp `requireAuth: { scopes: ["admin"] }`). The
 * `sensitivity: "privileged"` tag lets the validator warn if a route exposes one
 * without a gate. Each is fronted by its own dedicated route (see
 * `./admin-routes.ts`) that decomposes the request onto these ports.
 */
function adminOp(
  type: string,
  description: string,
  io: { in?: Record<string, z.ZodType>; out: string },
  handler: (args: Record<string, unknown>, ctx: OpContext) => unknown | Promise<unknown>,
): OpDefinition {
  const inSpec = io.in ?? {};
  return {
    type,
    title: type,
    description,
    sensitivity: "privileged",
    inputs: Object.fromEntries(Object.entries(inSpec).map(([k, s]) => [k, value(s)])),
    outputs: { [io.out]: value() },
    execute: async (ctx) => {
      const args: Record<string, unknown> = {};
      await Promise.all(Object.keys(inSpec).map(async (k) => void (args[k] = ctx.input.has(k) ? await ctx.input.value(k) : undefined)));
      return { [io.out]: await handler(args, ctx) };
    },
  };
}

const adminList = adminOp(
  "vault.admin.list",
  "Secret names + dates (never values). Shows a setup hint when no master key is configured.",
  { out: "secrets" },
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
  { in: { name: z.string(), value: z.string() }, out: "result" },
  async (args, ctx) => {
    const name = String(args.name ?? "").trim();
    const valueStr = String(args.value ?? "");
    if (!name) throw new Error("vault: a secret needs a name");
    if (!valueStr) throw new Error("vault: a secret needs a value");
    await vaultService(ctx).write(name, valueStr);
    return { ok: true, name, note: "stored encrypted — the value will not be displayed again" };
  },
);

const adminDelete = adminOp("vault.admin.delete", "Delete a secret.", { in: { name: z.string() }, out: "result" }, async (args, ctx) => ({
  ok: await vaultService(ctx).delete(String(args.name ?? "")),
}));

/**
 * Parse dotenv text into [name, value] pairs, dropping what must not import:
 * comments/blanks, malformed names, empty values (a `KEY=` placeholder is not
 * a secret), and PATTERN_VAULT_KEY — the master key unlocks the vault, it can
 * never live inside it. Returns skips WITH reasons so the UI can say why.
 */
export function parseDotenv(text: string): {
  entries: Array<[string, string]>;
  skipped: Array<{ name: string; reason: string }>;
} {
  const entries: Array<[string, string]> = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const name = m[1]!;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      skipped.push({ name, reason: "not a valid variable name" });
      continue;
    }
    let value = m[2]!.trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) value = value.slice(1, -1);
    if (!value) {
      skipped.push({ name, reason: "empty value" });
      continue;
    }
    if (name === "PATTERN_VAULT_KEY") {
      skipped.push({ name, reason: "the master key unlocks the vault — it can't live inside it" });
      continue;
    }
    entries.push([name, value]);
  }
  return { entries, skipped };
}

const adminImport = adminOp(
  "vault.admin.import",
  "Import a pasted .env: each KEY=VALUE line becomes an encrypted secret (same name = rotate). Comments, " +
    "blanks, empty values and PATTERN_VAULT_KEY are skipped. Returns names only — values are never echoed.",
  { in: { dotenv: z.string() }, out: "result" },
  async (args, ctx) => {
    const { entries, skipped } = parseDotenv(String(args.dotenv ?? ""));
    const svc = vaultService(ctx);
    for (const [name, value] of entries) await svc.write(name, value);
    return { ok: true, imported: entries.map(([n]) => n), skipped };
  },
);

export const vaultOps: OpDefinition[] = [vaultRead, adminList, adminWrite, adminDelete, adminImport];
