Pass control through `out` only when `condition` is true; otherwise the path
stops here (downstream settles as skipped). The one-armed `branch`: use it to
guard a side effect, use `branch` when both outcomes need handling.
