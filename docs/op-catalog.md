# Op catalog

The ops `@pattern/core` ships (§12). Naming convention: `core.<area>.<op>`.
Boundary ops are `boundary.<area>.<op>`. Port glyphs: ◆ value, ≋ stream, ▸ control.

Every op also has an implicit control-in `in` and control-out `out` (not shown).
Most ops are pure value barriers; stream ops are concurrent; control-flow ops
pulse named control-outs. Higher-order array/stream ops (`map`/`filter`/`reduce`/
`find`/`some`/`every`/`partition`) take a **sub-workflow reference** in config and
apply it per element (the sub-workflow receives `{ item, index }` — `reduce` also
`{ acc }` — and returns `{ value }`).

> Note: dynamic-arity ops (e.g. `boundary.http.request`, `core.stream.split`)
> compute their ports from config; the table shows their default shape. Boundary
> ops may also expose registration-time **config ports** (not shown) — see
> [projects-and-mods.md](./projects-and-mods.md).

See [authoring-ops.md](./authoring-ops.md) to add your own.

_Auto-generated from the registry — 162 ops. Boundaries come in **pairs**: every
trigger names its out-gate partner (and vice versa) and editors create/delete
them together. The app trio (`boundary.http.app` → `core.app.static` →
`boundary.http.app.serve`) serves a static asset bundle; see
[admin-prereqs.md](./admin-prereqs.md)._

### boundary

| Op | In | Out | Control-out |
|----|----|----|----|
| `boundary.cli` | — | ◆args ◆parsed ≋stdin ◆env | — |
| `boundary.cli.exit` | ◆stdout ≋stdoutStream ◆stderr ◆code | — | — |
| `boundary.event` | — | ◆payload | — |
| `boundary.hook` | — | ◆payload | — |
| `boundary.hook.return` | ◆payload ◆stop | — | — |
| `boundary.http.app` | — | ◆mount | — |
| `boundary.http.app.serve` | ◆app | — | — |
| `boundary.http.request` | — | ◆method ◆url ◆path ◆headers ◆query ◆params ◆body | — |
| `boundary.http.response` | ◆status ◆headers ◆body ≋stream | — | — |
| `boundary.manual` | — | ◆value | — |
| `boundary.return` | ◆value | — | — |
| `boundary.return.named` | ◆value | — | — |
| `boundary.schedule` | — | ◆timestamp ◆scheduledFor | — |
| `boundary.ws.close` | — | ◆connection ◆code ◆reason | — |
| `boundary.ws.message` | — | ◆message ◆connection ◆room | — |
| `boundary.ws.open` | — | ◆connection | — |
| `boundary.ws.send` | ◆message ≋stream | — | — |

### core.app

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.app.static` | — | ◆app | — |

### core.array

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.array.append` | ◆values ◆item | ◆out | — |
| `core.array.at` | ◆values | ◆out | — |
| `core.array.chunk` | ◆values | ◆out | — |
| `core.array.concat` | ◆a ◆b | ◆out | — |
| `core.array.count` | ◆values ◆value | ◆out | — |
| `core.array.every` | ◆values | ◆out | — |
| `core.array.filter` | ◆values | ◆out | — |
| `core.array.find` | ◆values | ◆out | — |
| `core.array.first` | ◆values | ◆out | — |
| `core.array.flatMap` | ◆values | ◆out | — |
| `core.array.flatten` | ◆values | ◆out | — |
| `core.array.groupBy` | ◆values | ◆out | — |
| `core.array.includes` | ◆values ◆value | ◆out | — |
| `core.array.indexOf` | ◆values ◆value | ◆out | — |
| `core.array.join` | ◆values | ◆out | — |
| `core.array.last` | ◆values | ◆out | — |
| `core.array.length` | ◆values | ◆out | — |
| `core.array.map` | ◆values | ◆out | — |
| `core.array.partition` | ◆values | ◆pass ◆fail | — |
| `core.array.prepend` | ◆values ◆item | ◆out | — |
| `core.array.range` | — | ◆out | — |
| `core.array.reduce` | ◆values | ◆out | — |
| `core.array.reverse` | ◆values | ◆out | — |
| `core.array.slice` | ◆values | ◆out | — |
| `core.array.some` | ◆values | ◆out | — |
| `core.array.sort` | ◆values | ◆out | — |
| `core.array.unique` | ◆values | ◆out | — |
| `core.array.zip` | ◆a ◆b | ◆out | — |

