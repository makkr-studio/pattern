/**
 * The Pattern mark: a "P" drawn as a workflow — gradient edges with port-colored
 * nodes at the joints (cyan/violet/pink/lime = the port/status palette). The
 * same geometry ships as the favicon (public/favicon.svg); keep them in sync.
 */
export function PatternLogo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="Pattern"
      className={className}
    >
      <defs>
        <linearGradient id="pattern-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      {/* the graph: bowl + stem of a P, drawn as edges */}
      <path
        d="M14 7 H27 Q39 7 39 17 Q39 27 27 27 H14 M14 7 V41"
        stroke="url(#pattern-logo-g)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* the nodes, colored like ports/run states */}
      <circle cx="14" cy="7" r="3.4" fill="#22d3ee" />
      <circle cx="39" cy="17" r="3.4" fill="#a78bfa" />
      <circle cx="14" cy="27" r="3.4" fill="#f472b6" />
      <circle cx="14" cy="41" r="3.4" fill="#a3e635" />
    </svg>
  );
}
