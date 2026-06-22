import { type LucideIcon, Bot, BookOpen, Database, KeyRound, MessagesSquare, Shield } from "lucide-react";
import { motion } from "motion/react";
import { SectionShell } from "../components/SectionShell";
import { GlowCard } from "../components/ui";

interface Mod {
  icon: LucideIcon;
  name: string;
  pkg: string;
  body: string;
  hue: number;
}

const MODS: Mod[] = [
  { icon: Shield, name: "Admin", pkg: "@pattern-js/mod-admin", body: "The visual editor, runs, replay, and a catalog of every op and mod.", hue: 265 },
  { icon: BookOpen, name: "Docs", pkg: "@pattern-js/mod-docs", body: "A self-documenting handbook and a generated op reference, served at /docs.", hue: 262 },
  { icon: Database, name: "Store", pkg: "@pattern-js/mod-store", body: "Durable storage, blobs, turn documents, and per-turn leases.", hue: 330 },
  { icon: KeyRound, name: "Vault", pkg: "@pattern-js/mod-vault", body: "Secrets and API keys, resolved straight into the ops that need them.", hue: 258 },
  { icon: Bot, name: "Agents", pkg: "@pattern-js/mod-agents", body: "An agent loop with tools, MCP, and streaming turns you can watch live.", hue: 270 },
  { icon: MessagesSquare, name: "Chat", pkg: "@pattern-js/mod-chat", body: "A full hosted chat application running over one shared backend.", hue: 199 },
];

/** The mods: optional packages that extend an engine with ops, routes, and pages. */
export function Ecosystem() {
  return (
    <SectionShell
      id="ecosystem"
      eyebrow="The ecosystem"
      title="Batteries, in mods"
      subtitle="A mod is a package that gives an engine new capabilities: ops, workflows, routes, an admin page, a docs chapter, even a full frontend app you can brand. Add the ones you want, or write your own."
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {MODS.map((m, i) => (
          <motion.div
            key={m.name}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.4, delay: (i % 3) * 0.05 }}
          >
            <GlowCard className="h-full p-6">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: `hsl(${m.hue} 80% 60% / 0.16)`, color: `hsl(${m.hue} 80% 72%)` }}>
                  <m.icon size={19} />
                </div>
                <div>
                  <div className="font-semibold">{m.name}</div>
                  <div className="font-mono text-[11px] text-muted">{m.pkg}</div>
                </div>
              </div>
              <p className="mt-4 text-sm text-muted">{m.body}</p>
            </GlowCard>
          </motion.div>
        ))}
      </div>
    </SectionShell>
  );
}
