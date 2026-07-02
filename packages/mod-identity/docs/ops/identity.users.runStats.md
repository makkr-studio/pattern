Per-workflow run counts (runs, errors, avg ms, last run) for one user, read
from the admin's trace sink. Feature-detected: it returns an empty list when
`@pattern-js/mod-admin` isn't installed, and covers only the sink's **retained
window** (a bounded ring buffer), so the numbers reflect recent activity and
may omit older runs. Admin plumbing routes (`__`-prefixed, `*.route.admin.*`)
are filtered out. Privileged: gate the trigger with the `admin` scope.
