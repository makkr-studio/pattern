Serve a mod's Tier-2 page source (the `module` string of a frontend page) as
`text/javascript`, looked up by the page's path slug (`/x/ai/providers`
becomes `x-ai-providers`). Its `body`, `headers` and `status` outputs wire
straight into `boundary.http.response`; an unknown slug answers 404 with a
JavaScript comment as the body. Served same-origin, the page can be
`import()`ed by the shell under a plain `script-src 'self'` policy.

Like `admin.app`, this op is unprivileged and has no scope check: page source
is UI code. Its route (`GET /admin/api/ui/page/:slug`, workflow
`admin.api.ui.page`) is public so `import()` needs no credentials, and
internal, so it stays out of the catalog. Keep secrets out of `module`
strings for that reason. You get the URLs from `admin.ui.manifest`.
