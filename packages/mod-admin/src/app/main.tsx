import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@xyflow/react/dist/style.css";
import "./index.css";
import { Shell } from "./shell/Shell";
import { CatalogPage } from "./pages/CatalogPage";
import { EditorPage } from "./pages/EditorPage";
import { RunsPage } from "./pages/RunsPage";
import { OpsPage } from "./pages/OpsPage";
import { ModsPage } from "./pages/ModsPage";
import { SystemPage } from "./pages/SystemPage";
import { MetricsPage } from "./pages/MetricsPage";
import { VersionsPage } from "./pages/VersionsPage";
import { ManifestPage } from "./pages/ManifestPage";
import { api } from "./lib/api";
import * as React from "react";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 2000, retry: 1 } },
});

const router = createBrowserRouter(
  [
    {
      element: <Shell />,
      children: [
        { index: true, element: <Navigate to="/workflows" replace /> },
        { path: "workflows", element: <CatalogPage /> },
        { path: "editor", element: <EditorPage /> },
        { path: "editor/:slug", element: <EditorPage /> },
        { path: "runs", element: <RunsPage /> },
        { path: "runs/:runId", element: <RunsPage /> },
        { path: "ops", element: <OpsPage /> },
        { path: "ops/:type", element: <OpsPage /> },
        { path: "mods", element: <ModsPage /> },
        { path: "system", element: <SystemPage /> },
        { path: "metrics", element: <MetricsPage /> },
        { path: "versions/:slug", element: <VersionsPage /> },
        { path: "*", element: <ManifestPage /> },
      ],
    },
  ],
  { basename: "/admin" },
);

// Shared deps for Tier-2 ESM remotes (so mod bundles don't double-load React/SDK).
(globalThis as Record<string, unknown>).__PATTERN_ADMIN__ = { React, api };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
