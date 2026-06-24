import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * THE crash regression: a turn without an API key used to kill the whole
 * process — the streaming run settles before agents.run fails, the captured
 * SSE stream errors mid-write, and the host's fire-and-forget handler turned
 * that into a fatal unhandled rejection under plain `node`. Runs the real
 * stack (built dist) in a CHILD process so default rejection semantics apply.
 */
describe("missing API key", () => {
  // TODO(mod-ai): the fixture installs the retired mod-agents-openai. Re-enable
  // once mod-ai lands — point the fixture at mod-ai with NO provider key so the
  // model call fails mid-stream (the regression needs a present-but-failing
  // provider, after the streaming run is result-ready).
  it.skip("fails the TURN, not the PROCESS", async () => {
    const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "no-key-survival.mjs");
    const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number }>(
      (resolve) => {
        execFile(
          process.execPath,
          [fixture, "4966"],
          { cwd: join(dirname(fileURLToPath(import.meta.url)), ".."), timeout: 20_000 },
          (err, stdout, stderr) => resolve({ stdout, stderr, code: (err as { code?: number })?.code ?? 0 }),
        );
      },
    );

    expect(stderr).not.toContain("UNHANDLED_REJECTION");
    expect(code, `exit code (stderr: ${stderr.slice(0, 300)})`).toBe(0);
    expect(stdout).toContain("PROCESS_SURVIVED");

    const result = JSON.parse(stdout.slice(stdout.indexOf("RESULT") + 7, stdout.indexOf("\nPROCESS_SURVIVED")));
    // The SSE channel opened (the run was result-ready before the failure)…
    expect(result.httpStatus).toBe(200);
    // …and the TURN carries the failure as content, with the key hint.
    expect(result.turnStatus).toBe("error");
    expect(result.lastEvent).toBe("done");
    expect(result.errorMentionsKey).toBe(true);
  }, 30_000);
});
