---
title: Author a workflow in JSON
order: 9
---

# Author a workflow in JSON

A workflow is a JSON document. You don't need the admin: drop a `.json`
file into your project's `workflows/` directory and the host loads it. This is
the same format the editor reads and writes, so the two are interchangeable.

## Anatomy

```jsonc
{
  "id": "greeting",            // unique, stable; treat it like a route name
  "name": "Hello, Pattern",    // human label (optional)
  "nodes": [
    { "id": "in",    "op": "boundary.manual", "config": { "outputs": ["name"] } },
    { "id": "greet", "op": "core.string.template", "config": { "template": "Hello, {{ name }}!" } },
    { "id": "out",   "op": "boundary.return" }
  ],
  "edges": [
    { "from": { "node": "in",    "port": "name" }, "to": { "node": "greet", "port": "data"  } },
    { "from": { "node": "greet", "port": "out"  }, "to": { "node": "out",   "port": "value" } }
  ]
}
```

- **nodes** are op instances: a local `id`, the `op` type, and an
  optional `config` validated against that op's schema. An optional `ui: { x, y }`
  holds the canvas position (data-only; ignored at runtime). Optional `title` and
  `comment` are self-documenting annotations.
- **edges** connect one node's output port to another's input port. The
  [edge kind](../concepts.md#ports-and-the-three-edge-kinds) is *derived* from the
  ports: value→value is a barrier, stream→stream is concurrent, control→control is
  a dataless sequencing pulse. You never declare the kind.

To find a port's name and kind, consult the op in the [op reference](/ops)
(or `pattern ops <type>` in the terminal): it lists every input/output port.

## Make it an HTTP route

The only change from "runs once" to "is a URL" is the boundary pair. The route
(method, path, CORS, auth, body/query validation) is **declared in the trigger's
config**, never in code:

```workflow
{
  "id": "hello-http",
  "name": "GET /hello/:name",
  "nodes": [
    { "id": "in",   "op": "boundary.http.request", "config": { "method": "GET", "path": "/hello/:name", "cors": true } },
    { "id": "msg",  "op": "core.string.template", "config": { "template": "Hello, {{ name }}!" } },
    { "id": "body", "op": "core.object.build", "config": { "keys": ["message"] } },
    { "id": "out",  "op": "boundary.http.response", "config": { "mode": "buffered" } }
  ],
  "edges": [
    { "from": { "node": "in",   "port": "params" }, "to": { "node": "msg",  "port": "data"    } },
    { "from": { "node": "msg",  "port": "out"    }, "to": { "node": "body", "port": "message" } },
    { "from": { "node": "body", "port": "out"    }, "to": { "node": "out",  "port": "body"    } }
  ]
}
```

`boundary.http.request` exposes `params`, `query`, `body`, `headers`, … as output
ports; pull the one field you need with `core.object.get` (here the route's
`:name` arrives in `params`) and keep the rest of the graph HTTP-free. The host
**derives its route table by scanning workflows**: add the file and `GET
/hello/:name` is live. See [Designing your API](designing-your-api.md) for the
discipline that keeps a clean REST surface.

## The dev loop

```bash
pattern validate workflows/hello-http.json   # located, human-readable errors
pattern graph    workflows/hello-http.json    # print the graph in the terminal
pattern dev      src/index.ts                 # run with --watch hot-reload
```

`pattern dev` watches your files and re-derives routes on every save: edit the
JSON, hit the URL, repeat. Validation is your friend: it names the offending
node/port (an unknown op, a kind mismatch, a missing trigger, a cycle) before
anything runs.

```bash
curl localhost:3000/hello/world      # {"message":"Hello, world!"}
```

## When to reach for the admin instead

Hand-authoring is great for version-controlled, code-reviewed workflows and for
anything an agent generates. For exploring the op palette, wiring by drag, live
validation, and watching runs replay, use the [visual editor](workflow-in-the-admin.md),
and export back to a file when you're happy.
