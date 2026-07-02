import { motion } from "motion/react";
import { SectionShell } from "../components/SectionShell";
import { GlassPanel } from "../components/ui";
import { StaticGraph } from "../graph/StaticGraph";
import { useReducedMotion } from "../lib/reduced-motion";
import type { MiniGraph } from "../graph/types";

// The admin's own "list workflows" endpoint, as a workflow. Meta on purpose.
const selfGraph: MiniGraph = {
  nodes: [
    { id: "in", op: "boundary.http.request", title: "GET /workflows", boundary: "trigger", inputs: [], outputs: [{ name: "params", kind: "value", schemaType: "object" }], pos: { x: 0, y: 40 } },
    { id: "list", op: "admin.workflows.list", title: "List workflows", inputs: [{ name: "in", kind: "control" }], outputs: [{ name: "out", kind: "value", schemaType: "array" }], pos: { x: 250, y: 40 } },
    { id: "out", op: "boundary.http.response", title: "Respond", boundary: "outgate", inputs: [{ name: "body", kind: "value", schemaType: "array" }], outputs: [], pos: { x: 500, y: 40 } },
  ],
  edges: [
    { id: "e1", from: { node: "in", port: "params" }, to: { node: "list", port: "in" }, kind: "control" },
    { id: "e2", from: { node: "list", port: "out" }, to: { node: "out", port: "body" }, kind: "value" },
  ],
};

/** The flex: Pattern is built out of Pattern. */
export function EditsItself() {
  const reduced = useReducedMotion();
  return (
    <SectionShell id="meta" width="max-w-5xl">
      <GlassPanel className="overflow-hidden p-8 md:p-10">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mb-3 text-xs font-medium uppercase tracking-[0.22em] text-[var(--color-neon-violet)]">Turtles all the way down</div>
          <h2 className="text-3xl font-semibold tracking-tight">Pattern is built from Pattern</h2>
          <p className="mt-4 text-muted">
            The admin, the docs, and the op reference are mods built from the same ops and workflows you use. The editor you
            just played with takes its components directly from it. Every endpoint in the admin, including the one that lists
            your workflows, is itself a workflow you can open and read.
          </p>
        </div>
        {/* overflow-hidden (not -x-auto) so the fixed-width graph can't add a
            page-level horizontal scrollbar; scale it down to fit narrow screens. */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
          className="mt-10 flex justify-center overflow-hidden"
        >
          <div className="origin-top scale-[0.6] sm:scale-90 md:scale-100">
            <StaticGraph graph={selfGraph} pulse={!reduced} />
          </div>
        </motion.div>
      </GlassPanel>
    </SectionShell>
  );
}
