/**
 * @pattern/mod-admin — filesystem-backed workflow store (mod-admin-spec §3, §9).
 *
 * Storage layout (under `prefix`, default "workflows"):
 *
 *   <slug>/_meta.json          — WorkflowMeta (live, enabled, source, route, versions, audit)
 *   <slug>/v1.json v2.json …   — immutable version snapshots
 *   <slug>/fixtures/<name>.json
 *
 * Backed by the small `Filesystem` interface, so the same instance the HTTP app
 * boundary serves can also persist workflows, and a DB store can replace it
 * later behind `WorkflowStore`.
 */

import type { Filesystem } from "@pattern/runtime-node";
import type { Workflow } from "@pattern/core";
import { contentHash } from "./versioning.js";
import type {
  AuditEntry,
  Fixture,
  RouteInfo,
  VersionInfo,
  WorkflowDoc,
  WorkflowMeta,
  WorkflowStore,
} from "./types.js";

/** Extract the HTTP route a workflow declares (if any), for conflict checks. */
export function extractRoute(doc: Workflow): RouteInfo | undefined {
  for (const node of doc.nodes) {
    if (node.op === "boundary.http.request") {
      const cfg = (node.config ?? {}) as { method?: string; path?: string; port?: number };
      if (cfg.path) return { method: String(cfg.method ?? "GET").toUpperCase(), path: cfg.path, port: cfg.port };
    }
    if (node.op === "boundary.http.app") {
      const cfg = (node.config ?? {}) as { mount?: string; port?: number };
      if (cfg.mount) return { method: "GET", path: `${cfg.mount.replace(/\/$/, "")}/*`, port: cfg.port };
    }
  }
  return undefined;
}

export interface FlystorageWorkflowStoreOptions {
  /** Path prefix inside the filesystem. Default "workflows". */
  prefix?: string;
  /** Clock (overridable in tests). Default `() => new Date().toISOString()`. */
  now?: () => string;
}

export class FlystorageWorkflowStore implements WorkflowStore {
  private readonly prefix: string;
  private readonly now: () => string;

