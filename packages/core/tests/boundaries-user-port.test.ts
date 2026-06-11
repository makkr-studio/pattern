import { describe, it, expect } from "vitest";
import { boundaries, principalToUser, resolvePorts, type Principal } from "@pattern/core";

const { httpRequest, wsMessage, wsOpen, wsClose, manual } = boundaries;

describe("trigger `user` output port (§9)", () => {
  it("is declared on host-bound triggers", () => {
    expect(resolvePorts(httpRequest.outputs, {})).toHaveProperty("user");
    expect(resolvePorts(wsMessage.outputs, {})).toHaveProperty("user");
    expect(resolvePorts(wsOpen.outputs, {})).toHaveProperty("user");
    expect(resolvePorts(wsClose.outputs, {})).toHaveProperty("user");
  });

  it("survives config-derived http.request ports", () => {
    const ports = resolvePorts(httpRequest.outputs, {
      body: { type: "object" },
      query: { type: "object" },
    });
    expect(ports).toHaveProperty("user");
    expect(ports).toHaveProperty("body");
  });

  it("leaves boundary.manual alone (callers declare their own outputs)", () => {
    const ports = resolvePorts(manual.outputs, { outputs: ["value"] });
    expect(ports).not.toHaveProperty("user");
    // …but a caller CAN opt in by declaring it.
    expect(resolvePorts(manual.outputs, { outputs: ["value", "user"] })).toHaveProperty("user");
  });

  it("principalToUser flattens a user principal and nulls anonymous", () => {
    const anon: Principal = { kind: "anonymous" };
    expect(principalToUser(anon)).toBeNull();

    const principal: Principal = {
      kind: "user",
      id: "u1",
      provider: "@pattern/mod-identity",
      scopes: ["admin"],
      claims: { sessionId: "s1", email: "a@b.c", name: "Ada", roles: ["admin"] },
    };
    expect(principalToUser(principal)).toEqual({
      id: "u1",
      provider: "@pattern/mod-identity",
      email: "a@b.c",
      name: "Ada",
      scopes: ["admin"],
      claims: { sessionId: "s1", email: "a@b.c", name: "Ada", roles: ["admin"] },
    });
  });

  it("omits non-string email/name claims instead of mistyping them", () => {
    const principal: Principal = {
      kind: "user",
      id: "u2",
      provider: "test",
      claims: { email: 42, name: { nested: true } },
    };
    const user = principalToUser(principal);
    expect(user?.email).toBeUndefined();
    expect(user?.name).toBeUndefined();
    expect(user?.scopes).toEqual([]);
  });
});
