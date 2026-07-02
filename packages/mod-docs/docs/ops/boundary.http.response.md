The out-gate of an HTTP workflow. Wire `status`/`headers`/`body` for a
buffered reply, or the `stream` port with `mode: "sse"` / `"chunked"` for
streaming responses (agent tokens, file bodies).

`status` defaults to **200**. Wire it only for the exceptions (or let
`boundary.http.status` map a domain outcome to it). Prefer wiring an op's single
domain output port (`member`, `client`, `state`) straight into `body`; reach for
`core.object.build` only when the response is a deliberate projection
(rename/pick/merge) or assembled from several ops.

This out-gate owns the network-OUT surface so ops don't: wire **`cookies`**
(`{ name: value | { value, maxAge, path, httpOnly, sameSite, secure } }`, a
`null` value clears) to set Set-Cookie, and **`redirect`** (a URL) to send a 302
+ Location. The op outputs a domain value (the id to persist, where to go next);
the workflow turns it into cookies/redirects here.

One subtlety worth knowing: an out-gate whose only wired input is a stream
captures it the moment it exists. On a workflow with branches (e.g. a 409
conflict path), control-gate the streaming response (wire the branch's pulse into this node's
`in`) or the dead branch serves an eternally-empty stream.
