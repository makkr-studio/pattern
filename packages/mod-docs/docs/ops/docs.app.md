The docs SPA as an app descriptor. Wire `app` into `boundary.http.app.serve`
under a `boundary.http.app` mount; the shipped `docs.spa` workflow does this
at the configured mount (default `/docs`). Its config names the assets
`filesystem` (default `docs-assets`, the bundled build), the `spaFallback`
file, and `immutableAssets` (default true: every file except the HTML entry is served
with a one-year immutable cache header).

It emits an empty `manifest`, which tells the host to inject a `<base href>`
and `window.__APP__` with the resolved mount and `apiBase` (`{mount}/api`).
That is what lets one built bundle run under any mount. The SPA page itself
stays open regardless of `requireAuth`; it calls `docs.me` and shows its own
sign-in card when the API is gated. Same pattern as `chat.app`.
