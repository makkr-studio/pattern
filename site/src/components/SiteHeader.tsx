import { GitHubIcon } from "./icons";
import { PatternLogo } from "./logo";
import { ThemeToggle } from "./ThemeToggle";
import { SoundToggle } from "./SoundToggle";
import { REPO_URL } from "../lib/links";

/** Sticky glass top bar: brand + version, GitHub, theme + sound toggles. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b hairline backdrop-blur-xl" style={{ background: "color-mix(in srgb, var(--bg) 72%, transparent)" }}>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <a href="#top" className="flex items-center gap-2.5">
          <PatternLogo size={26} />
          <span className="text-[15px] font-semibold tracking-tight">Pattern</span>
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{ background: "color-mix(in srgb, var(--color-neon-cyan) 16%, transparent)", color: "var(--color-neon-cyan)", border: "1px solid color-mix(in srgb, var(--color-neon-cyan) 30%, transparent)" }}
          >
            v{__VERSION__}
          </span>
        </a>
        <nav className="flex items-center gap-2">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repository"
            className="grid h-9 w-9 place-items-center rounded-xl border hairline text-muted transition-colors hover:bg-white/10 hover:text-[var(--fg)]"
          >
            <GitHubIcon size={16} />
          </a>
          <ThemeToggle />
          <SoundToggle />
        </nav>
      </div>
    </header>
  );
}
