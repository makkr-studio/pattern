import { motion } from "motion/react";
import { prefersReducedMotion } from "../lib/reduced-motion";

const COLORS = ["#22d3ee", "#a78bfa", "#f472b6", "#a3e635", "#fbbf24"];
const N = 30;

/** A one-shot confetti burst from the center. Mount it (with a changing key) to fire. */
export function Confetti() {
  if (prefersReducedMotion()) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      {Array.from({ length: N }, (_, i) => {
        const angle = (i / N) * Math.PI * 2 + (i % 3) * 0.3;
        const dist = 120 + (i % 5) * 45;
        const x = Math.cos(angle) * dist;
        const y = Math.sin(angle) * dist;
        const color = COLORS[i % COLORS.length];
        return (
          <motion.span
            key={i}
            className="absolute left-1/2 top-1/2 h-2 w-2"
            style={{ background: color, borderRadius: i % 2 ? "50%" : "1px" }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
            animate={{ x, y: y + 90, opacity: 0, scale: 0.5, rotate: 320 }}
            transition={{ duration: 1.1 + (i % 4) * 0.18, ease: "easeOut" }}
          />
        );
      })}
    </div>
  );
}
