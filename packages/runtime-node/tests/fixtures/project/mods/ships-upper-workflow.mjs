// Exercises deferred mod-workflow registration: this mod is listed BEFORE
// upper.mjs but SHIPS a workflow (not a `ready` registration) wiring
// `app.upper`. Eager per-mod registration would fail validation ("unknown
// op"); loadMods parks mod workflows and flushes them once every mod's ops
// are in — the mod-buddy ⇄ mod-docs scaffold scenario in miniature.
export default {
  name: "ships-upper-workflow-mod",
  workflows: [
    {
      id: "seeded-greet",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["value"] } },
        { id: "up", op: "app.upper" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "value" }, to: { node: "up", port: "value" } },
        { from: { node: "up", port: "out" }, to: { node: "out", port: "value" } },
      ],
    },
  ],
};
