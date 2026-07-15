The caller's Buddy thread for a workflow slug: `{ slug, messages,
persistent }` — the dock loads this on mount so conversations survive
reloads. `persistent: false` means mod-store is absent and threads are
per-session only. Threads are scoped per (workflow, user); no slug means the
app-wide thread. Privileged: gate the trigger with the `admin` scope.
