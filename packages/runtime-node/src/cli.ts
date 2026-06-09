/**
 * @pattern/runtime-node — CLI host (§6, §7).
 *
 * Binds a process invocation to a `boundary.cli` trigger and writes the
 * `boundary.cli.exit` out-gate result to stdout/stderr + exit code. CLI is
 * intrinsically host-local — acceptable per the spec.
 */

import { Readable } from "node:stream";
import type { Engine, RunResult, Workflow } from "@pattern/core";

export interface CliHostOptions {
  /** Argument vector (defaults to process.argv.slice(2)). */
  argv?: string[];
  /** The `boundary.cli` trigger node id (inferred if omitted). */
  trigger?: string;
  /** Optional structured arg parser → `parsed` output port. */
  parse?: (argv: string[]) => Record<string, unknown>;
  /** Provide stdin as a web stream (defaults to process.stdin). */
  stdin?: ReadableStream<Uint8Array>;
}

interface ExitPayload {
  stdout?: unknown;
  stdoutStream?: ReadableStream<unknown>;
  stderr?: string;
  code?: number;
}

/** Run a CLI workflow once; returns the process exit code. Does not call process.exit. */
export async function runCli(
  engine: Engine,
  workflowOrId: Workflow | string,
  opts: CliHostOptions = {},
): Promise<number> {
  const workflow = typeof workflowOrId === "string" ? engine.workflows.get(workflowOrId) : workflowOrId;
  if (!workflow) throw new Error(`workflow "${String(workflowOrId)}" not registered`);
  const triggerId = opts.trigger ?? workflow.nodes.find((n) => n.op === "boundary.cli")?.id;
  if (!triggerId) throw new Error("no boundary.cli trigger");

  const argv = opts.argv ?? process.argv.slice(2);
  const stdin = opts.stdin ?? (Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>);

  const input = {
    args: argv,
    parsed: opts.parse ? opts.parse(argv) : {},
    stdin,
    env: { ...process.env } as Record<string, string>,
  };

  let result: RunResult;
  try {
    result = await engine.runFrom(workflow, triggerId, input, { kind: "anonymous" });
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  if (result.status === "error") {
    process.stderr.write(`${(result.error as any)?.message ?? String(result.error)}\n`);
    return 1;
  }

  const payload = firstExit(result, workflow);
  if (!payload) return 0;

  if (payload.stdoutStream instanceof ReadableStream) {
    const reader = payload.stdoutStream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      process.stdout.write(value instanceof Uint8Array ? Buffer.from(value) : String(value));
    }
  } else if (payload.stdout != null) {
    const out = payload.stdout;
    process.stdout.write(out instanceof Uint8Array ? Buffer.from(out) : typeof out === "string" ? out : JSON.stringify(out));
    if (typeof out === "string" && !out.endsWith("\n")) process.stdout.write("\n");
  }
  if (payload.stderr) process.stderr.write(String(payload.stderr));
  return payload.code ?? 0;
}

function firstExit(result: RunResult, workflow: Workflow): ExitPayload | undefined {
  for (const [nodeId, payload] of Object.entries(result.outputs)) {
    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (node?.op === "boundary.cli.exit") return payload as ExitPayload;
  }
  return Object.values(result.outputs)[0] as ExitPayload | undefined;
}
