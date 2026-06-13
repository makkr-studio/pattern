Fail the run loudly when `condition` is false (with your `message`). Use it
for invariants that should never happen — for EXPECTED failure paths prefer
`core.flow.branch` (control flow) or `core.flow.try` (error as data).
