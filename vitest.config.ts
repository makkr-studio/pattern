import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Resolve @pattern-js/core to TS source for fast, build-free iteration.
      "@pattern-js/core/boundaries": r("./packages/core/src/boundaries/index.ts"),
      "@pattern-js/core/ops": r("./packages/core/src/ops-core/index.ts"),
      "@pattern-js/core": r("./packages/core/src/index.ts"),
      // mod-admin (backend) + admin-sdk resolve to TS source for build-free iteration.
      "@pattern-js/mod-admin": r("./packages/mod-admin/src/index.ts"),
      "@pattern-js/admin-sdk": r("./packages/admin-sdk/src/index.ts"),
      "@pattern-js/mod-sample": r("./packages/mod-sample/src/index.ts"),
      "@pattern-js/mod-identity": r("./packages/mod-identity/src/index.ts"),
      "@pattern-js/mod-auth-magic-link": r("./packages/mod-auth-magic-link/src/index.ts"),
      "@pattern-js/mod-store": r("./packages/mod-store/src/index.ts"),
      "@pattern-js/mod-vault": r("./packages/mod-vault/src/index.ts"),
      "@pattern-js/mod-agents": r("./packages/mod-agents/src/index.ts"),
      "@pattern-js/mod-ai": r("./packages/mod-ai/src/index.ts"),
      "@pattern-js/mod-chat": r("./packages/mod-chat/src/index.ts"),
      "@pattern-js/mod-docs": r("./packages/mod-docs/src/index.ts"),
      // runtime-node is loaded from its built dist (the worker pool needs built
      // JS to spawn workers); its own @pattern-js/core imports still alias above.
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/tests/**/*.test.ts",
      "packages/*/tests/**/*.test.tsx",
    ],
    environment: "node",
    pool: "threads",
    testTimeout: 15_000,
  },
});
