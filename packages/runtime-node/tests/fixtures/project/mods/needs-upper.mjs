// Exercises the two-phase mod install: this mod is listed BEFORE upper.mjs but
// its `ready` registers a workflow using `app.upper`. `setup` would crash
// (op not yet registered); `ready` runs after the whole batch, so it works.
export default {
  name: "needs-upper-mod",
  setup: (engine) => {
    if (engine.ops.has("app.upper")) throw new Error("setup must run before later mods install");
  },
  ready: async (engine) => {
    await engine.registerWorkflowAsync({
      id: "ready-greet",
      nodes: [
        { id: "in", op: "boundary.manual", config: { outputs: ["value"] } },
        { id: "up", op: "app.upper" },
        { id: "out", op: "boundary.return" },
      ],
      edges: [
        { from: { node: "in", port: "value" }, to: { node: "up", port: "value" } },
        { from: { node: "up", port: "out" }, to: { node: "out", port: "value" } },
      ],
    });
  },
};
