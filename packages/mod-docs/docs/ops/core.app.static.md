The generic app descriptor: serve a registered filesystem as a static site
(with `spaFallback` for client routing). Wire this between `boundary.http.app`
and `boundary.http.app.serve` — that's a deployed frontend with zero server
code.

`filesystem` is a **name**, not a path — register the assets in a mod's setup
with `provideFilesystem(engine, "my-app", localFs("./app/dist"))`, then
reference that name here. The host resolves the app **once at registration**,
so a rebuilt SPA needs a restart; in dev, run the frontend's own dev server and
proxy the API instead (see the *Serving your own frontend* guide).
