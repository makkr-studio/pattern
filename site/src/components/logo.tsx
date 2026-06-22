import { motion } from "motion/react";

/**
 * The Pattern mark: a "P" drawn as a workflow — gradient edges with port-colored
 * nodes at the joints (cyan/violet/pink/lime = the port/status palette). The
 * same geometry ships as the favicon (public/favicon.svg); keep them in sync.
 */
export function PatternLogo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" role="img" aria-label="Pattern" className={className}>
      <defs>
        <linearGradient id="pattern-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <path
        d="M14 7 H27 Q39 7 39 17 Q39 27 27 27 H14 M14 7 V41"
        stroke="url(#pattern-logo-g)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="7" r="3.4" fill="#22d3ee" />
      <circle cx="39" cy="17" r="3.4" fill="#a78bfa" />
      <circle cx="14" cy="27" r="3.4" fill="#f472b6" />
      <circle cx="14" cy="41" r="3.4" fill="#a3e635" />
    </svg>
  );
}

const NODES = [
  { cx: 14, cy: 7, fill: "#22d3ee" },
  { cx: 39, cy: 17, fill: "#a78bfa" },
  { cx: 14, cy: 27, fill: "#f472b6" },
  { cx: 14, cy: 41, fill: "#a3e635" },
];

/**
 * The mark with its edge drawing itself and its nodes lighting up in sequence on
 * mount — the hero's opening beat. Honors reduced motion: with `animate={false}`
 * it renders the final lit state immediately.
 */
export function AnimatedPatternLogo({ size = 44, className, animate = true }: { size?: number; className?: string; animate?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" role="img" aria-label="Pattern" className={className}>
      <defs>
        <linearGradient id="pattern-logo-anim-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <motion.path
        d="M14 7 H27 Q39 7 39 17 Q39 27 27 27 H14 M14 7 V41"
        stroke="url(#pattern-logo-anim-g)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={animate ? { pathLength: 0, opacity: 0.3 } : false}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.9, ease: "easeInOut" }}
      />
      {NODES.map((n, i) => (
        <motion.circle
          key={i}
          cx={n.cx}
          cy={n.cy}
          r="3.4"
          fill={n.fill}
          initial={animate ? { opacity: 0.15, scale: 0.6 } : false}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 + i * 0.18, type: "spring", stiffness: 400, damping: 14 }}
          style={{ transformOrigin: `${n.cx}px ${n.cy}px`, filter: `drop-shadow(0 0 5px ${n.fill})` }}
        />
      ))}
    </svg>
  );
}
