/**
 * @pattern-js/mod-billing — persisted settings: billing accounts.
 *
 * Provider CREDENTIALS live in the vault (or env vars). What mod-billing
 * persists is a flat list of **accounts** — memorable names ("default"), each
 * a self-contained payment handle (driver + sourced secrets + options),
 * resolved by `billing.account`. Stored as a small JSON file under the
 * runtime data dir; in-memory on a read-only fs. A clone of mod-email's
 * account store — same shape, same guarantees.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "@pattern-js/core";
import { billingAccountSchema, type BillingAccount, type BillingAccountRef } from "./types.js";

export const DEFAULT_ACCOUNT = "default";

export const billingSettingsSchema = z.object({
  accounts: z.array(billingAccountSchema).default([]),
});
export type BillingSettings = z.infer<typeof billingSettingsSchema>;

export class BillingConfigService {
  private settings: BillingSettings = { accounts: [] };
  private loaded = false;

  constructor(private readonly path = ".pattern-data/billing-config.json") {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = billingSettingsSchema.safeParse(JSON.parse(await readFile(this.path, "utf8")));
      if (parsed.success) this.settings = parsed.data;
    } catch {
      /* no file yet — defaults */
    }
  }

  accounts(): BillingAccount[] {
    return this.settings.accounts;
  }

  account(name: string): BillingAccount | undefined {
    return this.settings.accounts.find((a) => a.name === name);
  }

  /** Resolve to the edge-safe ref (the NAME; secrets re-resolve at call time). */
  resolveAccount(name: string): BillingAccountRef | undefined {
    const a = this.account(name);
    if (!a) return undefined;
    return { kind: "billingAccount", account: a.name, provider: a.provider };
  }

  defaultAccount(): BillingAccountRef | undefined {
    return this.resolveAccount(DEFAULT_ACCOUNT);
  }

  // ── Mutations (upsert by name; each persists) ──

  async upsertAccount(a: BillingAccount): Promise<void> {
    const parsed = billingAccountSchema.parse(a);
    const next = this.settings.accounts.filter((x) => x.name !== parsed.name);
    next.push(parsed);
    await this.write({ ...this.settings, accounts: next });
  }

  async deleteAccount(name: string): Promise<void> {
    await this.write({ ...this.settings, accounts: this.settings.accounts.filter((a) => a.name !== name) });
  }

  private async write(next: BillingSettings): Promise<void> {
    this.settings = billingSettingsSchema.parse(next);
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, JSON.stringify(this.settings, null, 2));
    } catch {
      /* read-only fs — keep the value in memory for this process */
    }
  }
}
