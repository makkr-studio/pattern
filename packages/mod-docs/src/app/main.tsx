/** Pattern Docs — router. The shell loads the manifest; pages read it via context. */

import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Shell } from "./shell/Shell";
import { HomePage } from "./pages/HomePage";
import { DocPage } from "./pages/DocPage";
import { OpsIndexPage } from "./pages/OpsIndexPage";
import { OpPage } from "./pages/OpPage";
import { ModsPage } from "./pages/ModsPage";
import "./index.css";

const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <Shell />,
      children: [
        { index: true, element: <HomePage /> },
        // The generated reference sits above the chapter catch-alls.
        { path: "ops", element: <OpsIndexPage /> },
        { path: "ops/*", element: <OpPage /> },
        { path: "mods", element: <ModsPage /> },
        { path: ":chapter", element: <DocPage /> },
        { path: ":chapter/*", element: <DocPage /> },
      ],
    },
  ],
  { basename: "/docs" },
);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
