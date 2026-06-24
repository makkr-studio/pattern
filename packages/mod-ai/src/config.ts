/**
 * @pattern-js/mod-ai — persisted settings (the default model).
 *
 * The provider KEYS live in the vault (mod-vault's own Secrets screen). What
 * mod-ai persists is the chosen DEFAULT model so agents/chat run without wiring
 * an ai.model node into every graph. Stored as a small JSON file under the
 * runtime data dir; falls back to in-memory on a read-only filesystem.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "@pattern-js/core";
import { modelRefSchema, type ModelRef } from "@pattern-js/mod-agents";

export const aiSettingsSchema = z.object({
  /** The default language model for agents/chat when no ai.model is wired. */
  defaultModel: modelRefSchema.optional(),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export class AiConfigService {
  private settings: AiSettings = {};
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

  defaultModel(): ModelRef | undefined {
    return this.settings.defaultModel;
  }

  async set(next: AiSettings): Promise<void> {
    this.settings = aiSettingsSchema.parse(next);
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, JSON.stringify(this.settings, null, 2));
    } catch {
      /* read-only fs — keep the value in memory for this process */
    }
  }
}
