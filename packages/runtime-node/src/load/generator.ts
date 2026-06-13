/**
 * The open-loop request generator. Requests launch at a fixed arrival rate on
 * a schedule — NOT after the previous one returns. That distinction is the
 * whole point: closed-loop (fixed concurrency) self-throttles when the server
 * slows, so it measures the server's pace, not its capacity. Open-loop keeps
 * the pressure constant and lets latency reveal the ceiling.
 *
 * Latency is measured from the SCHEDULED time, not the send time — so a
 * generator that itself falls behind still attributes that lag to latency
 * (coordinated-omission-free).
 */

import type { LoadRequest, LoadStage, RequestSample } from "./types.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** Build a weighted picker over the request mix (cumulative-weight search). */
function picker(requests: LoadRequest[]): () => LoadRequest {
  const cum: number[] = [];
  let total = 0;
  for (const r of requests) {
    total += r.weight ?? 1;
    cum.push(total);
  }
  return () => {
    const x = Math.random() * total;
    for (let i = 0; i < cum.length; i++) if (x < cum[i]!) return requests[i]!;
    return requests[requests.length - 1]!;
  };
}

const labelOf = (r: LoadRequest): string => r.label ?? `${r.method} ${r.path}`;

async function fire(baseUrl: string, req: LoadRequest, scheduledAt: number, sink: RequestSample[]): Promise<void> {
  const sentAt = performance.now();
  const url = /^https?:\/\//.test(req.path) ? req.path : `${baseUrl}${req.path}`;
  const hasBody = req.body !== undefined && req.method !== "GET" && req.method !== "HEAD";
  const body = hasBody ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body)) : undefined;
  const headers = { ...(hasBody && typeof req.body !== "string" ? { "content-type": "application/json" } : {}), ...req.headers };
  try {
    const res = await fetch(url, { method: req.method, headers, body });
    const buf = await res.arrayBuffer(); // drain so timing includes the full body
    sink.push({
      scheduledAt,
      sentAt,
      endedAt: performance.now(),
      status: res.status,
      ok: res.ok,
      bytes: buf.byteLength,
      label: labelOf(req),
    });
  } catch (err) {
    sink.push({
      scheduledAt,
      sentAt,
      endedAt: performance.now(),
      status: 0,
      ok: false,
      bytes: 0,
      label: labelOf(req),
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Run one constant-rate stage. Fires `rate` req/s for `durationMs`, launching
 * each request without awaiting it (open-loop), bounded by `maxInflight` as a
 * memory backstop. Resolves once every launched request has settled.
 */
export async function runStage(
  baseUrl: string,
  stage: LoadStage,
  requests: LoadRequest[],
  maxInflight: number,
): Promise<RequestSample[]> {
  const samples: RequestSample[] = [];
  const pick = picker(requests);
  const interval = 1000 / stage.rate;
  const count = Math.max(1, Math.round((stage.rate * stage.durationMs) / 1000));
  const t0 = performance.now();
  const inflight = new Set<Promise<void>>();
  let dropped = 0;

  for (let i = 0; i < count; i++) {
    const due = t0 + i * interval;
    const wait = due - performance.now();
    if (wait > 1) await sleep(wait);

    if (inflight.size >= maxInflight) {
      dropped++;
      continue; // backstop: never let the queue grow unbounded
    }
    const p = fire(baseUrl, pick(), due, samples).finally(() => inflight.delete(p));
    inflight.add(p);
  }
  await Promise.all(inflight);
  if (dropped > 0) {
    // Surfaced, never silent — a dropped request means the cap bit.
    console.error(`  ! ${dropped} request(s) skipped (maxInflight=${maxInflight} reached — server can't keep up at ${stage.rate}/s)`);
  }
  return samples;
}
