/**
 * §12 — HTTP (outbound). `core.http.fetch` makes a request via the Web-standard
 * `fetch`. The response body is a value (text/json) or, with `config.stream`, a
 * `stream<Uint8Array>` for large/streamed responses. Honors `ctx.signal`.
 */

import { defineOp, value, stream, required, z } from "./helpers.js";
import type { OpDefinition, Ports } from "../types.js";

const headersSchema = z.record(z.string(), z.string());

export const httpFetch: OpDefinition = defineOp({
  type: "core.http.fetch",
  title: "core.http.fetch",
  description: "Outbound HTTP request via fetch. Inputs: { url, method?, headers?, body? }.",
  inputs: {
    url: required(z.string()),
    method: value(z.string()),
    headers: value(headersSchema),
    body: value(),
  },
  outputs: (config: { stream?: boolean }): Ports => ({
    status: value(z.number()),
    headers: value(headersSchema),
    body: config.stream ? stream(z.instanceof(Uint8Array)) : value(),
  }),
  config: z.object({
    stream: z.boolean().default(false),
    responseType: z.enum(["auto", "text", "json", "arrayBuffer"]).default("auto"),
  }),
  execute: async (ctx) => {
    const { stream: asStream, responseType } = ctx.config as {
      stream: boolean;
      responseType: "auto" | "text" | "json" | "arrayBuffer";
    };
    const [url, method, headersIn, body] = await Promise.all([
      ctx.input.value<string>("url"),
      ctx.input.value<string>("method"),
      ctx.input.value<Record<string, string>>("headers"),
      ctx.input.value<unknown>("body"),
    ]);

    const headers = new Headers(headersIn ?? {});
    let payload: BodyInit | undefined;
    if (body != null) {
      if (typeof body === "string" || body instanceof Uint8Array || body instanceof ArrayBuffer) {
        payload = body as BodyInit;
      } else {
        payload = JSON.stringify(body);
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
      }
    }

    const res = await fetch(url, {
      method: method ?? (body != null ? "POST" : "GET"),
      headers,
      body: payload,
      signal: ctx.signal,
    });

    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (outHeaders[k] = v));

    if (asStream) {
      return {
        status: res.status,
        headers: outHeaders,
        body: res.body ?? new ReadableStream({ start: (c) => c.close() }),
      };
    }

    const ct = res.headers.get("content-type") ?? "";
    let parsed: unknown;
    if (responseType === "json" || (responseType === "auto" && ct.includes("application/json"))) {
      parsed = await res.json();
    } else if (responseType === "arrayBuffer") {
      parsed = new Uint8Array(await res.arrayBuffer());
    } else {
      parsed = await res.text();
    }
    return { status: res.status, headers: outHeaders, body: parsed };
  },
});
