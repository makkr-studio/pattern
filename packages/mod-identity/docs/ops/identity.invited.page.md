The invite-accepted interstitial (`GET {mount}/invited`): renders the "your
account is ready — sign in for the first time" page the token callback lands
invite acceptances on. Acceptance creates the account but deliberately mints
no session; this page explains that and hands over to the login screen with
the invite's `next` path riding along (sanitized — relative paths only), so
the first login lands where the inviting admin intended.
