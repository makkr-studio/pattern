/**
 * @pattern/mod-agents-openai — run input shaping.
 *
 * `agents.run` accepts a plain string, a PARTS array ({text | image_ref}),
 * or pre-shaped provider items. Image refs resolve through mod-store's blob
 * service (duck-typed by key — no package dependency) into base64 data URLs:
 * vision works local-first, no public URL needed.
 */

import type { AgentInputItem } from "@openai/agents";
import type { OpContext } from "@pattern/core";
import { messagePartSchema, type MessagePart } from "@pattern/mod-agents";
import { STORE_SERVICE_KEY, type BlobStoreLike } from "./well-known.js";

async function blobToDataUrl(blobId: string, ctx: OpContext): Promise<string> {
  const store = ctx.services[STORE_SERVICE_KEY] as BlobStoreLike | undefined;
  if (!store) {
    throw new Error("agents: image parts need @pattern/mod-store installed (blob ids resolve through it)");
  }
  const hit = await store.blobs.get(blobId);
  if (!hit) throw new Error(`agents: no blob "${blobId}" for image part`);
  const bytes = new Uint8Array(await new Response(hit.stream).arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${hit.meta.mime};base64,${btoa(bin)}`;
}

function looksLikeParts(v: unknown): v is MessagePart[] {
  return Array.isArray(v) && v.length > 0 && v.every((p) => messagePartSchema.safeParse(p).success);
}

/** Shape the user turn: string | parts → one user message; items pass through. */
export async function toInputItems(input: unknown, ctx: OpContext): Promise<AgentInputItem[]> {
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }
  if (looksLikeParts(input)) {
    const content: Array<Record<string, unknown>> = [];
    for (const part of input) {
      if (part.type === "text") content.push({ type: "input_text", text: part.text });
      else content.push({ type: "input_image", image: await blobToDataUrl(part.blobId, ctx) });
    }
    return [{ role: "user", content } as never];
  }
  if (Array.isArray(input)) return input as AgentInputItem[];
  throw new Error("agents.run: input must be a string, a parts array, or provider items");
}
