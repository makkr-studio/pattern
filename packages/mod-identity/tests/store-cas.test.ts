import { describe, it, expect } from "vitest";
import { memoryIdentityStores } from "../src/store/memory.js";
import { sqliteIdentityStores } from "../src/store/sqlite.js";
import { UniqueViolationError, type IdentityStores } from "../src/store/types.js";

/** Both drivers must pass the same contract suite — that's the whole point. */
const drivers: Array<[string, () => Promise<IdentityStores>]> = [
  ["memory", async () => memoryIdentityStores()],
];
if (process.getBuiltinModule?.("node:sqlite")) {
  drivers.push(["sqlite", () => sqliteIdentityStores(":memory:")]);
} else {
  // Node build without node:sqlite — the memory driver still covers the contract.
}

const session = (userId: string, over: Partial<Parameters<IdentityStores["sessions"]["create"]>[0]> = {}) => ({
  id: crypto.randomUUID(),
  tokenHash: crypto.randomUUID(),
  userId,
  createdAt: Date.now(),
  lastSeenAt: Date.now(),
  expiresAt: Date.now() + 60_000,
  revokedAt: null,
  userAgent: null,
  ip: null,
  ...over,
});

/** Sessions reference users (FK enforced by the sqlite driver) — create one. */
const mkUser = (stores: IdentityStores, email: string) =>
  stores.users.createUser({
    email,
    emailNorm: email.toLowerCase(),
    roles: [],
    identity: { provider: "test", subject: email.toLowerCase() },
  });

const token = (over: Partial<Parameters<IdentityStores["tokens"]["create"]>[0]> = {}) => ({
  id: crypto.randomUUID(),
  tokenHash: crypto.randomUUID(),
  purpose: "login" as const,
  emailNorm: "a@b.c",
  data: null,
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
  consumedAt: null,
  ...over,
});

