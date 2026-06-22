import { useState } from "react";
import { motion } from "motion/react";
import { Check, Code2, Maximize2, MousePointerClick, Play, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { JsonView, NeonButton } from "../components/ui";
import { categoryOfType, categoryStyle, humanizeOp } from "../lib/categories";
import { EditorCanvas } from "./EditorCanvas";
import { useQuest, type Quest } from "./quest/controller";
import { useFakeRun } from "./run/engine";
import { LEVELS } from "./quest/levels";
import type { QuestLevel } from "./quest/types";

export function MiniEditor() {
  const [levelIdx, setLevelIdx] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const level = LEVELS[levelIdx]!;

  const shell = fullscreen
    ? "fixed inset-0 z-50 m-0 rounded-none"
    : "relative rounded-2xl";

  return (
    <div className={`glass-strong overflow-hidden ${shell}`} style={fullscreen ? { background: "color-mix(in srgb, var(--bg) 92%, transparent)" } : undefined}>
      {/* Toolbar */}
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

      {/* The level (remounts on switch so the quest resets cleanly). */}
      <EditorLevel key={level.id} level={level} fullscreen={fullscreen} />
    </div>
  );
}

function EditorLevel({ level, fullscreen }: { level: QuestLevel; fullscreen: boolean }) {
  const quest = useQuest(level);
  const [runKey, setRunKey] = useState(0);
  const [showJson, setShowJson] = useState(false);
  const [input, setInput] = useState(level.input.initial);
  const run = useFakeRun(level.goal, runKey, quest.finishRun);

  const startRun = () => {
    setShowJson(false);
    quest.run();
    setRunKey((k) => k + 1);
  };

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
          ) : (
            <Palette quest={quest} onRun={startRun} />
          )}
          <button
            type="button"
            onClick={() => setShowJson((s) => !s)}
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-[var(--fg)]"
          >
            <Code2 size={13} /> {showJson ? "Back to the canvas" : "See the JSON"}
          </button>
        </div>
      </div>

      {/* Canvas / JSON */}
      <div className={`relative min-w-0 flex-1 ${canvasH}`}>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(var(--canvas-dot) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
        <div className="relative grid h-full place-items-center p-4">
          {showJson ? <JsonView value={level.doc} className="max-h-full w-full max-w-lg p-3" /> : <EditorCanvas quest={quest} run={run} />}
        </div>
      </div>
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
            <div
              className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold transition-colors"
              style={{
                background: done ? "var(--color-neon-lime)" : active ? "var(--color-neon-cyan)" : "transparent",
                color: done || active ? "#000" : "var(--fg-muted)",
                border: done || active ? "none" : "1px solid var(--hairline)",
              }}
            >
              {done ? <Check size={12} /> : i + 1}
            </div>
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

function Palette({ quest, onRun }: { quest: Quest; onRun: () => void }) {
  const step = quest.step;
  if (!step) return null;

  if (step.kind === "run" || quest.status === "running") {
    return (
      <NeonButton onClick={onRun} disabled={quest.status === "running"} className="w-full justify-center">
        <Play size={15} /> {quest.status === "running" ? "Running…" : "Run it"}
      </NeonButton>
    );
  }

  if (step.kind === "wire") {
    return (
      <div className="rounded-xl border border-dashed p-3 text-center text-[12px] text-muted" style={{ borderColor: "var(--color-neon-cyan)" }}>
        <MousePointerClick size={15} className="mx-auto mb-1 text-[var(--color-neon-cyan)]" />
        Click the glowing node to connect it.
      </div>
    );
  }

  // place
  const node = quest.level.goal.nodes.find((n) => n.id === step.placeNode);
  if (!node) return null;
  const cat = categoryStyle(categoryOfType(node.op));
  const Icon = cat.Icon;
  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">Palette</div>
      <button
        type="button"
        onClick={() => quest.tryPlace(node.id)}
        className="flex w-full items-center gap-2.5 rounded-xl border p-3 text-left transition-transform hover:scale-[1.02]"
        style={{ borderColor: cat.border, background: cat.soft, animation: "pulse 1.8s ease-in-out infinite" }}
      >
        <Icon size={17} style={{ color: cat.color }} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{node.title ?? humanizeOp(node.op)}</div>
          <div className="truncate font-mono text-[10px] text-muted">{node.op}</div>
        </div>
        <Plus size={15} className="ml-auto text-muted" />
      </button>
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
  run: ReturnType<typeof useFakeRun>;
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
      <button
        type="button"
        onClick={onReplay}
        disabled={run.phase === "running"}
        className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-[var(--fg)] disabled:opacity-40"
      >
        <RotateCcw size={13} /> Run again
      </button>
    </div>
  );
}
