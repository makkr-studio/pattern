/**
 * Pattern — the rate-limit brick.
 *
 * One small sliding-window counter, shared by the HTTP host's per-route
 * `rateLimit` (429 before the run starts) and the `core.flow.throttle` op
 * (pulse `out` or `limited` inside a workflow). In-process: each instance
 * counts its own traffic, which bounds a single process's spend; a fleet
 * behind a load balancer multiplies the ceiling by its instance count.
 *
 * The estimate is the classic two-window blend: the previous window's count,
 * weighted by how much of it still overlaps the sliding window, plus the
 * current window's count. It avoids the fixed-window "2× burst at the
 * boundary" without keeping a timestamp per hit.
 */

export interface RateLimitRule {
  /** Hits allowed per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitVerdict {
  ok: boolean;
  /** Hits left in the sliding window after this one (0 when refused). */
  remaining: number;
  /** When refused: milliseconds until a hit would be allowed again (0 when ok). */
  retryAfterMs: number;
}

interface Bucket {
  windowStart: number;
  curr: number;
  prev: number;
  windowMs: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxKeys: number;

  constructor(opts: { maxKeys?: number } = {}) {
    this.maxKeys = opts.maxKeys ?? 100_000;
  }

  /** Count one hit against `key` under `rule`. A refused hit is not counted. */
  hit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitVerdict {
    const windowMs = Math.max(1, rule.windowMs);
    const max = Math.max(0, Math.floor(rule.max));
    let b = this.buckets.get(key);
    const aligned = now - (now % windowMs);
    if (!b || b.windowMs !== windowMs) {
      b = { windowStart: aligned, curr: 0, prev: 0, windowMs };
      this.buckets.set(key, b);
      this.prune(now);
    } else if (aligned !== b.windowStart) {
      // Rolled forward: one window keeps the old count as `prev`; more drops it.
      b.prev = aligned - b.windowStart === windowMs ? b.curr : 0;
      b.curr = 0;
      b.windowStart = aligned;
    }
    const overlap = 1 - (now - b.windowStart) / windowMs;
    const estimate = b.prev * overlap + b.curr;
    if (estimate + 1 > max) {
      return { ok: false, remaining: 0, retryAfterMs: this.retryAfter(b, max, now) };
    }
    b.curr++;
    return { ok: true, remaining: Math.max(0, Math.floor(max - estimate - 1)), retryAfterMs: 0 };
  }

  /** Forget every counter (tests, or an operator reset). */
  clear(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }

  /** The soonest moment the blended estimate drops below `max`. */
  private retryAfter(b: Bucket, max: number, now: number): number {
    const end = b.windowStart + b.windowMs;
    // Within this window, only `prev`'s weight decays: solve prev·(1−t/w)+curr+1 ≤ max.
    if (b.prev > 0 && b.curr + 1 <= max) {
      const t = b.windowMs * (1 - (max - 1 - b.curr) / b.prev);
      const at = b.windowStart + Math.max(0, t);
      if (at < end) return Math.max(1, Math.ceil(at - now));
    }
    // Otherwise the next window: curr becomes prev and decays from full weight.
    const prev = b.curr;
    if (prev === 0 || max < 1) return Math.max(1, end - now);
    const t = b.windowMs * (1 - (max - 1) / prev);
    return Math.max(1, Math.ceil(end + Math.max(0, t) - now));
  }

  /** Bound memory: expired buckets go first, then the oldest-created ones. */
  private prune(now: number): void {
    if (this.buckets.size <= this.maxKeys) return;
    for (const [k, b] of this.buckets) {
      if (now - b.windowStart >= 2 * b.windowMs) this.buckets.delete(k);
    }
    const target = Math.floor(this.maxKeys * 0.9);
    for (const k of this.buckets.keys()) {
      if (this.buckets.size <= target) break;
      this.buckets.delete(k);
    }
  }
}

/** Parse a duration: a number of ms, or "30s" / "15m" / "1h" / "1d". */
export function parseDurationMs(v: number | string): number {
  if (typeof v === "number") return v;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?\s*$/.exec(v);
  if (!m) throw new Error(`invalid duration "${v}" (use ms, or e.g. "30s", "15m", "1h")`);
  const n = Number(m[1]);
  const unit = m[2] ?? "ms";
  const mult = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return Math.round(n * mult);
}
