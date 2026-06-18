/**
 * Pattern — load-time workflow validation (§6).
 *
 * Runs the spec's validation checklist and produces human-readable issues that
 * name the offending node/port (§6, §12):
 *
 *   1. Every node references a registered op; every config parses.
 *   2. Every edge references existing nodes/ports.
 *   3. Edge endpoints have matching kind and compatible schemas (§3).
 *   4. No cycles (all edge kinds).
 *   5. At least one trigger and a reachable out-gate for it (§7).
 *
 * `validateWorkflow` returns the parsed `Workflow` on success and throws
 * `WorkflowValidationError` on failure. `collectIssues` is the non-throwing core.
 */

import { z } from "zod";
import { WorkflowValidationError, type ValidationIssue } from "./errors.js";
import type { OpRegistry } from "./registry.js";
import {
  detectCycle,
  edgeInto,
  edgesInto,
  findOutGateNodes,
  findTriggerNodes,
  portKindOf,
  reachableFrom,
  resolveConfigInputs,
  resolvePorts,
} from "./graph.js";
import { schemasCompatible } from "./schema-compat.js";
import { CONTROL_IN, CONTROL_OUT, WorkflowSchema, type Workflow } from "./types.js";

export interface ValidateResult {
  ok: boolean;
  workflow?: Workflow;
  issues: ValidationIssue[];
}

/** Format Zod issues into dotted-path validation issues bound to a node. */
function zodIssues(err: z.ZodError, nodeId: string): ValidationIssue[] {
  return err.issues.map((i) => ({
    nodeId,
    path: i.path.length ? i.path.join(".") : undefined,
    message: `config: ${i.message}`,
    code: "config_invalid",
  }));
}

