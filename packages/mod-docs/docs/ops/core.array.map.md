Higher-order map: applies a **sub-workflow** (config ref) to each element.
The sub-workflow receives `{ item, index }` through a `boundary.manual`
trigger and returns `{ value }` via `boundary.return`. Each application is a
linked sub-run, visible in the admin's run view.
