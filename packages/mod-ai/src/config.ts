/**
 * @pattern-js/mod-ai — persisted settings: model aliases.
 *
 * Provider KEYS live in the vault (mod-vault's Secrets screen) or in env vars.
 * What mod-ai persists is a flat list of **aliases** — memorable names
 * ("default", "mini", …), each a fully self-contained model handle (provider +
 * model id + sourced secrets + structured options), resolved by `ai.alias`.
 * Agents/chat fall back to the "default" alias when no model is wired. Stored as
 * a small JSON file under the runtime data dir; in-memory on a read-only fs.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "@pattern-js/core";
import type { ModelRef } from "@pattern-js/mod-agents";
import { aliasSchema, type Alias } from "./types.js";

export const DEFAULT_ALIAS = "default";

export const aiSettingsSchema = z.object({
  aliases: z.array(aliasSchema).default([]),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export class AiConfigService {
  private settings: AiSettings = { aliases: [] };
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

  aliases(): Alias[] {
    return this.settings.aliases;
  }

  alias(name: string): Alias | undefined {
    return this.settings.aliases.find((a) => a.name === name);
  }

  /**
   * Resolve an alias to a ModelRef. The ref carries the alias NAME so mod-ai's
   * ProviderService re-resolves the (sourced) secrets + options at run time —
   * keeping re-pointing dynamic and secret VALUES out of the value that flows on
   * edges. provider/routing/modelId are filled for display + catalog validation.
   */
  resolveAlias(name: string): ModelRef | undefined {
    const a = this.alias(name);
    if (!a) return undefined;
    return {
      kind: "model",
      routing: a.provider === "gateway" ? "gateway" : "direct",
      modality: a.modality,
      provider: a.provider,
      modelId: a.modelId,
      alias: a.name,
    };
  }

  /** The model agents/chat fall back to: the "default" alias. */
  defaultModel(): ModelRef | undefined {
    return this.resolveAlias(DEFAULT_ALIAS);
  }

  // ── Mutations (upsert by name; each persists) ──

  async upsertAlias(a: Alias): Promise<void> {
    const parsed = aliasSchema.parse(a);
    const next = this.settings.aliases.filter((x) => x.name !== parsed.name);
    next.push(parsed);
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
