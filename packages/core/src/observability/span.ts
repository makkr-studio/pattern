/**
 * Pattern — OTLP-shaped, zero-dependency spans (§10).
 *
 * Core ships its own span types modeled on OTLP rather than pulling in the
 * OpenTelemetry SDK. A real OTLP exporter is an optional add-on/mod that
 * subscribes via `TraceSink`. We emit; we never persist.
 */

import type { Span, SpanData, SpanEvent, SpanStatus, TraceSink } from "../types.js";

const hex = "0123456789abcdef";

/** Random hex id of `bytes` length using the Web Crypto global. */
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += hex[(b >> 4) & 0xf]! + hex[b & 0xf]!;
  return out;
}

/** A 16-byte (32 hex) trace id, OTLP-style. */
export const newTraceId = (): string => randomHex(16);
/** An 8-byte (16 hex) span id, OTLP-style. */
export const newSpanId = (): string => randomHex(8);

/** A TraceSink that fans out to many sinks; the engine's subscription point. */
export class MultiTraceSink implements TraceSink {
  private sinks = new Set<TraceSink>();

  add(sink: TraceSink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  onRunStart(run: Parameters<NonNullable<TraceSink["onRunStart"]>>[0]): void {
    for (const s of this.sinks) s.onRunStart?.(run);
  }
  onSpanEnd(span: SpanData): void {
    for (const s of this.sinks) s.onSpanEnd?.(span);
  }
  onRunEnd(run: Parameters<NonNullable<TraceSink["onRunEnd"]>>[0]): void {
    for (const s of this.sinks) s.onRunEnd?.(run);
  }
}

/** A live span. On `end()` it snapshots itself to the sink (one per node, §10). */
export class SpanImpl implements Span {
  readonly traceId: string;
  readonly spanId: string;
  private readonly parentSpanId?: string;
  private readonly name: string;
  private readonly startTime: number;
  private readonly attributes: Record<string, unknown> = {};
  private readonly events: SpanEvent[] = [];
  private status: SpanStatus = "unset";
  private error?: { message: string; stack?: string };
  private ended = false;
  private readonly sink?: TraceSink;

  constructor(opts: { traceId: string; name: string; parentSpanId?: string; sink?: TraceSink }) {
    this.traceId = opts.traceId;
    this.spanId = newSpanId();
    this.parentSpanId = opts.parentSpanId;
    this.name = opts.name;
    this.sink = opts.sink;
    this.startTime = Date.now();
  }

  setAttribute(key: string, value: unknown): void {
    this.attributes[key] = value;
  }
  setAttributes(attrs: Record<string, unknown>): void {
    Object.assign(this.attributes, attrs);
  }
  addEvent(name: string, attributes?: Record<string, unknown>): void {
    this.events.push({ name, time: Date.now(), attributes });
  }
  setStatus(status: SpanStatus, error?: unknown): void {
    this.status = status;
    if (status === "error" && error !== undefined) {
      this.error =
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : { message: String(error) };
    }
  }
  startChild(name: string): Span {
    return new SpanImpl({ traceId: this.traceId, name, parentSpanId: this.spanId, sink: this.sink });
  }
  end(): void {
    if (this.ended) return;
    this.ended = true;
    const data: SpanData = {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      startTime: this.startTime,
      endTime: Date.now(),
      attributes: this.attributes,
      events: this.events,
      status: this.status === "unset" ? "ok" : this.status,
      error: this.error,
    };
    this.sink?.onSpanEnd?.(data);
  }
}

/** A do-nothing sink — the engine default (§10). */
export const noopTraceSink: TraceSink = {};
