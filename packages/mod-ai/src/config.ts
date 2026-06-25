/**
 * @pattern-js/mod-ai — persisted settings: connections + model aliases.
 *
 * Provider KEYS live in the vault (mod-vault's Secrets screen). What mod-ai
 * persists is:
 *  - **connections** — how to reach each provider (secret NAMES + structured
 *    options), so credential selection is explicit, and
 *  - **aliases** — memorable names ("default", "mini", …) pointing at a
 *    connection + model id, resolved by `ai.alias`.
 * Agents/chat fall back to the "default" alias when no model is wired. Stored as
 * a small JSON file under the runtime data dir; in-memory on a read-only fs.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "@pattern-js/core";
import { modelRefSchema, type ModelRef } from "@pattern-js/mod-agents";
import { aliasSchema, connectionSchema, type Alias, type Connection } from "./types.js";

export const DEFAULT_ALIAS = "default";

export const aiSettingsSchema = z.object({
  connections: z.array(connectionSchema).default([]),
  aliases: z.array(aliasSchema).default([]),
  /** Legacy single default model (pre-aliases) — still honored as a fallback. */
  defaultModel: modelRefSchema.optional(),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export class AiConfigService {
  private settings: AiSettings = { connections: [], aliases: [] };
  private loaded = false;

  constructor(private readonly path = ".pattern-data/ai-config.json") {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = aiSettingsSchema.safeParse(JSON.parse(await readFile(this.path, "utf8")));
      if (parsed.success) this.settings = parsed.data;
    } catch {
      /* no file yet — defaults */
    }
  }

  get(): AiSettings {
    return this.settings;
  }

  connections(): Connection[] {
    return this.settings.connections;
  }

  aliases(): Alias[] {
    return this.settings.aliases;
  }

  connection(id: string): Connection | undefined {
    return this.settings.connections.find((c) => c.id === id);
  }

  alias(name: string): Alias | undefined {
    return this.settings.aliases.find((a) => a.name === name);
  }

  /** Resolve an alias to a connection-backed ModelRef (provider/routing for display). */
  resolveAlias(name: string): ModelRef | undefined {
    const a = this.alias(name);
    if (!a) return undefined;
    const conn = this.connection(a.connection);
    if (!conn) return undefined;
    return {
      kind: "model",
      routing: conn.routing,
      modality: a.modality,
      provider: conn.provider,
      modelId: a.modelId,
      connection: conn.id,
    };
  }

  /** The model agents/chat fall back to: the "default" alias, then the legacy single default. */
  defaultModel(): ModelRef | undefined {
    return this.resolveAlias(DEFAULT_ALIAS) ?? this.settings.defaultModel;
  }

  // ── Mutations (upsert by id/name; each persists) ──

  async upsertConnection(c: Connection): Promise<void> {
    const next = this.settings.connections.filter((x) => x.id !== c.id);
    next.push(connectionSchema.parse(c));
    await this.write({ ...this.settings, connections: next });
  }

  async deleteConnection(id: string): Promise<void> {
    await this.write({ ...this.settings, connections: this.settings.connections.filter((c) => c.id !== id) });
  }

  async upsertAlias(a: Alias): Promise<void> {
    const next = this.settings.aliases.filter((x) => x.name !== a.name);
    next.push(aliasSchema.parse(a));
    await this.write({ ...this.settings, aliases: next });
  }

  async deleteAlias(name: string): Promise<void> {
    await this.write({ ...this.settings, aliases: this.settings.aliases.filter((a) => a.name !== name) });
  }

  /** Replace the whole settings object (used by the load/import path). */
  async set(next: AiSettings): Promise<void> {
    await this.write(next);
  }

  private async write(next: AiSettings): Promise<void> {
    this.settings = aiSettingsSchema.parse(next);
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, JSON.stringify(this.settings, null, 2));
    } catch {
      /* read-only fs — keep the value in memory for this process */
    }
  }
}
