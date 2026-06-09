/**
 * Pattern — terminal graph rendering for `pattern graph file.json` (§15).
 *
 * Prints the workflow's nodes, their ports, and the edges (with derived kind) as
 * readable text before the admin-UI mod exists. Runtime-neutral (no host I/O);
 * the CLI just writes the returned string.
 */

import { portKindOf, resolveControlOuts, resolvePorts } from "./graph.js";
import { redactConfig } from "./redact.js";
import type { OpRegistry } from "./registry.js";
import type { Workflow } from "./types.js";

const KIND_GLYPH: Record<string, string> = { value: "◆", stream: "≋", control: "▸" };

/** Render a workflow as an annotated, human-readable graph listing. */
export function formatGraph(workflow: Workflow, ops: OpRegistry): string {
  const lines: string[] = [];
  lines.push(`workflow ${workflow.id}${workflow.name ? ` — ${workflow.name}` : ""}`);
  lines.push(`  ${workflow.nodes.length} nodes, ${workflow.edges.length} edges`);
  lines.push("");

  lines.push("nodes:");
  for (const node of workflow.nodes) {
    const op = ops.get(node.op);
    const tag = op?.boundary ? ` [${op.boundary}]` : "";
    lines.push(`  ● ${node.id}${node.title ? ` — ${node.title}` : ""}  (${node.op})${tag}`);
    if (node.comment) {
      for (const line of node.comment.split("\n")) lines.push(`      ┄ ${line}`);
    }
    if (!op) {
      lines.push(`      ⚠ unknown op`);
      continue;
    }
    if (node.config && Object.keys(node.config as object).length) {
      // Surface config inline, with schema-tagged secrets masked (P4).
      const safe = redactConfig(node.config, op.config);
      lines.push(`      cfg: ${JSON.stringify(safe)}`);
    }
    const ins = resolvePorts(op.inputs, node.config);
    const outs = resolvePorts(op.outputs, node.config);
    const cOuts = resolveControlOuts(op, node.config);
    const inNames = Object.entries(ins).map(([n, s]) => `${KIND_GLYPH[s.kind] ?? "?"}${n}`);
    const outNames = Object.entries(outs).map(([n, s]) => `${KIND_GLYPH[s.kind] ?? "?"}${n}`);
    if (inNames.length) lines.push(`      in:  ${inNames.join("  ")}`);
    if (outNames.length) lines.push(`      out: ${outNames.join("  ")}`);
    if (cOuts.length) lines.push(`      ctl: ${cOuts.map((c) => `▸${c}`).join("  ")}`);
  }

  lines.push("");
  lines.push("edges:");
  for (const e of workflow.edges) {
    const fromNode = workflow.nodes.find((n) => n.id === e.from.node);
    const fromOp = fromNode && ops.get(fromNode.op);
    const kind = fromOp ? portKindOf(fromOp, fromNode!.config, e.from.port, "out") : undefined;
    const glyph = kind ? (KIND_GLYPH[kind] ?? "→") : "→";
    lines.push(`  ${e.from.node}.${e.from.port}  ${glyph}─${glyph === "≋" ? "≋" : "─"}▶  ${e.to.node}.${e.to.port}`);
  }
  return lines.join("\n");
}
