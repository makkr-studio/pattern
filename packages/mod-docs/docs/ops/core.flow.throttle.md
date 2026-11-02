Let a path through at most `max` times per `window`, then route the rest to
`limited`. `window` is milliseconds or a string like `"30s"`, `"15m"`, `"1h"`.
The count is per node and, when `key` is wired, per key value: an email
address, a user id, a workflow id. Over the budget, `retryAfterMs` says when
the next pass would succeed.

Use it to bound anything that costs money or attention: a notification that
could fire on every request, a provider call a user can trigger in a loop, a
reply email per inbound message. Leave `limited` unwired to drop the excess
silently, or wire it to a response that tells the caller to wait. The packaged
failure alert (`email.alert-failed-run`) keys one on the failing workflow's id
so a broken route costs one email per 10 minutes.

The window slides (the previous window's count fades out as time passes), so
a burst at a window boundary can't double the budget. Counters live in the
engine's process: a restart resets them, and each instance of a fleet counts
its own traffic. For a request-level cap that answers `429` before anything
runs, use `rateLimit` on `boundary.http.request`.
