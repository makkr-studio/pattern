Reads an environment variable from the injected env map (same source as
`$env` config interpolation), with `type` casting (string/number/integer/
boolean/json) and a `default`. Typical use: feeding a boundary's **config
port** (e.g. a route's `port`) so deployment config stays in the environment.