### core.bool

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.bool.and` | ◆a ◆b | ◆out | — |
| `core.bool.not` | ◆a | ◆out | — |
| `core.bool.or` | ◆a ◆b | ◆out | — |
| `core.bool.xor` | ◆a ◆b | ◆out | — |

### core.cast

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.cast.coalesce` | ◆a ◆b ◆c | ◆out | — |
| `core.cast.isNull` | ◆value | ◆out | — |
| `core.cast.toBoolean` | ◆value | ◆out | — |
| `core.cast.toNumber` | ◆value | ◆out | — |
| `core.cast.toString` | ◆value | ◆out | — |
| `core.cast.typeof` | ◆value | ◆out | — |

### core.cmp

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.cmp.eq` | ◆a ◆b | ◆out | — |
| `core.cmp.gt` | ◆a ◆b | ◆out | — |
| `core.cmp.gte` | ◆a ◆b | ◆out | — |
| `core.cmp.lt` | ◆a ◆b | ◆out | — |
| `core.cmp.lte` | ◆a ◆b | ◆out | — |
| `core.cmp.neq` | ◆a ◆b | ◆out | — |

### core.const

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.const.array` | — | ◆out | — |
| `core.const.boolean` | — | ◆out | — |
| `core.const.json` | — | ◆out | — |
| `core.const.null` | — | ◆out | — |
| `core.const.number` | — | ◆out | — |
| `core.const.object` | — | ◆out | — |
| `core.const.string` | — | ◆out | — |

### core.crypto

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.crypto.hmac` | ◆value ◆key | ◆out | — |

### core.decode

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.decode.base64` | ◆value | ◆out | — |
| `core.decode.url` | ◆value | ◆out | — |

### core.encode

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.encode.base64` | ◆value | ◆out | — |
| `core.encode.url` | ◆value | ◆out | — |

### core.env

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.env` | — | ◆out | — |

### core.event

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.event.emit` | ◆payload | — | — |

### core.flow

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.flow.assert` | ◆condition | — | — |
| `core.flow.branch` | ◆condition | — | ▸then ▸else |
| `core.flow.delay` | — | — | — |
| `core.flow.foreach` | ◆values | ◆results | — |
| `core.flow.gate` | ◆condition | — | ▸out |
| `core.flow.join` | — | — | — |
| `core.flow.noop` | ◆value | ◆value | — |
| `core.flow.parallel` | — | — | — |
| `core.flow.sequence` | — | — | — |
| `core.flow.switch` | ◆value | — | ▸default |
| `core.flow.throw` | ◆data | — | — |
| `core.flow.try` | ◆input | ◆result ◆error | ▸out ▸catch |

### core.hash

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.hash` | ◆value | ◆out | — |

### core.hook

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.hook.invoke` | ◆payload | ◆payload | — |

### core.http

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.http.fetch` | ◆url ◆method ◆headers ◆body | ◆status ◆headers ◆body | — |

### core.input

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.input` | — | ◆out | — |

### core.json

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.json.parse` | ◆text | ◆out | — |
| `core.json.stringify` | ◆value | ◆out | — |

### core.log

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.log` | ◆value | ◆value | — |

