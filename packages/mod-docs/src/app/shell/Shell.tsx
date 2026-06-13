/**
 * Pattern Docs — the reading shell. Glass header + chapter sidebar (drawer
 * below md), a measured content column, and the manifest shared to pages via
 * outlet context. The admin's visual language at a library's volume.
 */

import React, { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useOutletContext } from "react-router-dom";
import { BookOpen, Menu, Monitor, Moon, Search, Sun, X } from "lucide-react";
import { api, type Manifest, type Me } from "../lib/api";
import { useTheme, type ThemeMode } from "../lib/theme";
import type { DocsNavItem } from "../../shared/types";
import { SignIn } from "../components/SignIn";
import { SearchPalette, useSearchHotkey } from "./SearchPalette";

export interface DocsContext {
  manifest: Manifest;
  me: Me | null;
}

export function useDocs(): DocsContext {
  return useOutletContext<DocsContext>();
}

const THEME_ICON: Record<ThemeMode, React.ReactNode> = {
  light: <Sun size={15} />,
  dark: <Moon size={15} />,
  auto: <Monitor size={15} />,
};

function routeOf(slug: string, file: string): string {
  return `/${slug}/${file.replace(/\.md$/, "")}`;
}

function NavLeaf({ slug, item, depth }: { slug: string; item: DocsNavItem; depth: number }) {
  return (
    <>
      <NavLink
        to={routeOf(slug, item.file)}
        className={({ isActive }) =>
          `block rounded-md px-2.5 py-1 text-[13px] transition-colors ${
            isActive ? "nav-active" : "text-muted hover:text-[var(--fg)]"
          }`
        }
        style={{ paddingLeft: `${10 + depth * 12}px` }}
      >
        {item.label}
      </NavLink>
      {item.items?.map((child) => <NavLeaf key={child.file} slug={slug} item={child} depth={depth + 1} />)}
    </>
  );
}

function Sidebar({ manifest, onNavigate }: { manifest: Manifest; onNavigate: () => void }) {
  const location = useLocation();
  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-4" onClick={onNavigate}>
      <div>
        <div className="px-2.5 py-1 text-[12px] font-semibold uppercase tracking-wider text-muted">Reference</div>
        <div className="mt-1 flex flex-col gap-0.5">
          {[
            { to: "/ops", label: "Op reference" },
            { to: "/mods", label: "Installed mods" },
          ].map((r) => (
            <NavLink
              key={r.to}
              to={r.to}
              className={({ isActive }) =>
                `block rounded-md px-2.5 py-1 text-[13px] transition-colors ${
                  isActive ? "nav-active" : "text-muted hover:text-[var(--fg)]"
                }`
              }
            >
              {r.label}
            </NavLink>
          ))}
        </div>
      </div>
      {manifest.chapters.map((chapter) => {
        // Only the active chapter expands. On the home page that's the
        // handbook (the first chapter, whose overview IS the home page) —
        // not every chapter at once.
        const firstSlug = manifest.chapters[0]?.slug;
        const open =
          location.pathname === "/"
            ? chapter.slug === firstSlug
            : location.pathname.startsWith(`/${chapter.slug}`);
        return (
          <div key={chapter.slug}>
            <NavLink
              to={chapter.slug === manifest.chapters[0]?.slug ? "/" : routeOf(chapter.slug, chapter.index)}
              className="block rounded-md px-2.5 py-1 text-[12px] font-semibold uppercase tracking-wider text-muted hover:text-[var(--fg)]"
            >
              {chapter.title}
            </NavLink>
            {open && (
              <div className="mt-1 flex flex-col gap-0.5">
                <NavLink
                  to={chapter.slug === manifest.chapters[0]?.slug ? "/" : routeOf(chapter.slug, chapter.index)}
                  end
                  className={({ isActive }) =>
                    `block rounded-md px-2.5 py-1 text-[13px] transition-colors ${
                      isActive ? "nav-active" : "text-muted hover:text-[var(--fg)]"
                    }`
                  }
                >
                  Overview
                </NavLink>
                {chapter.nav.map((item) => (
                  <NavLeaf key={item.file} slug={chapter.slug} item={item} depth={0} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function Shell() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [denied, setDenied] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [searching, setSearching] = useState(false);
  const { mode, toggle } = useTheme();
  useSearchHotkey(() => setSearching(true));

  useEffect(() => {
    void api.me().then(setMe).catch(() => setMe(null));
    void api
      .manifest()
      .then(setManifest)
      .catch((err: { status?: number }) => {
        if (err.status === 401) setDenied(true);
      });
  }, []);

  // Gated docs + anonymous reader → the sign-in card replaces the shell.
  if (denied || (me?.authRequired && !me.user)) {
    return me ? <SignIn me={me} /> : null;
  }

  return (
    <div className="flex h-full flex-col">
      <header
        className="glass z-30 flex shrink-0 items-center gap-3 border-b px-4 py-2.5 hairline"
        style={{ borderRadius: 0, borderLeft: "none", borderRight: "none", borderTop: "none" }}
      >
        <button
          onClick={() => setDrawer(true)}
          className="rounded-md p-1.5 text-muted transition-colors hover:text-[var(--fg)] md:hidden"
          aria-label="Open navigation"
        >
          <Menu size={17} />
        </button>
        <Link to="/" className="flex items-center gap-2 text-[14.5px] font-semibold tracking-tight">
          <BookOpen size={16} className="text-[var(--color-neon-cyan)]" />
          Pattern Docs
        </Link>
        <div className="flex-1" />
        <button
          onClick={() => setSearching(true)}
          className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] text-muted transition-colors hairline hover:text-[var(--fg)]"
        >
          <Search size={13} />
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden rounded border px-1 text-[10px] hairline sm:inline">⌘K</kbd>
        </button>
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[12px] text-muted transition-colors hairline hover:text-[var(--fg)]"
          title={`Theme: ${mode} (click to cycle)`}
        >
          {THEME_ICON[mode]}
        </button>
      </header>

      {searching && <SearchPalette onClose={() => setSearching(false)} />}

      <div className="flex min-h-0 flex-1">
        {/* Scrim + drawer below md; static rail at md+. */}
        {drawer && (
          <div className="fixed inset-0 z-40 bg-black/35 md:hidden" onClick={() => setDrawer(false)} aria-hidden />
        )}
        <aside
          className={`glass-strong fixed inset-y-0 left-0 z-50 w-[270px] transition-transform duration-200 md:static md:z-auto md:block md:w-[260px] md:translate-x-0 md:transition-none ${
            drawer ? "translate-x-0" : "-translate-x-full"
          }`}
          style={{ borderRadius: 0 }}
        >
          <div className="flex items-center justify-end px-3 pt-3 md:hidden">
            <button onClick={() => setDrawer(false)} className="rounded-md p-1 text-muted" aria-label="Close">
              <X size={16} />
            </button>
          </div>
          {manifest ? (
            <Sidebar manifest={manifest} onNavigate={() => setDrawer(false)} />
          ) : (
            <div className="px-5 py-6 text-[13px] text-muted">loading…</div>
          )}
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          {manifest ? (
            <Outlet context={{ manifest, me } satisfies DocsContext} />
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-muted">loading…</div>
          )}
        </main>
      </div>
    </div>
  );
}
