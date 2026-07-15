import { type LucideIcon, Bot, BookOpen, Database, KeyRound, Mail, MessagesSquare, Puzzle, ScanSearch, Shield, Sparkles, Users, CreditCard } from "lucide-react";
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
  { icon: ScanSearch, name: "Vectors", pkg: "@pattern-js/mod-vectors", body: "Embedding collections with declared filters and hybrid search — RAG over your own data in two nodes.", hue: 190 },
  { icon: KeyRound, name: "Vault", pkg: "@pattern-js/mod-vault", body: "Secrets and API keys, resolved straight into the ops that need them.", hue: 258 },
  { icon: Users, name: "Identity", pkg: "@pattern-js/mod-identity", body: "Users, sessions, roles and invites — sign in by magic link or any OIDC provider.", hue: 152 },
  { icon: Mail, name: "Email", pkg: "@pattern-js/mod-email", body: "Send and receive: Resend or SMTP drivers, sign-in links that deliver themselves, inbound email that triggers workflows.", hue: 22 },
  { icon: CreditCard, name: "Billing", pkg: "@pattern-js/mod-billing", body: "Stripe checkout, portal and verified webhooks — an active plan becomes a scope, and agent usage meters itself.", hue: 120 },
  { icon: Bot, name: "Agents", pkg: "@pattern-js/mod-agents", body: "An agent loop with tools, guardrails and streaming turns — plus MCP in both directions.", hue: 270 },
  { icon: Sparkles, name: "Buddy", pkg: "@pattern-js/mod-buddy", body: "The assistant in the editor: it drafts and repairs workflows on your canvas, and debugs failed runs from their traces.", hue: 285 },
  { icon: MessagesSquare, name: "Chat", pkg: "@pattern-js/mod-chat", body: "A full hosted chat application running over one shared backend.", hue: 199 },
  { icon: Puzzle, name: "Yours", pkg: "npm create pattern -- --kind mod", body: "A mod is a small TypeScript package. Scaffold one with an op, a route, an admin page and a docs chapter — and publish it.", hue: 45 },
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
