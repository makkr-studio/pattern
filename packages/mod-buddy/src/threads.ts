/**
 * @pattern-js/mod-buddy — thread persistence.
 *
 * One thread per (workflow slug, owner): the dock reloads it on mount, the
 * turn pipeline replaces its messages with the agent's updated history after
 * every turn (CAS-retried). mod-store is duck-typed via its well-known
 * "storeService" key — when absent, Buddy degrades gracefully to stateless
 * turns (the dock still works; memory just doesn't survive a reload).
 */

import type { OpContext, Principal } from "@pattern-js/core";

export const THREADS = "buddy.threads";
const STORE_SERVICE = "storeService";

interface DocumentRowLike {
  id: string;
  version: number;
  data: Record<string, unknown>;
}

interface DocsLike {
  ensureCollection(def: { name: string; indexes?: string[] }): Promise<void>;
  get(collection: string, id: string): Promise<DocumentRowLike | null>;
  put(collection: string, id: string, data: Record<string, unknown>, expectedVersion?: number): Promise<DocumentRowLike | null>;
  delete(collection: string, id: string): Promise<boolean>;
}

interface StoreLike {
  docs: DocsLike;
}

export interface ThreadDoc {
  slug: string;
  ownerId: string;
  messages: unknown[];
  updatedAt: number;
}

function docsOf(services: Record<string, unknown>): DocsLike | null {
  const svc = services[STORE_SERVICE] as StoreLike | undefined;
  return svc?.docs && typeof svc.docs.get === "function" ? svc.docs : null;
}

export function ownerOf(principal: Principal): string {
  return principal.kind === "user" ? principal.id : "anonymous";
}

const threadId = (slug: string, ownerId: string): string => `${ownerId}::${slug}`;

// Per-store (not per-process): tests boot several engines, each with its own store.
const ensured = new WeakSet<DocsLike>();
async function ensure(docs: DocsLike): Promise<void> {
  if (ensured.has(docs)) return;
  await docs.ensureCollection({ name: THREADS, indexes: ["slug", "ownerId"] });
  ensured.add(docs);
}

/** The thread's messages (empty when no store / no thread yet). */
export async function loadThread(ctx: OpContext, slug: string): Promise<unknown[]> {
  const docs = docsOf(ctx.services);
  if (!docs) return [];
  await ensure(docs);
  const row = await docs.get(THREADS, threadId(slug, ownerOf(ctx.principal)));
  const messages = (row?.data as ThreadDoc | undefined)?.messages;
  return Array.isArray(messages) ? messages : [];
}

/** Replace the thread's messages with the turn's updated history (CAS-retried). */
export async function saveThread(ctx: OpContext, slug: string, messages: unknown[]): Promise<boolean> {
  const docs = docsOf(ctx.services);
  if (!docs) return false;
  await ensure(docs);
  const ownerId = ownerOf(ctx.principal);
  const id = threadId(slug, ownerId);
  const data: ThreadDoc = { slug, ownerId, messages, updatedAt: Date.now() };
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await docs.get(THREADS, id);
    const written = await docs.put(THREADS, id, data as unknown as Record<string, unknown>, existing?.version);
    if (written) return true;
  }
  console.warn(`[pattern/mod-buddy] thread "${id}": CAS save kept losing — dropping this turn's history`);
  return false;
}

export async function clearThread(ctx: OpContext, slug: string): Promise<boolean> {
  const docs = docsOf(ctx.services);
  if (!docs) return false;
  await ensure(docs);
  return docs.delete(THREADS, threadId(slug, ownerOf(ctx.principal)));
}

/** Whether persistence is available (the dock's status probe reports it). */
export function hasThreadStore(services: Record<string, unknown>): boolean {
  return docsOf(services) !== null;
}
