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
    { type: "core.math.add", title: "add", category: "math", inputs: [{ name: "a", kind: "value" }, { name: "b", kind: "value" }], outputs: [{ name: "out", kind: "value" }], controlOut: [], usedBy: 2 },
  ]);
  qc.setQueryData(["mods"], [{ name: "@pattern/mod-admin", ops: ["admin.workflow.list"], workflows: ["admin.api.ops.list"], frontend: { menu: 5, pages: 0, commands: 2 } }]);
  qc.setQueryData(["system"], { routes: [{ method: "GET", path: "/hello/:name", workflow: "greeting", conflict: false }], apps: [], schedules: [], hooks: [], events: [], ws: [], ports: [3000] });
  qc.setQueryData(["metrics"], { window: { label: "since boot", sinceBoot: true }, runs: 12, errors: 1, errorRate: 0.08, inFlight: 0, runsPerMin: 3.2, perWorkflow: [{ workflowId: "greeting", count: 10, errors: 1, p50: 2, p95: 8, p99: 12, maxMs: 20 }] });
  qc.setQueryData(["runs", {}], [
    { runId: "run-1234abcd", traceId: "t", workflowId: "greeting", trigger: "in", principal: {}, status: "ok", startTime: Date.now() - 1000, endTime: Date.now(), durationMs: 7, spanCount: 3 },
  ]);
  return qc;
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
    expect(screen.getByText("Used by 2 workflow(s).")).toBeTruthy();
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
    expect(screen.getByText("@pattern/mod-admin")).toBeTruthy();
  });

  it("Runs list renders a run", () => {
    mount(<RunsPage />, "/runs", "/runs");
    expect(screen.getByText("greeting")).toBeTruthy();
  });

  it("Editor mounts with palette + canvas", () => {
    mount(<EditorPage />, "/editor", "/editor");
    expect(screen.getByText("Palette")).toBeTruthy();
    expect(screen.getByText("New workflow")).toBeTruthy();
  });
});
