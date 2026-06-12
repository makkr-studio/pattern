/** Pattern Docs — API client (pure fetch over the docs.* routes). */

import type { DocsNavItem, ModInfo, OpInfo } from "../../shared/types";

export interface Me {
  user: { id: string; name: string | null; email: string | null } | null;
  authRequired: boolean;
  login: { kind: string; requestPath: string };
}

export interface Chapter {
  mod: string;
  slug: string;
  title: string;
  order: number;
  index: string;
  nav: DocsNavItem[];
}

export interface Manifest {
  chapters: Chapter[];
  mount: string;
  adminMount: string;
}

export interface Page {
  chapter: string;
  file: string;
  title: string;
  markdown: string;
}

const API = "/docs/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw Object.assign(new Error(`${res.status}`), { status: res.status });
  }
  return (await res.json()) as T;
}

export const api = {
  me: async (): Promise<Me> => json(await fetch(`${API}/me`)),
  manifest: async (): Promise<Manifest> => json(await fetch(`${API}/manifest`)),
  page: async (chapter: string, file: string): Promise<Page> =>
    json(await fetch(`${API}/page?chapter=${encodeURIComponent(chapter)}&file=${encodeURIComponent(file)}`)),
  rawUrl: (chapter: string, file: string): string =>
    `/docs/raw?chapter=${encodeURIComponent(chapter)}&file=${encodeURIComponent(file)}`,
  ops: async (): Promise<OpInfo[]> => (await json<{ ops: OpInfo[] }>(await fetch(`${API}/ops`))).ops,
  op: async (type: string): Promise<{ info: OpInfo; prose: string | null }> =>
    json(await fetch(`${API}/op?type=${encodeURIComponent(type)}`)),
  mods: async (): Promise<ModInfo[]> => (await json<{ mods: ModInfo[] }>(await fetch(`${API}/mods`))).mods,
};

/** Module-cached op catalog (the embeds' OpMap; one fetch per page load). */
let opsPromise: Promise<OpInfo[]> | null = null;
export function fetchOps(): Promise<OpInfo[]> {
  if (!opsPromise) opsPromise = api.ops().catch((err) => {
    opsPromise = null;
    throw err;
  });
  return opsPromise;
}

/**
 * "Open in admin" probe — one HEAD-ish request per session; links render only
 * for readers who actually have the admin (non-200/network → hidden).
 */
let adminPromise: Promise<boolean> | null = null;
export function hasAdminAccess(adminMount: string): Promise<boolean> {
  if (!adminPromise) {
    adminPromise = fetch(`${adminMount}/api/ops`, { redirect: "manual" })
      .then((r) => r.ok)
      .catch(() => false);
  }
  return adminPromise;
}

/** Ask the identity stack to email a sign-in link (always answers 200). */
export async function requestMagicLink(requestPath: string, email: string): Promise<void> {
  const res = await fetch(requestPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, next: "/docs/" }),
  });
  if (!res.ok) throw new Error(`sign-in request failed (${res.status})`);
}
