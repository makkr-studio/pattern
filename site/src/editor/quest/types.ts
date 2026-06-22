import type { MiniGraph, PortKind } from "../../graph/types";

export type StepKind = "place" | "wire" | "run";

export interface QuestStep {
  id: string;
  /** Which stepper cell (0-based) this step belongs to. */
  stage: number;
  kind: StepKind;
  /** Coach narration shown while this step is active. */
  narration: string;
  /** A nudge shown if the visitor clicks the wrong thing. */
  hint?: string;
  /** For `place`: the goal node id to drop in. */
  placeNode?: string;
  /** For `wire`: the edge (by goal edge id) to draw. */
  wireEdge?: string;
}

export interface QuestLevel {
  id: "level1" | "level2";
  title: string;
  tagline: string;
  /** The finished graph (positions, ports, edges). */
  goal: MiniGraph;
  /** The same workflow as the JSON the engine runs. */
  doc: unknown;
  /** Stepper cell labels. */
  stages: string[];
  steps: QuestStep[];
  /** The result an out-gate reveals, given the live input. */
  result: (input: string) => { label: string; value: unknown; streamed?: string };
  /** The editable input field (the request) for the run. */
  input: { label: string; placeholder: string; initial: string };
}

export interface WireRef {
  from: { node: string; port: string };
  to: { node: string; port: string };
  kind: PortKind;
}
