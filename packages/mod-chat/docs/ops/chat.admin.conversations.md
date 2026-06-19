Every chat conversation — user-owned AND guest — newest first, for the admin
"Conversations" table; guests render as `guest · a1b2c3` via the deviceId.
`privileged`-tagged and scope-free in-op: authorization is its route's job
(`requireAuth: { scopes: ["admin"] }`), so never wire it behind a public route.
Counts turns per row, which is N extra queries — the `limit` caps at 500.
