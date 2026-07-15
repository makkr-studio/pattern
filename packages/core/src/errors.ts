/**
 * Pattern — error types.
 *
 * Validation errors are a first-class DX feature (§6, §12): every issue names
 * the offending node/port and reads like a sentence. Zod's issue tree feeds the
 * messages where config/schema parsing is involved.
 */

/** A single, human-readable validation issue located in the workflow document. */
export interface ValidationIssue {
  message: string;
  /** The node the issue concerns, if any. */
  nodeId?: string;
  /** The port the issue concerns, if any. */
  port?: string;
  /** Dotted path inside a config object, if any (from Zod). */
  path?: string;
  /** Stable machine code for programmatic handling. */
  code?: string;
  /**
   * "error" (default) blocks registration; "warning" is advisory — surfaced in
   * the editor and on save, but the workflow still validates and runs.
   */
  severity?: "error" | "warning";
}

/** Thrown by `validateWorkflow` when a workflow document is invalid (§6). */
export class WorkflowValidationError extends Error {
  readonly issues: ValidationIssue[];
  readonly workflowId?: string;

  constructor(issues: ValidationIssue[], workflowId?: string) {
    super(WorkflowValidationError.format(issues, workflowId));
    this.name = "WorkflowValidationError";
    this.issues = issues;
    this.workflowId = workflowId;
  }

  private static format(issues: ValidationIssue[], workflowId?: string): string {
    const head = `Workflow${workflowId ? ` "${workflowId}"` : ""} is invalid (${issues.length} issue${
      issues.length === 1 ? "" : "s"
    }):`;
    const lines = issues.map((i) => {
      const loc = [
        i.nodeId ? `node "${i.nodeId}"` : undefined,
        i.port ? `port "${i.port}"` : undefined,
        i.path ? `at ${i.path}` : undefined,
      ]
        .filter(Boolean)
        .join(", ");
      return `  • ${i.message}${loc ? ` (${loc})` : ""}`;
    });
    return [head, ...lines].join("\n");
  }
}

/** Raised at runtime when a node's op throws. Carries the locating context. */
export class NodeExecutionError extends Error {
  readonly nodeId: string;
  readonly opType: string;
  override readonly cause: unknown;

  constructor(nodeId: string, opType: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Node "${nodeId}" (${opType}) failed: ${reason}`);
    this.name = "NodeExecutionError";
    this.nodeId = nodeId;
    this.opType = opType;
    this.cause = cause;
  }
}

/** One mismatch between a trigger's declared schema and the seeded run input. */
export interface TriggerInputIssue {
  /** The trigger output port the value was seeded into (e.g. "body"). */
  port: string;
  /** Dotted path inside the value (from Zod). */
  path: string;
  message: string;
}

/**
 * Raised when a run's external input fails the trigger's declared validation
 * schemas (§7) — e.g. an http.request body schema. Enforced by the engine when
 * seeding trigger outputs, so it holds for every entry path (hosts, editor
 * runs, ctx.invoke), not just routes the HTTP host fronts.
 */
export class TriggerInputError extends Error {
  readonly triggerNodeId: string;
  readonly issues: TriggerInputIssue[];

  constructor(triggerNodeId: string, issues: TriggerInputIssue[]) {
    const detail = issues.map((i) => `${i.port}${i.path ? `.${i.path}` : ""} — ${i.message}`).join("; ");
    super(`invalid trigger input: ${detail}`);
    this.name = "TriggerInputError";
    this.triggerNodeId = triggerNodeId;
    this.issues = issues;
  }
}

/**
 * The abort reason cancellation paths pass (admin cancel, client disconnect,
 * worker abort). Distinguishes "someone stopped this run" from "a node failed",
 * so the run records `status: "canceled"` instead of `"error"`.
 */
export class RunCanceled extends Error {
  constructor(message = "run canceled") {
    super(message);
    this.name = "RunCanceled";
  }
}

/** True when `v` is a cancellation reason (unwraps NodeExecutionError; matches
 *  by name so a reason that crossed a transport seam still counts). */
export function isRunCanceled(v: unknown): boolean {
  if (!(v instanceof Error)) return false;
  if (v.name === "RunCanceled") return true;
  if (v instanceof NodeExecutionError) return isRunCanceled(v.cause);
  return false;
}

/** Raised by `core.flow.throw` / `core.flow.assert` and surfaced to an enclosing `try`. */
export class WorkflowError extends Error {
  readonly data?: unknown;
  constructor(message: string, data?: unknown) {
    super(message);
    this.name = "WorkflowError";
    this.data = data;
  }
}

/**
 * Raised when a durable resume would re-run external-effects nodes whose fate
 * is AMBIGUOUS — recorded `started` with no terminal record (a crash
 * mid-execute), so the side effect may or may not have happened. The caller
 * lists the nodes to a human and retries with `confirmExternal: true`.
 * (A node that recorded its own `error` re-runs without confirmation — the op
 * reported its failure, that's what makes "fix creds → resume" work.)
 */
export class ResumeBlockedError extends Error {
  readonly nodes: Array<{ nodeId: string; op: string }>;

  constructor(nodes: Array<{ nodeId: string; op: string }>) {
    const list = nodes.map((n) => `"${n.nodeId}" (${n.op})`).join(", ");
    super(
      `resume blocked: ${list} ${nodes.length === 1 ? "is" : "are"} external-effect node${
        nodes.length === 1 ? "" : "s"
      } that started but never finished — the effect may already have happened. Confirm to re-run them anyway.`,
    );
    this.name = "ResumeBlockedError";
    this.nodes = nodes;
  }
}

/** Raised when a hook chain exceeds its recursion guard (§8). */
export class HookRecursionError extends Error {
  constructor(hook: string, maxDepth: number) {
    super(`Hook "${hook}" exceeded maxDepth ${maxDepth} (recursion guard).`);
    this.name = "HookRecursionError";
  }
}
