import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { prefersReducedMotion } from "../lib/reduced-motion";

// Port + accent palette — the same colors data wears everywhere else on the site.
const TOKENS = ["#22d3ee", "#a78bfa", "#9ca3af", "#a3e635", "#f472b6"];
const N = 72;

const STEPS = ["trigger", "transform", "respond"];
const LINES = [
  "$ pattern run ./this-page.json",
  ...STEPS.map((s) => `● ${s.padEnd(11)}✓`),
  "✓ 1 workflow · 0 errors · +30 lives",
];

/**
 * The Konami payoff: the whole page "runs" like a workflow. Port-colored tokens
 * stream down the viewport, and a little glass terminal types out a fake run
 * log (with a wink to Contra's 30 lives). Self-dismisses via `onDone`.
 * Reduced-motion keeps the terminal but skips the particle storm.
 */
export function KonamiFx({ onDone }: { onDone: () => void }) {
  const reduced = prefersReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const reveals = LINES.map((_, i) => window.setTimeout(() => setShown(i + 1), 200 + i * 320));
    const end = window.setTimeout(onDone, 5200);
    return () => {
      reveals.forEach(clearTimeout);
      clearTimeout(end);
    };
  }, [onDone]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[200] overflow-hidden">
      {!reduced &&
        Array.from({ length: N }, (_, i) => {
          const color = TOKENS[i % TOKENS.length];
          const size = 4 + (i % 3) * 2;
          return (
            <motion.span
              key={i}
              className="absolute rounded-full"
              style={{ left: `${(i * 53) % 100}%`, top: 0, width: size, height: size, background: color, boxShadow: `0 0 8px ${color}` }}
              initial={{ y: -24, opacity: 0 }}
              animate={{ y: "104vh", opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.6 + (i % 6) * 0.22, delay: (i % 9) * 0.08, ease: "easeIn" }}
            />
          );
        })}

      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        className="glass-strong absolute left-1/2 top-1/2 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5 font-mono text-sm"
      >
        <div className="mb-3 flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#f472b6" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#fbbf24" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#a3e635" }} />
          <span className="ml-2 text-[10px] uppercase tracking-[0.2em] text-muted">konami</span>
        </div>
        {LINES.slice(0, shown).map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            className={`whitespace-pre ${i === LINES.length - 1 ? "mt-1 font-semibold text-[var(--color-neon-lime)]" : "text-[var(--fg)]"}`}
          >
            {line}
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
