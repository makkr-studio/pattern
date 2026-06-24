/**
 * @pattern-js/mod-ai — neutral messages → AI SDK ModelMessage[].
 *
 * The agent loop owns history in mod-agents' neutral, parts-based shape; here we
 * map it into the SDK's message format. Image parts resolve through mod-store's
 * blob store (duck-typed) into raw bytes, so vision works local-first.
 */

import type { OpContext } from "@pattern-js/core";
import type { NeutralMessage } from "@pattern-js/mod-agents";
import type { ModelMessage } from "./sdk.js";
import { blobStore } from "./well-known.js";

function textOf(content: NeutralMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.map((p) => (p.type === "text" ? p.text : "")).join("");
}

async function blobBytes(blobId: string, ctx: OpContext): Promise<Uint8Array> {
  const hit = await blobStore(ctx).blobs.get(blobId);
  if (!hit) throw new Error(`mod-ai: no blob "${blobId}" for an image part`);
  return new Uint8Array(await new Response(hit.stream).arrayBuffer());
}

export async function toModelMessages(messages: NeutralMessage[], ctx: OpContext): Promise<ModelMessage[]> {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      out.push({ role: "system", content: textOf(m.content) });
    } else if (m.role === "tool") {
      out.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: m.toolCallId ?? "",
            toolName: m.toolName ?? "",
            output: { type: "text", value: textOf(m.content) },
          },
        ],
      });
    } else if (m.role === "assistant") {
      if (m.toolCalls?.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parts: any[] = [];
        const t = textOf(m.content);
        if (t) parts.push({ type: "text", text: t });
        for (const tc of m.toolCalls) parts.push({ type: "tool-call", toolCallId: tc.callId, toolName: tc.toolName, input: tc.args });
        out.push({ role: "assistant", content: parts });
      } else {
        out.push({ role: "assistant", content: textOf(m.content) });
      }
    } else {
      // user
      if (typeof m.content === "string") {
        out.push({ role: "user", content: m.content });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parts: any[] = [];
        for (const p of m.content) {
          if (p.type === "text") parts.push({ type: "text", text: p.text });
          else parts.push({ type: "image", image: await blobBytes(p.blobId, ctx) });
        }
        out.push({ role: "user", content: parts });
      }
    }
  }
  return out;
}