/** Non-throwing validation. Returns parsed workflow + accumulated issues. */
export function collectIssues(input: unknown, ops: OpRegistry): ValidateResult {
  const issues: ValidationIssue[] = [];

  // (0) Structural shape of the document itself.
  const parsed = WorkflowSchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      issues.push({
        message: `workflow document: ${i.message}`,
        path: i.path.length ? i.path.join(".") : undefined,
        code: "document_invalid",
      });
    }
    return { ok: false, issues };
  }
  const workflow = parsed.data;

  // Unique node ids.
  const seen = new Set<string>();
  for (const n of workflow.nodes) {
    if (seen.has(n.id)) {
      issues.push({ nodeId: n.id, message: `duplicate node id "${n.id}"`, code: "duplicate_node" });
    }
    seen.add(n.id);
  }

  // (1) Ops registered + config parses. Cache parsed configs for port resolution.
  const parsedConfig = new Map<string, unknown>();
  for (const node of workflow.nodes) {
    const op = ops.get(node.op);
    if (!op) {
      issues.push({
        nodeId: node.id,
        message: `unknown op "${node.op}" — not found in the op registry`,
        code: "unknown_op",
      });
      continue;
    }
    if (op.config) {
      const res = op.config.safeParse(node.config ?? {});
      if (!res.success) {
        issues.push(...zodIssues(res.error, node.id));
        parsedConfig.set(node.id, node.config ?? {});
      } else {
        parsedConfig.set(node.id, res.data);
      }
    } else {
      parsedConfig.set(node.id, node.config ?? {});
    }
  }

  const nodeById = new Map(workflow.nodes.map((n) => [n.id, n] as const));

  // (2) + (3) Edges reference existing nodes/ports; kinds match; schemas compatible.
  for (const [idx, edge] of workflow.edges.entries()) {
    const where = `edge #${idx}`;
    const fromNode = nodeById.get(edge.from.node);
    const toNode = nodeById.get(edge.to.node);
    if (!fromNode) {
      issues.push({ message: `${where}: from-node "${edge.from.node}" does not exist`, code: "bad_edge" });
    }
    if (!toNode) {
      issues.push({ message: `${where}: to-node "${edge.to.node}" does not exist`, code: "bad_edge" });
    }
    if (!fromNode || !toNode) continue;

    const fromOp = ops.get(fromNode.op);
    const toOp = ops.get(toNode.op);
    if (!fromOp || !toOp) continue; // already reported as unknown_op

    const fromCfg = parsedConfig.get(fromNode.id);
    const toCfg = parsedConfig.get(toNode.id);

    const fromKind = portKindOf(fromOp, fromCfg, edge.from.port, "out");
    const toKind = portKindOf(toOp, toCfg, edge.to.port, "in");

    if (!fromKind) {
      issues.push({
        nodeId: fromNode.id,
        port: edge.from.port,
        message: `${where}: output port "${edge.from.port}" does not exist on op "${fromOp.type}"`,
        code: "bad_port",
      });
    }
    if (!toKind) {
      issues.push({
        nodeId: toNode.id,
        port: edge.to.port,
        message: `${where}: input port "${edge.to.port}" does not exist on op "${toOp.type}"`,
        code: "bad_port",
      });
    }
    if (!fromKind || !toKind) continue;

    if (fromKind !== toKind) {
      const hint =
        (fromKind === "stream" && toKind === "value") || (fromKind === "value" && toKind === "stream")
          ? ` — insert an adapter op (core.stream.accumulate for stream→value, core.stream.emit for value→stream)`
          : "";
      issues.push({
        nodeId: toNode.id,
        port: edge.to.port,
        message: `${where}: cannot connect ${fromKind} output "${fromNode.id}.${edge.from.port}" to ${toKind} input "${toNode.id}.${edge.to.port}"${hint}`,
        code: "kind_mismatch",
      });
      continue;
    }

    // Schema compatibility for value/stream edges (control carries no schema).
    if (fromKind !== "control") {
      const producer = resolvePorts(fromOp.outputs, fromCfg)[edge.from.port]?.schema;
      const consumer = resolvePorts(toOp.inputs, toCfg)[edge.to.port]?.schema;
      if (!schemasCompatible(producer, consumer)) {
        issues.push({
          nodeId: toNode.id,
          port: edge.to.port,
          message: `${where}: ${fromKind} output "${fromNode.id}.${edge.from.port}" is not assignable to input "${toNode.id}.${edge.to.port}" (schema mismatch)`,
          code: "schema_mismatch",
        });
      }
    }

    // A *stream* input accepts exactly one source (use core.stream.merge to
    // combine). A *value* input MAY have several sources when they sit on
    // mutually-exclusive control paths (branch/switch convergence) — it resolves
    // to whichever producer actually fires, so that is allowed.
    if (toKind === "stream") {
      const feeders = edgesInto(workflow, toNode.id, edge.to.port);
      if (feeders.length > 1 && feeders[0] === edge) {
        issues.push({
          nodeId: toNode.id,
          port: edge.to.port,
          message: `stream input "${toNode.id}.${edge.to.port}" has ${feeders.length} sources; stream inputs accept exactly one (use core.stream.merge to combine streams)`,
          code: "multi_source",
        });
      }
    }
  }

  // Required value inputs must be wired.
  for (const node of workflow.nodes) {
    const op = ops.get(node.op);
    if (!op) continue;
    const inputs = resolvePorts(op.inputs, parsedConfig.get(node.id));
    for (const [port, spec] of Object.entries(inputs)) {
      if (spec.kind === "value" && spec.required && !edgeInto(workflow, node.id, port)) {
        issues.push({
          nodeId: node.id,
          port,
          message: `required input "${port}" of op "${op.type}" is not connected`,
          code: "missing_required_input",
        });
      }
    }
  }

  // Triggers have no graph inputs; out-gates have no graph outputs.
  for (const node of workflow.nodes) {
    const op = ops.get(node.op);
    if (!op) continue;
    if (op.boundary === "trigger") {
      // Config-input edges (registration-time, e.g. http port ← core.env) and the
      // implicit control-in are allowed; any other incoming edge is not.
      const configIns = new Set(Object.keys(resolveConfigInputs(op, parsedConfig.get(node.id))));
      const dataIn = workflow.edges.filter(
        (e) => e.to.node === node.id && e.to.port !== CONTROL_IN && !configIns.has(e.to.port),
      );
      if (dataIn.length) {
        issues.push({
          nodeId: node.id,
          message: `trigger "${node.id}" must not have incoming data edges (a trigger's outputs are the external input)`,
          code: "trigger_has_input",
        });
      }
    }
    if (op.boundary === "outgate") {
      const dataOut = workflow.edges.filter((e) => e.from.node === node.id && e.from.port !== CONTROL_OUT);
      if (dataOut.length) {
        issues.push({
          nodeId: node.id,
          message: `out-gate "${node.id}" must not have outgoing data edges (it produces the external result)`,
          code: "outgate_has_output",
        });
      }
    }
  }

  // (4) No cycles.
  const cycle = detectCycle(
    workflow.nodes.map((n) => n.id),
    workflow.edges,
  );
  if (cycle) {
    issues.push({
      message: `cycle detected: ${cycle.join(" → ")} (v1 forbids cycles, including across stream edges)`,
      code: "cycle",
    });
  }

  // (5) At least one trigger, and each trigger reaches an out-gate (or is event/schedule).
  const triggers = findTriggerNodes(workflow, ops);
  const outgates = findOutGateNodes(workflow, ops);
  if (triggers.length === 0) {
    issues.push({
      message: `workflow has no trigger node (every workflow needs at least one boundary trigger)`,
      code: "no_trigger",
    });
  }
  for (const t of triggers) {
    // Event subscribers (fire-and-forget, §8) and schedules (result discarded,
    // §7) tolerate a missing out-gate — their pair is the generic
    // `boundary.return`, which only records the run's result.
    const op = ops.get(t.op)!;
    const noOutgateExpected = t.op === "boundary.event" || t.op === "boundary.schedule";
    if (noOutgateExpected) continue;
    const reach = reachableFrom(workflow, t.id);
    const reachesOutgate = outgates.some((g) => reach.nodes.has(g.id));
    if (!reachesOutgate && outgates.length > 0) {
      issues.push({
        nodeId: t.id,
        message: `trigger "${t.id}" (${op.type}) does not reach any out-gate`,
        code: "trigger_no_outgate",
      });
    } else if (outgates.length === 0) {
      issues.push({
        nodeId: t.id,
        message: `trigger "${t.id}" (${op.type}) has no reachable out-gate (workflow has none)`,
        code: "trigger_no_outgate",
      });
    }
  }

  // (6) Advisory (warning, never blocking): a network trigger whose `requireAuth`
  // is *unspecified* (undefined) that can reach a `privileged` op. Authorization
  // is the trigger's job (who's asking) — the ops are pure — so a forgotten gate
  // would expose sensitive data unauthenticated. ANY explicit decision silences
  // it: a requirement (true / { scopes } / { env }), an explicit `false`
  // (acknowledged-public), or a value wired into the `requireAuth` config port.
  for (const t of triggers) {
    if (!t.op.startsWith("boundary.http.")) continue;
    const auth = (t.config as { requireAuth?: unknown } | undefined)?.requireAuth;
    const authWired = workflow.edges.some((e) => e.to.node === t.id && e.to.port === "requireAuth");
    if (auth !== undefined || authWired) continue;
    const reach = reachableFrom(workflow, t.id);
    const hit = workflow.nodes.find((n) => reach.nodes.has(n.id) && ops.get(n.op)?.sensitivity === "privileged");
    if (hit) {
      issues.push({
        nodeId: t.id,
        message: `trigger "${t.id}" (${t.op}) has no requireAuth but can reach the privileged op "${hit.op}" (node "${hit.id}") — add requireAuth (e.g. { scopes: ["admin"] }) to gate it, or this data is exposed unauthenticated`,
        code: "privileged_without_auth",
        severity: "warning",
      });
    }
  }

  // (7) Advisory (warning, never blocking): a `cpuHeavy` op in a workflow that
  // runs inline (`offload !== true`). Synchronous compute on the host event loop
  // stalls every other run (and the admin) — the fix is the workflow's `offload`
  // flag (run the whole graph on the worker pool). The op tag only nudges; it
  // routes nothing on its own.
  if (workflow.offload !== true) {
    for (const node of workflow.nodes) {
      if (ops.get(node.op)?.cpuHeavy === true) {
        issues.push({
          nodeId: node.id,
          message: `node "${node.id}" runs the cpu-heavy op "${node.op}" inline on the host event loop — turn on the workflow's Offload to run it on the worker pool, or it can stall the host loop`,
          code: "cpuHeavy_inline",
          severity: "warning",
        });
      }
    }
  }

  // (8) Advisory (warning, never blocking): an offloaded workflow that uses a
  // live host socket. Workers build their own engine with no host WS sockets /
  // connection registry, so a `boundary.ws.*` node can't reach the live socket
  // from the pool. (Prefix check for v1; a `hostOnly` op tag is the v2 follow-up.)
  if (workflow.offload === true) {
    for (const node of workflow.nodes) {
      if (node.op.startsWith("boundary.ws.")) {
        issues.push({
          nodeId: node.id,
          message: `node "${node.id}" (${node.op}) uses a live host socket, but this workflow is offloaded — workers run on their own engine and can't reach host sockets; keep socket-bound workflows inline`,
          code: "offload_unsafe_op",
          severity: "warning",
        });
      }
    }
  }

  // Warnings are advisory: a workflow with only warnings still validates + runs.
  return { ok: !issues.some((i) => i.severity !== "warning"), workflow, issues };
}

/**
 * Validate a workflow document. Returns the parsed `Workflow` on success;
 * throws `WorkflowValidationError` with all *error*-severity issues on failure
 * (warnings never block).
 */
export function validateWorkflow(input: unknown, ops: OpRegistry): Workflow {
  const { ok, workflow, issues } = collectIssues(input, ops);
  if (!ok || !workflow) {
    const id =
      input && typeof input === "object" && "id" in input ? String((input as any).id) : undefined;
    throw new WorkflowValidationError(issues, id);
  }
  return workflow;
}
