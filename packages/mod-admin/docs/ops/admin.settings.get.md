Read the server-side admin settings: `{ observability: { capacity, exclude,
sampleIo } }`. `capacity` is how many runs the trace store retains; `exclude`
is the workflow-id regex whose runs are never recorded (`^admin\.` until you
save your own, null for none); `sampleIo` says whether every run samples node
I/O (editor runs always do). These settings belong to the host and are shared
by every admin user. Per-browser preferences such as theme and editor layout
stay in the browser.

Change them with `admin.settings.set`.

Route: `GET /admin/api/settings`. Scope: `admin` (root).
