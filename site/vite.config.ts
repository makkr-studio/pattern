import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The framework version is the monorepo root's version (currently 0.2.1). Inject
// it at build time so the nav badge, install snippets, and footer always match
// what is published — no runtime env var.
const version = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")).version as string;

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  define: {
    __VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5280,
  },
});
