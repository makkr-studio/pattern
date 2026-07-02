Consume the bootstrap token, create the first user with the bootstrap roles
(`["admin"]` by default), and sign them in. The POST half of the first-boot
flow backing `POST /auth/bootstrap`; it accepts only a `bootstrap`-purpose
token, so it works exactly once on an empty store. Re-renders the form with an
error on a bad email.
