/**
 * Pattern — registries (§5).
 *
 * Op `type` ids and hook names are stable contracts — treat them like a public
 * API. Registries are populated by base ops and, later, by mods. All registries
 * have plain in-memory implementations and could sit behind a network-backed
 * one without touching workflows (§4).
 */

import type {
  AuthProvider,
  HookDefinition,
  HookRegistration,
  OpDefinition,
  Workflow,
} from "./types.js";

// ────────────────────────────────────────────────────────────────────────────
// Op registry
// ────────────────────────────────────────────────────────────────────────────

export interface OpRegistry {
  register(op: OpDefinition): void;
  get(type: string): OpDefinition | undefined;
  has(type: string): boolean;
  list(): OpDefinition[];
}

export class InMemoryOpRegistry implements OpRegistry {
  private ops = new Map<string, OpDefinition>();

  register(op: OpDefinition): void {
    if (this.ops.has(op.type)) {
      throw new Error(`Op "${op.type}" is already registered.`);
    }
    this.ops.set(op.type, op);
  }

  /** Register, replacing any existing op of the same type (used by mods/tests). */
  override(op: OpDefinition): void {
    this.ops.set(op.type, op);
  }

  get(type: string): OpDefinition | undefined {
    return this.ops.get(type);
  }

  has(type: string): boolean {
    return this.ops.has(type);
  }

  list(): OpDefinition[] {
    return [...this.ops.values()];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Auth provider registry (§9)
// ────────────────────────────────────────────────────────────────────────────

export interface AuthProviderRegistry {
  register(p: AuthProvider): void;
  chain(): AuthProvider[];
}

export class InMemoryAuthProviderRegistry implements AuthProviderRegistry {
  private providers: AuthProvider[] = [];

  register(p: AuthProvider): void {
    this.providers.push(p);
  }

  chain(): AuthProvider[] {
    return [...this.providers];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Hook registry (§8)
// ────────────────────────────────────────────────────────────────────────────

export interface HookRegistry {
  declare(def: HookDefinition): void;
  definition(name: string): HookDefinition | undefined;
  register(reg: HookRegistration): void;
  /** Registrations for a hook, sorted ascending by priority then node id (§8). */
  registrations(name: string): HookRegistration[];
  /** Remove every registration contributed by a workflow (runtime update/remove). */
  unregisterWorkflow(workflowId: string): void;
}

export class InMemoryHookRegistry implements HookRegistry {
  private defs = new Map<string, HookDefinition>();
  private regs = new Map<string, HookRegistration[]>();

  declare(def: HookDefinition): void {
    this.defs.set(def.name, def);
  }

  definition(name: string): HookDefinition | undefined {
    return this.defs.get(name);
  }

  register(reg: HookRegistration): void {
    const list = this.regs.get(reg.name) ?? [];
    list.push(reg);
    this.regs.set(reg.name, list);
  }

  registrations(name: string): HookRegistration[] {
    const list = [...(this.regs.get(name) ?? [])];
    // Sole ordering key is priority (ascending); deterministic tiebreak by node id (§8).
    list.sort((a, b) => a.priority - b.priority || a.nodeId.localeCompare(b.nodeId));
    return list;
  }

  unregisterWorkflow(workflowId: string): void {
    for (const [name, list] of this.regs) {
      const kept = list.filter((r) => r.workflowId !== workflowId);
      if (kept.length) this.regs.set(name, kept);
      else this.regs.delete(name);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Workflow registry — resolves sub-workflow refs and named workflows
// ────────────────────────────────────────────────────────────────────────────

/** A change to the workflow set, broadcast to subscribers (runtime modifiability). */
export interface WorkflowChange {
  type: "set" | "delete";
  id: string;
  workflow?: Workflow;
}

export interface WorkflowRegistry {
  register(wf: Workflow): void;
  get(id: string): Workflow | undefined;
  list(): Workflow[];
  has(id: string): boolean;
  delete(id: string): boolean;
  /** Observe add/update/remove. Returns an unsubscribe fn. */
  subscribe(listener: (change: WorkflowChange) => void): () => void;
}

export class InMemoryWorkflowRegistry implements WorkflowRegistry {
  private workflows = new Map<string, Workflow>();
  private listeners = new Set<(change: WorkflowChange) => void>();

  register(wf: Workflow): void {
    this.workflows.set(wf.id, wf);
    this.notify({ type: "set", id: wf.id, workflow: wf });
  }

  get(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }

  has(id: string): boolean {
    return this.workflows.has(id);
  }

  list(): Workflow[] {
    return [...this.workflows.values()];
  }

  delete(id: string): boolean {
    const existed = this.workflows.delete(id);
    if (existed) this.notify({ type: "delete", id });
    return existed;
  }

  subscribe(listener: (change: WorkflowChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(change: WorkflowChange): void {
    for (const l of this.listeners) {
      try {
        l(change);
      } catch (err) {
        console.error("[pattern] workflow change listener threw:", err);
      }
    }
  }
}
