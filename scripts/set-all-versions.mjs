#!/usr/bin/env node
/**
 * Set the version of every workspace package (and the monorepo root) to the
 * argument. Used by CI before publishing: `node scripts/set-all-versions.mjs 0.3.0`.
 *
 * Inter-package `workspace:*` deps are left as-is; `pnpm publish` rewrites them
 * to the real version at pack time, so the published set is internally
 * consistent.
 *
 * The create-pattern templates' @pattern-js/* dep ranges are also rewritten to
 * `^major.minor.0` — the CLI re-derives that range from its own version at
 * scaffold time anyway, but keeping the checked-in files truthful means a
 * template diff always shows the range a scaffold really gets.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!version) {
  console.error("usage: set-all-versions.mjs <version>");
  process.exit(1);
}

const targets = [join(ROOT, "package.json")];
const pkgsDir = join(ROOT, "packages");
for (const name of readdirSync(pkgsDir)) {
  const p = join(pkgsDir, name, "package.json");
  if (existsSync(p)) targets.push(p);
}

for (const p of targets) {
  const pkg = JSON.parse(readFileSync(p, "utf8"));
  if (!pkg.version) continue;
  pkg.version = version;
  writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`set ${pkg.name} -> ${version}`);
}

// Template @pattern-js/* dep ranges follow the release minor.
const range = `^${version.split(".").slice(0, 2).join(".")}.0`;
const templatesDir = join(pkgsDir, "create-pattern", "templates");
if (existsSync(templatesDir)) {
  for (const name of readdirSync(templatesDir)) {
    const p = join(templatesDir, name, "package.json");
    if (!existsSync(p)) continue;
    const pkg = JSON.parse(readFileSync(p, "utf8"));
    let touched = false;
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const dep of Object.keys(pkg[field] ?? {})) {
        if (dep.startsWith("@pattern-js/") && pkg[field][dep] !== range) {
          pkg[field][dep] = range;
          touched = true;
        }
      }
    }
    if (touched) {
      writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
      console.log(`set ${name} template @pattern-js/* -> ${range}`);
    }
  }
}
