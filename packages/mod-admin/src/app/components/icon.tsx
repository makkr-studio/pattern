import {
  Activity,
  BarChart3,
  Boxes,
  GitBranch,
  Network,
  Package,
  Plus,
  Rocket,
  Workflow,
  Box,
  Search,
  Play,
  Trash2,
  Power,
  Sun,
  Moon,
  ChevronRight,
  CircleDot,
  Undo2,
  Redo2,
  Pause,
  SkipBack,
  SkipForward,
  Download,
  Upload,
  Volume2,
  VolumeX,
  Wand2,
  History,
  GitFork,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  workflow: Workflow,
  "git-branch": GitBranch,
  activity: Activity,
  "bar-chart": BarChart3,
  boxes: Boxes,
  package: Package,
  network: Network,
  plus: Plus,
  rocket: Rocket,
  search: Search,
  play: Play,
  trash: Trash2,
  power: Power,
  sun: Sun,
  moon: Moon,
};

/** Render a lucide icon by its kebab name (from menu/command manifests). */
export function Icon({ name, size = 16, className }: { name?: string; size?: number; className?: string }) {
  const C = (name && MAP[name]) || Box;
  return <C size={size} className={className} />;
}

export { ChevronRight, CircleDot, Sun, Moon, Search, Play, Plus, Rocket, Power, Trash2, Undo2, Redo2, Pause, SkipBack, SkipForward, Download, Upload, Volume2, VolumeX, Wand2, History, GitFork, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen };
