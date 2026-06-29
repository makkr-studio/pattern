/**
 * Per-instance bootstrap. The host injects `window.__APP__` into the served
 * index.html (see runtime-node's injectBootstrap): the `mount`/`apiBase` it
 * resolved for this app. The docs app op opts in by carrying a `manifest`, so a
 * single built bundle works under ANY configured mount, not only `/docs`.
 *
 * In `vite` dev there is no host to inject, so we fall back to the default
 * `/docs` mount the dev server and its API proxy target.
 */
export interface AppBoot {
  /** This SPA's URL prefix, e.g. "/docs" ("/" at root). Drives the router basename. */
  mount: string;
  /** The docs API root under the mount, e.g. "/docs/api". */
  apiBase: string;
}

const injected = (globalThis as { __APP__?: Partial<AppBoot> }).__APP__ ?? {};

export const appBoot: AppBoot = {
  mount: injected.mount ?? "/docs",
  apiBase: injected.apiBase ?? "/docs/api",
};
