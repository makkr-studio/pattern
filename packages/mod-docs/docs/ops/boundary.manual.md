The programmatic trigger — `engine.run(workflow, { input })` seeds its
declared `outputs` ports from the run input. The default port is `value`;
declare more in config (`outputs: ["name", "count"]`) and each becomes a
typed output port.

Use it for workflows you invoke from code or tests, and as the entry point of
sub-workflows called via `ctx.invoke` (higher-order ops, workflow tools).
