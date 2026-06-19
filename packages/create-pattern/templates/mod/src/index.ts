/**
 * {{pkgName}} — a Pattern mod.
 *
 * `defineMod` bundles everything this package contributes — ops, workflows
 * (incl. routes), an admin page, and a docs chapter — behind one object.
 * Install it by adding "{{pkgName}}" to a project's pattern.config.json `mods`.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineMod } from "@pattern/core";
import { localFs, provideFilesystem } from "@pattern/runtime-node";
import { itemsList } from "./ops.js";
import { itemsRoute, itemsAdminRoute } from "./routes.js";
import { frontendTier1 } from "./frontend.js";

export default defineMod({
  name: "{{pkgName}}",
  ops: [itemsList],
  workflows: [itemsRoute, itemsAdminRoute],
  frontend: frontendTier1,
  docs: { filesystem: "{{name}}-docs", title: "{{Title}}", order: 50 },
  setup: (engine) => {
    // Ship the docs/ chapter as a filesystem (the `docs` contribution points here).
    try {
      const dir = fileURLToPath(new URL("../docs", import.meta.url));
      if (existsSync(dir)) provideFilesystem(engine, "{{name}}-docs", localFs(dir));
    } catch {
      /* packaged without docs — the contribution is simply skipped */
    }
  },
});
