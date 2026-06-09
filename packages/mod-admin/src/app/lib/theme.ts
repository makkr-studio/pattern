import { create } from "zustand";

type Mode = "dark" | "light";

interface ThemeState {
  mode: Mode;
  toggle: () => void;
  set: (mode: Mode) => void;
}

function apply(mode: Mode) {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", mode === "dark");
  }
}

const initial: Mode =
  (typeof localStorage !== "undefined" && (localStorage.getItem("pattern-admin-theme") as Mode)) || "dark";
apply(initial);

/** Theme store: dark/light, persisted, toggles the `.dark` class on <html>. */
export const useTheme = create<ThemeState>((set) => ({
  mode: initial,
  toggle: () =>
    set((s) => {
      const mode: Mode = s.mode === "dark" ? "light" : "dark";
      apply(mode);
      if (typeof localStorage !== "undefined") localStorage.setItem("pattern-admin-theme", mode);
      return { mode };
    }),
  set: (mode) =>
    set(() => {
      apply(mode);
      if (typeof localStorage !== "undefined") localStorage.setItem("pattern-admin-theme", mode);
      return { mode };
    }),
}));
