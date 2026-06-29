Run the referenced sub-workflow per element of `values` (each gets
`{ item, index }`), sequential by default or bounded-concurrent via config,
with collected `results` out. The workhorse for "do this for each X"; reach for
`core.array.map` when it's a pure transform.
