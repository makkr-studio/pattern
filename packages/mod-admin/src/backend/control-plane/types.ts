/**
 * @pattern-js/mod-admin — control-plane contracts (admin internals §9).
 *
 * These are the data shapes the admin's backend speaks in. The `ControlPlane`
 * and `WorkflowStore` are internal *services* (registered on the engine), not an
 * HTTP API — the only HTTP surface is the endpoint workflows (§11). Persistence
 * sits behind `WorkflowStore` with a `Filesystem` inside, so a DB can replace it
 * later without touching the ops.
 */

import type { Principal, Workflow, WorkflowSource } from "@pattern-js/core";

/** A workflow document, as authored/stored. Re-exported alias for spec parity. */
export type WorkflowDoc = Workflow;

export type Source = WorkflowSource; // "code" | "file" | "db"
export type VersionId = string;

/** One immutable version snapshot's metadata (§9). */
export interface VersionInfo {
  id: VersionId;
  /** Content hash of the snapshot (content-addressed dedupe). */
  hash: string;
  note?: string;
  author?: string;
  /** ISO timestamp. */
  createdAt: string;
}

/** An audit-trail entry: who did what, to which version, when (§5). */
export interface AuditEntry {
  at: string;
  principal: Principal;
  action: "create" | "save" | "activate" | "rollback" | "disable" | "enable" | "delete" | "fork" | "import";
  version?: VersionId;
  note?: string;
}

/** A declared HTTP route (method + path) extracted from a workflow's trigger. */
export interface RouteInfo {
  method: string;
  path: string;
  port?: number;
}

/** Catalog metadata for one logical workflow (stable `slug` + version history). */
export interface WorkflowMeta {
  slug: string;
  name: string;
  description?: string;
  source: Source;
  enabled: boolean;
  /** The version currently registered on the engine (null = none). */
  live: VersionId | null;
  route?: RouteInfo;
  tags?: string[];
  /** Framework plumbing (route endpoint / asset mount); hidden from the catalog by default. */
  internal?: boolean;
  versions: VersionInfo[];
  audit: AuditEntry[];
}

/** A saved test input for a workflow (§15.5). Not versioned with the workflow. */
export interface Fixture {
  trigger?: string;
  input?: unknown;
  params?: unknown;
  principal?: unknown;
}

/** A route collision detected on activation (§4). */
export interface RouteConflict {
  route: RouteInfo;
  /** The slug of the live workflow already serving this route. */
  conflictsWith: string;
}

/** Outcome of a deploy: success, or a conflict the UI resolves (cancel/swap). */
export type DeployResult = { ok: true; version: VersionId } | { ok: false; conflicts: RouteConflict[] };

/**
 * Persistence for logical workflows + their versions + fixtures (§9).
 * `FlystorageWorkflowStore` implements this over a `Filesystem`.
 */
export interface WorkflowStore {
  list(): Promise<WorkflowMeta[]>;
  getMeta(slug: string): Promise<WorkflowMeta | null>;
  getVersion(slug: string, v: VersionId): Promise<WorkflowDoc | null>;
  saveVersion(slug: string, doc: WorkflowDoc, info: { note?: string; author?: string; principal?: Principal }): Promise<VersionInfo>;
  setLive(slug: string, v: VersionId): Promise<void>;
  setEnabled(slug: string, enabled: boolean): Promise<void>;
  appendAudit(slug: string, entry: AuditEntry): Promise<void>;
  delete(slug: string): Promise<void>;
  listFixtures(slug: string): Promise<string[]>;
  getFixture(slug: string, name: string): Promise<Fixture | null>;
  saveFixture(slug: string, name: string, f: Fixture): Promise<void>;
  deleteFixture(slug: string, name: string): Promise<void>;
  /** Admin-wide settings blob (observability knobs etc.) — survives restarts
   *  on persistent storage. Null = never saved. */
  getAdminConfig(): Promise<Record<string, unknown> | null>;
  saveAdminConfig(cfg: Record<string, unknown>): Promise<void>;
}

/**
 * The admin's control plane (§9). Owns lifecycle: load on boot, deploy
 * (route-conflict checked) → `registerWorkflowAsync`, disable →
 * `unregisterWorkflow`. Reached by ops as `ctx.services.adminControlPlane`.
 */
export interface ControlPlane {
  store: WorkflowStore;
  /** Load code + file workflows; register the enabled ones (idempotent). */
  bootstrap(): Promise<void>;
  /** Activate a version: route-conflict check, then register under the slug id. */
  deploy(slug: string, v: VersionId, opts?: { principal?: Principal; swap?: boolean }): Promise<DeployResult>;
  /** Disable a slug: unregister from the engine; definition stays in the store. */
  disable(slug: string, opts?: { principal?: Principal }): Promise<void>;
  /** Route conflicts a doc would cause against currently-live workflows. */
  routeConflicts(doc: WorkflowDoc, selfSlug?: string): Promise<RouteConflict[]>;
}

/** The service key the control plane is registered under (ops read this). */
export const ADMIN_CONTROL_PLANE = "adminControlPlane";
