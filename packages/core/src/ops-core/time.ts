/**
 * §12 — Time. Timestamps are epoch milliseconds (numbers); formatting goes
 * through the Web-standard `Date`/`Intl` APIs. Note: `core.time.now` is
 * intentionally non-deterministic.
 */

import { defineOp, pureOp, required, value, z } from "./helpers.js";
import type { OpDefinition } from "../types.js";

const num = z.number();

const duration = z.object({
  ms: z.number().default(0),
  seconds: z.number().default(0),
  minutes: z.number().default(0),
  hours: z.number().default(0),
  days: z.number().default(0),
});

function durationToMs(d: z.infer<typeof duration>): number {
  return d.ms + d.seconds * 1000 + d.minutes * 60_000 + d.hours * 3_600_000 + d.days * 86_400_000;
}

export const timeOps: OpDefinition[] = [
  defineOp({
    type: "core.time.now",
    title: "core.time.now",
    description: "Current epoch timestamp in milliseconds (non-deterministic).",
    inputs: {},
    outputs: { out: value(num) },
    execute: () => ({ out: Date.now() }),
  }),
  pureOp({
    type: "core.time.parse",
    description: "Parse a date string/number into an epoch-ms timestamp.",
    inputs: { value: required() },
    output: num,
    compute: ({ value: v }) => {
      const t = typeof v === "number" ? v : Date.parse(String(v));
      if (Number.isNaN(t)) throw new Error(`cannot parse time: ${JSON.stringify(v)}`);
      return t;
    },
  }),
  pureOp({
    type: "core.time.format",
    description: "Format an epoch-ms timestamp. config: { format: 'iso'|'date'|'time'|'locale', locale? }.",
    inputs: { timestamp: required(num) },
    output: z.string(),
    config: z.object({ format: z.enum(["iso", "date", "time", "locale"]).default("iso"), locale: z.string().optional() }),
    compute: ({ timestamp }, ctx) => {
      const { format, locale } = ctx.config as { format: string; locale?: string };
      const d = new Date(Number(timestamp));
      switch (format) {
        case "date":
          return d.toISOString().slice(0, 10);
        case "time":
          return d.toISOString().slice(11, 19);
        case "locale":
          return d.toLocaleString(locale);
        default:
          return d.toISOString();
      }
    },
  }),
  pureOp({
    type: "core.time.add",
    description: "Adds a duration to a timestamp (ms). Input `{ timestamp }`; config `{ amount, unit }`.",
    inputs: { timestamp: required(num) },
    output: num,
    config: duration,
    compute: ({ timestamp }, ctx) => Number(timestamp) + durationToMs(ctx.config as z.infer<typeof duration>),
  }),
  pureOp({
    type: "core.time.subtract",
    description: "Subtracts a duration from a timestamp (ms). Input `{ timestamp }`; config `{ amount, unit }`.",
    inputs: { timestamp: required(num) },
    output: num,
    config: duration,
    compute: ({ timestamp }, ctx) => Number(timestamp) - durationToMs(ctx.config as z.infer<typeof duration>),
  }),
  pureOp({
    type: "core.time.diff",
    description: "Difference a - b in milliseconds.",
    inputs: { a: required(num), b: required(num) },
    output: num,
    compute: ({ a, b }) => Number(a) - Number(b),
  }),
];
