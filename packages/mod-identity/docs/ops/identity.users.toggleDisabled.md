Flip a user between disabled and enabled: disabling also revokes all their
sessions and closes their sockets, so it's the lock-out switch. It reads the
current state and inverts it (no explicit on/off arg), so two concurrent calls
cancel out. Privileged: gate the trigger with the `admin` scope. A disabled
user can't be issued a login link until re-enabled.
