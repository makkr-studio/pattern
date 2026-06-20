/**
 * @pattern-js/runtime-node — storage layer (admin-spec P1/§3), backed by **flystorage**.
 *
 * `boundary.http.app` serves static assets and the admin's `WorkflowStore`
 * persists workflow JSON — both over flystorage's `FileStorage`, the universal
 * interface across adapters. Today we ship local-fs and in-memory; swapping in
 * S3 / GCS / Azure later is a one-line adapter change with no consumer edits.
 *
 * Filesystems are registered on the engine as a named service (a
 * `FilesystemRegistry` under the `"filesystems"` service key) so the HTTP host
 * and any mod (the admin) resolve them by name and share one instance.
 */

import { resolve } from "node:path";
import { FileStorage } from "@flystorage/file-storage";
import { LocalStorageAdapter } from "@flystorage/local-fs";
import { InMemoryStorageAdapter } from "@flystorage/in-memory";
import type { Engine } from "@pattern-js/core";

export { FileStorage } from "@flystorage/file-storage";
export type { StatEntry, FileInfo } from "@flystorage/file-storage";

/** The storage handle consumers depend on (flystorage's `FileStorage`). */
export type Filesystem = FileStorage;

/** A `FileStorage` rooted at a local directory (local-fs adapter). */
export function localFs(rootDir: string): FileStorage {
  return new FileStorage(new LocalStorageAdapter(resolve(rootDir)));
}

/** An ephemeral in-memory `FileStorage` (tests, placeholder assets). */
export function memoryFs(): FileStorage {
  return new FileStorage(new InMemoryStorageAdapter());
}

/** Coerce a `Filesystem | string` (dir path) into a `FileStorage`. */
export function toFilesystem(fs: FileStorage | string): FileStorage {
  return typeof fs === "string" ? localFs(fs) : fs;
}

// ── Engine service registry ──

/** A named collection of filesystems shared via the engine's service bag. */
export class FilesystemRegistry {
  private map = new Map<string, FileStorage>();
  set(name: string, fs: FileStorage): void {
    this.map.set(name, fs);
  }
  get(name: string): FileStorage | undefined {
    return this.map.get(name);
  }
  names(): string[] {
    return [...this.map.keys()];
  }
}

/** The service key the filesystem registry is registered under. */
export const FILESYSTEMS_SERVICE = "filesystems";

/** Get (or lazily create + register) the engine's filesystem registry. */
export function filesystems(engine: Engine): FilesystemRegistry {
  let reg = engine.service<FilesystemRegistry>(FILESYSTEMS_SERVICE);
  if (!reg) {
    reg = new FilesystemRegistry();
    engine.provideService(FILESYSTEMS_SERVICE, reg);
  }
  return reg;
}

/** Register a named filesystem on the engine (shared by the app boundary + mods). */
export function provideFilesystem(engine: Engine, name: string, fs: FileStorage): void {
  filesystems(engine).set(name, fs);
}
