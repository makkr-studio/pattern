The post-login landing of last resort: shown only when no app advertised a
home under core's `AUTH_HOME_URL` (the admin registers its mount there). Renders
who-you-are plus a sign-out button; an HTTP-shaped op backing `GET
/auth/welcome` that redirects anonymous callers to the login page. If you have
an app, advertise its home and users never see this.
