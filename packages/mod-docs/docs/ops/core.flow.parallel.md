Fan ONE control pulse out to N branches at once (control-outs `0..count-1`);
all regions start together. This is control fan-out; for running a
sub-workflow per ELEMENT use `core.flow.foreach` (which has a concurrency
knob) or `core.array.map`.
