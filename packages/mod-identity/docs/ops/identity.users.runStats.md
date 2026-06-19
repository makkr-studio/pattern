Per-workflow run counts (runs, errors, avg ms, last run) for one user, read
from the admin's trace sink. Feature-detected: it returns an empty list when
`@pattern/mod-admin` isn't installed, and only covers the sink's **retained
window** (a bounded ring buffer), not all-time history — so treat the numbers
as recent-activity, not an audit log. Admin plumbing routes (`__`-prefixed,
`*.route.admin.*`) are filtered out. Privileged — gate the trigger with the
`admin` scope.
