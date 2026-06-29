Multi-way branch: matches `value` against the configured `cases` and pulses
the matching `case.N` control-out (or `default`). Same skip semantics as
`core.flow.branch`; un-pulsed regions settle as skipped.
