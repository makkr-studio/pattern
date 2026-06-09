# {{name}}

An HTTP API built from declarative [Pattern](https://github.com/) workflows.

```bash
npm run dev          # hot-reload server (pattern dev)
# then:
curl localhost:3000/hello/world
curl -XPOST localhost:3000/echo -H 'content-type: application/json' -d '{"message":"hi"}'
curl localhost:3000/shout/hello
```

```
{{name}}/
  pattern.config.json     # mods to load, workflows dir, http port
  mods/
    uppercase.mjs         # an app-local mod: contributes the `app.shout` op
  workflows/
    hello.json            # GET  /hello/:name
    echo.json             # POST /echo  (body validated by JSON Schema)
    shout.json            # GET  /shout/:text  (uses the mod op)
  src/index.ts            # loadProject() → start()
```

Routes are **declared in the workflow**, not in code: the
`boundary.http.request` op config holds the method, path, CORS policy, and
JSON-Schema validation for body/query. Add a `.json` to `workflows/` and the
route appears. Mods (here `mods/uppercase.mjs`, an app-local one) add ops; install
3rd-party mods from npm and list the package name in `pattern.config.json`.

Inspect any workflow's graph:

```bash
npx pattern graph workflows/hello.json
```
