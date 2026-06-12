/**
 * @pattern/mod-agents — the registry implementation.
 *
 * Workflow tools are DISCOVERED, never registered by hand: the service scans
 * the engine's workflow registry for `boundary.tool` triggers and keeps the
 * index live via `onWorkflowsChanged` (the same pattern hook listeners use) —
 * deploy a tool workflow from the admin and the next agent run sees it.
 */

import type { Engine, Workflow } from "@pattern/core";
import type {
  AgentsService,
  OpToolRegistration,
  WorkflowToolRegistration,
} from "./well-known.js";

export class AgentsRegistry implements AgentsService {
  private workflowTools = new Map<string, WorkflowToolRegistration>();
  private opTools = new Map<string, OpToolRegistration>();
  private turns = new Map<string, AbortController>();

  constructor(private readonly engine: Engine) {
    for (const wf of engine.workflows.list()) this.index(wf);
    engine.onWorkflowsChanged(() => this.rescan());
  }

  private rescan(): void {
    this.workflowTools.clear();
    for (const wf of this.engine.workflows.list()) this.index(wf);
  }

  private index(workflow: Workflow): void {
    for (const node of workflow.nodes) {
      if (node.op !== "boundary.tool") continue;
      const cfg = (node.config ?? {}) as {
        name?: string;
        description?: string;
        params?: Record<string, unknown>;
        needsApproval?: boolean;
      };
      if (!cfg.name) continue;
      const existing = this.workflowTools.get(cfg.name);
      if (existing && existing.workflowId !== workflow.id) {
        console.warn(
          `[pattern/mod-agents] tool name "${cfg.name}" is declared by both "${existing.workflowId}" and "${workflow.id}" — keeping the first`,
        );
        continue;
      }
      this.workflowTools.set(cfg.name, {
        workflowId: workflow.id,
        nodeId: node.id,
        name: cfg.name,
        description: cfg.description,
        params: cfg.params,
        needsApproval: cfg.needsApproval,
      });
    }
  }

  listWorkflowTools(): WorkflowToolRegistration[] {
    return [...this.workflowTools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getWorkflowTool(name: string): WorkflowToolRegistration | undefined {
    return this.workflowTools.get(name);
  }

  registerOpTool(reg: OpToolRegistration): void {
    if (this.opTools.has(reg.name)) {
      throw new Error(`[pattern/mod-agents] op tool "${reg.name}" is already registered`);
    }
    this.opTools.set(reg.name, reg);
  }

  listOpTools(): OpToolRegistration[] {
    return [...this.opTools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getOpTool(name: string): OpToolRegistration | undefined {
    return this.opTools.get(name);
  }

  registerTurn(turnId: string, controller: AbortController): void {
    this.turns.set(turnId, controller);
  }

  releaseTurn(turnId: string): void {
    this.turns.delete(turnId);
  }

  abortTurn(turnId: string, reason?: unknown): boolean {
    const ctrl = this.turns.get(turnId);
    if (!ctrl) return false;
    this.turns.delete(turnId);
    ctrl.abort(reason ?? new Error("turn aborted"));
    return true;
  }
}
