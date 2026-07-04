/**
 * @pattern-js/mod-agents — the well-known service seam.
 *
 * The model provider (mod-ai) and consumers (mod-chat) meet here:
 * the tool registry lives on AGENTS_SERVICE; nobody imports a provider mod
 * to find tools.
 */

import type { OpContext } from "@pattern-js/core";
import type { ToolRef } from "./types.js";

export const AGENTS_SERVICE = "agentsService";

/** A boundary.tool workflow discovered in the registry. */
export interface WorkflowToolRegistration {
  workflowId: string;
  nodeId: string;
  name: string;
  description?: string;
  params?: Record<string, unknown>;
  needsApproval?: boolean;
  /** Guardrail-only: resolvable by name, but excluded from the default toolset. */
  guardrail?: boolean;
  /** Privileged (control-plane): excluded from EVERY `["*"]` expansion (toolsets AND MCP). */
  restricted?: boolean;
}

/** A code tool a mod contributes directly (registered in its `setup`). */
export interface OpToolRegistration {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  params: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: OpContext): unknown | Promise<unknown>;
  needsApproval?: boolean;
}

export interface AgentsService {
  /** Live view of every boundary.tool workflow (registered ⇄ discovered). */
  listWorkflowTools(): WorkflowToolRegistration[];
  getWorkflowTool(name: string): WorkflowToolRegistration | undefined;
  /** Mods contribute ready-made tools here from their setup. */
  registerOpTool(reg: OpToolRegistration): void;
  listOpTools(): OpToolRegistration[];
  getOpTool(name: string): OpToolRegistration | undefined;
  /**
   * Turn-scoped cancellation. A STREAMING run settles for the engine as soon
   * as its out-gates capture (the SSE tail flows after), so engine.cancelRun
   * can't reach an in-flight agent turn — providers register an
   * AbortController per turnId instead, and a Stop button calls `abortTurn`.
   */
  registerTurn(turnId: string, controller: AbortController): void;
  releaseTurn(turnId: string): void;
  abortTurn(turnId: string, reason?: unknown): boolean;
}

export function agentsService(ctx: OpContext): AgentsService {
  const svc = ctx.services[AGENTS_SERVICE] as AgentsService | undefined;
  if (!svc) {
    throw new Error(
      'agent ops need @pattern-js/mod-agents installed — add "@pattern-js/mod-agents" to your pattern.config.json mods',
    );
  }
  return svc;
}

/** ToolRef for a workflow tool registration (what flows on toolset edges). */
export function workflowToolRef(reg: WorkflowToolRegistration): ToolRef {
  return {
    origin: "workflow",
    workflowId: reg.workflowId,
    name: reg.name,
    description: reg.description,
    params: reg.params,
    needsApproval: reg.needsApproval,
  };
}
