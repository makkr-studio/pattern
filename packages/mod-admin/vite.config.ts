import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Builds the admin SPA (src/app) → dist-app/, served by `boundary.http.app` under
 * the `/admin` mount. In dev, Vite serves on 5273 and proxies the workflow-backed
 * API to the engine.
 */
export default defineConfig({
  root: dir("src/app"),
  base: "/admin/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: dir("dist-app"),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5273,
    proxy: {
      "/admin/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
