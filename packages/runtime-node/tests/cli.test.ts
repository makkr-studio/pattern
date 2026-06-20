import { describe, it, expect } from "vitest";
import { Engine, type Workflow } from "@pattern-js/core";
import { runCli } from "@pattern-js/runtime-node";

/**
 * `runCli` writes a `boundary.cli.exit` payload to stdout. A *streamed* result
 * that doesn't end in a newline must still be terminated — otherwise zsh/bash
 * leave a partial line that can look like the output vanished on exit.
 */
function capture(): { chunks: string[]; restore: () => void } {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((c: unknown) => {
    chunks.push(typeof c === "string" ? c : (c as Buffer).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  return { chunks, restore: () => void (process.stdout.write = orig) };
}

describe("runCli stdout", () => {
  it("terminates a streamed stdout with a trailing newline", async () => {
    const engine = new Engine();
    const wf: Workflow = {
      id: "cli-stream",
      nodes: [
        { id: "cli", op: "boundary.cli" },
        { id: "emit", op: "core.stream.emit" }, // args array → stream of chunks
        { id: "exit", op: "boundary.cli.exit" },
      ],
      edges: [
        { from: { node: "cli", port: "args" }, to: { node: "emit", port: "in" } },
        { from: { node: "emit", port: "out" }, to: { node: "exit", port: "stdoutStream" } },
      ],
    };
    engine.registerWorkflow(wf);

    const cap = capture();
    let code: number;
    try {
      code = await runCli(engine, wf, { argv: ["foo", "bar"], stdin: new ReadableStream() });
    } finally {
      cap.restore();
    }
    expect(code).toBe(0);
    const out = cap.chunks.join("");
    expect(out).toBe("foobar\n"); // streamed chunks + the appended newline
  });
});
