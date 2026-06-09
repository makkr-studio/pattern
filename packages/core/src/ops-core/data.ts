/**
 * §12 — Data & encoding: JSON, base64, URL-encoding, URL parse/build, query strings.
 *
 * All built on Web-standard primitives (`URL`, `URLSearchParams`, `TextEncoder`,
 * `btoa`/`atob`) so the core stays runtime-neutral.
 */

import { pureOp, required, value, z } from "./helpers.js";
import type { OpDefinition } from "../types.js";

const str = z.string();

/** UTF-8-safe base64 encode. */
function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** UTF-8-safe base64 decode. */
function fromBase64(input: string): string {
  const bin = atob(input);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export const dataOps: OpDefinition[] = [
  pureOp({
    type: "core.json.parse",
    description: "Parses a JSON string into a value. Input `{ text }`.",
    inputs: { text: required(str) },
    compute: ({ text }) => JSON.parse(String(text)),
  }),
  pureOp({
    type: "core.json.stringify",
    description: "Serializes a value to a JSON string. Input `{ value }`; config `{ pretty }` for 2-space indentation.",
    inputs: { value: required() },
    output: str,
    config: z.object({ pretty: z.boolean().default(false) }),
    compute: ({ value: v }, ctx) => JSON.stringify(v, null, (ctx.config as { pretty: boolean }).pretty ? 2 : undefined),
  }),
  pureOp({ type: "core.encode.base64", description: "Encodes a string to UTF-8-safe base64. Input `{ value }`.", inputs: { value: required(str) }, output: str, compute: ({ value: v }) => toBase64(String(v)) }),
  pureOp({ type: "core.decode.base64", description: "Decodes a UTF-8-safe base64 string. Input `{ value }`.", inputs: { value: required(str) }, output: str, compute: ({ value: v }) => fromBase64(String(v)) }),
  pureOp({ type: "core.encode.url", description: "URL-encodes a string via `encodeURIComponent`. Input `{ value }`.", inputs: { value: required(str) }, output: str, compute: ({ value: v }) => encodeURIComponent(String(v)) }),
  pureOp({ type: "core.decode.url", description: "URL-decodes a string via `decodeURIComponent`. Input `{ value }`.", inputs: { value: required(str) }, output: str, compute: ({ value: v }) => decodeURIComponent(String(v)) }),
  pureOp({
    type: "core.url.parse",
    description: "Parse a URL into { href, protocol, host, hostname, port, pathname, search, hash, query }.",
    inputs: { url: required(str) },
    output: z.record(z.string(), z.unknown()),
    compute: ({ url }) => {
      const u = new URL(String(url));
      return {
        href: u.href,
        protocol: u.protocol,
        host: u.host,
        hostname: u.hostname,
        port: u.port,
        pathname: u.pathname,
        search: u.search,
        hash: u.hash,
        query: Object.fromEntries(u.searchParams.entries()),
      };
    },
  }),
  pureOp({
    type: "core.url.build",
    description: "Build a URL from { base, pathname?, query? }.",
    inputs: { parts: required(z.record(z.string(), z.unknown())) },
    output: str,
    compute: ({ parts }) => {
      const p = parts as { base: string; pathname?: string; query?: Record<string, unknown> };
      const u = new URL(p.pathname ?? "", p.base);
      for (const [k, v] of Object.entries(p.query ?? {})) u.searchParams.set(k, String(v));
      return u.toString();
    },
  }),
  pureOp({
    type: "core.query.parse",
    description: "Parses a URL query string into an object of string values. Input `{ query }` (leading `?` optional).",
    inputs: { query: required(str) },
    output: z.record(z.string(), z.string()),
    compute: ({ query }) => Object.fromEntries(new URLSearchParams(String(query).replace(/^\?/, "")).entries()),
  }),
  pureOp({
    type: "core.query.build",
    description: "Builds a URL query string from an object. Input `{ object }`.",
    inputs: { object: required(z.record(z.string(), z.unknown())) },
    output: str,
    compute: ({ object }) => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(object as object)) sp.set(k, String(v));
      return sp.toString();
    },
  }),
];
