Error boundary as a node: runs the referenced sub-workflow (config `workflow`)
with the object on `input`, then pulses **`out`** (with `result`) or
**`catch`** (with `error`) instead of failing the run. Use it when a step is
allowed to fail — external calls, optional enrichment — and you want the
failure as data on a branch.
