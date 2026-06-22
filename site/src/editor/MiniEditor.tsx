import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Check, Code2, Hand, Maximize2, Play, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { JsonView, Modal, NeonButton } from "../components/ui";
import { Confetti } from "../components/Confetti";
import { categoryOfType, categoryStyle, humanizeOp } from "../lib/categories";
import { EditorCanvas } from "./EditorCanvas";
import { useQuest, type Quest } from "./quest/controller";
import { useFakeRun, type RunState } from "./run/engine";
import { LEVELS } from "./quest/levels";
import type { QuestLevel } from "./quest/types";

export function MiniEditor() {
  const [levelIdx, setLevelIdx] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const level = LEVELS[levelIdx]!;

  const shell = fullscreen ? "fixed inset-0 z-50 m-0 rounded-none" : "relative rounded-2xl";

  return (
    <div className={`glass-strong overflow-hidden ${shell}`} style={fullscreen ? { background: "color-mix(in srgb, var(--bg) 92%, transparent)" } : undefined}>
      <div className="flex items-center gap-2 border-b hairline px-4 py-2.5">
        <div className="flex items-center gap-1 rounded-lg border hairline p-0.5">
          {LEVELS.map((l, i) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLevelIdx(i)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${i === levelIdx ? "bg-[var(--color-neon-cyan)] text-black" : "text-muted hover:text-[var(--fg)]"}`}
            >
              {l.title}
            </button>
          ))}
        </div>
        <span className="ml-1 hidden font-mono text-[11px] text-muted sm:inline">{level.tagline}</span>
        <button
          type="button"
          onClick={() => setFullscreen((f) => !f)}
          className="ml-auto grid h-8 w-8 place-items-center rounded-lg border hairline text-muted transition-colors hover:bg-white/10 hover:text-[var(--fg)]"
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
        >
          {fullscreen ? <X size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>

      <EditorLevel key={level.id} level={level} fullscreen={fullscreen} />
    </div>
  );
}

function EditorLevel({ level, fullscreen }: { level: QuestLevel; fullscreen: boolean }) {
  const quest = useQuest(level);
  const [runKey, setRunKey] = useState(0);
  const [showJson, setShowJson] = useState(false);
  const [input, setInput] = useState(level.input.initial);
  const [askRun, setAskRun] = useState(false);
  const [confetti, setConfetti] = useState(0);
  const run = useFakeRun(level.goal, runKey, quest.finishRun);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);

  // A confetti burst each time a run completes, auto-removed after it plays.
  useEffect(() => {
    if (quest.status !== "done") return;
    setConfetti((c) => c + 1);
    const t = setTimeout(() => setConfetti(0), 2200);
    return () => clearTimeout(t);
  }, [quest.status]);

  const doRun = () => {
    setShowJson(false);
    setAskRun(false);
    quest.run();
    setRunKey((k) => k + 1);
  };

  // Drag a node from the palette onto the canvas to place it (drag-only).
  const startPlaceDrag = (e: React.PointerEvent) => {
    if (quest.step?.kind !== "place" || quest.status !== "building") return;
    const node = quest.step.placeNode;
    setGhost({ x: e.clientX, y: e.clientY });
    const move = (ev: PointerEvent) => setGhost({ x: ev.clientX, y: ev.clientY });
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      setGhost(null);
      if (!node) return;
      const r = canvasRef.current?.getBoundingClientRect();
      const overCanvas = !!r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (overCanvas) quest.tryPlace(node);
      else quest.flagInvalid("Drag the op onto the canvas.");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const ghostNode = ghost && quest.step?.kind === "place" ? level.goal.nodes.find((n) => n.id === quest.step!.placeNode) : null;
  const canvasH = fullscreen ? "h-[calc(100vh-180px)]" : "h-[440px]";

  return (
    <div className="flex flex-col lg:flex-row">
      {/* Coach rail */}
      <div className="flex shrink-0 flex-col gap-4 border-b hairline p-5 lg:w-[300px] lg:border-b-0 lg:border-r">
        <Stepper quest={quest} />
        <Coach quest={quest} />
        <div className="mt-auto">
          {quest.status === "done" ? (
            <OutGate quest={quest} run={run} input={input} setInput={setInput} onReplay={() => setRunKey((k) => k + 1)} />
          ) : quest.status === "running" ? (
            <RunPanel quest={quest} run={run} input={input} />
          ) : (
            <Palette quest={quest} onRequestRun={() => setAskRun(true)} onStartPlaceDrag={startPlaceDrag} />
          )}
          <button type="button" onClick={() => setShowJson((s) => !s)} className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-[var(--fg)]">
            <Code2 size={13} /> {showJson ? "Back to the canvas" : "See the JSON"}
          </button>
        </div>
      </div>

      {/* Canvas / JSON */}
      <div ref={canvasRef} className={`relative min-w-0 flex-1 ${canvasH}`}>
        <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(var(--canvas-dot) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
        <div className="relative grid h-full place-items-center p-4">
          {showJson ? <JsonView value={level.doc} className="max-h-full w-full max-w-lg p-3" /> : <EditorCanvas quest={quest} run={run} />}
        </div>
        {confetti > 0 && <Confetti key={confetti} />}
      </div>

      {/* Run prompt: ask for the parameter so the result clearly depends on it */}
      {askRun && (
        <Modal open title="Run the workflow" onClose={() => setAskRun(false)}>
          <p className="mb-3 text-sm text-muted">Give it an input. The result depends on what you pass in.</p>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted">{level.input.label}</label>
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doRun()}
            placeholder={level.input.placeholder}
            className="mb-4 w-full rounded-lg border hairline bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-neon-cyan)]"
          />
          <div className="flex justify-end">
            <NeonButton onClick={doRun}>
              <Play size={15} /> Run it
            </NeonButton>
          </div>
        </Modal>
      )}

      {/* The node being dragged from the palette */}
      {ghost &&
        ghostNode &&
        createPortal(
          <div className="glass-strong pointer-events-none fixed z-[60] flex items-center gap-2 rounded-xl px-3 py-2 text-sm shadow-lg" style={{ left: ghost.x + 12, top: ghost.y + 12 }}>
            {(() => {
              const cat = categoryStyle(categoryOfType(ghostNode.op));
              const Icon = cat.Icon;
              return <Icon size={15} style={{ color: cat.color }} />;
            })()}
            {ghostNode.title ?? humanizeOp(ghostNode.op)}
          </div>,
          document.body,
        )}
    </div>
  );
}

function Stepper({ quest }: { quest: Quest }) {
  const current = quest.status === "done" ? quest.level.stages.length : (quest.step?.stage ?? 0);
  return (
    <div className="flex items-center gap-1.5">
      {quest.level.stages.map((label, i) => {
        const done = i < current;
        const active = i === current && quest.status !== "done";
        return (
          <div key={label} className="flex items-center gap-1.5">
            <motion.div
              key={done ? "done" : "todo"}
              initial={{ scale: done ? 0.3 : 1 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 16 }}
              className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold"
              style={{
                background: done ? "var(--color-neon-lime)" : active ? "var(--color-neon-cyan)" : "transparent",
                color: done || active ? "#000" : "var(--fg-muted)",
                border: done || active ? "none" : "1px solid var(--hairline)",
                boxShadow: done ? "0 0 10px color-mix(in srgb, var(--color-neon-lime) 55%, transparent)" : undefined,
              }}
            >
              {done ? <Check size={12} /> : i + 1}
            </motion.div>
            <span className={`text-[11px] ${active ? "text-[var(--fg)]" : "text-muted"}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function Coach({ quest }: { quest: Quest }) {
  const text = quest.status === "done" ? "Done. You built and ran a real workflow. That same JSON is what the engine serves." : quest.step?.narration ?? "";
  return (
    <div className="rounded-xl border hairline p-3.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--color-neon-violet)]">
        <Sparkles size={13} /> Coach
      </div>
      <p className="text-[13px] leading-relaxed">{text}</p>
      {quest.hint && <p className="mt-2 text-[12px] text-[var(--color-neon-amber)]">{quest.hint}</p>}
    </div>
  );
}

function Palette({ quest, onRequestRun, onStartPlaceDrag }: { quest: Quest; onRequestRun: () => void; onStartPlaceDrag: (e: React.PointerEvent) => void }) {
  const step = quest.step;
  if (!step) return null;

  if (step.kind === "run") {
    return (
      <NeonButton onClick={onRequestRun} className="w-full justify-center">
        <Play size={15} /> Run it
      </NeonButton>
    );
  }

  if (step.kind === "wire") {
    return (
      <div className="rounded-xl border border-dashed p-3 text-center text-[12px] text-muted" style={{ borderColor: "var(--color-neon-cyan)" }}>
        <Hand size={15} className="mx-auto mb-1 text-[var(--color-neon-cyan)]" />
        Drag from the glowing output port to the glowing input port.
      </div>
    );
  }

  const node = quest.level.goal.nodes.find((n) => n.id === step.placeNode);
  if (!node) return null;
  const cat = categoryStyle(categoryOfType(node.op));
  const Icon = cat.Icon;
  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">Palette</div>
      <button
        type="button"
        onPointerDown={onStartPlaceDrag}
        className="flex w-full touch-none items-center gap-2.5 rounded-xl border p-3 text-left transition-transform hover:scale-[1.02] active:scale-[0.99]"
        style={{ borderColor: cat.border, background: cat.soft, animation: "pulse 1.8s ease-in-out infinite", cursor: "grab" }}
      >
        <Icon size={17} style={{ color: cat.color }} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{node.title ?? humanizeOp(node.op)}</div>
          <div className="truncate font-mono text-[10px] text-muted">{node.op}</div>
        </div>
        <Plus size={15} className="ml-auto text-muted" />
      </button>
      <p className="mt-1.5 text-center text-[11px] text-muted">Drag it onto the canvas</p>
    </div>
  );
}

/** Shown while a run is in flight. For a streaming level the answer types out word by word. */
function RunPanel({ quest, run, input }: { quest: Quest; run: RunState; input: string }) {
  const result = quest.level.result(input);
  const streams = quest.level.goal.edges.some((e) => e.kind === "stream");
  if (streams && result.streamed) {
    const words = result.streamed.split(" ");
    const shown = Math.max(1, Math.ceil(run.streamProgress * words.length));
    return (
      <div className="rounded-xl border hairline p-3.5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--color-port-stream)]">
          <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--color-port-stream)", boxShadow: "0 0 8px var(--color-port-stream)" }} />
          streaming…
        </div>
        <div className="min-h-[48px] rounded-lg p-2.5 font-mono text-[11px] leading-relaxed" style={{ background: "var(--tip-bg)" }}>
          {words.slice(0, shown).join(" ")}
          <span className="ml-0.5 inline-block h-[1em] w-[5px] translate-y-[2px] animate-pulse bg-[var(--color-port-stream)]" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-xl border hairline p-3.5 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-neon-cyan)] border-t-transparent" />
      Running the workflow…
    </div>
  );
}

function OutGate({
  quest,
  run,
  input,
  setInput,
  onReplay,
}: {
  quest: Quest;
  run: RunState;
  input: string;
  setInput: (v: string) => void;
  onReplay: () => void;
}) {
  const result = quest.level.result(input);
  return (
    <div className="rounded-xl border hairline p-3.5">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--color-neon-lime)]">
        <Check size={14} /> {result.label}
      </div>
      <label className="mb-1 block text-[11px] text-muted">{quest.level.input.label}</label>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={quest.level.input.placeholder}
        className="mb-3 w-full rounded-lg border hairline bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-neon-cyan)]"
      />
      <div className="rounded-lg p-2.5 font-mono text-[11px]" style={{ background: "var(--tip-bg)" }}>
        {result.streamed ? <span>{result.streamed}</span> : <span className="whitespace-pre-wrap">{JSON.stringify(result.value, null, 2)}</span>}
      </div>
      <button type="button" onClick={onReplay} disabled={run.phase === "running"} className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-[var(--fg)] disabled:opacity-40">
        <RotateCcw size={13} /> Run again
      </button>
    </div>
  );
}
