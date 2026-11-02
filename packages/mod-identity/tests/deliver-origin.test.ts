import { describe, it, expect } from "vitest";
import type { OpContext } from "@pattern-js/core";
import { deliverToken } from "../src/deliver.js";

describe("emailed links in production never come from the Host header", () => {
  it("refuses to build a link from the request origin without PATTERN_PUBLIC_URL", async () => {
    const ctx = { env: { NODE_ENV: "production" }, services: {} } as unknown as OpContext;
    await expect(
      deliverToken(ctx, { email: "ada@x.io", path: "/auth/token?t=abc", purpose: "login", origin: "https://evil.example" }),
    ).rejects.toThrow(/PATTERN_PUBLIC_URL is required in production/);
  });
});
