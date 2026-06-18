/**
 * @pattern/admin-sdk — the typed API client (mod-admin-spec §12).
 *
 * A thin, framework-agnostic client over the admin's workflow-backed endpoints.
 * The admin UI's `useApi()` wraps an instance of this; mods get the same surface.
 * No hand-rolled fetch in pages — everything goes through here, so the wire
 * contract lives in one place ([`protocol.ts`](./protocol.ts)).
 *
 * Uses the global `fetch` by default; inject one for tests / non-browser hosts.
 */

import type { NodePorts,
  DeployResult,
  JsonDiff,
  MetricsSummary,
  ModInfo,
  OpInfo,
  PortCompatibility,
  PortRef,
  RunDetail,
  RunInput,
  RunResult,
  RunSummary,
  SaveResult,
  SpanData,
  SystemMap,
  Template,
  UiManifest,
  VersionId,
  VersionInfo,
  WorkflowDoc,
  WorkflowGetResult,
  WorkflowMeta,
} from "./protocol.js";

export interface AdminClientOptions {
  /** Base URL the admin is mounted at. Default "/admin". */
  baseUrl?: string;
  /** Injectable fetch (default global). */
  fetch?: typeof fetch;
  /** Extra headers (e.g. auth) added to every request. */
  headers?: Record<string, string>;
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export interface RunListFilter {
  workflow?: string;
  status?: string;
  limit?: number;
}

function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

export class AdminClient {
  private readonly api: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(opts: AdminClientOptions = {}) {
    this.api = `${(opts.baseUrl ?? "/admin").replace(/\/$/, "")}/api`;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.headers = opts.headers ?? {};
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.api}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...this.headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!res.ok) {
      const message = (parsed && typeof parsed === "object" && "error" in parsed ? String((parsed as { error: unknown }).error) : res.statusText) || `HTTP ${res.status}`;
      throw new AdminApiError(res.status, message, parsed);
    }
    return parsed as T;
  }

  // ── Workflows ──
  readonly workflows = {
    list: (): Promise<WorkflowMeta[]> => this.request("GET", "/workflows"),
    get: (slug: string): Promise<WorkflowGetResult> => this.request("GET", `/workflows/${encodeURIComponent(slug)}`),
    save: (slug: string, doc: WorkflowDoc, note?: string): Promise<SaveResult> =>
      this.request("POST", `/workflows/${encodeURIComponent(slug)}`, { doc, note }),
    delete: (slug: string): Promise<{ ok: boolean }> => this.request("DELETE", `/workflows/${encodeURIComponent(slug)}`),
    setEnabled: (slug: string, enabled: boolean): Promise<{ ok: boolean }> =>
      this.request("POST", `/workflows/${encodeURIComponent(slug)}/enabled`, { enabled }),
    explain: (slug: string): Promise<{ text: string }> => this.request("GET", `/workflows/${encodeURIComponent(slug)}/explain`),
    import: (json: WorkflowDoc | string): Promise<{ slug: string; issues: unknown[] }> => this.request("POST", "/import", { json }),
  };

  deploy = (slug: string, version: VersionId, swap?: boolean): Promise<DeployResult> =>
    this.request("POST", `/deploy/${encodeURIComponent(slug)}`, { version, swap });

  // ── Versions ──
  readonly versions = {
    list: (slug: string): Promise<VersionInfo[]> => this.request("GET", `/workflows/${encodeURIComponent(slug)}/versions`),
    get: (slug: string, v: VersionId): Promise<WorkflowDoc> => this.request("GET", `/workflows/${encodeURIComponent(slug)}/versions/${encodeURIComponent(v)}`),
    diff: (slug: string, a: VersionId, b: VersionId, ignoreUi?: boolean): Promise<JsonDiff> =>
      this.request("GET", `/workflows/${encodeURIComponent(slug)}/diff${qs({ a, b, ignoreUi })}`),
  };

  // ── Ops / ports ──
  readonly ops = {
    list: (): Promise<OpInfo[]> => this.request("GET", "/ops"),
    get: (type: string): Promise<OpInfo | null> => this.request("GET", `/ops/${encodeURIComponent(type)}`),
  };
  portsCompatible = (from: PortRef, to: PortRef): Promise<PortCompatibility> => this.request("POST", "/ports/compatible", { from, to });

  // ── Runs / metrics ──
  readonly runs = {
    list: (filter: RunListFilter = {}): Promise<RunSummary[]> => this.request("GET", `/runs${qs({ ...filter })}`),
    get: (runId: string): Promise<RunDetail | null> => this.request("GET", `/runs/${encodeURIComponent(runId)}`),
    /** Stream live node spans (SSE). Typed as a generator (not just
     *  AsyncIterable) so consumers can `.return()` to cancel — that runs the
     *  finally and closes the underlying SSE connection. */
    tail: (workflow?: string): AsyncGenerator<SpanData, void, undefined> => this.tailSpans(workflow),
    /** Abort an in-flight run (any entry path). */
    cancel: (runId: string): Promise<{ ok: boolean }> => this.request("POST", `/runs/${encodeURIComponent(runId)}/cancel`, {}),
    /** Pause an in-flight run: no new node starts; running ops finish. */
    pause: (runId: string): Promise<{ ok: boolean }> => this.request("POST", `/runs/${encodeURIComponent(runId)}/pause`, {}),
    resume: (runId: string): Promise<{ ok: boolean }> => this.request("POST", `/runs/${encodeURIComponent(runId)}/resume`, {}),
  };
  metrics = (minutes?: number): Promise<MetricsSummary> => this.request("GET", `/metrics${qs({ window: minutes })}`);

  // ── Mods / templates / UI manifest ──
  mods = (): Promise<ModInfo[]> => this.request("GET", "/mods");
  templates = (): Promise<Template[]> => this.request("GET", "/templates");
  uiManifest = (): Promise<UiManifest> => this.request("GET", "/ui/manifest");
  systemMap = (): Promise<SystemMap> => this.request("GET", "/system");
  /** Host/process/event-loop/transport snapshot (deltas since the last poll). */
  systemStats = <T = Record<string, unknown>>(): Promise<T> => this.request("GET", "/system/stats");
  /** Worker-efficiency benchmark: same workload inline vs on a worker pool. */
  systemBench = <T = Record<string, unknown>>(opts?: { n?: number; runs?: number; workers?: number }): Promise<T> =>
    this.request("POST", "/system/bench", opts ?? {});
  /** Server-side admin settings (run retention/exclusion). */
  readonly settings = {
    get: <T = Record<string, unknown>>(): Promise<T> => this.request("GET", "/settings"),
    set: <T = Record<string, unknown>>(patch: Record<string, unknown>): Promise<T> => this.request("POST", "/settings", patch),
  };
  /**
   * Call a dedicated route by `{ method, path }` — how declarative surfaces reach
   * their data and run their actions now that there is no generic invoke
   * endpoint. `:tokens` in the path are filled from `args`; leftover args become
   * the query string (GET/DELETE) or the JSON body (POST/PUT). The path is
   * relative to the admin API mount (e.g. "/store/collections/:collection/docs").
   */
  call = <T = unknown>(method: string, path: string, args?: Record<string, unknown>): Promise<T> => {
    const { path: filled, rest } = fillPath(path, args ?? {});
    const m = method.toUpperCase();
    return m === "GET" || m === "DELETE"
      ? this.request<T>(m, `${filled}${qs(rest)}`)
      : this.request<T>(m, filled, rest);
  };
  /** Run a workflow (draft doc or live slug) from a trigger; records the run. */
  run = (req: RunInput): Promise<RunResult> => this.request("POST", "/run", req);
  /** Per-node ports for a doc, resolved against each node's config (dynamic-port ops). */
  docPorts = (doc: unknown): Promise<Record<string, NodePorts>> => this.request("POST", "/doc/ports", { doc });

  /** Consume the SSE tail endpoint as parsed `SpanData` events. */
  private async *tailSpans(workflow?: string): AsyncGenerator<SpanData, void, undefined> {
    const res = await this.fetchImpl(`${this.api}/runs/tail${qs({ workflow })}`, {
      headers: { accept: "text/event-stream", ...this.headers },
    });
    if (!res.ok || !res.body) throw new AdminApiError(res.status, "failed to open tail stream");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        // SSE events are separated by a blank line; each `data:` line carries JSON.
        while ((nl = buffer.indexOf("\n\n")) !== -1) {
          const event = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 2);
          for (const line of event.split("\n")) {
            if (line.startsWith("data:")) {
              const json = safeJson(line.slice(5).trim());
              if (json) yield json as SpanData;
            }
          }
        }
      }
    } finally {
      // Cancel (not just releaseLock) so breaking out of the loop closes the
      // underlying HTTP connection instead of leaving the SSE stream open.
      await reader.cancel().catch(() => {});
    }
  }
}

/** Fill `:token` segments from `args`, returning the path + the unconsumed args. */
function fillPath(path: string, args: Record<string, unknown>): { path: string; rest: Record<string, unknown> } {
  const rest = { ...args };
  const filled = path.replace(/:([A-Za-z0-9_]+)/g, (_m, key: string) => {
    const v = rest[key];
    delete rest[key];
    return encodeURIComponent(String(v ?? ""));
  });
  return { path: filled, rest };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Create a typed admin API client. */
export function createAdminClient(opts?: AdminClientOptions): AdminClient {
  return new AdminClient(opts);
}
