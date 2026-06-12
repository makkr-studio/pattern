import { create } from "zustand";

/** "auto" follows the OS (prefers-color-scheme), live. */
export type ThemeMode = "light" | "dark" | "auto";

interface ThemeState {
  mode: ThemeMode;
  /** What is actually on screen right now (auto resolved against the OS). */
  resolved: "light" | "dark";
  /** Cycle light → dark → auto. */
  toggle: () => void;
  set: (mode: ThemeMode) => void;
}

const KEY = "pattern-docs-theme";
const NEXT: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "auto", auto: "light" };

const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : undefined;

function resolve(mode: ThemeMode): "light" | "dark" {
  return mode === "auto" ? (mq?.matches ? "dark" : "light") : mode;
}

function apply(mode: ThemeMode) {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", resolve(mode) === "dark");
  }
}

const stored = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
const initial: ThemeMode = stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
apply(initial);

/** Theme store: light/dark/auto, persisted, toggles the `.dark` class on <html>. */
export const useTheme = create<ThemeState>((set, get) => ({
  mode: initial,
  resolved: resolve(initial),
  toggle: () => get().set(NEXT[get().mode]),
  set: (mode) => {
    apply(mode);
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, mode);
    set({ mode, resolved: resolve(mode) });
  },
}));

// In auto, track the OS preference as it changes (no reload needed).
mq?.addEventListener("change", () => {
  const { mode } = useTheme.getState();
  if (mode === "auto") {
    apply("auto");
    useTheme.setState({ resolved: resolve("auto") });
  }
});
