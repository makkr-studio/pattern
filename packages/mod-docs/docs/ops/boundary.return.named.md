Like `boundary.return`, but the run's result is an OBJECT of named values —
declare the keys in config, wire one input per key. Use it when a
sub-workflow needs to hand back more than one thing (e.g. `{ value, score }`
to a higher-order op).
