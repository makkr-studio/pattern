import { describe, it, expect } from "vitest";
import { segmentsOf, expressOf, type TurnEvent } from "../src/app/lib/types.js";

/** The silent `express` avatar signal must never appear in the transcript, and
 *  expressOf surfaces the latest one for the voice mode. */

const ev = (o: Record<string, unknown>): TurnEvent => ({ turnId: "t", runId: "r", ...o }) as TurnEvent;

describe("segmentsOf / expressOf", () => {
  it("hides express from the rendered segments but keeps real tools and text", () => {
    const events: TurnEvent[] = [
      ev({ type: "tool.activity", toolName: "express", phase: "start", args: { emotion: "happy", emoji: "😀" } }),
      ev({ type: "text.delta", delta: "Hello" }),
      ev({ type: "tool.activity", toolName: "get_weather", phase: "start", args: {} }),
      ev({ type: "tool.activity", toolName: "get_weather", phase: "done", result: "sunny" }),
    ];
    const segs = segmentsOf(events, false);
    expect(segs.some((s) => s.kind === "tool" && s.toolName === "express")).toBe(false);
    expect(segs.some((s) => s.kind === "tool" && s.toolName === "get_weather")).toBe(true);
    expect(segs.some((s) => s.kind === "text" && s.text === "Hello")).toBe(true);
  });

  it("expressOf returns the latest express signal", () => {
    const events: TurnEvent[] = [
      ev({ type: "tool.activity", toolName: "express", phase: "start", args: { emotion: "neutral" } }),
      ev({ type: "tool.activity", toolName: "express", phase: "start", args: { emotion: "excited", emoji: "🎉" } }),
    ];
    expect(expressOf(events)).toEqual({ emotion: "excited", emoji: "🎉", shape: undefined });
    expect(expressOf([])).toBeNull();
  });
});
