import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Resolve @pattern/core to TS source for fast, build-free iteration.
      "@pattern/core/boundaries": r("./packages/core/src/boundaries/index.ts"),
      "@pattern/core/ops": r("./packages/core/src/ops-core/index.ts"),
      "@pattern/core": r("./packages/core/src/index.ts"),
      // mod-admin (backend) + admin-sdk resolve to TS source for build-free iteration.
      "@pattern/mod-admin": r("./packages/mod-admin/src/index.ts"),
      "@pattern/admin-sdk": r("./packages/admin-sdk/src/index.ts"),
      "@pattern/mod-sample": r("./packages/mod-sample/src/index.ts"),
      "@pattern/mod-identity": r("./packages/mod-identity/src/index.ts"),
      "@pattern/mod-auth-magic-link": r("./packages/mod-auth-magic-link/src/index.ts"),
      "@pattern/mod-store": r("./packages/mod-store/src/index.ts"),
      "@pattern/mod-vault": r("./packages/mod-vault/src/index.ts"),
      "@pattern/mod-agents": r("./packages/mod-agents/src/index.ts"),
      "@pattern/mod-agents-openai": r("./packages/mod-agents-openai/src/index.ts"),
      // runtime-node is loaded from its built dist (the worker pool needs built
      // JS to spawn workers); its own @pattern/core imports still alias above.
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
