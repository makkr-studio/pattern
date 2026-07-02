/**
 * Scaffold-behavior tests: run the BUILT CLI headlessly into a tmpdir and
 * assert the artifacts it writes — the dimensions (auth / sign-in methods /
 * email delivery / examples) and the derived @pattern-js/* dep ranges. Like
 * runtime-node, this suite runs against dist (build before test).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const SELF = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version: string };
const RANGE = `^${SELF.version.split(".").slice(0, 2).join(".")}.0`;

const cwd = mkdtempSync(join(tmpdir(), "create-pattern-test-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

function scaffold(name: string, ...flags: string[]) {
  const res = spawnSync(process.execPath, [CLI, name, "--yes", "--no-install", "--no-git", ...flags], { cwd, encoding: "utf8" });
  expect(res.status, res.stderr).toBe(0);
  const dir = join(cwd, name);
  const read = (f: string) => readFileSync(join(dir, f), "utf8");
  return { dir, read, json: (f: string) => JSON.parse(read(f)) as Record<string, any> };
}

describe("create-pattern scaffold dimensions", () => {
  it("--help prints the flag reference (incl. --oidc) and writes nothing", () => {
    const res = spawnSync(process.execPath, [CLI, "--help"], { cwd, encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("--oidc");
    expect(res.stdout).toContain("--email <console|resend|smtp>");
  });

  it("rejects invalid flag values with a friendly error", () => {
    for (const args of [["--pm", "bogus"], ["--email", "pigeon"], ["--admin", "tier9"], ["--providers", "unknownx"]]) {
      const res = spawnSync(process.execPath, [CLI, "x", ...args], { cwd, encoding: "utf8" });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("✗");
    }
  });

  it("studio + oidc + resend: methods sit together in config, wrapper + env hints written, ranges derived", () => {
    const { dir, read, json } = scaffold("s-oidc", "--modpack", "studio", "--auth", "--oidc", "--email", "resend");
    expect(json("pattern.config.json").mods.slice(0, 5)).toEqual([
      "@pattern-js/mod-identity",
      "@pattern-js/mod-auth-magic-link",
      "./mods/oidc.mjs",
      "@pattern-js/mod-email",
      "@pattern-js/mod-email-resend",
    ]);
    expect(read("mods/oidc.mjs")).toContain("oidcMod({");
    const env = read(".env.example");
    expect(env).toContain("RESEND_API_KEY");
    expect(env).toContain("GOOGLE_CLIENT_SECRET");
    const deps = json("package.json").dependencies as Record<string, string>;
    for (const [name, range] of Object.entries(deps)) {
      if (name.startsWith("@pattern-js/")) expect(range, name).toBe(RANGE);
    }
    expect(existsSync(join(dir, "mods", "quotes.mjs"))).toBe(true); // examples untouched
  });

  it("headless oidc-only: no magic-link mod, /whoami still ships", () => {
    const { dir, json } = scaffold("s-oidc-only", "--modpack", "headless", "--auth", "--oidc", "--no-magic-link");
    const mods = json("pattern.config.json").mods as string[];
    expect(mods).toContain("./mods/oidc.mjs");
    expect(mods).not.toContain("@pattern-js/mod-auth-magic-link");
    expect(json("package.json").dependencies["@pattern-js/mod-auth-magic-link"]).toBeUndefined();
    expect(existsSync(join(dir, "workflows", "whoami.json"))).toBe(true);
  });

  it("auth with no sign-in method is refused", () => {
    const res = spawnSync(process.execPath, [CLI, "s-none", "--yes", "--no-install", "--no-git", "--modpack", "studio", "--auth", "--no-magic-link"], { cwd, encoding: "utf8" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("at least one sign-in method");
  });

  it("studio-ai --no-examples strips the summarize workflow AND its banner line", () => {
    const { dir, read } = scaffold("s-ai-clean", "--modpack", "studio-ai", "--no-examples", "--no-vault-key", "--providers", "");
    expect(existsSync(join(dir, "workflows", "summarize.json"))).toBe(false);
    expect(read("src/index.ts")).not.toContain("/summarize");
    expect(existsSync(join(dir, "workflows", "README.md"))).toBe(true);
  });

  it("headless --no-examples strips the load profile aimed at removed routes", () => {
    const { dir } = scaffold("s-hl-clean", "--modpack", "headless", "--no-examples");
    expect(existsSync(join(dir, "load.example.json"))).toBe(false);
  });

  it("flags a pack can't honor produce notes, not silence", () => {
    const res = spawnSync(
      process.execPath,
      [CLI, "s-notes", "--yes", "--no-install", "--no-git", "--modpack", "blank", "--email", "resend", "--oidc"],
      { cwd, encoding: "utf8" },
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("note: --email ignored");
    expect(res.stdout).toContain("note: --oidc ignored");
  });
});
