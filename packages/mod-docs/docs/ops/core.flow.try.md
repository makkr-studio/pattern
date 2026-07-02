Error boundary as a node: runs the referenced sub-workflow (config `workflow`)
with the object on `input`, then routes the outcome to **`out`** (with `result`)
on success or **`catch`** (with `error`) on failure, so the run continues either
way. Use it when a step is allowed to fail (external calls, optional enrichment)
and you want the failure as data on a branch.
