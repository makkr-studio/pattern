import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { buildNav, type MenuEntry } from "@pattern/admin-sdk";
import { useManifest } from "../lib/queries";
import { useTheme } from "../lib/theme";
import { sfx } from "../lib/sfx";
import { Icon } from "../components/icon";
import { Sun, Moon, Search, Volume2, VolumeX } from "../components/icon";
import { PatternLogo } from "../components/logo";
import { CommandPalette, useCommandHotkey } from "./CommandPalette";
import { TooltipHost } from "../components/Tooltip";

/** A sensible default nav if the manifest hasn't loaded yet (the admin's own). */
const FALLBACK_MENU: MenuEntry[] = [
  { category: "Author", label: "Workflows", icon: "workflow", path: "/workflows", order: 10 },
  { category: "Observe", label: "Runs", icon: "activity", path: "/runs", order: 10 },
  { category: "Observe", label: "Metrics", icon: "bar-chart", path: "/metrics", order: 20 },
  { category: "Catalog", label: "Ops", icon: "boxes", path: "/ops", order: 10 },
  { category: "Catalog", label: "Mods", icon: "package", path: "/mods", order: 20 },
  { category: "System", label: "System map", icon: "network", path: "/system", order: 10 },
];

export function Shell() {
  const { data: manifest } = useManifest();
  const { mode, toggle } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(sfx.muted());
  const location = useLocation();
  useCommandHotkey(() => {
    sfx.play("open");
    setPaletteOpen(true);
  });
  const sections = buildNav(manifest?.menu?.length ? manifest.menu : FALLBACK_MENU);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="glass m-3 flex w-60 shrink-0 flex-col rounded-2xl p-4">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <PatternLogo size={30} />
          <span className="text-lg font-semibold tracking-tight">Pattern</span>
        </div>

        <button
          onClick={() => {
            sfx.play("open");
            setPaletteOpen(true);
          }}
          className="glass text-muted mb-5 flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-white/5"
        >
          <Search size={14} />
          <span>Search…</span>
          <kbd className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-xs">⌘K</kbd>
        </button>

        <nav className="flex-1 space-y-5 overflow-y-auto">
          {sections.map((section) => (
            <div key={section.category}>
              <div className="text-muted mb-1.5 px-2 text-xs font-semibold uppercase tracking-wider opacity-70">
                {section.category}
              </div>
              {section.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => sfx.play("nav")}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                      isActive ? "bg-white/10 text-[var(--fg)]" : "text-muted hover:bg-white/5 hover:text-[var(--fg)]"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon name={item.icon} className={isActive ? "text-[var(--color-neon-cyan)]" : ""} />
                      <span>{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer toggles: sound + theme (both advertise what they switch TO). */}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => {
              const next = !sfxMuted;
              sfx.setMuted(next);
              setSfxMuted(next);
              if (!next) sfx.play("toggle"); // audible confirmation on unmute
            }}
            aria-label={sfxMuted ? "Enable sound effects" : "Mute sound effects"}
            title={sfxMuted ? "Enable sound effects" : "Mute sound effects"}
            className="glass text-muted flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-white/5"
          >
            {sfxMuted ? <Volume2 size={14} /> : <VolumeX size={14} />}
            <span>{sfxMuted ? "Sound" : "Mute"}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              sfx.play("toggle");
              toggle();
            }}
            aria-label={mode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="glass text-muted flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-white/5"
          >
            {mode === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            <span>{mode === "dark" ? "Light" : "Dark"}</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Outlet />
        </motion.div>
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <TooltipHost />
    </div>
  );
}
