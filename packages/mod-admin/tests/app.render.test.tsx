// @vitest-environment happy-dom
/**
 * SPA render smoke tests (no live browser available in CI): mount each page
 * against a seeded query cache and assert it renders real content without
 * throwing. Complements the strict app type-check + `vite build`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { ReactElement } from "react";

import { CatalogPage } from "../src/app/pages/CatalogPage";
import { OpsPage } from "../src/app/pages/OpsPage";
import { SystemPage } from "../src/app/pages/SystemPage";
import { MetricsPage } from "../src/app/pages/MetricsPage";
import { ModsPage } from "../src/app/pages/ModsPage";
import { RunsPage } from "../src/app/pages/RunsPage";
import { EditorPage } from "../src/app/pages/EditorPage";
import { ManifestPage } from "../src/app/pages/ManifestPage";
import { WorkflowLayout } from "../src/app/pages/workflow/WorkflowLayout";
import { WorkflowSettingsPage } from "../src/app/pages/workflow/WorkflowSettingsPage";

// xyflow needs ResizeObserver + matchMedia in the DOM env.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  if (!window.matchMedia) {
    // @ts-expect-error test shim
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
});

afterEach(() => cleanup());

function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false, staleTime: Infinity } } });
  qc.setQueryData(["manifest"], { menu: [], commands: [], assets: [], pages: [] });
  qc.setQueryData(["workflows"], [
    { slug: "greeting", name: "Greeting", source: "file", enabled: true, live: "v1", route: { method: "GET", path: "/hello/:name" }, versions: [{ id: "v1", hash: "x", createdAt: "" }], audit: [] },
  ]);
  qc.setQueryData(["ops"], [
    { type: "core.math.add", title: "add", category: "math", inputs: [{ name: "a", kind: "value" }, { name: "b", kind: "value" }], outputs: [{ name: "out", kind: "value" }], controlOut: [], usedBy: 2, reusable: true },
    { type: "admin.workflow.list", title: "admin.workflow.list", category: "admin", inputs: [], outputs: [{ name: "out", kind: "value" }], controlOut: [], usedBy: 1, reusable: false },
  ]);
  qc.setQueryData(["mods"], [{ name: "@pattern-js/mod-admin", ops: ["admin.workflow.list"], workflows: ["admin.api.ops.list"], frontend: { menu: 5, pages: 0, commands: 2 } }]);
  qc.setQueryData(["system"], { routes: [{ method: "GET", path: "/hello/:name", workflow: "greeting", conflict: false }], apps: [], schedules: [], hooks: [], events: [], ws: [], ports: [3000] });
  qc.setQueryData(["metrics"], { window: { label: "since boot", sinceBoot: true }, runs: 12, errors: 1, errorRate: 0.08, inFlight: 0, runsPerMin: 3.2, perWorkflow: [{ workflowId: "greeting", count: 10, errors: 1, p50: 2, p95: 8, p99: 12, maxMs: 20 }] });
  const run = { runId: "run-1234abcd", traceId: "t", workflowId: "greeting", trigger: "in", principal: {}, status: "ok", startTime: Date.now() - 1000, endTime: Date.now(), durationMs: 7, spanCount: 3 };
  qc.setQueryData(["runs", { limit: 500 }], [run]);
  qc.setQueryData(["runs", { limit: 500, workflow: "greeting" }], [run]);
  const doc = {
    id: "greeting",
    name: "Greeting",
    durable: true,
    nodes: [
      { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/hello/:name", requireAuth: { scopes: ["member"] } } },
      { id: "add", op: "core.math.add", config: {} },
    ],
    edges: [],
  };
  qc.setQueryData(["workflow", "greeting"], {
    meta: {
      slug: "greeting",
      name: "Greeting",
      source: "file",
      enabled: true,
      live: "v1",
      route: { method: "GET", path: "/hello/:name" },
      versions: [
        { id: "v1", hash: "x", createdAt: "" },
        { id: "v2", hash: "y", createdAt: "" },
      ],
      audit: [],
    },
    liveDoc: { ...doc, durable: undefined, nodes: [doc.nodes[0]] },
    latestDoc: doc,
  });
  return qc;
}

/** Mount a workflow workspace page the way main.tsx routes it (layout + child). */
function mountWorkspace(child: ReactElement, path: string, childPath: string) {
  return render(
    <QueryClientProvider client={seeded()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="workflows/:slug" element={<WorkflowLayout />}>
            <Route path={childPath} element={child} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mount(ui: ReactElement, path = "/", routePath = "*") {
  return render(
    <QueryClientProvider client={seeded()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SPA pages render", () => {
  it("Catalog lists workflows", () => {
    mount(<CatalogPage />);
    expect(screen.getByText("Greeting")).toBeTruthy();
    expect(screen.getByText("GET /hello/:name")).toBeTruthy();
  });

  it("Ops browser lists ops and shows detail", () => {
    mount(<OpsPage />, "/ops/core.math.add", "/ops/:type");
    expect(screen.getAllByText("core.math.add").length).toBeGreaterThan(0);
    expect(screen.getByText("Used by 2 workflows")).toBeTruthy();
  });

  it("System map renders sections", () => {
    mount(<SystemPage />);
    expect(screen.getByText("HTTP routes")).toBeTruthy();
    expect(screen.getByText("Hook chains")).toBeTruthy();
  });

  it("Metrics strip renders counters", () => {
    mount(<MetricsPage />);
    expect(screen.getByText("Runs / min")).toBeTruthy();
    expect(screen.getByText("3.2")).toBeTruthy();
  });

  it("Mods page renders contributions", () => {
    mount(<ModsPage />);
    expect(screen.getByText("@pattern-js/mod-admin")).toBeTruthy();
  });

  it("Runs list renders a run", () => {
    mount(<RunsPage />, "/runs", "/runs");
    expect(screen.getByText("greeting")).toBeTruthy();
  });

  it("Editor mounts with categorized palette + Advanced section (new workflow)", () => {
    // /workflows/new: the layout says "New workflow", the editor asks for a slug.
    render(
      <QueryClientProvider client={seeded()}>
        <MemoryRouter initialEntries={["/workflows/new"]}>
          <Routes>
            <Route path="workflows/new" element={<WorkflowLayout />}>
              <Route index element={<EditorPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("New workflow")).toBeTruthy();
    expect(screen.getByLabelText("Slug for the new workflow")).toBeTruthy();
    expect(screen.getByText("math")).toBeTruthy(); // reusable category section
    expect(screen.getByText("Add")).toBeTruthy(); // disambiguated palette label
    expect(screen.getByText("Advanced")).toBeTruthy(); // non-reusable ops collapsed here
    // Nothing selected → the dock shows the workflow's own settings.
    expect(screen.getByText("Durable runs (resume & re-run)")).toBeTruthy();
    // Save first: the other workspace tabs wait for a slug.
    expect(screen.getAllByTitle("Save the workflow first").length).toBe(3);
  });

  it("Workspace header tells the deployment truth: saved v2 vs live v1", () => {
    mountWorkspace(<WorkflowSettingsPage />, "/workflows/greeting/settings", "settings");
    expect(screen.getByText("Greeting")).toBeTruthy();
    expect(screen.getByText("Saved v2")).toBeTruthy();
    expect(screen.getByText("Live v1")).toBeTruthy();
    expect(screen.getByText("Deploy v2")).toBeTruthy();
    // Settings tab: identity + execution + deployment sections.
    expect(screen.getByText("Identity")).toBeTruthy();
    expect(screen.getByText("Deployment")).toBeTruthy();
    expect(screen.getByText("Save as new version")).toBeTruthy();
  });

  it("A workflow's Runs tab lists only its runs, without the global header", () => {
    mountWorkspace(<RunsPage />, "/workflows/greeting/runs", "runs");
    expect(screen.getAllByText("greeting").length).toBeGreaterThan(0);
    expect(screen.queryByText("Live tail")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Runs" })).toBeNull();
  });

  it("ManifestPage renders a mod's Tier-1 declarative table (M10)", () => {
    const qc = seeded();
    qc.setQueryData(["manifest"], {
      menu: [{ category: "Examples", label: "Greetings", path: "/x/greetings" }],
      commands: [],
      assets: [],
      pages: [{ path: "/x/greetings", view: { kind: "table", route: { method: "GET", path: "/sample/greetings" }, columns: [{ key: "id", label: "ID" }, { key: "text", label: "Greeting" }] } }],
    });
    qc.setQueryData(["call", "GET", "/sample/greetings", {}], [{ id: "ada", text: "Hello, Ada!" }]);
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/x/greetings"]}>
          <Routes>
            <Route path="*" element={<ManifestPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Hello, Ada!")).toBeTruthy();
    expect(screen.getByText("Greetings")).toBeTruthy(); // titled from the menu entry
    // A mod page is a first-class page — no "contributed by a mod" name tag
    // under the title (that was scaffolding-era debug chrome).
    expect(screen.queryByText("Contributed by", { exact: false })).toBeNull();
  });
});
