import { describe, it, expect } from "vitest";
import { jsonSchemaToZod } from "@pattern-js/core";

describe("jsonSchemaToZod coerce: query booleans", () => {
  const s = jsonSchemaToZod({ type: "object", properties: { flag: { type: "boolean" } } } as never, { coerce: true });
  const flag = (v: string) => (s.safeParse({ flag: v }) as { success: boolean; data?: { flag: boolean } });

  it('reads "false", "0" and "" as false (JS truthiness would make them true)', () => {
    for (const v of ["false", "FALSE", "0", "", "no", "off"]) expect(flag(v).data?.flag).toBe(false);
    for (const v of ["true", "1", "yes", "on"]) expect(flag(v).data?.flag).toBe(true);
  });

  it("refuses anything else", () => {
    expect(flag("maybe").success).toBe(false);
  });
});
