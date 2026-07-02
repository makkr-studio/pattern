If/else for graphs: evaluates `condition` and pulses **`then`** or **`else`**
(named control-outs that carry no data payload). The un-pulsed branch's whole
region is marked *skipped* and settles cleanly (skip propagates through value,
stream, and control edges; no hanging).

Wire the pulse into the first node of each branch's `in`. Remember: any node
with several wired control-ins waits for ALL of them; converge branches on a
value port (a value input with several producers resolves to whichever branch
actually ran).
