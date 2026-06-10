#!/usr/bin/env node
/**
 * Test `create-pattern` end-to-end against a local Verdaccio registry: scaffold a
 * project, install its deps (pulling the freshly-published @pattern/* packages),
 * and optionally run it.
 *
 *   node scripts/verdaccio-test-create.mjs                       # blank modpack, install + run
 *   node scripts/verdaccio-test-create.mjs --template studio     # different modpack
 *   node scripts/verdaccio-test-create.mjs --no-run --keep       # keep the temp dir, skip run
 *
 * Publish first with:  node scripts/verdaccio-publish.mjs
 */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REGISTRY = process.env.VERDACCIO_REGISTRY || "http://localhost:4873";
const args = process.argv.slice(2);
const tIdx = args.indexOf("--template");
const template = tIdx >= 0 ? args[tIdx + 1] : "blank";
const keep = args.includes("--keep");
const run = !args.includes("--no-run");

const c = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

// Point npm at Verdaccio (covers both `npm create` resolution and the
// scaffolded project's own `npm install`), and prefer fresh metadata so a newly
// bumped `latest` is picked up.
const env = {
  ...process.env,
  npm_config_registry: REGISTRY,
  npm_config_prefer_online: "true",
};

const dir = mkdtempSync(join(tmpdir(), "pattern-create-"));
const name = `demo-${template}`;
const appDir = join(dir, name);

function sh(cmd, cwd) {
  console.log(c.dim(`$ ${cmd}`));
  execSync(cmd, { cwd, env, stdio: "inherit" });
}

try {
  console.log(c.b(`\nScaffolding ${c.cyan(template)} from ${REGISTRY}`));
  console.log(c.dim(`  workdir: ${dir}\n`));

  // `--` forwards the rest to create-pattern; install runs with the env registry.
  sh(`npm create pattern@latest -- ${name} --template ${template} --pm npm --no-git --yes`, dir);

  if (!existsSync(appDir)) throw new Error(`scaffold did not create ${appDir}`);

  if (run && existsSync(join(appDir, "src/index.ts"))) {
    if (template === "blank") {
      console.log(c.b("\nRunning the scaffolded app…"));
      sh(`node src/index.ts`, appDir);
    } else {
      console.log(c.dim(`\n(skipping run for "${template}" — it starts a server; cd ${appDir} && npm run dev)`));
    }
  }

  console.log(c.green(`\n✓ create-pattern works against Verdaccio`));
  if (keep) console.log(c.dim(`  kept: ${appDir}`));
} catch (err) {
  console.error(c.red(`\n✗ ${err instanceof Error ? err.message : String(err)}`));
  console.error(c.dim(`  temp dir: ${appDir}`));
  process.exit(1);
} finally {
  if (!keep) rmSync(dir, { recursive: true, force: true });
}
