/** A compact 3-way theme control: light · dark · system (auto). */

import React from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme, type Theme } from "../lib/theme";

const OPTS: { value: Theme; Icon: typeof Sun; label: string }[] = [
  { value: "light", Icon: Sun, label: "Light" },
  { value: "dark", Icon: Moon, label: "Dark" },
  { value: "auto", Icon: Monitor, label: "System" },
];

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="flex items-center rounded-lg border p-0.5" style={{ borderColor: "var(--line)" }} role="group" aria-label="Theme">
      {OPTS.map(({ value, Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors"
          style={theme === value ? { background: "var(--line-soft)", color: "var(--fg)" } : { color: "var(--fg-faint)" }}
          title={label}
          aria-label={label}
          aria-pressed={theme === value}
        >
          <Icon size={13} />
        </button>
      ))}
    </div>
  );
}
