List every user with roles flattened to a comma string for table rendering.
Backs the admin Users screen. Privileged and pure: scope checks are the
trigger's job, so a route or workflow wiring it MUST stamp `requireAuth: {
scopes: ["admin"] }` on the trigger (the validator flags it otherwise). For one
user's detail use `identity.users.get`.
