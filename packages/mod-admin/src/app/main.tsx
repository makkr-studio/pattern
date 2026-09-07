import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@xyflow/react/dist/style.css";
import "./index.css";
import { Shell } from "./shell/Shell";
import { DashboardPage } from "./pages/DashboardPage";
import { CatalogPage } from "./pages/CatalogPage";
import { EditorPage } from "./pages/EditorPage";
import { RunsPage } from "./pages/RunsPage";
import { ReplayPage } from "./pages/ReplayPage";
import { OpsPage } from "./pages/OpsPage";
import { ModsPage } from "./pages/ModsPage";
import { SystemPage } from "./pages/SystemPage";
import { MetricsPage } from "./pages/MetricsPage";
import { ProcessPage } from "./pages/ProcessPage";
import { SettingsPage } from "./pages/SettingsPage";
import { VersionsPage } from "./pages/VersionsPage";
import { ManifestPage } from "./pages/ManifestPage";
import { WorkflowLayout } from "./pages/workflow/WorkflowLayout";
import { WorkflowSettingsPage } from "./pages/workflow/WorkflowSettingsPage";
import { api } from "./lib/api";
import * as React from "react";
import {
  Badge,
  Dot,
  EmptyState,
  GlassPanel,
  GlowCard,
  JsonView,
  Modal,
  NeonButton,
  PageHeader,
  Spinner,
  Table,
} from "./components/ui";
import { FormFromSchema } from "./components/FormFromSchema";
import { Markdown } from "./components/Markdown";
import { motion } from "motion/react";
import * as lucide from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 2000, retry: 1 } },
});

/** Pre-0.5 URLs (`/editor/:slug`, `/versions/:slug`) land on the workflow's workspace. */
function LegacySlugRedirect({ tab }: { tab: "editor" | "versions" }) {
  const { slug } = useParams();
  return <Navigate to={slug ? `/workflows/${encodeURIComponent(slug)}/${tab}` : "/workflows"} replace />;
}

const router = createBrowserRouter(
  [
    {
      element: <Shell />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: "workflows", element: <CatalogPage /> },
        // A workflow is a workspace: Editor · Runs · Versions · Settings share one chrome.
        { path: "workflows/new", element: <WorkflowLayout />, children: [{ index: true, element: <EditorPage /> }] },
        {
          path: "workflows/:slug",
          element: <WorkflowLayout />,
          children: [
            { index: true, element: <Navigate to="editor" replace /> },
            { path: "editor", element: <EditorPage /> },
            { path: "runs", element: <RunsPage /> },
            { path: "runs/:runId", element: <RunsPage /> },
            { path: "versions", element: <VersionsPage /> },
            { path: "settings", element: <WorkflowSettingsPage /> },
          ],
        },
        { path: "editor", element: <Navigate to="/workflows" replace /> },
        { path: "editor/:slug", element: <LegacySlugRedirect tab="editor" /> },
        { path: "versions/:slug", element: <LegacySlugRedirect tab="versions" /> },
        { path: "runs", element: <RunsPage /> },
        { path: "runs/:runId", element: <RunsPage /> },
        { path: "runs/:runId/replay", element: <ReplayPage /> },
        { path: "ops", element: <OpsPage /> },
        { path: "ops/:type", element: <OpsPage /> },
        { path: "mods", element: <ModsPage /> },
        { path: "system", element: <SystemPage /> },
        { path: "metrics", element: <MetricsPage /> },
        { path: "process", element: <ProcessPage /> },
        { path: "settings", element: <SettingsPage /> },
        { path: "*", element: <ManifestPage /> },
      ],
    },
  ],
  { basename: "/admin" },
);

// Shared deps for Tier-2 ESM remotes (so mod bundles don't double-load React/SDK),
// plus the glass UI kit so mod pages match the admin's visual language
// (admin internals §6/§12 — typed in @pattern-js/admin-sdk as `PatternAdminGlobal`).
(globalThis as Record<string, unknown>).__PATTERN_ADMIN__ = {
  React,
  api,
  ui: {
    GlassPanel,
    GlowCard,
    NeonButton,
    Badge,
    Dot,
    Spinner,
    EmptyState,
    PageHeader,
    Table,
    JsonView,
    Modal,
    FormFromSchema,
    Markdown,
  },
  // The admin's animation + icon libraries, shared so Tier-2 mod pages use the
  // same stack (motion.dev + lucide) without bundling their own.
  motion,
  lucide,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