### core.math

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.math.abs` | ◆a | ◆out | — |
| `core.math.add` | ◆a ◆b | ◆out | — |
| `core.math.ceil` | ◆a | ◆out | — |
| `core.math.clamp` | ◆value ◆min ◆max | ◆out | — |
| `core.math.divide` | ◆a ◆b | ◆out | — |
| `core.math.floor` | ◆a | ◆out | — |
| `core.math.max` | ◆a ◆b | ◆out | — |
| `core.math.min` | ◆a ◆b | ◆out | — |
| `core.math.modulo` | ◆a ◆b | ◆out | — |
| `core.math.multiply` | ◆a ◆b | ◆out | — |
| `core.math.pow` | ◆a ◆b | ◆out | — |
| `core.math.round` | ◆a | ◆out | — |
| `core.math.subtract` | ◆a ◆b | ◆out | — |

### core.object

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.object.build` | — | ◆out | — |
| `core.object.clone` | ◆object | ◆out | — |
| `core.object.delete` | ◆object | ◆out | — |
| `core.object.entries` | ◆object | ◆out | — |
| `core.object.fromEntries` | ◆entries | ◆out | — |
| `core.object.get` | ◆object | ◆out | — |
| `core.object.has` | ◆object | ◆out | — |
| `core.object.keys` | ◆object | ◆out | — |
| `core.object.mapValues` | ◆object | ◆out | — |
| `core.object.merge` | ◆a ◆b | ◆out | — |
| `core.object.mergeDeep` | ◆a ◆b | ◆out | — |
| `core.object.omit` | ◆object | ◆out | — |
| `core.object.pick` | ◆object | ◆out | — |
| `core.object.set` | ◆object ◆value | ◆out | — |
| `core.object.values` | ◆object | ◆out | — |

### core.query

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.query.build` | ◆object | ◆out | — |
| `core.query.parse` | ◆query | ◆out | — |

### core.random

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.random.number` | — | ◆out | — |
| `core.random.pick` | ◆values | ◆out | — |
| `core.random.uuid` | — | ◆out | — |

### core.stream

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.stream.accumulate` | ≋in | ◆out | — |
| `core.stream.emit` | ◆in | ≋out | — |
| `core.stream.filter` | ≋in | ≋out | — |
| `core.stream.map` | ≋in | ≋out | — |
| `core.stream.merge` | ≋in.0 ≋in.1 | ≋out | — |
| `core.stream.split` | ≋in | ≋out.0 ≋out.1 | — |

### core.string

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.string.concat` | ◆values | ◆out | — |
| `core.string.endsWith` | ◆value ◆search | ◆out | — |
| `core.string.includes` | ◆value ◆search | ◆out | — |
| `core.string.join` | ◆values | ◆out | — |
| `core.string.length` | ◆value | ◆out | — |
| `core.string.lower` | ◆value | ◆out | — |
| `core.string.match` | ◆value | ◆out | — |
| `core.string.pad` | ◆value | ◆out | — |
| `core.string.replace` | ◆value | ◆out | — |
| `core.string.slice` | ◆value | ◆out | — |
| `core.string.split` | ◆value | ◆out | — |
| `core.string.startsWith` | ◆value ◆search | ◆out | — |
| `core.string.template` | ◆data | ◆out | — |
| `core.string.trim` | ◆value | ◆out | — |
| `core.string.upper` | ◆value | ◆out | — |

### core.time

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.time.add` | ◆timestamp | ◆out | — |
| `core.time.diff` | ◆a ◆b | ◆out | — |
| `core.time.format` | ◆timestamp | ◆out | — |
| `core.time.now` | — | ◆out | — |
| `core.time.parse` | ◆value | ◆out | — |
| `core.time.subtract` | ◆timestamp | ◆out | — |

### core.url

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.url.build` | ◆parts | ◆out | — |
| `core.url.parse` | ◆url | ◆out | — |

### core.ws

| Op | In | Out | Control-out |
|----|----|----|----|
| `core.ws.broadcast` | ◆room ◆message | — | — |
| `core.ws.close` | ◆connection | — | — |
| `core.ws.emit` | ◆connection ◆message ≋messages | — | — |
| `core.ws.join` | ◆connection ◆room | — | — |
| `core.ws.leave` | ◆connection ◆room | — | — |

