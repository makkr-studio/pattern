/**
 * Client-side admin preferences (localStorage). Server-side knobs (worker pool
 * size, ports…) belong to the host's code/config — the Settings page explains
 * them instead of pretending the SPA could change a running process.
 */

export interface AdminSettings {
  /** Benchmark defaults for the Process page. */
  benchN: number;
  benchRuns: number;
  /** null = auto (min(runs, cores − 1)). */
  benchWorkers: number | null;
}

const KEY = "pattern.admin.settings";

export const DEFAULT_SETTINGS: AdminSettings = { benchN: 34, benchRuns: 4, benchWorkers: null };

export function readSettings(): AdminSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<AdminSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(patch: Partial<AdminSettings>): AdminSettings {
  const next = { ...readSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
  return next;
}
