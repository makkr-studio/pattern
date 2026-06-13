Mounts a static app (SPA) at a URL prefix. The trigger half of the app trio:
`boundary.http.app` (mount/cors/auth) → an app-descriptor op (e.g.
`core.app.static`, `admin.app`, `chat.app`, `docs.app`) → `boundary.http.app.serve`.
Files come from a registered filesystem; `spaFallback` serves index.html for
client-routed paths.
