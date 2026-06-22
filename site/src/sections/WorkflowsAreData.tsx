import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { motion } from "motion/react";
import { SectionShell } from "../components/SectionShell";
import { JsonView } from "../components/ui";
import { EdgeLegend } from "../components/EdgeLegend";
import { MiniNodeBody } from "../graph/MiniOpNode";
import { edgePath, graphBounds } from "../graph/geometry";
import { portColor } from "../lib/format";
import { useReducedMotion } from "../lib/reduced-motion";
import { level1Doc, level1Graph } from "../graph/sampleWorkflow";

const B = graphBounds(level1Graph);
// Build order → reveal delay (seconds).
const NODE_DELAY: Record<string, number> = { in: 0.1, msg: 0.5, body: 0.9, out: 1.3 };
const EDGE_DELAY: Record<string, number> = { e1: 0.7, e2: 1.1, e3: 1.5 };

/**
 * "A workflow is just data": the graph assembles node by node when it scrolls
 * into view, wires drawing as it goes, and the very same workflow appears below
 * it as the JSON the engine runs. Driven by a single in-view flag (robust).
 */
export function WorkflowsAreData() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(reduced);

  useEffect(() => {
    if (reduced) {
      setInView(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <SectionShell
      id="data"
      eyebrow="The idea"
      title="A workflow is just data"
      subtitle="A graph of typed operations wired by their ports. The very same thing, as the JSON document the engine runs."
    >
      <div ref={ref} className="flex flex-col items-center gap-8">
        {/* The graph, assembling */}
        <div className="flex w-full justify-center" style={{ overflow: "visible" }}>
          <div className="scale-[0.56] sm:scale-[0.75] md:scale-100" style={{ position: "relative", width: B.width, height: B.height, transformOrigin: "top center" }}>
            <svg aria-hidden width={B.width} height={B.height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
              <g transform={`translate(${-B.minX}, ${-B.minY})`}>
                {level1Graph.edges.map((e) => {
                  const d = edgePath(level1Graph, e);
                  const color = portColor(e.kind);
                  return (
                    <g key={e.id}>
                      <path d={d} fill="none" stroke={color} strokeWidth={2} opacity={0.12} />
                      <motion.path
                        d={d}
                        fill="none"
                        stroke={color}
                        strokeWidth={2}
                        strokeLinecap="round"
                        initial={{ pathLength: reduced ? 1 : 0 }}
                        animate={{ pathLength: inView ? 1 : 0 }}
                        transition={{ duration: 0.5, delay: reduced ? 0 : EDGE_DELAY[e.id], ease: "easeInOut" }}
                        style={{ filter: `drop-shadow(0 0 4px ${color})` }}
                      />
                    </g>
                  );
                })}
              </g>
            </svg>
            {level1Graph.nodes.map((n) => (
              <motion.div
                key={n.id}
                initial={{ opacity: reduced ? 1 : 0, scale: reduced ? 1 : 0.85 }}
                animate={{ opacity: inView ? 1 : 0, scale: inView ? 1 : 0.85 }}
                transition={{ type: "spring", stiffness: 340, damping: 22, delay: reduced ? 0 : NODE_DELAY[n.id] }}
                style={{ position: "absolute", left: n.pos.x - B.minX, top: n.pos.y - B.minY }}
              >
                <MiniNodeBody spec={n} />
              </motion.div>
            ))}
          </div>
        </div>

        <EdgeLegend />

        <motion.div
          initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 14 }}
          animate={{ opacity: inView ? 1 : 0, y: inView ? 0 : 14 }}
          transition={{ duration: 0.5, delay: reduced ? 0 : 1.8 }}
          className="flex items-center gap-2 text-sm text-muted"
        >
          <ArrowDown size={15} /> the same workflow, as JSON
        </motion.div>

        <motion.div
          initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 18 }}
          animate={{ opacity: inView ? 1 : 0, y: inView ? 0 : 18 }}
          transition={{ duration: 0.6, delay: reduced ? 0 : 2.0 }}
          className="w-full max-w-xl"
        >
          <JsonView value={level1Doc} className="max-h-[460px] p-3" />
        </motion.div>
      </div>
    </SectionShell>
  );
}
