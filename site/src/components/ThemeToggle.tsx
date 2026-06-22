import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeMode } from "../lib/theme";
import { sfx } from "../lib/sfx";

const ICON: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, auto: Monitor };
const LABEL: Record<ThemeMode, string> = { light: "Light", dark: "Dark", auto: "Auto" };

/** Cycles light → dark → auto. Keyboard-operable, announces the current mode. */
export function ThemeToggle() {
  const { mode, toggle } = useTheme();
  const Icon = ICON[mode];
  return (
    <button
      type="button"
      onClick={() => {
        sfx.play("toggle");
        toggle();
      }}
      aria-label={`Theme: ${LABEL[mode]} (click to change)`}
      title={`Theme: ${LABEL[mode]}`}
      className="grid h-9 w-9 place-items-center rounded-xl border hairline text-muted transition-colors hover:bg-white/10 hover:text-[var(--fg)]"
    >
      <Icon size={16} />
    </button>
  );
}