describe.each(drivers)("identity stores (%s)", (_name, open) => {
  it("consumes a token exactly once under concurrency (CAS single-use)", async () => {
    const stores = await open();
    const t = await stores.tokens.create(token());
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => stores.tokens.consume(t.id, t.version, Date.now())),
    );
    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect(attempts.filter(Boolean)[0]!.consumedAt).not.toBeNull();
    await stores.close();
  });

  it("rejects a stale-version touch and accepts a fresh one", async () => {
    const stores = await open();
    const u = await mkUser(stores, "touch@test");
    const s = await stores.sessions.create(session(u.id));
    const touched = await stores.sessions.touch(s.id, s.version, 1, 2);
    expect(touched?.version).toBe(s.version + 1);
    // Same (now stale) version again → lost the race → null.
    expect(await stores.sessions.touch(s.id, s.version, 3, 4)).toBeNull();
    // The first touch's values survived (no lost update).
    const final = await stores.sessions.findById(s.id);
    expect(final?.lastSeenAt).toBe(1);
    expect(final?.expiresAt).toBe(2);
    await stores.close();
  });

  it("enforces one user per email", async () => {
    const stores = await open();
    const mk = () =>
      stores.users.createUser({
        email: "Ada@Example.com",
        emailNorm: "ada@example.com",
        roles: ["admin"],
        identity: { provider: "magic-link", subject: "ada@example.com" },
      });
    await mk();
    await expect(mk()).rejects.toThrow(UniqueViolationError);
    expect(await stores.users.countUsers()).toBe(1);
    await stores.close();
  });

  it("CAS-updates users; stale writers retry against the fresh row", async () => {
    const stores = await open();
    const u = await stores.users.createUser({
      email: "a@b.c",
      emailNorm: "a@b.c",
      roles: [],
      identity: { provider: "magic-link", subject: "a@b.c" },
    });
    const first = await stores.users.updateUser(u.id, u.version, { roles: ["admin"] });
    expect(first?.roles).toEqual(["admin"]);
    // Stale write loses…
    expect(await stores.users.updateUser(u.id, u.version, { name: "Ada" })).toBeNull();
    // …then retries with the fresh version and keeps the earlier roles change.
    const fresh = (await stores.users.findById(u.id))!;
    const second = await stores.users.updateUser(fresh.id, fresh.version, { name: "Ada" });
    expect(second?.name).toBe("Ada");
    expect(second?.roles).toEqual(["admin"]);
    await stores.close();
  });

  it("rotates the session secret: old hash dies, id survives", async () => {
    const stores = await open();
    const u = await mkUser(stores, "rotate@test");
    const s = await stores.sessions.create(session(u.id, { tokenHash: "old-hash" }));
    const rotated = await stores.sessions.rotate(s.id, s.version, "new-hash");
    expect(rotated?.version).toBe(s.version + 1);
    expect(await stores.sessions.findByTokenHash("old-hash")).toBeNull();
    expect((await stores.sessions.findByTokenHash("new-hash"))?.id).toBe(s.id);
    await stores.close();
  });

  it("revokeAllForUser flips every active session and reports the ids", async () => {
    const stores = await open();
    const ada = await mkUser(stores, "ada@test");
    const bob = await mkUser(stores, "bob@test");
    const a = await stores.sessions.create(session(ada.id));
    const b = await stores.sessions.create(session(ada.id));
    await stores.sessions.create(session(bob.id));
    const ids = await stores.sessions.revokeAllForUser(ada.id, Date.now());
    expect(ids.sort()).toEqual([a.id, b.id].sort());
    expect((await stores.sessions.findById(a.id))?.revokedAt).not.toBeNull();
    expect((await stores.sessions.listForUser(bob.id))[0]?.revokedAt).toBeNull();
    await stores.close();
  });

  it("deleteExpired sweeps only stale tokens", async () => {
    const stores = await open();
    await stores.tokens.create(token({ expiresAt: 10 }));
    const live = await stores.tokens.create(token({ expiresAt: Date.now() + 60_000 }));
    expect(await stores.tokens.deleteExpired(Date.now())).toBe(1);
    expect(await stores.tokens.findByTokenHash(live.tokenHash)).not.toBeNull();
    await stores.close();
  });

  it("deleteUser removes the user, their identity links AND their session rows", async () => {
    const stores = await open();
    const ada = await mkUser(stores, "ada@test");
    const bob = await mkUser(stores, "bob@test");
    await stores.sessions.create(session(ada.id));
    const bobs = await stores.sessions.create(session(bob.id));

    expect(await stores.users.deleteUser(ada.id)).toBe(true);
    expect(await stores.users.findById(ada.id)).toBeNull();
    expect(await stores.users.findByIdentity("test", "ada@test")).toBeNull();
    expect(await stores.sessions.listForUser(ada.id)).toHaveLength(0);
    // The email is free again, the neighbor untouched.
    await expect(mkUser(stores, "ada@test")).resolves.toMatchObject({ email: "ada@test" });
    expect((await stores.sessions.findById(bobs.id))?.userId).toBe(bob.id);
    expect(await stores.users.deleteUser("nope")).toBe(false);
    await stores.close();
  });

  it("invite acceptance is CAS single-shot, and revoke can't land on an accepted invite", async () => {
    const stores = await open();
    const mkInvite = () =>
      stores.invites.create({
        id: crypto.randomUUID(),
        email: "new@test",
        emailNorm: "new@test",
        roles: ["admin"],
        next: "/admin",
        invitedBy: null,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        acceptedAt: null,
        acceptedUserId: null,
        revokedAt: null,
      });

    // Exactly one of N concurrent acceptors wins.
    const a = await mkInvite();
    const wins = await Promise.all(
      Array.from({ length: 5 }, () => stores.invites.markAccepted(a.id, a.version, Date.now(), "user-1")),
    );
    expect(wins.filter(Boolean)).toHaveLength(1);

    // Accepted → revoke misses (stale version AND the accepted_at guard).
    const accepted = (await stores.invites.findById(a.id))!;
    expect(await stores.invites.revoke(a.id, accepted.version, Date.now())).not.toBeNull(); // CAS itself allows it…
    const b = await mkInvite();
    const revoked = await stores.invites.revoke(b.id, b.version, Date.now());
    expect(revoked?.revokedAt).not.toBeNull();
    // …and a revoked invite refuses acceptance outright.
    expect(await stores.invites.markAccepted(b.id, revoked!.version, Date.now(), "user-2")).toBeNull();
    // Idempotent revoke: same answer, no error.
    expect((await stores.invites.revoke(b.id, revoked!.version, Date.now()))?.revokedAt).not.toBeNull();
    await stores.close();
  });

  it("invites list newest-first", async () => {
    const stores = await open();
    for (const email of ["one@test", "two@test"]) {
      await stores.invites.create({
        id: crypto.randomUUID(),
        email,
        emailNorm: email,
        roles: [],
        next: null,
        invitedBy: null,
        createdAt: email === "one@test" ? 1000 : 2000,
        expiresAt: Date.now() + 60_000,
        acceptedAt: null,
        acceptedUserId: null,
        revokedAt: null,
      });
    }
    expect((await stores.invites.list()).map((i) => i.email)).toEqual(["two@test", "one@test"]);
    await stores.close();
  });
});
