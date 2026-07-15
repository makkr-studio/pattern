import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { AnimatedPatternLogo } from "../components/logo";
import { GitHubIcon } from "../components/icons";
import { NeonButton } from "../components/ui";
import { Terminal } from "../components/Terminal";
import { StaticGraph } from "../graph/StaticGraph";
import { heroGraph } from "../graph/heroGraph";
import { useReducedMotion } from "../lib/reduced-motion";
import { REPO_URL } from "../lib/links";

/** The opening beat: an ambient living graph behind a glass headline. */
export function Hero({ spin = false }: { spin?: boolean }) {
  const reduced = useReducedMotion();
  return (
    <section id="top" className="relative flex min-h-[94vh] items-center justify-center overflow-hidden px-6">
      {/* Ambient workflow graph, faded and masked as a backdrop. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.22] dark:opacity-[0.3]"
        style={{ maskImage: "radial-gradient(120% 80% at 50% 42%, black 35%, transparent 78%)", WebkitMaskImage: "radial-gradient(120% 80% at 50% 42%, black 35%, transparent 78%)" }}
      >
        <motion.div
          animate={spin && !reduced ? { rotate: 360 } : { rotate: 0 }}
          transition={spin ? { duration: 6, ease: "easeInOut" } : { duration: 0.3 }}
          style={{ transform: "scale(1.18)", filter: "blur(0.4px)" }}
        >
          <StaticGraph graph={heroGraph} pulse={!reduced} />
        </motion.div>
      </div>
      {/* Contrast scrim so the headline always reads over the graph. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(50% 42% at 50% 48%, var(--bg) 0%, color-mix(in srgb, var(--bg) 55%, transparent) 45%, transparent 75%)" }}
      />

      {/* Headline */}
      <motion.div
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="relative z-10 flex max-w-3xl flex-col items-center text-center"
      >
        <AnimatedPatternLogo size={76} animate={!reduced} className="mb-7" />
        <h1 className="text-balance text-5xl font-semibold tracking-tight md:text-6xl">
          Build apps by{" "}
          <span className="bg-gradient-to-r from-[var(--color-neon-cyan)] to-[var(--color-neon-violet)] bg-clip-text text-transparent">connecting the dots</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
          Pattern is a workflow engine for APIs, agents, and apps. Wire typed operations into a graph, watch the data flow,
          and ship. The visual editor, streaming, and live reload are built in. So is Buddy — the assistant that drafts
          workflows with you.
        </p>
        <div className="mt-9 flex flex-col items-center gap-5">
          <Terminal />
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a href="#build">
              <NeonButton>
                Build one now <ArrowRight size={16} />
              </NeonButton>
            </a>
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              <NeonButton variant="ghost">
                <GitHubIcon size={16} /> Star on GitHub
              </NeonButton>
            </a>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
