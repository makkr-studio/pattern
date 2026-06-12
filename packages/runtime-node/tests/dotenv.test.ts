import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject } from "@pattern/runtime-node";

let closer: (() => Promise<void>) | undefined;
const setKeys: string[] = [];
afterEach(async () => {
  await closer?.();
  closer = undefined;
  for (const k of setKeys.splice(0)) delete process.env[k];
});

function projectDir(env: string, port: number): string {
  const dir = mkdtempSync(join(tmpdir(), "pattern-dotenv-"));
  mkdirSync(join(dir, "workflows"));
  writeFileSync(join(dir, ".env"), env);
  // baseDir derives from the CONFIG PATH — the .env sits next to it.
  writeFileSync(
    join(dir, "pattern.config.json"),
    JSON.stringify({ workflows: "./workflows", ws: false, http: { port } }),
  );
  // A route whose response body interpolates an env var at registration.
  writeFileSync(
    join(dir, "workflows", "greet.json"),
    JSON.stringify({
      id: "greet",
      nodes: [
        { id: "in", op: "boundary.http.request", config: { method: "GET", path: "/greet" } },
        { id: "msg", op: "core.const.string", config: { value: "${DOTENV_GREETING}" } },
        { id: "out", op: "boundary.http.response" },
      ],
      edges: [
        { from: { node: "in", port: "out" }, to: { node: "out", port: "in" } }, // trigger reaches the out-gate
        { from: { node: "msg", port: "out" }, to: { node: "out", port: "body" } },
      ],
    }),
  );
  return dir;
}

describe("loadProject .env loading", () => {
  it("loads KEY=VALUE lines (comments, quotes, export prefix) into process.env", async () => {
    const dir = projectDir(
      [
        "# a comment",
        "",
        "DOTENV_GREETING=bonjour",
        'DOTENV_QUOTED="with spaces"',
        "export DOTENV_EXPORTED='single'",
        "not a kv line",
      ].join("\n"),
      4969,
    );
    setKeys.push("DOTENV_GREETING", "DOTENV_QUOTED", "DOTENV_EXPORTED");

    const project = await loadProject(join(dir, "pattern.config.json"));
    const { close } = await project.start();
    closer = close;

    expect(process.env.DOTENV_QUOTED).toBe("with spaces");
    expect(process.env.DOTENV_EXPORTED).toBe("single");
    // The value reached $env interpolation in workflow config.
    const res = await fetch("http://localhost:4969/greet");
    expect(await res.text()).toContain("bonjour");
  });

  it("the real environment outranks the file", async () => {
    process.env.DOTENV_GREETING = "from-real-env";
    setKeys.push("DOTENV_GREETING");
    const dir = projectDir("DOTENV_GREETING=from-file\n", 4970);
    const project = await loadProject(join(dir, "pattern.config.json"));
    const { close } = await project.start();
    closer = close;
    const res = await fetch("http://localhost:4970/greet");
    expect(await res.text()).toContain("from-real-env");
  });
});
