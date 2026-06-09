/**
 * §12 — Crypto / random. Hashing and HMAC go through Web Crypto (`crypto.subtle`),
 * randomness through `crypto.getRandomValues` / `crypto.randomUUID`.
 */

import { defineOp, pureOp, required, value, z } from "./helpers.js";
import type { OpDefinition } from "../types.js";

const HASH_ALGOS = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const;

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function toBase64(buf: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin);
}

const encode = (buf: ArrayBuffer, encoding: "hex" | "base64") => (encoding === "hex" ? toHex(buf) : toBase64(buf));

/** Cryptographically-strong uniform float in [0, 1). */
function randomFloat(): number {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  // 53-bit mantissa from two 32-bit words.
  return (buf[0]! * 2 ** 21 + (buf[1]! >>> 11)) / 2 ** 53;
}

export const cryptoOps: OpDefinition[] = [
  defineOp({
    type: "core.random.number",
    title: "core.random.number",
    description: "Random number in [min, max). config: { min, max, integer? } (non-deterministic).",
    inputs: {},
    outputs: { out: value(z.number()) },
    config: z.object({ min: z.number().default(0), max: z.number().default(1), integer: z.boolean().default(false) }),
    execute: (ctx) => {
      const { min, max, integer } = ctx.config as { min: number; max: number; integer: boolean };
      const r = min + randomFloat() * (max - min);
      return { out: integer ? Math.floor(r) : r };
    },
  }),
  defineOp({
    type: "core.random.uuid",
    title: "core.random.uuid",
    description: "Random UUID v4 (non-deterministic).",
    inputs: {},
    outputs: { out: value(z.string()) },
    execute: () => ({ out: crypto.randomUUID() }),
  }),
  defineOp({
    type: "core.random.pick",
    title: "core.random.pick",
    description: "Pick a random element from an array (non-deterministic).",
    inputs: { values: required(z.array(z.unknown())) },
    outputs: { out: value() },
    execute: async (ctx) => {
      const values = (await ctx.input.value<unknown[]>("values")) ?? [];
      if (values.length === 0) return { out: undefined };
      return { out: values[Math.floor(randomFloat() * values.length)] };
    },
  }),
  pureOp({
    type: "core.hash",
    description: "Hash a string. config: { algorithm: SHA-256|…, encoding: hex|base64 }.",
    inputs: { value: required(z.string()) },
    output: z.string(),
    config: z.object({ algorithm: z.enum(HASH_ALGOS).default("SHA-256"), encoding: z.enum(["hex", "base64"]).default("hex") }),
    compute: async ({ value: v }, ctx) => {
      const { algorithm, encoding } = ctx.config as { algorithm: (typeof HASH_ALGOS)[number]; encoding: "hex" | "base64" };
      const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(String(v)));
      return encode(digest, encoding);
    },
  }),
  pureOp({
    type: "core.crypto.hmac",
    description: "HMAC of `value` with `key`. config: { algorithm, encoding }.",
    inputs: { value: required(z.string()), key: required(z.string()) },
    output: z.string(),
    config: z.object({ algorithm: z.enum(["SHA-256", "SHA-384", "SHA-512"]).default("SHA-256"), encoding: z.enum(["hex", "base64"]).default("hex") }),
    compute: async ({ value: v, key }, ctx) => {
      const { algorithm, encoding } = ctx.config as { algorithm: string; encoding: "hex" | "base64" };
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(String(key)),
        { name: "HMAC", hash: algorithm },
        false,
        ["sign"],
      );
      const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(String(v)));
      return encode(sig, encoding);
    },
  }),
];
