/**
 * {{name}} — a SaaS that takes money, on Pattern.
 *
 * `pattern.config.json` wires the pieces: identity (sign-in, roles→scopes),
 * billing (checkout, the customer portal, the payment→role bridge — see
 * mods/billing.mjs), the Stripe driver (signed webhooks), email, the store,
 * and the admin. The app itself is five file workflows in `workflows/`:
 * a landing page, a subscribe route, a one-time buy route, a portal route,
 * and the /pro page that a subscription or a lifetime purchase opens.
 */
import { loadProject } from "@pattern-js/runtime-node";

const { start } = await loadProject();

const { ports } = await start();
const base = `http://localhost:${ports[0]}`;

console.log(`◆ {{name}}`);
console.log(`  Landing ${base}/`);
console.log(`  Members ${base}/pro   (a subscription or a lifetime purchase unlocks it)`);
console.log(`  Admin   ${base}/admin`);
