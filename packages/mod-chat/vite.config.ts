import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Builds the chat SPA (src/app) → dist-app/, served by `boundary.http.app`
 * under the `/chat` mount. In dev, Vite serves on 5274 and proxies the
 * workflow-backed API (and blob serving) to the engine.
 */
export default defineConfig({
  root: dir("src/app"),
  // Relative asset URLs so the bundle is MOUNT-PORTABLE: the host injects a
  // `<base href="${mount}/">` into the served index.html (runtime-node's
  // injectBootstrap), and `./assets/...` then resolve under whatever mount this
  // instance is served at — /chat, /sales, /support… (see app/lib/config.ts).
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: dir("dist-app"),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5274,
    proxy: {
      "/chat/api": { target: "http://localhost:3000", changeOrigin: true },
      "/store/blobs": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
