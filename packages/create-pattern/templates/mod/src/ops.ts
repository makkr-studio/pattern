import { value, z, type OpDefinition } from "@pattern-js/core";

/**
 * The example op — replace it with your mod's real logic.
 *
 * An op is a PURE function over typed ports: declared `inputs`/`outputs`, a
 * config schema, and an `execute`. It never sees HTTP — the route below fronts
 * it. Op `type` ids are a stable public contract, so namespace yours
 * (`{{opPrefix}}.*`).
 */
export const itemsList: OpDefinition = {
  type: "{{opPrefix}}.items.list",
  title: "{{opPrefix}}.items.list",
  description: "Returns a static list of items (the example op). Replace with your mod's real logic.",
  inputs: {},
  outputs: { items: value(z.array(z.object({ id: z.string(), label: z.string() }))) },
  execute: async () => ({
    items: [
      { id: "first", label: "First item" },
      { id: "second", label: "Second item" },
    ],
  }),
};
