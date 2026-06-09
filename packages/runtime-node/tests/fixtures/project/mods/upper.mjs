// An app-local mod: contributes one op. No imports needed — a PatternMod is a
// plain object (defineMod is just an identity helper for typing).
export default {
  name: "upper-mod",
  ops: [
    {
      type: "app.upper",
      title: "app.upper",
      inputs: { value: { kind: "value" } },
      outputs: { out: { kind: "value" } },
      execute: async (ctx) => ({ out: String(await ctx.input.value("value")).toUpperCase() }),
    },
  ],
};
