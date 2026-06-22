import { BookOpen } from "lucide-react";
import { motion } from "motion/react";
import { GitHubIcon } from "../components/icons";
import { NeonButton } from "../components/ui";
import { Terminal } from "../components/Terminal";
import { PatternLogo } from "../components/logo";
import { REPO_URL } from "../lib/links";

/** The closing call to action, plus the footer. */
export function FinalCta() {
  return (
    <section id="start" className="px-6 pb-16 pt-20">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5 }}
        className="mx-auto flex max-w-2xl flex-col items-center text-center"
      >
        <h2 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">Ready to build something?</h2>
        <p className="mt-4 text-lg text-muted">One command scaffolds a project, installs the engine, and opens the visual editor.</p>
        <div className="mt-8 flex flex-col items-center gap-5">
          <Terminal />
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              <NeonButton>
                <GitHubIcon size={16} /> Star on GitHub
              </NeonButton>
            </a>
            <a href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer">
              <NeonButton variant="ghost">
                <BookOpen size={16} /> Read the docs
              </NeonButton>
            </a>
          </div>
        </div>
      </motion.div>

      <footer className="mx-auto mt-24 flex max-w-6xl flex-col items-center justify-between gap-4 border-t hairline px-2 pt-8 text-sm text-muted sm:flex-row">
        <div className="flex items-center gap-2">
          <PatternLogo size={20} />
          <span>Pattern</span>
          <span className="opacity-60">v{__VERSION__}</span>
        </div>
        <div className="flex items-center gap-5">
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-[var(--fg)]">
            GitHub
          </a>
          <a href="https://www.npmjs.com/package/create-pattern" target="_blank" rel="noreferrer" className="hover:text-[var(--fg)]">
            npm
          </a>
          <span className="opacity-60">Made by Makkr Studio</span>
        </div>
      </footer>
    </section>
  );
}
