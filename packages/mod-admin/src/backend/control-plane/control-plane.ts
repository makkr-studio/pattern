/**
 * @pattern-js/mod-admin — the control plane (admin internals §4, §9).
 *
 * Owns workflow lifecycle on top of the engine + store:
 *   draft → save version → activate (route-conflict checked) → registerWorkflowAsync
 *                                                          → disable → unregisterWorkflow
 *
 * "Enabled/disabled" is control-plane state, not an engine concept: enabled +
 * live → registered under the slug's stable id (so rollback is a pointer move);
 * otherwise stored-but-unregistered. Code workflows are registered by their mod
 * at boot and are read-only here.
 */

import type { Engine, Principal } from "@pattern-js/core";
import { extractRoute } from "./store.js";
import type {
  ControlPlane,
  DeployResult,
  RouteConflict,
  RouteInfo,
  WorkflowDoc,
  WorkflowStore,
} from "./types.js";

const ANON: Principal = { kind: "anonymous" };

/** Do two routes collide? (Same path + port; methods overlap, "ANY" matches all.) */
function routesCollide(a: RouteInfo, b: RouteInfo): boolean {
  if (a.path !== b.path) return false;
  if ((a.port ?? null) !== (b.port ?? null)) return false;
  return a.method === "ANY" || b.method === "ANY" || a.method === b.method;
}

export interface ControlPlaneOptions {
  now?: () => string;
}

export class DefaultControlPlane implements ControlPlane {
  private readonly now: () => string;

  constructor(
    private readonly engine: Engine,
    readonly store: WorkflowStore,
    opts: ControlPlaneOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  async bootstrap(): Promise<void> {
    for (const meta of await this.store.list()) {
      // Code workflows are registered by their owning mod; the store only tracks
      // their catalog metadata. Register enabled file/db workflows.
      if (meta.source === "code") continue;
      if (meta.enabled && meta.live) {
        const doc = await this.store.getVersion(meta.slug, meta.live);
        // A workflow that no longer validates (e.g. its op's mod was removed)
        // must never brick boot: log, leave it stored-but-unregistered, move on.
        try {
          if (doc) await this.register(meta.slug, doc);
        } catch (err) {
          console.error(`[pattern] admin bootstrap: skipping "${meta.slug}":`, (err as Error).message);
        }
      }
    }
  }

  async routeConflicts(doc: WorkflowDoc, selfSlug?: string): Promise<RouteConflict[]> {
    const route = extractRoute(doc);
    if (!route) return [];
    const conflicts: RouteConflict[] = [];
    for (const wf of this.engine.workflows.list()) {
      if (wf.id === selfSlug) continue;
      const other = extractRoute(wf);
      if (other && routesCollide(route, other)) {
        conflicts.push({ route, conflictsWith: wf.id });
      }
    }
    return conflicts;
  }

  async deploy(
    slug: string,
    v: string,
    opts: { principal?: Principal; swap?: boolean } = {},
  ): Promise<DeployResult> {
    const doc = await this.store.getVersion(slug, v);
    if (!doc) throw new Error(`version "${v}" of "${slug}" not found`);
    const principal = opts.principal ?? ANON;

    const conflicts = await this.routeConflicts(doc, slug);
    if (conflicts.length) {
      if (!opts.swap) return { ok: false, conflicts };
      // Swap: disable each conflicting live workflow, then proceed.
      for (const c of conflicts) await this.disable(c.conflictsWith, { principal });
    }

    await this.store.setLive(slug, v);
    await this.store.setEnabled(slug, true);
    await this.register(slug, doc);
    await this.store.appendAudit(slug, { at: this.now(), principal, action: "activate", version: v });
    return { ok: true, version: v };
  }

  async disable(slug: string, opts: { principal?: Principal } = {}): Promise<void> {
    this.engine.unregisterWorkflow(slug);
    const meta = await this.store.getMeta(slug);
    if (meta) {
      await this.store.setEnabled(slug, false);
      await this.store.appendAudit(slug, {
        at: this.now(),
        principal: opts.principal ?? ANON,
        action: "disable",
        version: meta.live ?? undefined,
      });
    }
  }

  /** Register a doc under the slug's stable id (per-request atomicity → safe). */
  private async register(slug: string, doc: WorkflowDoc): Promise<void> {
    await this.engine.registerWorkflowAsync({ ...doc, id: slug });
  }
}