  constructor(
    private readonly fs: Filesystem,
    opts: FlystorageWorkflowStoreOptions = {},
  ) {
    this.prefix = (opts.prefix ?? "workflows").replace(/\/$/, "");
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  private metaPath(slug: string): string {
    return `${this.prefix}/${slug}/_meta.json`;
  }
  private versionPath(slug: string, v: string): string {
    return `${this.prefix}/${slug}/${v}.json`;
  }
  private fixturePath(slug: string, name: string): string {
    return `${this.prefix}/${slug}/fixtures/${name}.json`;
  }

  /** Read a file as text, or null if it does not exist. */
  private async readText(path: string): Promise<string | null> {
    return (await this.fs.fileExists(path)) ? this.fs.readToString(path) : null;
  }

  async list(): Promise<WorkflowMeta[]> {
    if (!(await this.fs.directoryExists(this.prefix))) return [];
    const entries = await this.fs.list(this.prefix, { deep: true }).toArray();
    const slugs = new Set<string>();
    for (const e of entries) {
      if (!e.isFile) continue;
      const rest = e.path.slice(this.prefix.length + 1); // "<slug>/..."
      const slug = rest.split("/")[0];
      if (slug && rest.endsWith("_meta.json")) slugs.add(slug);
    }
    const metas: WorkflowMeta[] = [];
    for (const slug of slugs) {
      const m = await this.getMeta(slug);
      if (m) metas.push(m);
    }
    metas.sort((a, b) => a.slug.localeCompare(b.slug));
    return metas;
  }

  async getMeta(slug: string): Promise<WorkflowMeta | null> {
    const text = await this.readText(this.metaPath(slug));
    return text == null ? null : (JSON.parse(text) as WorkflowMeta);
  }

  private async saveMeta(meta: WorkflowMeta): Promise<void> {
    await this.fs.write(this.metaPath(meta.slug), `${JSON.stringify(meta, null, 2)}\n`);
  }

  async getVersion(slug: string, v: string): Promise<WorkflowDoc | null> {
    const text = await this.readText(this.versionPath(slug, v));
    return text == null ? null : (JSON.parse(text) as WorkflowDoc);
  }

  async saveVersion(
    slug: string,
    doc: WorkflowDoc,
    info: { note?: string; author?: string },
  ): Promise<VersionInfo> {
    let meta = await this.getMeta(slug);
    const hash = contentHash(doc);

    if (!meta) {
      meta = {
        slug,
        name: doc.name ?? slug,
        description: doc.description,
        source: doc.source ?? "file",
        enabled: false,
        live: null,
        route: extractRoute(doc),
        tags: doc.tags,
        versions: [],
        audit: [{ at: this.now(), principal: { kind: "anonymous" }, action: "create" }],
      };
    }

    // Content-addressed dedupe: an identical snapshot reuses its version id.
    const existing = meta.versions.find((v) => v.hash === hash);
    if (existing) {
      // Keep catalog metadata fresh even when the body is unchanged.
      meta.name = doc.name ?? meta.name;
      meta.description = doc.description ?? meta.description;
      meta.tags = doc.tags ?? meta.tags;
      meta.route = extractRoute(doc);
      await this.saveMeta(meta);
      return existing;
    }

    const id = `v${meta.versions.length + 1}`;
    const version: VersionInfo = {
      id,
      hash,
      note: info.note,
      author: info.author,
      createdAt: this.now(),
    };
    // Persist the snapshot with its provenance stamped in.
    await this.fs.write(
      this.versionPath(slug, id),
      `${JSON.stringify({ ...doc, id: slug, source: meta.source }, null, 2)}\n`,
    );
    meta.versions.push(version);
    meta.name = doc.name ?? meta.name;
    meta.description = doc.description ?? meta.description;
    meta.tags = doc.tags ?? meta.tags;
    meta.route = extractRoute(doc);
    meta.audit.push({ at: this.now(), principal: { kind: "anonymous" }, action: "save", version: id, note: info.note });
    await this.saveMeta(meta);
    return version;
  }

  async setLive(slug: string, v: string): Promise<void> {
    const meta = await this.requireMeta(slug);
    if (!meta.versions.some((ver) => ver.id === v)) throw new Error(`version "${v}" not found for "${slug}"`);
    meta.live = v;
    await this.saveMeta(meta);
  }

  async setEnabled(slug: string, enabled: boolean): Promise<void> {
    const meta = await this.requireMeta(slug);
    meta.enabled = enabled;
    await this.saveMeta(meta);
  }

  async appendAudit(slug: string, entry: AuditEntry): Promise<void> {
    const meta = await this.requireMeta(slug);
    meta.audit.push(entry);
    await this.saveMeta(meta);
  }

  async delete(slug: string): Promise<void> {
    await this.fs.deleteDirectory(`${this.prefix}/${slug}`);
  }

  async listFixtures(slug: string): Promise<string[]> {
    const dir = `${this.prefix}/${slug}/fixtures`;
    if (!(await this.fs.directoryExists(dir))) return [];
    const entries = await this.fs.list(dir, { deep: false }).toArray();
    return entries
      .filter((e) => e.isFile)
      .map((e) => e.path.split("/").pop() ?? "")
      .filter((n) => n.endsWith(".json"))
      .map((n) => n.slice(0, -".json".length));
  }

  async getFixture(slug: string, name: string): Promise<Fixture | null> {
    const text = await this.readText(this.fixturePath(slug, name));
    return text == null ? null : (JSON.parse(text) as Fixture);
  }

  async saveFixture(slug: string, name: string, f: Fixture): Promise<void> {
    await this.fs.write(this.fixturePath(slug, name), `${JSON.stringify(f, null, 2)}\n`);
  }

  async deleteFixture(slug: string, name: string): Promise<void> {
    await this.fs.deleteFile(this.fixturePath(slug, name));
  }

  private async requireMeta(slug: string): Promise<WorkflowMeta> {
    const meta = await this.getMeta(slug);
    if (!meta) throw new Error(`workflow "${slug}" not found`);
    return meta;
  }
}
