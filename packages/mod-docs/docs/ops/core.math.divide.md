Use for a ratio or average. It throws on a zero divisor, so guard with `core.cmp.neq` against `0` (or `core.math.max` to floor the denominator) when `b` comes from untrusted data.
