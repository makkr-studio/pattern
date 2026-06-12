#!/usr/bin/env node
/**
 * Publish all publishable Pattern packages to a local Verdaccio registry.
 *
 *   node scripts/verdaccio-publish.mjs               # bump patch, build, publish
 *   node scripts/verdaccio-publish.mjs --set 0.1.7   # publish an exact version
 *   node scripts/verdaccio-publish.mjs --no-bump     # republish current version
 *   VERDACCIO_REGISTRY=http://localhost:4873 node scripts/verdaccio-publish.mjs
 *
 * Notes
 * - Versions are kept in lockstep across @pattern/core, @pattern/runtime-node,
 *   and create-pattern, bumped within 0.1.x so the templates' `^0.1.0` deps
 *   resolve to the freshly-published version.
 * - `runtime-node`'s `workspace:*` dep on core is converted to the real version
 *   by `pnpm publish` automatically.
 * - You must be logged in to the registry once:
 *       npm adduser --registry http://localhost:4873
 *   (any user/password/email works with a default Verdaccio config).
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = process.env.VERDACCIO_REGISTRY || "http://localhost:4873";

// Publish order matters: dependencies before dependents (core → runtime-node →
// admin-sdk → mod-admin → create-pattern, whose studio modpack pulls mod-admin).
const PKG_DIRS = [
  "packages/core",
  "packages/runtime-node",
  "packages/admin-sdk",
  "packages/mod-admin",
  "packages/mod-identity",
  "packages/mod-auth-magic-link",
  "packages/mod-store",
  "packages/mod-vault",
  "packages/create-pattern",
];

const args = process.argv.slice(2);
const setIdx = args.indexOf("--set");
const explicit = setIdx >= 0 ? args[setIdx + 1] : undefined;
const noBump = args.includes("--no-bump");
const dryRun = args.includes("--dry-run");

const c = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const pkgPath = (dir) => join(ROOT, dir, "package.json");
const readPkg = (dir) => JSON.parse(readFileSync(pkgPath(dir), "utf8"));

function nextVersion() {
  if (explicit) return explicit;
  const cur = readPkg("packages/core").version;
  if (noBump) return cur;
  const [maj, min, patch] = cur.split(".").map(Number);
  return `${maj}.${min}.${patch + 1}`;
}

function run(cmd, opts = {}) {
  console.log(c.dim(`$ ${cmd}`));
  execSync(cmd, { cwd: ROOT, stdio: "inherit", ...opts });
}

function main() {
  // Ensure the registry is reachable before doing anything destructive.
  try {
    execSync(`curl -sf ${REGISTRY}/-/ping`, { stdio: "ignore" });
  } catch {
    console.warn(c.red(`⚠ could not reach Verdaccio at ${REGISTRY}`));
    console.warn(c.dim(`  start it with:  npx verdaccio   (default port 4873)`));
  }

  const version = nextVersion();
  console.log(c.b(`\n${dryRun ? "[dry-run] " : ""}Publishing Pattern @ ${c.cyan(version)} → ${REGISTRY}\n`));

  if (dryRun) {
    for (const dir of PKG_DIRS) {
      console.log(`  ${c.dim("would set+publish")} ${readPkg(dir).name} → ${version}`);
    }
    console.log(c.dim("\n[dry-run] no files written, nothing built or published."));
    return;
  }

  // 1. Write the version into every package.json.
  for (const dir of PKG_DIRS) {
    const pkg = readPkg(dir);
    pkg.version = version;
    writeFileSync(pkgPath(dir), JSON.stringify(pkg, null, 2) + "\n");
    console.log(`  ${c.green("set")} ${pkg.name} → ${version}`);
  }

  // 2. Build everything.
  console.log(c.b("\nBuilding…"));
  run(`pnpm -r --filter "./packages/**" run build`);

  // 3. Publish in dependency order.
  console.log(c.b("\nPublishing…"));
  for (const dir of PKG_DIRS) {
    const pkg = readPkg(dir);
    run(`pnpm --filter ${pkg.name} publish --registry ${REGISTRY} --no-git-checks --access public`);
  }

  console.log(c.green(`\n✓ published @ ${version}`));
  console.log(c.dim(`\nTest the scaffolder against this registry:`));
  console.log(`  node scripts/verdaccio-test-create.mjs\n`);
}

try {
  main();
} catch (err) {
  console.error(c.red(`\n✗ ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
}
