import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Builds the docs SPA (src/app) → dist-app/, served by `boundary.http.app`
 * under the `/docs` mount. In dev, Vite serves on 5275 and proxies the
 * workflow-backed API (+ the llms.txt / raw markdown routes) to the engine.
 */
export default defineConfig({
  root: dir("src/app"),
  base: "/docs/",
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
});
