import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { buildNav, type MenuEntry } from "@pattern/admin-sdk";
import { useManifest } from "../lib/queries";
import { useTheme } from "../lib/theme";
import { sfx } from "../lib/sfx";
import { Icon } from "../components/icon";
import { Sun, Moon, Search, Volume2, VolumeX, PanelLeftClose, PanelLeftOpen } from "../components/icon";
import { PatternLogo } from "../components/logo";
import { CommandPalette, useCommandHotkey } from "./CommandPalette";
import { TooltipHost, tip } from "../components/Tooltip";

/** A sensible default nav if the manifest hasn't loaded yet (the admin's own). */
const FALLBACK_MENU: MenuEntry[] = [
  { category: "Author", label: "Workflows", icon: "workflow", path: "/workflows", order: 10 },
  { category: "Observe", label: "Runs", icon: "activity", path: "/runs", order: 10 },
  { category: "Observe", label: "Metrics", icon: "bar-chart", path: "/metrics", order: 20 },
  { category: "Catalog", label: "Ops", icon: "boxes", path: "/ops", order: 10 },
  { category: "Catalog", label: "Mods", icon: "package", path: "/mods", order: 20 },
  { category: "System", label: "System map", icon: "network", path: "/system", order: 10 },
];

const SIDEBAR_KEY = "pattern.admin.sidebar";

export function Shell() {
  const { data: manifest } = useManifest();
  const { mode, toggle } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(sfx.muted());
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
    } catch {
      return false;
    }
  });
  const location = useLocation();
  useCommandHotkey(() => {
    sfx.play("open");
    setPaletteOpen(true);
  });
  const sections = buildNav(manifest?.menu?.length ? manifest.menu : FALLBACK_MENU);

  const toggleSidebar = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "collapsed" : "open");
      } catch {
        /* best-effort */
      }
      return next;
    });
    sfx.play("toggle");
  };

  return (
    <div className="flex h-full">
      {/* Sidebar — collapses to an icon rail to free canvas space */}
      <aside className={`glass m-3 flex shrink-0 flex-col rounded-2xl transition-[width] duration-200 ${collapsed ? "w-[4.25rem] p-2" : "w-60 p-4"}`}>
        <div className={`mb-6 flex items-center ${collapsed ? "flex-col gap-2 px-0 pt-1" : "gap-2.5 px-2"}`}>
          <PatternLogo size={30} />
          {!collapsed && <span className="text-lg font-semibold tracking-tight">Pattern</span>}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            {...tip(collapsed ? "Expand sidebar" : "Collapse sidebar")}
            className={`text-muted rounded-lg p-1.5 hover:bg-white/10 hover:text-[var(--fg)] ${collapsed ? "" : "ml-auto"}`}
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>

        <button
          onClick={() => {
            sfx.play("open");
            setPaletteOpen(true);
          }}
          aria-label="Search (⌘K)"
          {...(collapsed ? tip("Search (⌘K)") : {})}
          className={`glass text-muted mb-5 flex items-center rounded-xl text-sm hover:bg-white/5 ${collapsed ? "justify-center p-2" : "gap-2 px-3 py-2"}`}
        >
          <Search size={14} />
          {!collapsed && (
            <>
              <span>Search…</span>
              <kbd className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-xs">⌘K</kbd>
            </>
          )}
        </button>

        <nav className={`flex-1 overflow-y-auto ${collapsed ? "space-y-1" : "space-y-5"}`}>
          {sections.map((section) => (
            <div key={section.category}>
              {!collapsed && (
                <div className="text-muted mb-1.5 px-2 text-xs font-semibold uppercase tracking-wider opacity-70">
                  {section.category}
                </div>
              )}
              {section.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => sfx.play("nav")}
                  {...(collapsed ? tip(item.label) : {})}
                  aria-label={item.label}
                  className={({ isActive }) =>
                    `flex items-center rounded-lg text-sm transition-colors ${collapsed ? "justify-center p-2.5" : "gap-2.5 px-2.5 py-2"} ${
                      isActive ? "bg-white/10 text-[var(--fg)]" : "text-muted hover:bg-white/5 hover:text-[var(--fg)]"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon name={item.icon} className={isActive ? "text-[var(--color-neon-cyan)]" : ""} />
                      {!collapsed && <span>{item.label}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer toggles: sound + theme (both advertise what they switch TO). */}
        <div className={`mt-4 flex gap-2 ${collapsed ? "flex-col" : ""}`}>
          <button
            type="button"
            onClick={() => {
              const next = !sfxMuted;
              sfx.setMuted(next);
              setSfxMuted(next);
              if (!next) sfx.play("toggle"); // audible confirmation on unmute
            }}
            aria-label={sfxMuted ? "Enable sound effects" : "Mute sound effects"}
            {...tip(sfxMuted ? "Enable sound effects" : "Mute sound effects")}
            className={`glass text-muted flex flex-1 items-center justify-center rounded-xl text-sm hover:bg-white/5 ${collapsed ? "p-2" : "gap-2 px-3 py-2"}`}
          >
            {sfxMuted ? <Volume2 size={14} /> : <VolumeX size={14} />}
            {!collapsed && <span>{sfxMuted ? "Sound" : "Mute"}</span>}
          </button>
          <button
            type="button"
            onClick={() => {
              sfx.play("toggle");
              toggle();
            }}
            aria-label={mode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            {...tip(mode === "dark" ? "Light theme" : "Dark theme")}
            className={`glass text-muted flex flex-1 items-center justify-center rounded-xl text-sm hover:bg-white/5 ${collapsed ? "p-2" : "gap-2 px-3 py-2"}`}
          >
            {mode === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {!collapsed && <span>{mode === "dark" ? "Light" : "Dark"}</span>}
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
