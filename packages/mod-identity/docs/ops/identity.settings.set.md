Switch the signup policy between `"open"` and `"invite"` — persisted, so it
survives restarts and **overrides** the `signup` mod option (which only seeds
the initial value). This is the live switch that governs whether unknown emails
can self-register through `/auth/token` and `auth.magiclink.request`.
Privileged — gate the trigger with the `admin` scope.
