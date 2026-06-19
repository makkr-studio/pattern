/**
 * Pattern — bounded I/O sampling for trace spans (admin-spec T1).
 *
 * When a run opts into I/O sampling, each node span records a small, capped
 * preview of its port values so the admin's run-replay can show "what flowed
 * here". Sampling is **off by default**; replay works structurally without it.
 *
 * Two hard rules keep it safe:
 *  - **Bounded** — each value preview is capped (~4 KB); over-cap values are
 *    truncated and flagged. Streams are marked, not drained (draining a stream
 *    to sample it would change run behavior), so their sample is a placeholder.
 *  - **Masked** — an optional `mask` hook (the engine wires its secret redaction)
 *    runs over every previewed value before it is stored.
 */

import type { IoSample } from "../types.js";

/** Soft cap on a single value preview, in bytes of its JSON encoding. */
export const SAMPLE_CAP = 4096;

export type MaskFn = (value: unknown) => unknown;

/** Produce a bounded, masked sample of a single value port's data. */
export function sampleValue(value: unknown, mask?: MaskFn): IoSample {
  const masked = mask ? mask(value) : value;
  let json: string;
  try {
    json = JSON.stringify(masked) ?? String(masked);
  } catch {
    return { kind: "value", preview: String(masked), truncated: true };
  }
  if (json.length > SAMPLE_CAP) {
    return { kind: "value", preview: `${json.slice(0, SAMPLE_CAP)}…`, truncated: true };
  }
  // Round-trip so the preview is structured data, not a JSON string, when small.
  try {
    return { kind: "value", preview: JSON.parse(json) };
  } catch {
    return { kind: "value", preview: masked };
  }
}

/**
 * A glimpse of a single stream chunk for replay scrubbing: masked, clipped to a
 * tight `cap` (a glimpse is enough to follow a token stream; binary is unreadable
 * regardless), and reporting the byte size it cost so the caller can hold a
 * per-stream budget. Unlike {@link sampleValue} the preview stays a string — one
 * chunk is a fragment, not a structured port value.
 */
export function sampleChunk(value: unknown, cap: number, mask?: MaskFn): { preview: string; truncated: boolean; bytes: number } {
  const masked = mask ? mask(value) : value;
  let s: string;
  try {
    s = typeof masked === "string" ? masked : (JSON.stringify(masked) ?? String(masked));
  } catch {
    s = String(masked);
  }
  if (s.length > cap) return { preview: `${s.slice(0, cap)}…`, truncated: true, bytes: cap };
  return { preview: s, truncated: false, bytes: s.length };
}

/**
 * A placeholder sample for a stream port. We never drain the stream to sample it
 * (that would consume data meant for downstream consumers and change behavior),
 * so the head is empty and the sample is flagged truncated.
 */
export function streamSample(): IoSample {
  return { kind: "stream", head: [], count: 0, truncated: true };
}
