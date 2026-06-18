// A worker-loadable mod whose op reports which thread it ran on: the main
// thread has threadId 0, a worker thread is > 0. `cpuHeavy` is the offload
// nudge tag — it routes nothing on its own; the workflow's `offload` flag does.
import { threadId } from "node:worker_threads";

export default {
  name: "whereami-mod",
  ops: [
    {
      type: "app.whereami",
      title: "app.whereami",
      cpuHeavy: true,
      inputs: { in: { kind: "value" } },
      outputs: { threadId: { kind: "value" } },
      execute: async () => ({ threadId }),
    },
  ],
};
