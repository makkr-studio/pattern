/**
 * An app-local mod. A mod is any module exporting a PatternMod (default export):
 * it contributes ops (and may contribute workflows, auth providers, hooks). This
 * one adds a single op, `app.shout`. List it in `pattern.config.json` under
 * `mods` and reference its ops from any workflow.
 *
 * 3rd-party mods work identically — install them from npm and list the package
 * name instead of a relative path.
 */

/** @type {import("@pattern-js/core").PatternMod} */
export default {
  name: "uppercase-mod",
  ops: [
    {
      type: "app.shout",
      title: "app.shout",
      description: "UPPERCASES a string and appends '!'.",
      inputs: { value: { kind: "value" } },
      outputs: { out: { kind: "value" } },
      execute: async (ctx) => ({ out: String(await ctx.input.value("value")).toUpperCase() + "!" }),
    },
  ],
};
