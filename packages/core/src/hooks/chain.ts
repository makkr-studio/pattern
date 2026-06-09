/**
 * Pattern — hook chain runner (§8).
 *
 * The `apply_filters` / Tapable pattern: a named, blocking, priority-ordered
 * pipeline that threads a payload through every registered workflow and returns
 * the final result. Each member runs as its own run (own Principal/context).
 *
 *  - Priority is the sole ordering key, ascending (lower first), default 100.
 *  - Fail-fast: a throwing member aborts the chain.
 *  - Short-circuit: a member's out-gate may set `stop: true` to halt the rest.
 *  - Payloads are Zod-validated against the hook's declared schema.
 *  - A recursion guard trips when invocation depth exceeds `maxDepth` (default 16).
 *
 * Depth is threaded **explicitly** per call chain (`invoke(name, payload, depth)`
 * → run → nested `core.hook.invoke` carries `depth + 1` back in): core is
 * runtime-neutral, so no AsyncLocalStorage — and an explicit number survives
 * the worker-transport seam, which thread-locals never could. A shared instance
 * counter is wrong the other way: N *concurrent* invocations would read as N
 * levels of recursion and trip the guard spuriously.
 */

import { HookRecursionError } from "../errors.js";
import type { HookRegistry, WorkflowRegistry } from "../registry.js";
import { ANONYMOUS, type HookInvoker, type Principal, type RunResult, type Workflow } from "../types.js";

export type HookRunFn = (
  workflow: Workflow,
  triggerNodeId: string,
  input: Record<string, unknown>,
  principal: Principal,
  /** Hook-chain depth the spawned run inherits (its nested invokes resume here). */
  hookDepth: number,
) => Promise<RunResult>;

export class HookChainRunner implements HookInvoker {
  constructor(
    private readonly hooks: HookRegistry,
    private readonly workflows: WorkflowRegistry,
    private readonly runFrom: HookRunFn,
  ) {}

  async invoke(name: string, payload: unknown, depth = 0): Promise<unknown> {
    const def = this.hooks.definition(name);
    const maxDepth = def?.maxDepth ?? 16;
    if (depth >= maxDepth) throw new HookRecursionError(name, maxDepth);

    // Validate the incoming payload against the declared schema (§8).
    let current = payload;
    if (def?.payload) {
      const parsed = def.payload.safeParse(current);
      if (!parsed.success) {
        throw new Error(`Hook "${name}" payload is invalid: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);
      }
      current = parsed.data;
    }

    const regs = this.hooks.registrations(name);
    for (const reg of regs) {
      const wf = this.workflows.get(reg.workflowId);
      if (!wf) continue;
      const res = await this.runFrom(wf, reg.nodeId, { payload: current }, ANONYMOUS, depth + 1);
      if (res.status === "error") throw res.error; // fail-fast
      const out = firstOutput(res.outputs);
      if (out && "payload" in out) current = out.payload;
      if (out && out.stop === true) break; // short-circuit
    }
    // Re-validate the final payload so downstream consumers get the declared type.
    if (def?.payload) {
      const parsed = def.payload.safeParse(current);
      if (parsed.success) current = parsed.data;
    }
    return current;
  }
}

function firstOutput(outputs: Record<string, Record<string, unknown>>): Record<string, unknown> | undefined {
  const values = Object.values(outputs);
  return values[0];
}
