/**
 * Theme: dark / light / auto. A forced choice sets `data-theme` on <html> (the
 * CSS in index.css overrides the prefers-color-scheme defaults); "auto" removes
 * the attribute and lets the OS preference govern. Persisted to localStorage.
 */

import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light" | "auto";

const KEY = "pattern.chat.theme";

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "dark" || v === "light" || v === "auto") return v;
  } catch {
    /* private mode */
  }
  return "auto";
}

function apply(t: Theme): void {
  const el = document.documentElement;
  if (t === "auto") delete el.dataset.theme;
  else el.dataset.theme = t;
}

let current = read();
apply(current); // before first paint (module evaluated at import)

const listeners = new Set<() => void>();

export const themeStore = {
  get: (): Theme => current,
  set(t: Theme): void {
    current = t;
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* session-only */
    }
    apply(t);
    for (const fn of listeners) fn();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** Re-assert the stored theme (call once on boot, before render). */
export function applyTheme(): void {
  apply(current);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.get, themeStore.get);
  return [theme, themeStore.set];
}
