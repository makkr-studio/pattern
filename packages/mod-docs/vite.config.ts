import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Builds the docs SPA (src/app) → dist-app/, served by `boundary.http.app`.
 * The built bundle uses RELATIVE asset URLs (base "./") so the host's injected
 * `<base href="${mount}/">` makes it work under any configured mount, not only
 * `/docs`. In dev, Vite serves on 5275 under `/docs/` (matching the API proxy)
 * and proxies the workflow-backed API (+ the llms.txt / raw markdown routes).
 */
export default defineConfig(({ command }) => ({
  root: dir("src/app"),
  base: command === "build" ? "./" : "/docs/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: dir("dist-app"),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5275,
    proxy: {
      "/docs/api": { target: "http://localhost:3000", changeOrigin: true },
      "/docs/llms.txt": { target: "http://localhost:3000", changeOrigin: true },
      "/docs/raw": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
}));
