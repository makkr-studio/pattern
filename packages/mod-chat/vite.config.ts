import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { copyFileSync, createReadStream, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Voice mode's on-device VAD needs the Silero model + worklet (from vad-web) and
// the onnxruntime-web wasm. We VENDOR them FLAT under <mount>/vad/ so they're
// served same-origin (the host serves dist-app under the SPA mount) — self-
// contained, no CDN, version-matched. vad.ts points baseAssetPath +
// onnxWASMBasePath at "vad/".
const vadAssets = [
  "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
  "node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
];

// Vendor the VAD assets by hand instead of via vite-plugin-static-copy: v4 of
// that plugin mirrors each source's `node_modules/…` directory tree under the
// dest rather than flattening to the basename, so the app's `vad/<file>` fetches
// 404. This copies them flat — into dist-app/vad/ for the build, and serves them
// at `…/vad/<file>` for the dev server.
const MIME: Record<string, string> = {
  ".onnx": "application/octet-stream",
  ".wasm": "application/wasm",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
};
function vendorVadAssets(): Plugin {
  const byName = new Map(vadAssets.map((src) => [path.basename(src), dir(src)]));
  return {
    name: "vendor-vad-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url ? path.basename(req.url.split("?")[0]) : "";
        const file = byName.get(name);
        if (!file || !req.url?.includes("/vad/") || !existsSync(file)) return next();
        res.setHeader("Content-Type", MIME[path.extname(name)] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      const destDir = path.join(options.dir ?? dir("dist-app"), "vad");
      mkdirSync(destDir, { recursive: true });
      for (const [name, file] of byName) copyFileSync(file, path.join(destDir, name));
    },
  };
}

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
  plugins: [
    react(),
    tailwindcss(),
    vendorVadAssets(),
  ],
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
