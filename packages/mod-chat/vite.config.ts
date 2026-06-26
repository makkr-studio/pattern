import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { fileURLToPath } from "node:url";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Voice mode's on-device VAD needs the Silero model + worklet (from vad-web) and
// the onnxruntime-web wasm. We VENDOR them under dist-app/vad/ so they're served
// same-origin (the host serves dist-app under the SPA mount) — self-contained, no
// CDN, version-matched. vad.ts points baseAssetPath + onnxWASMBasePath at "vad/".
const vadAssets = [
  "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
  "node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs",
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
];

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
    viteStaticCopy({ targets: vadAssets.map((src) => ({ src: dir(src), dest: "vad" })) }),
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
