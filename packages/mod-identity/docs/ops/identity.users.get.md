One user's profile shaped for the admin details page — email, name, roles, the
**resolved scopes** (via the role→scopes map), disabled flag, created time, and
active-session count. Use this for a single user; `identity.users.list` for the
table. Privileged — gate the trigger with the `admin` scope; throws if the user
isn't found.
