import { describe, it, expect } from "vitest";
import { DefaultIdentityService } from "../src/service.js";
import { memoryIdentityStores } from "../src/store/memory.js";
import { resolveOptions } from "../src/options.js";
import { sessionAuthProvider } from "../src/auth-provider.js";

async function setup() {
  const svc = new DefaultIdentityService(memoryIdentityStores(), resolveOptions({ touchThrottleMs: 0 }));
  const user = await svc.findOrCreateByIdentity({
    provider: "magic-link",
    subject: "ada@x.io",
    email: "ada@x.io",
    allowCreate: true,
    roles: ["admin"],
  });
  const minted = await svc.mintSession(user!.id);
  const provider = sessionAuthProvider(() => svc);
  return { svc, user: user!, minted, provider };
}

const ctx = (headers: Record<string, string>, method = "GET") => ({
  headers: new Headers(headers),
  raw: { method },
});

describe("session AuthProvider", () => {
  it("turns a valid cookie into a user principal with claims.sessionId", async () => {
    const { provider, minted, user } = await setup();
    const principal = await provider.authenticate(ctx({ cookie: `pattern_session=${minted.token}` }));
    expect(principal).toMatchObject({
      kind: "user",
      id: user.id,
      scopes: ["admin"],
      claims: { sessionId: minted.sessionId, email: "ada@x.io", roles: ["admin"] },
    });
  });

  it("passes (null) without our cookie so other providers get a turn", async () => {
    const { provider } = await setup();
    expect(await provider.authenticate(ctx({}))).toBeNull();
    expect(await provider.authenticate(ctx({ cookie: "other=1" }))).toBeNull();
  });

  it("rejects revoked sessions and disabled users", async () => {
    const { provider, svc, minted, user } = await setup();
    await svc.revokeSession(minted.sessionId);
    expect(await provider.authenticate(ctx({ cookie: `pattern_session=${minted.token}` }))).toBeNull();

    // A second admin, so the last-admin floor lets us disable the first.
    await svc.findOrCreateByIdentity({
      provider: "magic-link",
      subject: "grace@x.io",
      email: "grace@x.io",
      allowCreate: true,
      roles: ["admin"],
    });
    const second = await svc.mintSession(user.id);
    await svc.setDisabled(user.id, true);
    expect(await provider.authenticate(ctx({ cookie: `pattern_session=${second.token}` }))).toBeNull();
  });

  describe("CSRF guard", () => {
    it("refuses cross-site writes even with a valid cookie", async () => {
      const { provider, minted } = await setup();
      const cookie = `pattern_session=${minted.token}`;
      expect(
        await provider.authenticate(ctx({ cookie, "sec-fetch-site": "cross-site" }, "POST")),
      ).toBeNull();
      expect(
        await provider.authenticate(
          ctx({ cookie, origin: "https://evil.example", host: "app.example" }, "POST"),
        ),
      ).toBeNull();
    });

    it("authenticates same-origin writes and cross-site GETs", async () => {
      const { provider, minted } = await setup();
      const cookie = `pattern_session=${minted.token}`;
      expect(
        await provider.authenticate(ctx({ cookie, "sec-fetch-site": "same-origin" }, "POST")),
      ).not.toBeNull();
      // The magic-link callback IS a cross-site top-level GET — must pass.
      expect(
        await provider.authenticate(ctx({ cookie, "sec-fetch-site": "cross-site" }, "GET")),
      ).not.toBeNull();
      // Non-browser clients (no Origin, no Fetch Metadata) are not CSRF-able.
      expect(await provider.authenticate(ctx({ cookie }, "POST"))).not.toBeNull();
    });
  });
});
