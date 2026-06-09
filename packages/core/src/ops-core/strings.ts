/**
 * §12 — Strings.
 *
 * Data flows on ports; knobs (separators, regex flags, template text) live in
 * config. `template` interpolates `{{ path }}` placeholders from a `data` object
 * using dot-path lookup.
 */

import { pureOp, required, value, z } from "./helpers.js";
import type { OpDefinition } from "../types.js";
import { getPath } from "./objects.js";

const str = z.string();

export const stringOps: OpDefinition[] = [
  pureOp({
    type: "core.string.concat",
    inputs: { values: required(z.array(z.string())) },
    output: str,
    compute: ({ values }) => (values as string[]).join(""),
  }),
  pureOp({
    type: "core.string.join",
    inputs: { values: required(z.array(z.unknown())) },
    output: str,
    config: z.object({ separator: z.string().default(",") }),
    compute: ({ values }, ctx) => (values as unknown[]).join((ctx.config as { separator: string }).separator),
  }),
  pureOp({
    type: "core.string.split",
    inputs: { value: required(str) },
    output: z.array(str),
    config: z.object({ separator: z.string().default(""), limit: z.number().int().optional() }),
    compute: ({ value: v }, ctx) => {
      const { separator, limit } = ctx.config as { separator: string; limit?: number };
      return String(v).split(separator, limit);
    },
  }),
  pureOp({
    type: "core.string.replace",
    description: "Replace literal or regex matches. config: { search, replacement, regex?, flags? }.",
    inputs: { value: required(str) },
    output: str,
    config: z.object({
      search: z.string(),
      replacement: z.string().default(""),
      regex: z.boolean().default(false),
      flags: z.string().default("g"),
    }),
    compute: ({ value: v }, ctx) => {
      const { search, replacement, regex, flags } = ctx.config as {
        search: string;
        replacement: string;
        regex: boolean;
        flags: string;
      };
      const pattern = regex ? new RegExp(search, flags) : new RegExp(escapeRegExp(search), flags);
      return String(v).replace(pattern, replacement);
    },
  }),
  pureOp({ type: "core.string.trim", inputs: { value: required(str) }, output: str, compute: ({ value: v }) => String(v).trim() }),
  pureOp({ type: "core.string.lower", inputs: { value: required(str) }, output: str, compute: ({ value: v }) => String(v).toLowerCase() }),
  pureOp({ type: "core.string.upper", inputs: { value: required(str) }, output: str, compute: ({ value: v }) => String(v).toUpperCase() }),
  pureOp({
    type: "core.string.slice",
    inputs: { value: required(str) },
    output: str,
    config: z.object({ start: z.number().int().default(0), end: z.number().int().optional() }),
    compute: ({ value: v }, ctx) => {
      const { start, end } = ctx.config as { start: number; end?: number };
      return String(v).slice(start, end);
    },
  }),
  pureOp({ type: "core.string.length", inputs: { value: required(str) }, output: z.number(), compute: ({ value: v }) => String(v).length }),
  pureOp({
    type: "core.string.includes",
    inputs: { value: required(str), search: required(str) },
    output: z.boolean(),
    compute: ({ value: v, search }) => String(v).includes(String(search)),
  }),
  pureOp({
    type: "core.string.startsWith",
    inputs: { value: required(str), search: required(str) },
    output: z.boolean(),
    compute: ({ value: v, search }) => String(v).startsWith(String(search)),
  }),
  pureOp({
    type: "core.string.endsWith",
    inputs: { value: required(str), search: required(str) },
    output: z.boolean(),
    compute: ({ value: v, search }) => String(v).endsWith(String(search)),
  }),
  pureOp({
    type: "core.string.match",
    description: "Regex match → array of matches (or null). config: { pattern, flags? }.",
    inputs: { value: required(str) },
    output: z.array(str).nullable(),
    config: z.object({ pattern: z.string(), flags: z.string().default("") }),
    compute: ({ value: v }, ctx) => {
      const { pattern, flags } = ctx.config as { pattern: string; flags: string };
      const m = String(v).match(new RegExp(pattern, flags));
      return m ? [...m] : null;
    },
  }),
  pureOp({
    type: "core.string.pad",
    inputs: { value: required(str) },
    output: str,
    config: z.object({
      length: z.number().int(),
      side: z.enum(["start", "end"]).default("start"),
      fill: z.string().default(" "),
    }),
    compute: ({ value: v }, ctx) => {
      const { length, side, fill } = ctx.config as { length: number; side: "start" | "end"; fill: string };
      return side === "start" ? String(v).padStart(length, fill) : String(v).padEnd(length, fill);
    },
  }),
  pureOp({
    type: "core.string.template",
    description: "Interpolate {{ dot.path }} placeholders from the `data` object.",
    inputs: { data: required(z.record(z.string(), z.unknown())) },
    output: str,
    config: z.object({ template: z.string() }),
    compute: ({ data }, ctx) => {
      const { template } = ctx.config as { template: string };
      return template.replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (_, path: string) => {
        const v = getPath(data, path);
        return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      });
    },
  }),
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
