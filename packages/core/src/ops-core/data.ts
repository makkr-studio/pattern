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
    inputs: { text: required(str) },
    compute: ({ text }) => JSON.parse(String(text)),
  }),
  pureOp({
    type: "core.json.stringify",
    inputs: { value: required() },
    output: str,
    config: z.object({ pretty: z.boolean().default(false) }),
    compute: ({ value: v }, ctx) => JSON.stringify(v, null, (ctx.config as { pretty: boolean }).pretty ? 2 : undefined),
  }),
  pureOp({ type: "core.encode.base64", inputs: { value: required(str) }, output: str, compute: ({ value: v }) => toBase64(String(v)) }),
  pureOp({ type: "core.decode.base64", inputs: { value: required(str) }, output: str, compute: ({ value: v }) => fromBase64(String(v)) }),
  pureOp({ type: "core.encode.url", inputs: { value: required(str) }, output: str, compute: ({ value: v }) => encodeURIComponent(String(v)) }),
  pureOp({ type: "core.decode.url", inputs: { value: required(str) }, output: str, compute: ({ value: v }) => decodeURIComponent(String(v)) }),
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
    inputs: { query: required(str) },
    output: z.record(z.string(), z.string()),
    compute: ({ query }) => Object.fromEntries(new URLSearchParams(String(query).replace(/^\?/, "")).entries()),
  }),
  pureOp({
    type: "core.query.build",
    inputs: { object: required(z.record(z.string(), z.unknown())) },
    output: str,
    compute: ({ object }) => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(object as object)) sp.set(k, String(v));
      return sp.toString();
    },
  }),
];
