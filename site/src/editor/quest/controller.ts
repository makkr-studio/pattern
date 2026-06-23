import { useCallback, useState } from "react";
import { sfx } from "../../lib/sfx";
import type { QuestLevel } from "./types";

export type QuestStatus = "building" | "running" | "done";

/**
 * The quest state machine. By construction the visitor can only ever take the
 * one correct action for the current step, so the graph can never end up wrong.
 * Fresh per level (the editor remounts this on a level switch).
 */
export function useQuest(level: QuestLevel) {
  const [placed, setPlaced] = useState<ReadonlySet<string>>(() => new Set());
  const [wired, setWired] = useState<ReadonlySet<string>>(() => new Set());
  const [stepIndex, setStepIndex] = useState(0);
  const [status, setStatus] = useState<QuestStatus>("building");
  const [hint, setHint] = useState<string | null>(null);
  const [reward, setReward] = useState(0);

  const step = level.steps[stepIndex];

  const advance = useCallback(() => {
    setHint(null);
    setStepIndex((i) => Math.min(i + 1, level.steps.length - 1));
  }, [level.steps.length]);

  const tryPlace = useCallback(
    (nodeId: string) => {
      if (!step || step.kind !== "place") return;
      if (step.placeNode !== nodeId) {
        setHint(step.hint ?? "Add the highlighted op.");
        sfx.play("invalid");
        return;
      }
      setPlaced((p) => new Set(p).add(nodeId));
      setReward((r) => r + 1);
      sfx.play("add");
      advance();
    },
    [step, advance],
  );

  const tryWire = useCallback(
    (edgeId: string) => {
      if (!step || step.kind !== "wire") return;
      if (step.wireEdge !== edgeId) {
        setHint(step.hint ?? "That is not the connection this step needs.");
        sfx.play("invalid");
        return;
      }
      setWired((w) => new Set(w).add(edgeId));
      setReward((r) => r + 1);
      sfx.play("connect");
      advance();
    },
    [step, advance],
  );

  const run = useCallback(() => {
    setStatus("running");
    sfx.play("run");
  }, []);

  const finishRun = useCallback(() => {
    setStatus("done");
    sfx.play("deploy");
  }, []);

  const replayRun = useCallback(() => {
    setStatus("running");
    sfx.play("run");
  }, []);

  const flagInvalid = useCallback((message: string) => {
    setHint(message);
    sfx.play("invalid");
  }, []);

  return {
    level,
    placed,
    wired,
    step,
    stepIndex,
    status,
    hint,
    reward,
    atRunStep: step?.kind === "run",
    tryPlace,
    tryWire,
    flagInvalid,
    run,
    finishRun,
    replayRun,
  };
}

export type Quest = ReturnType<typeof useQuest>;
