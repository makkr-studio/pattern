Load one saved fixture: `{ trigger?, input?, params?, principal? }`. Its
`trigger`, `input` and `params` map directly onto `admin.run`. `admin.run`
always runs as the caller, so a stored `principal` is a record of who the
test is meant to impersonate; nothing applies it automatically. An unknown
name answers 404.

Route: `GET /admin/api/workflows/:slug/fixtures/:name`. Scope:
`workflows:read`.
