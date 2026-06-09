/**
 * Pattern — secret-safe config (admin-spec P4).
 *
 * Two pieces:
 *
 *  - `secret(schema?)` tags a config field as sensitive (via Zod v4 `.meta`).
 *  - `redactConfig(config, schema?, extraPaths?)` returns a deep copy of a config
 *    object with every secret field replaced by `"••••"`. A field is secret when
 *    its schema is tagged with `secret()`, **or** its dotted path is listed in
 *    `extraPaths` (the engine passes the paths it resolved from `$env`/`core.env`,
 *    so anything injected from the environment is masked by provenance).
 *
 * The single redaction routine is reused wherever config is surfaced — op
 * introspection, `formatGraph`, and every `admin.*` endpoint — so a raw secret
 * value never crosses the admin API.
 */

import { z } from "zod";
import type { ZodAny } from "./types.js";

export const REDACTED = "••••";

/**
 * Tag a config field as a secret. Defaults to a string field. Use inside an op's
 * `config` object schema:
 *
 *   config: z.object({ token: secret(), retries: z.number().default(3) })
 */
export function secret<S extends ZodAny>(schema?: S): ZodAny {
  return (schema ?? z.string()).meta({ secret: true });
}

/** The Zod 4 type tag of a schema. */
function tag(schema: ZodAny | undefined): string {
  return (schema as any)?.def?.type ?? "unknown";
}

/** Unwrap optional/nullable/default/readonly/catch wrappers to the inner schema. */
function unwrap(schema: ZodAny): ZodAny {
  let s = schema;
  for (let i = 0; i < 32; i++) {
    const t = tag(s);
    const def = (s as any)?.def;
    if ((t === "optional" || t === "nullable" || t === "readonly" || t === "catch" || t === "default") && def?.innerType) {
      s = def.innerType;
    } else if (t === "pipe" && def?.out) {
      s = def.out;
    } else {
      break;
    }
  }
  return s;
}

/** Read the `{ secret: true }` meta off a schema (checking wrappers too). */
function isSecretSchema(schema: ZodAny | undefined): boolean {
  if (!schema) return false;
  const read = (s: ZodAny | undefined): boolean => {
    try {
      return ((s as any)?.meta?.() as { secret?: boolean } | undefined)?.secret === true;
    } catch {
      return false;
    }
  };
  return read(schema) || read(unwrap(schema));
}

/** The object shape of a schema, if it is (or wraps) an object schema. */
function objectShape(schema: ZodAny | undefined): Record<string, ZodAny> | undefined {
  if (!schema) return undefined;
  const s = unwrap(schema);
  if (tag(s) !== "object") return undefined;
  return ((s as any).def?.shape ?? {}) as Record<string, ZodAny>;
}

/** Set a value at a dotted path inside a plain object (best-effort, no creation). */
function maskAtPath(root: unknown, path: string): void {
  const parts = path.split(".");
  let cur: any = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur == null || typeof cur !== "object") return;
    cur = cur[parts[i]!];
  }
  const last = parts[parts.length - 1]!;
  if (cur != null && typeof cur === "object" && last in cur) cur[last] = REDACTED;
}

/** Recursively mask schema-tagged secret fields in `value`. */
function maskBySchema(value: unknown, schema: ZodAny | undefined): unknown {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return value;
  const shape = objectShape(schema);
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const [key, v] of Object.entries(out)) {
    const fieldSchema = shape?.[key];
    if (isSecretSchema(fieldSchema)) {
      out[key] = REDACTED;
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[key] = maskBySchema(v, fieldSchema);
    }
  }
  return out;
}

/**
 * Return a deep copy of `config` with secret fields masked. `schema` is the op's
 * config schema (tagged fields are masked); `extraPaths` are dotted config paths
 * to mask regardless of schema (the engine supplies its env-resolved paths).
 */
export function redactConfig(
  config: unknown,
  schema?: ZodAny,
  extraPaths?: readonly string[],
): unknown {
  if (config == null || typeof config !== "object") return config;
  const masked = maskBySchema(config, schema);
  if (extraPaths?.length) {
    // maskBySchema already returned a shallow-cloned tree; clone deeply so we can
    // safely poke nested paths without mutating the caller's object.
    const deep = structuredClone(masked);
    for (const p of extraPaths) maskAtPath(deep, p);
    return deep;
  }
  return masked;
}

/** Read the value at a dotted path inside a plain object (best-effort). */
function valueAtPath(root: unknown, path: string): unknown {
  let cur: any = root;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Recursively collect schema-tagged secret field values from `value`. */
function collectBySchema(value: unknown, schema: ZodAny | undefined, into: Set<string>): void {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return;
  const shape = objectShape(schema);
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const fieldSchema = shape?.[key];
    if (isSecretSchema(fieldSchema)) {
      if (typeof v === "string" && v.length >= MIN_SECRET_LENGTH) into.add(v);
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      collectBySchema(v, fieldSchema, into);
    }
  }
}

/**
 * Secrets shorter than this are not value-masked at runtime: replacing every
 * occurrence of a 1–3 char string in sampled I/O would mangle unrelated data.
 * (They are still masked in *config* surfaces, which match by path, not value.)
 */
const MIN_SECRET_LENGTH = 4;

/**
 * Collect the concrete secret string **values** present in a node config —
 * schema-tagged fields plus the env-resolved paths the engine tracked. The
 * engine pools these so the I/O sampler can mask them wherever they reappear
 * in run data (admin-spec T1: samples must be masked, not just configs).
 */
export function collectSecretValues(
  config: unknown,
  schema?: ZodAny,
  extraPaths?: readonly string[],
): Set<string> {
  const values = new Set<string>();
  if (config == null || typeof config !== "object") return values;
  collectBySchema(config, schema, values);
  for (const p of extraPaths ?? []) {
    const v = valueAtPath(config, p);
    if (typeof v === "string" && v.length >= MIN_SECRET_LENGTH) values.add(v);
  }
  return values;
}

/**
 * Deep-copy `value`, replacing every occurrence of a known secret value with
 * `"••••"` — full-string matches and substrings both (a token embedded in an
 * "Authorization: Bearer …" header must not survive). Cycle-safe; non-JSON
 * leaves (functions, streams) pass through untouched.
 */
export function maskSecretValues(value: unknown, secrets: ReadonlySet<string>): unknown {
  if (secrets.size === 0) return value;
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      let out = v;
      for (const s of secrets) if (out.includes(s)) out = out.split(s).join(REDACTED);
      return out;
    }
    if (v == null || typeof v !== "object") return v;
    if (seen.has(v)) return v;
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    if (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v; // class instances / streams: not sampled structurally
  };
  return walk(value);
}

export const __testing = { isSecretSchema, objectShape, unwrap };
