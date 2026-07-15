Stop an in-flight Buddy turn by its `turnId` (the dock's Stop button). A
streaming agent turn settles for the engine as soon as its out-gates capture,
so run-cancel can't reach it — this goes through the agents service's
per-turn AbortController instead. Idempotent: aborting a finished or unknown
turn answers `{ ok: true, aborted: false }`. Privileged: gate the trigger
with the `admin` scope.
