/** Pattern Docs — API client (pure fetch over the docs.* routes). */

import type { DocsNavItem } from "../../shared/types";

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
};

/** Ask the identity stack to email a sign-in link (always answers 200). */
export async function requestMagicLink(requestPath: string, email: string): Promise<void> {
  const res = await fetch(requestPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, next: "/docs/" }),
  });
  if (!res.ok) throw new Error(`sign-in request failed (${res.status})`);
}
