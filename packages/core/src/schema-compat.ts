/**
 * Structural schema compatibility for edges (§3).
 *
 * "The producer schema must be assignable to the consumer schema (structural
 * check at validation time; `z.any()` on either end is always compatible)."
 *
 * Zod has no built-in assignability relation, so this is a pragmatic structural
 * check that errs toward *permissive* — it rejects only clear mismatches
 * (string → number, object shape conflicts) and lets anything it cannot
 * confidently compare through, so valid graphs are never blocked by an
 * over-eager checker. This is a DX guardrail, not a soundness proof.
 */

import { z } from "zod";
import type { ZodAny } from "./types.js";

/** The Zod "type tag" of a schema (e.g. "string", "object", "array", "union"). */
function tag(schema: ZodAny): string {
  // Zod 4 exposes the def publicly as `schema.def` with a `.type` discriminant.
  return (schema as any)?.def?.type ?? "unknown";
}

/** Unwrap optional/nullable/default/readonly/catch wrappers to the inner schema. */
function unwrap(schema: ZodAny): ZodAny {
  let s = schema;
  // Guard against pathological deep nesting.
  for (let i = 0; i < 32; i++) {
    const t = tag(s);
    const def = (s as any)?.def;
    if ((t === "optional" || t === "nullable" || t === "readonly" || t === "catch") && def?.innerType) {
      s = def.innerType;
    } else if (t === "default" && def?.innerType) {
      s = def.innerType;
    } else if (t === "pipe" && def?.out) {
      s = def.out;
    } else {
      break;
    }
  }
  return s;
}

const WILDCARD = new Set(["any", "unknown", "never"]);

/**
 * Returns true if a value produced as `producer` can be consumed where
 * `consumer` is expected. Either side missing → compatible (untyped port).
 */
export function schemasCompatible(producer?: ZodAny, consumer?: ZodAny): boolean {
  if (!producer || !consumer) return true;
  return compat(unwrap(producer), unwrap(consumer), 0);
}

function compat(p: ZodAny, c: ZodAny, depth: number): boolean {
  if (depth > 8) return true; // give up gracefully on very deep schemas

  const pt = tag(p);
  const ct = tag(c);

  if (WILDCARD.has(pt) || WILDCARD.has(ct)) return true;

  // Unions: producer assignable if assignable to *some* consumer option;
  // a producer union is assignable only if *every* option is assignable.
  if (ct === "union") {
    const opts: ZodAny[] = (c as any).def?.options ?? [];
    if (pt === "union") {
      const popts: ZodAny[] = (p as any).def?.options ?? [];
      return popts.every((po) => opts.some((co) => compat(unwrap(po), unwrap(co), depth + 1)));
    }
    return opts.some((co) => compat(p, unwrap(co), depth + 1));
  }
  if (pt === "union") {
    const popts: ZodAny[] = (p as any).def?.options ?? [];
    return popts.every((po) => compat(unwrap(po), c, depth + 1));
  }

  // Literals are assignable to a matching primitive or equal literal.
  if (pt === "literal" && ct === "literal") {
    const pv: unknown[] = (p as any).def?.values ?? [];
    const cv: unknown[] = (c as any).def?.values ?? [];
    return pv.every((v) => cv.includes(v));
  }
  if (pt === "literal") {
    const pv: unknown[] = (p as any).def?.values ?? [];
    const jsType = typeof pv[0];
    return jsType === ct || (pv[0] === null && ct === "null");
  }
  if (pt === "enum" && ct === "string") return true;

  // Arrays / tuples: compare element schemas.
  if ((pt === "array" || pt === "tuple") && (ct === "array" || ct === "tuple")) {
    const pe = (p as any).def?.element;
    const ce = (c as any).def?.element;
    if (!pe || !ce) return true;
    return compat(unwrap(pe), unwrap(ce), depth + 1);
  }

  // Objects: every consumer-required key must exist in producer & be compatible.
  if (pt === "object" && ct === "object") {
    const ps = (p as any).def?.shape ?? {};
    const cs = (c as any).def?.shape ?? {};
    for (const key of Object.keys(cs)) {
      const cprop = unwrap(cs[key]);
      const optional = tag(cs[key]) === "optional" || WILDCARD.has(tag(cprop));
      const pprop = ps[key];
      if (!pprop) {
        if (optional) continue;
        return false;
      }
      if (!compat(unwrap(pprop), cprop, depth + 1)) return false;
    }
    return true;
  }

  // Records map to records/objects permissively.
  if (pt === "record" || ct === "record") return true;

  // Same primitive tag → compatible. Differing concrete tags → incompatible.
  return pt === ct;
}

/** Convenience: is this schema effectively a wildcard (`any`/`unknown`)? */
export function isWildcard(schema?: ZodAny): boolean {
  if (!schema) return true;
  return WILDCARD.has(tag(unwrap(schema)));
}

export const __testing = { tag, unwrap, compat };
export { z };
