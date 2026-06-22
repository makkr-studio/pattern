import { motion } from "motion/react";
import { SectionShell } from "../components/SectionShell";
import { GlowCard } from "../components/ui";
import { portColor } from "../lib/format";
import { useReducedMotion } from "../lib/reduced-motion";

const X0 = 24;
const X1 = 196;
const Y = 34;

function Wire({ color }: { color: string }) {
  return (
    <>
      <line x1={X0} y1={Y} x2={X1} y2={Y} stroke={color} strokeWidth={2} opacity={0.4} />
      <circle cx={X0} cy={Y} r={5} fill={color} />
      <circle cx={X1} cy={Y} r={5} fill={color} />
    </>
  );
}

function Token({ color, delay = 0, dur = 1.4, repeatDelay = 0 }: { color: string; delay?: number; dur?: number; repeatDelay?: number }) {
  return (
    <motion.circle
      r={4}
      cy={Y}
      fill={color}
      style={{ filter: `drop-shadow(0 0 5px ${color})` }}
      initial={{ cx: X0, opacity: 0 }}
      animate={{ cx: [X0, X1], opacity: [0, 1, 1, 0] }}
      transition={{ duration: dur, delay, repeat: Infinity, repeatDelay, ease: "easeInOut" }}
    />
  );
}

const KINDS = [
  {
    kind: "value" as const,
    title: "Value",
    blurb: "One resolved value. The consumer waits for it, so a value wire is a barrier.",
    render: (reduced: boolean, color: string) => (!reduced ? <Token color={color} dur={1.3} repeatDelay={0.9} /> : <circle cx={(X0 + X1) / 2} cy={Y} r={4} fill={color} />),
  },
  {
    kind: "stream" as const,
    title: "Stream",
    blurb: "A flow of chunks. Stream wires run concurrently with full backpressure.",
    render: (reduced: boolean, color: string) =>
      !reduced ? (
        <>
          <Token color={color} dur={1.6} delay={0} />
          <Token color={color} dur={1.6} delay={0.4} />
          <Token color={color} dur={1.6} delay={0.8} />
          <Token color={color} dur={1.6} delay={1.2} />
        </>
      ) : (
        <>
          <circle cx={X0 + 50} cy={Y} r={3.5} fill={color} />
          <circle cx={X0 + 95} cy={Y} r={3.5} fill={color} />
          <circle cx={X0 + 140} cy={Y} r={3.5} fill={color} />
        </>
      ),
  },
  {
    kind: "control" as const,
    title: "Control",
    blurb: "A dataless pulse. Control wires sequence work without passing a value.",
    render: (reduced: boolean, color: string) =>
      !reduced ? (
        <motion.circle
          cx={X1}
          cy={Y}
          fill="none"
          stroke={color}
          strokeWidth={2}
          initial={{ r: 4, opacity: 0 }}
          animate={{ r: [4, 16], opacity: [0.9, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, repeatDelay: 1.1, ease: "easeOut" }}
        />
      ) : (
        <circle cx={X1} cy={Y} r={9} fill="none" stroke={color} strokeWidth={2} opacity={0.6} />
      ),
  },
];

/** A small interactive panel: each edge kind shows how it behaves. */
export function EdgeKindsToy() {
  const reduced = useReducedMotion();
  return (
    <SectionShell
      id="edges"
      eyebrow="The wires"
      title="Three kinds of edge"
      subtitle="Pattern derives an edge's behavior from the ports it connects. You never declare it; you just wire compatible dots."
    >
      <div className="grid gap-5 md:grid-cols-3">
        {KINDS.map((k) => {
          const color = portColor(k.kind);
          return (
            <GlowCard key={k.kind} className="p-6">
              <svg viewBox="0 0 220 68" className="w-full">
                <Wire color={color} />
                {k.render(reduced, color)}
              </svg>
              <div className="mt-4 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                <span className="font-semibold">{k.title}</span>
              </div>
              <p className="mt-2 text-sm text-muted">{k.blurb}</p>
            </GlowCard>
          );
        })}
      </div>
    </SectionShell>
  );
}
