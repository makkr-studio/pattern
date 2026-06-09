/**
 * @pattern/runtime-node — filesystem abstraction (admin-spec P1/§3).
 *
 * `boundary.http.app` serves static assets, and the admin's `WorkflowStore`
 * persists workflow JSON — both over a small, swappable `Filesystem` interface.
 * The spec names "flystorage"; we ship a dependency-light interface of just the
 * slice both consumers need (read/write/list/exists/delete/stat) plus a local
 * Node implementation. A flystorage adapter can drop in behind the same
 * interface without touching either consumer.
 *
 * Filesystems are registered on the engine as a named service (a
 * `FilesystemRegistry` under the `"filesystems"` service key) so the HTTP host
 * and any mod (the admin) resolve them by name and share one instance.
 */

import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import type { Engine } from "@pattern/core";

export interface FileStat {
  size: number;
  /** Last-modified time, epoch milliseconds. */
  mtimeMs: number;
}

/** The minimal storage surface the app boundary and workflow store need. */
export interface Filesystem {
  /** Read a file's bytes, or `null` if it does not exist. */
  read(path: string): Promise<Uint8Array | null>;
  /** Read a file as UTF-8 text, or `null` if it does not exist. */
  readText(path: string): Promise<string | null>;
  /** Write bytes or text, creating parent directories as needed. */
  write(path: string, data: Uint8Array | string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Relative paths of all files at/under `prefix` (recursive). */
  list(prefix?: string): Promise<string[]>;
  delete(path: string): Promise<void>;
  stat(path: string): Promise<FileStat | null>;
}

/** A `Filesystem` rooted at a local directory, with path-traversal containment. */
export class LocalFilesystem implements Filesystem {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Resolve a relative path inside the root, refusing to escape it. */
  private abs(path: string): string {
    const p = resolve(this.root, normalize(path).replace(/^(\.\.(\/|\\|$))+/, ""));
    const rel = relative(this.root, p);
    if (rel.startsWith("..") || (rel !== "" && rel.split(sep)[0] === "..")) {
      throw new Error(`path "${path}" escapes the filesystem root`);
    }
    return p;
  }

  async read(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.abs(path)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async readText(path: string): Promise<string | null> {
    const bytes = await this.read(path);
    return bytes == null ? null : Buffer.from(bytes).toString("utf8");
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    const abs = this.abs(path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof data === "string" ? data : Buffer.from(data));
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(this.abs(path));
  }

  async list(prefix = ""): Promise<string[]> {
    const base = this.abs(prefix);
    if (!existsSync(base)) return [];
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) out.push(relative(this.root, full).split(sep).join("/"));
      }
    };
    const baseStat = await stat(base);
    if (baseStat.isDirectory()) await walk(base);
    else out.push(relative(this.root, base).split(sep).join("/"));
    return out;
  }

  async delete(path: string): Promise<void> {
    await rm(this.abs(path), { recursive: true, force: true });
  }

  async stat(path: string): Promise<FileStat | null> {
    try {
      const s = await stat(this.abs(path));
      return { size: s.size, mtimeMs: s.mtimeMs };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}

/** An in-memory `Filesystem` (tests, ephemeral assets). */
export class MemoryFilesystem implements Filesystem {
  private files = new Map<string, Uint8Array>();

  private key(path: string): string {
    return normalize(path).replace(/^(\.\.(\/|\\|$))+/, "").replace(/\\/g, "/").replace(/^\/+/, "");
  }

  async read(path: string): Promise<Uint8Array | null> {
    return this.files.get(this.key(path)) ?? null;
  }
  async readText(path: string): Promise<string | null> {
    const b = await this.read(path);
    return b == null ? null : Buffer.from(b).toString("utf8");
  }
  async write(path: string, data: Uint8Array | string): Promise<void> {
    this.files.set(this.key(path), typeof data === "string" ? new Uint8Array(Buffer.from(data)) : data);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(this.key(path));
  }
  async list(prefix = ""): Promise<string[]> {
    const p = this.key(prefix);
    return [...this.files.keys()].filter((k) => p === "" || k === p || k.startsWith(`${p}/`));
  }
  async delete(path: string): Promise<void> {
    const p = this.key(path);
    for (const k of [...this.files.keys()]) if (k === p || k.startsWith(`${p}/`)) this.files.delete(k);
  }
  async stat(path: string): Promise<FileStat | null> {
    const b = this.files.get(this.key(path));
    return b == null ? null : { size: b.byteLength, mtimeMs: 0 };
  }
}

// ── Engine service registry ──

/** A named collection of filesystems shared via the engine's service bag. */
export class FilesystemRegistry {
  private map = new Map<string, Filesystem>();
  set(name: string, fs: Filesystem): void {
    this.map.set(name, fs);
  }
  get(name: string): Filesystem | undefined {
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
export function provideFilesystem(engine: Engine, name: string, fs: Filesystem): void {
  filesystems(engine).set(name, fs);
}
