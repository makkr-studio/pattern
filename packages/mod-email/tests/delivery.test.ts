import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineMod, Engine } from "@pattern-js/core";
import { createHttpHost } from "@pattern-js/runtime-node";
import { identityMod } from "@pattern-js/mod-identity";
import { magicLinkMod } from "@pattern-js/mod-auth-magic-link";
import { emailMod } from "../src/index.js";
import { EMAIL_CONFIG_SERVICE, EMAIL_SERVICE } from "../src/well-known.js";
import type { EmailConfigService } from "../src/config.js";
import type { EmailService } from "../src/service.js";
import type { EmailMessage } from "../src/types.js";

/**
 * The whole point of mod-email, end to end: identity issues a sign-in link →
 * the packaged `email.deliver-token` workflow probes the "default" account →
 * unconfigured runs stay on the console fallback, configured ones send the
 * email — whose link actually signs the user in.
 */

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
  vi.restoreAllMocks();
});

async function boot(port: number) {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const dir = await mkdtemp(join(tmpdir(), "email-delivery-"));

  const sent: EmailMessage[] = [];
  const driver = { fail: false };
  const driverMod = defineMod({
    name: "test-email-driver",
    ready: (engine: Engine) => {
      engine.service<EmailService>(EMAIL_SERVICE)!.registerDriver({
        id: "test",
        label: "Test driver",
        secrets: [],
        options: [],
        send: async (message) => {
          if (driver.fail) throw new Error("driver down");
          sent.push(message);
          return { messageId: "m-1" };
        },
      });
    },
  });

  const engine = new Engine();
  const mods = [
    identityMod({ storage: "memory", signup: "open" }),
    magicLinkMod(),
    emailMod({ configPath: join(dir, "email-config.json") }),
    driverMod,
  ];
  for (const mod of mods) await engine.useAsync(mod, { deferReady: true });
  for (const mod of mods) await mod.ready?.(engine);

  const { close } = await createHttpHost(engine, { defaultPort: port }).start();
  closer = close;
  const config = engine.service<EmailConfigService>(EMAIL_CONFIG_SERVICE)!;
  return { engine, base: `http://localhost:${port}`, config, sent, driver, logSpy };
}

const requestLink = (base: string, email: string) =>
  fetch(`${base}/auth/magic-link/request`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, next: "/admin" }).toString(),
  });

const printedLink = (logSpy: ReturnType<typeof vi.spyOn>): string | undefined =>
  /(https?:\/\/\S*\/auth\/token\?t=\S+)/.exec(logSpy.mock.calls.map((c) => String(c[0])).join("\n"))?.[1];

const defaultAccount = { name: "default", provider: "test", from: "App <app@example.com>", secrets: {}, options: {} };

describe("email.deliver-token (identity.deliverToken subscriber)", () => {
  it("no account configured → console fallback, nothing sent (installing mod-email changes nothing)", async () => {
    const { base, sent, logSpy } = await boot(5101);

    const res = await requestLink(base, "ada@x.io");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Check your inbox");

    expect(printedLink(logSpy)).toContain("/auth/token?t=");
    expect(sent).toEqual([]);
  });

  it("default account configured → the link goes by email, console stays silent, and the emailed link signs in", async () => {
    const { base, config, sent, logSpy } = await boot(5102);
    await config.upsertAccount(defaultAccount);

    const res = await requestLink(base, "ada@x.io");
    expect(res.status).toBe(200);

    // The email, not the console.
    expect(printedLink(logSpy)).toBeUndefined();
    expect(sent).toHaveLength(1);
    const message = sent[0]!;
    expect(message.to).toEqual(["ada@x.io"]);
    expect(message.from).toBe("App <app@example.com>");
    expect(message.subject).toBe("Your login link");
    expect(message.html).toContain("/auth/token?t=");
    expect(message.html).toContain("display:inline-block"); // the sign-in button
    expect(message.text).toContain("single-use");

    // The emailed link is the working link: callback → 302 → session cookie → whoami.
    const link = /(https?:\/\/\S*\/auth\/token\?t=[^\s)]+)/.exec(message.text!)?.[1];
    expect(link).toContain(`${base}/auth/token?t=`);
    const cb = await fetch(link!, { redirect: "manual" });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/admin");
    const cookie = (cb.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(cookie).toMatch(/pattern_session=/);
    const who = await fetch(`${base}/auth/whoami`, { headers: { cookie } });
    expect((await who.json()).email).toBe("ada@x.io");
  });

  it("a payload another subscriber already delivered passes through untouched (no double send)", async () => {
    const { engine, config, sent } = await boot(5104 + 5); // 5109
    await config.upsertAccount(defaultAccount);

    const out = (await engine.invokeHook("identity.deliverToken", {
      email: "ada@x.io",
      url: "http://h/auth/token?t=1",
      purpose: "login",
      delivered: true, // an earlier chain member claimed it
    })) as Record<string, unknown>;
    expect(out.delivered).toBe(true);
    expect(sent).toEqual([]);
  });

  it("a broken driver never eats the link: hook fails fast → console fallback still prints", async () => {
    const { base, config, sent, driver, logSpy } = await boot(5103);
    await config.upsertAccount(defaultAccount);
    driver.fail = true;

    const res = await requestLink(base, "ada@x.io");
    expect(res.status).toBe(200);
    expect(sent).toEqual([]);
    expect(printedLink(logSpy)).toContain("/auth/token?t=");
  });
});
