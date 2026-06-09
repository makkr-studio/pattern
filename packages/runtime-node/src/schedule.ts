/**
 * @pattern/runtime-node — schedule host (§7, §12).
 *
 * Fires `boundary.schedule` triggers on an interval or a 5-field cron. Results
 * are discarded or traced. Cron is evaluated once per minute against the local
 * clock (no external dependency).
 */

import type { Engine, Workflow } from "@pattern/core";

interface ScheduledTimer {
  stop: () => void;
}

/** Parse "m h dom mon dow" into per-field matchers. `*`, ranges, lists, steps. */
function cronMatcher(expr: string): (d: Date) => boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`invalid cron "${expr}" (expected 5 fields)`);
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ] as const;
  const matchers = fields.map((f, i) => fieldMatcher(f, ranges[i]![0], ranges[i]![1]));
  return (d: Date) =>
    matchers[0]!(d.getMinutes()) &&
    matchers[1]!(d.getHours()) &&
    matchers[2]!(d.getDate()) &&
    matchers[3]!(d.getMonth() + 1) &&
    matchers[4]!(d.getDay());
}

function fieldMatcher(field: string, min: number, max: number): (v: number) => boolean {
  if (field === "*") return () => true;
  const allowed = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    let lo = min;
    let hi = max;
    if (rangePart && rangePart !== "*") {
      const [a, b] = rangePart.split("-");
      lo = Number(a);
      hi = b !== undefined ? Number(b) : Number(a);
    }
    for (let v = lo; v <= hi; v += step) allowed.add(v);
  }
  return (v: number) => allowed.has(v);
}

export class ScheduleHost {
  /** Timers keyed by workflow id, so a redeploy/remove reconciles cleanly. */
  private timers = new Map<string, ScheduledTimer[]>();
  private unsubscribe?: () => void;

  constructor(private readonly engine: Engine) {}

  /**
   * Schedule every `boundary.schedule` trigger. With no argument it watches the
   * engine and **reacts to workflow changes at runtime** — a workflow deployed,
   * updated, or removed (e.g. from an admin) re-reconciles its timers live.
   * Passing an explicit list disables the live watch (one-shot scheduling).
   */
  start(workflows?: Workflow[]): this {
    if (workflows) {
      for (const wf of workflows) this.scheduleWorkflow(wf);
      return this;
    }
    for (const wf of this.engine.workflows.list()) this.scheduleWorkflow(wf);
    this.unsubscribe = this.engine.onWorkflowsChanged((change) => {
      this.clearWorkflow(change.id);
      if (change.type === "set" && change.workflow) this.scheduleWorkflow(change.workflow);
    });
    return this;
  }

  private scheduleWorkflow(wf: Workflow): void {
    const created: ScheduledTimer[] = [];
    for (const node of wf.nodes) {
      if (node.op !== "boundary.schedule") continue;
      const cfg = (node.config ?? {}) as { intervalMs?: number; cron?: string };
      if (cfg.intervalMs) created.push(this.everyInterval(wf, node.id, cfg.intervalMs));
      else if (cfg.cron) created.push(this.everyCron(wf, node.id, cfg.cron));
    }
    if (created.length) this.timers.set(wf.id, created);
  }

  private clearWorkflow(id: string): void {
    for (const t of this.timers.get(id) ?? []) t.stop();
    this.timers.delete(id);
  }

  private fire(wf: Workflow, triggerId: string, scheduledFor: number): void {
    void this.engine
      .runFrom(wf, triggerId, { timestamp: Date.now(), scheduledFor }, { kind: "anonymous" })
      .catch((err) => console.error(`[pattern] scheduled run "${wf.id}" failed:`, err));
  }

  private everyInterval(wf: Workflow, triggerId: string, ms: number): ScheduledTimer {
    const handle = setInterval(() => this.fire(wf, triggerId, Date.now()), ms);
    handle.unref?.();
    return { stop: () => clearInterval(handle) };
  }

  private everyCron(wf: Workflow, triggerId: string, expr: string): ScheduledTimer {
    const match = cronMatcher(expr);
    let last = "";
    const tick = () => {
      const now = new Date();
      const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
      if (minuteKey !== last && match(now)) {
        last = minuteKey;
        this.fire(wf, triggerId, now.getTime());
      }
    };
    const handle = setInterval(tick, 30_000);
    handle.unref?.();
    return { stop: () => clearInterval(handle) };
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const timers of this.timers.values()) for (const t of timers) t.stop();
    this.timers.clear();
  }
}

export function createScheduleHost(engine: Engine): ScheduleHost {
  return new ScheduleHost(engine);
}

export { cronMatcher };
