/**
 * Pattern — environment interpolation for workflow config.
 *
 * Workflows are data, but a deployed app needs to inject environment values
 * (ports, hosts, secrets, feature flags) into that data. Config supports two
 * forms, resolved at registration time *before* validation:
 *
 *  1. **Typed object form** — `{ "$env": "NAME", "type"?, "default"? }`. `type`
 *     casts the env string to string|number|integer|boolean|json (default
 *     "string"); `default` is used when the var is unset/empty. Missing var with
 *     no default is a loud error (deployment misconfig caught early).
 *
 *  2. **String interpolation** — `"${NAME}"` / `"${NAME:-fallback}"` inside any
 *     string. Always yields a string (use the object form for other types). Emit
 *     a literal `${...}` by writing `$${...}`.
 *
 * This module is runtime-neutral: the env map is injected, never read from
 * `process.env` here (the Node runtime adapter passes that in).
 */

import type { Workflow } from "./types.js";

export type EnvMap = Record<string, string | undefined>;

export type EnvCastType = "string" | "number" | "integer" | "boolean" | "json";

/** Thrown when an env reference can't be resolved or cast. */
export class EnvConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvConfigError";
  }
}

/** True when the env value should be treated as "unset" (missing or empty). */
const unset = (v: string | undefined): boolean => v === undefined || v === "";

function castEnv(raw: string, type: EnvCastType, name: string): unknown {
  switch (type) {
    case "string":
      return raw;
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new EnvConfigError(`env "${name}"="${raw}" is not a number`);
      return n;
    }
    case "integer": {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new EnvConfigError(`env "${name}"="${raw}" is not an integer`);
      return n;
    }
    case "boolean": {
      if (/^(true|1|yes|on)$/i.test(raw)) return true;
      if (/^(false|0|no|off)$/i.test(raw)) return false;
      throw new EnvConfigError(`env "${name}"="${raw}" is not a boolean (use true/false/1/0/yes/no/on/off)`);
    }
    case "json":
      try {
        return JSON.parse(raw);
      } catch {
        throw new EnvConfigError(`env "${name}"="${raw}" is not valid JSON`);
      }
    default:
      throw new EnvConfigError(`unknown env type "${type}" for "${name}"`);
  }
}

const ENV_REF = /\$(\$)?\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

function interpolateString(s: string, env: EnvMap): string {
  return s.replace(ENV_REF, (_match, escaped, name: string, fallback: string | undefined) => {
    if (escaped) {
      // `$${NAME}` → literal `${NAME}` (optionally with the :-default preserved).
      return `\${${name}${fallback !== undefined ? `:-${fallback}` : ""}}`;
    }
    const raw = env[name];
    if (unset(raw)) {
      if (fallback !== undefined) return fallback;
      throw new EnvConfigError(`missing required env var "${name}" in "${s}" (use \${${name}:-default} to provide a fallback)`);
    }
    return raw as string;
  });
}

/** Recursively resolve env references in a config value against `env`. */
export function interpolateValue(value: unknown, env: EnvMap): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && "$env" in (value as object)) {
    const ref = value as { $env: string; type?: EnvCastType; default?: unknown };
    if (typeof ref.$env !== "string") {
      throw new EnvConfigError(`"$env" must be a string env var name`);
    }
    const raw = env[ref.$env];
    if (unset(raw)) {
      if ("default" in ref) return ref.default;
      throw new EnvConfigError(`missing required env var "${ref.$env}" (add a "default" to make it optional)`);
    }
    return castEnv(raw as string, ref.type ?? "string", ref.$env);
  }
  if (Array.isArray(value)) return value.map((v) => interpolateValue(v, env));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as object)) out[k] = interpolateValue(v, env);
    return out;
  }
  if (typeof value === "string") return interpolateString(value, env);
  return value;
}

/**
 * Return a copy of `workflow` with every node's config env-resolved against
 * `env`. Used by the engine on registration; safe to call on env-free workflows
 * (it just deep-clones the config).
 */
export function resolveWorkflowEnv(workflow: Workflow, env: EnvMap): Workflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((n) =>
      n.config === undefined ? n : { ...n, config: interpolateValue(n.config, env) },
    ),
  };
}
