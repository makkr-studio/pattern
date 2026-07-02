import {
  ArrowDownToLine,
  Bell,
  Boxes,
  Braces,
  FileJson2,
  AppWindow,
  Calculator,
  Clock,
  Database,
  DoorOpen,
  GitFork,
  Globe,
  Hash,
  KeyRound,
  List,
  Radio,
  Shield,
  Sigma,
  Type,
  Variable,
  Waves,
  Webhook,
  Box,
  Bot,
  type LucideIcon,
} from "lucide-react";
import { hashHue } from "./format";

/** A category's visual identity (icon + an HSL triple "H S% L%"). Mirrors the admin. */
const CATS: Record<string, { hsl: string; icon: LucideIcon }> = {
  string: { hsl: "199 89% 62%", icon: Type },
  math: { hsl: "150 70% 55%", icon: Calculator },
  flow: { hsl: "45 92% 62%", icon: GitFork },
  stream: { hsl: "270 82% 72%", icon: Waves },
  object: { hsl: "210 82% 66%", icon: Braces },
  array: { hsl: "174 72% 56%", icon: List },
  data: { hsl: "330 78% 66%", icon: Database },
  time: { hsl: "28 88% 62%", icon: Clock },
  crypto: { hsl: "258 72% 70%", icon: KeyRound },
  const: { hsl: "220 14% 66%", icon: Hash },
  scalar: { hsl: "190 62% 60%", icon: Sigma },
  http: { hsl: "16 90% 62%", icon: Globe },
  ws: { hsl: "292 76% 70%", icon: Radio },
  input: { hsl: "140 62% 58%", icon: ArrowDownToLine },
  event: { hsl: "340 82% 68%", icon: Bell },
  hook: { hsl: "20 86% 62%", icon: Webhook },
  env: { hsl: "96 52% 58%", icon: Variable },
  schema: { hsl: "262 78% 72%", icon: FileJson2 },
  app: { hsl: "150 60% 56%", icon: AppWindow },
  boundary: { hsl: "186 90% 60%", icon: DoorOpen },
  admin: { hsl: "265 82% 72%", icon: Shield },
  agents: { hsl: "260 80% 72%", icon: Bot },
  sample: { hsl: "320 76% 68%", icon: Boxes },
};

export interface CategoryStyle {
  color: string;
  soft: string;
  border: string;
  Icon: LucideIcon;
}

/** Derive a display category from an op type id (mirrors the backend). */
export function categoryOfType(type: string): string {
  const parts = type.split(".");
  if (parts[0] === "core") return parts[1] ?? "core";
  if (parts[0] === "boundary") return "boundary";
  return parts[0] ?? "misc";
}

const titleCase = (s: string): string => s.replace(/[-_.]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** A friendly, human label for an op type (its last segment, prettified). */
export function humanizeOp(type: string): string {
  return titleCase(type.split(".").pop() ?? type);
}

/** Resolve a category's color ramp + icon (deterministic fallback for unknowns). */
export function categoryStyle(category: string): CategoryStyle {
  const meta = CATS[category];
  const hsl = meta?.hsl ?? `${hashHue(category)} 70% 64%`;
  return {
    color: `hsl(${hsl})`,
    soft: `hsl(${hsl} / 0.16)`,
    border: `hsl(${hsl} / 0.4)`,
    Icon: meta?.icon ?? Box,
  };
}
