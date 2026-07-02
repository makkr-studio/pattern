import { type LucideIcon, Bot, Braces, FileText, Plug, ScanText, Workflow, Zap, BookOpen } from "lucide-react";
import { motion } from "motion/react";
import { SectionShell } from "../components/SectionShell";
import { GlassPanel } from "../components/ui";

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
}

const DX: Feature[] = [
  { icon: Workflow, title: "A visual editor", body: "Drag ops onto a canvas, wire their ports, and hit run. The same editor ships with every app you build." },
  { icon: Zap, title: "Live reload", body: "Save a workflow or an op and the engine picks it up. There is no build step sitting between you and a run." },
  { icon: BookOpen, title: "Every op, documented", body: "175 core ops — strings, math, http, streams, time, crypto, objects — plus everything your mods add. The reference is generated from the live registry, so it never drifts." },
  { icon: Braces, title: "Typed end to end", body: "Ports carry types. The editor only lets you connect what fits, and a bad wire is caught before it runs." },
];

const AX: Feature[] = [
  { icon: Bot, title: "AGENTS.md in every scaffold", body: "Each project ships a contract sheet so a coding agent knows the conventions before it writes a line." },
  { icon: FileText, title: "llms.txt", body: "The docs expose a single llms.txt so an agent can read the whole handbook in one fetch." },
  { icon: ScanText, title: "Self-describing ops", body: "Every op carries its name, ports, schemas, and prose. An agent can author a real workflow without guessing." },
  { icon: Plug, title: "MCP ready", body: "Tools and workflows surface over MCP, so agents call your app directly with typed arguments." },
];

function Column({ eyebrow, title, blurb, features, accent }: { eyebrow: string; title: string; blurb: string; features: Feature[]; accent: string }) {
  return (
    <GlassPanel className="p-7">
      <div className="text-xs font-medium uppercase tracking-[0.22em]" style={{ color: accent }}>
        {eyebrow}
      </div>
      <h3 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm text-muted">{blurb}</p>
      <div className="mt-6 flex flex-col gap-5">
        {features.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.4, delay: i * 0.05 }}
            className="flex gap-3"
          >
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
              <f.icon size={17} />
            </div>
            <div>
              <div className="font-medium">{f.title}</div>
              <p className="mt-1 text-sm text-muted">{f.body}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </GlassPanel>
  );
}

/** DX and AX side by side: agent experience is a first-class pillar here. */
export function DxAxSection() {
  return (
    <SectionShell
      id="dx-ax"
      eyebrow="Made for humans and agents"
      title="A developer experience, and an agent experience"
      subtitle="Pattern is built to be a joy to work in by hand and just as legible to the coding agents working alongside you."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <Column eyebrow="Developer experience" title="Stay in flow" blurb="Everything you need to go from idea to running app, fast." features={DX} accent="var(--color-neon-cyan)" />
        <Column eyebrow="Agent experience" title="Legible to agents" blurb="The same surface your tools read, made for machines too." features={AX} accent="var(--color-neon-violet)" />
      </div>
    </SectionShell>
  );
}
