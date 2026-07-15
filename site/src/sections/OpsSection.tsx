import { motion } from "motion/react";
import { SectionShell } from "../components/SectionShell";
import { MiniNodeBody } from "../graph/MiniOpNode";
import { categoryStyle } from "../lib/categories";
import type { MiniNodeSpec } from "../graph/types";

// A few real ops, shown as the typed nodes they are.
const EXAMPLES: { spec: MiniNodeSpec; blurb: string }[] = [
  {
    spec: {
      id: "tmpl",
      op: "core.string.template",
      title: "Template",
      inputs: [{ name: "data", kind: "value", schemaType: "object", required: true }],
      outputs: [{ name: "out", kind: "value", schemaType: "string" }],
      pos: { x: 0, y: 0 },
    },
    blurb: "Fills a template from an object.",
  },
  {
    spec: {
      id: "now",
      op: "core.time.now",
      title: "Now",
      inputs: [],
      outputs: [{ name: "out", kind: "value", schemaType: "number" }],
      pos: { x: 0, y: 0 },
    },
    blurb: "The current timestamp, to the millisecond.",
  },
  {
    spec: {
      id: "run",
      op: "agents.run",
      title: "Run agent",
      inputs: [
        { name: "agent", kind: "value", schemaType: "object", required: true },
        { name: "input", kind: "value", schemaType: "string", required: true },
      ],
      outputs: [
        { name: "events", kind: "stream", schemaType: "object" },
        { name: "output", kind: "value", schemaType: "string" },
      ],
      pos: { x: 0, y: 0 },
    },
    blurb: "Runs an agent and streams its events.",
  },
];

const CATEGORIES = ["string", "math", "object", "array", "http", "stream", "time", "crypto", "schema", "agents", "data", "flow"];

/** Ops: the typed units of work you wire together. */
export function OpsSection() {
  return (
    <SectionShell
      id="ops"
      eyebrow="The building blocks"
      title="Ops do the work"
      subtitle="An op is a typed unit of work with named input and output ports. Pattern ships 175 in the base catalog — 343 with the first-party mods — and writing your own is a small TypeScript file."
    >
      <div className="flex flex-col items-center gap-12">
        {/* A few ops, as the nodes they are */}
        <div className="flex flex-wrap items-start justify-center gap-x-10 gap-y-8">
          {EXAMPLES.map((e, i) => (
            <motion.div
              key={e.spec.id}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="flex flex-col items-center gap-3"
            >
              <MiniNodeBody spec={e.spec} />
              <p className="max-w-[196px] text-center text-xs text-muted">{e.blurb}</p>
            </motion.div>
          ))}
        </div>

        {/* The categories */}
        <div className="flex max-w-2xl flex-wrap justify-center gap-2.5">
          {CATEGORIES.map((c) => {
            const s = categoryStyle(c);
            const Icon = s.Icon;
            return (
              <span
                key={c}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium"
                style={{ background: s.soft, color: s.color, border: `1px solid ${s.border}` }}
              >
                <Icon size={14} /> {c}
              </span>
            );
          })}
        </div>
      </div>
    </SectionShell>
  );
}
