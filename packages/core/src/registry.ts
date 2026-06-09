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
}

// ────────────────────────────────────────────────────────────────────────────
// Workflow registry — resolves sub-workflow refs and named workflows
// ────────────────────────────────────────────────────────────────────────────

export interface WorkflowRegistry {
  register(wf: Workflow): void;
  get(id: string): Workflow | undefined;
  list(): Workflow[];
}

export class InMemoryWorkflowRegistry implements WorkflowRegistry {
  private workflows = new Map<string, Workflow>();

  register(wf: Workflow): void {
    this.workflows.set(wf.id, wf);
  }

  get(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }

  list(): Workflow[] {
    return [...this.workflows.values()];
  }
}
