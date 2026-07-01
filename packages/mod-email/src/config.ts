/**
 * @pattern-js/mod-email — persisted settings: email accounts.
 *
 * Provider CREDENTIALS live in the vault (mod-vault's Secrets screen) or in
 * env vars. What mod-email persists is a flat list of **accounts** — memorable
 * names ("default", "alerts", …), each a fully self-contained sending handle
 * (driver + from + sourced secrets + options), resolved by `email.account`.
 * The packaged delivery workflow falls back to the "default" account. Stored
 * as a small JSON file under the runtime data dir; in-memory on a read-only fs.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "@pattern-js/core";
import { accountSchema, type EmailAccount, type EmailAccountRef } from "./types.js";

export const DEFAULT_ACCOUNT = "default";

export const emailSettingsSchema = z.object({
  accounts: z.array(accountSchema).default([]),
});
export type EmailSettings = z.infer<typeof emailSettingsSchema>;

export class EmailConfigService {
  private settings: EmailSettings = { accounts: [] };
  private loaded = false;

  constructor(private readonly path = ".pattern-data/email-config.json") {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = emailSettingsSchema.safeParse(JSON.parse(await readFile(this.path, "utf8")));
      if (parsed.success) this.settings = parsed.data;
    } catch {
      /* no file yet — defaults */
    }
  }

  get(): EmailSettings {
    return this.settings;
  }

  accounts(): EmailAccount[] {
    return this.settings.accounts;
  }

  account(name: string): EmailAccount | undefined {
    return this.settings.accounts.find((a) => a.name === name);
  }

  /**
   * Resolve an account to an EmailAccountRef. The ref carries the account NAME
   * so the send path re-resolves the (sourced) secrets + options at run time —
   * keeping re-pointing dynamic and secret VALUES out of the value that flows
   * on edges. `provider` is filled for display + validation.
   */
  resolveAccount(name: string): EmailAccountRef | undefined {
    const a = this.account(name);
    if (!a) return undefined;
    return { kind: "emailAccount", account: a.name, provider: a.provider };
  }

  /** The account the delivery workflow (and tools) fall back to: "default". */
  defaultAccount(): EmailAccountRef | undefined {
    return this.resolveAccount(DEFAULT_ACCOUNT);
  }

  // ── Mutations (upsert by name; each persists) ──

  async upsertAccount(a: EmailAccount): Promise<void> {
    const parsed = accountSchema.parse(a);
    const next = this.settings.accounts.filter((x) => x.name !== parsed.name);
    next.push(parsed);
    await this.write({ ...this.settings, accounts: next });
  }

  async deleteAccount(name: string): Promise<void> {
    await this.write({ ...this.settings, accounts: this.settings.accounts.filter((a) => a.name !== name) });
  }

  private async write(next: EmailSettings): Promise<void> {
    this.settings = emailSettingsSchema.parse(next);
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, JSON.stringify(this.settings, null, 2));
    } catch {
      /* read-only fs — keep the value in memory for this process */
    }
  }
}
