/**
 * {{name}} — a subscription SaaS on Pattern.
 *
 * `pattern.config.json` wires the pieces: identity (sign-in, roles→scopes),
 * billing (checkout, the customer portal, the subscription→role bridge — see
 * mods/billing.mjs), the Stripe driver (signed webhooks), email, the store,
 * and the admin. The app itself is four file workflows in `workflows/`:
 * a landing page, a checkout route, a portal route, and the /pro page that
 * only an active subscription can open.
 */
import { loadProject } from "@pattern-js/runtime-node";

const { start } = await loadProject();

const { ports } = await start();
const base = `http://localhost:${ports[0]}`;

console.log(`◆ {{name}}`);
console.log(`  Landing ${base}/`);
console.log(`  Members ${base}/pro   (needs an active subscription)`);
console.log(`  Admin   ${base}/admin`);
