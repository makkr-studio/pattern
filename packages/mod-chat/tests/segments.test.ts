import { describe, it, expect } from "vitest";
import { segmentsOf, type TurnEvent } from "../src/app/lib/types.js";

/** segmentsOf turns a turn's event log into the rendered transcript segments. */

const ev = (o: Record<string, unknown>): TurnEvent => ({ turnId: "t", runId: "r", ...o }) as TurnEvent;

describe("segmentsOf", () => {
  it("renders text and real tool calls as segments", () => {
    const events: TurnEvent[] = [
      ev({ type: "text.delta", delta: "Hello" }),
      ev({ type: "tool.activity", toolName: "get_weather", phase: "start", args: {} }),
      ev({ type: "tool.activity", toolName: "get_weather", phase: "done", result: "sunny" }),
    ];
    const segs = segmentsOf(events, false);
    expect(segs.some((s) => s.kind === "tool" && s.toolName === "get_weather")).toBe(true);
    expect(segs.some((s) => s.kind === "text" && s.text === "Hello")).toBe(true);
  });
});
