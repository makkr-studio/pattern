/**
 * Per-instance bootstrap. The host injects `window.__APP__` into the served
 * index.html (see runtime-node's injectBootstrap): the brand the `chat.app` node
 * was configured with, plus the `mount`/`apiBase` the host resolved. This is how
 * one static bundle is hosted many times with different looks and API roots.
 *
 * In `vite` dev there is no host to inject, so we fall back to the default
 * `/chat` mount the dev proxy targets.
 */
export interface AppBoot {
  /** This SPA's URL prefix, e.g. "/chat" or "/sales" ("/" at root). */
  mount: string;
  /** The SHARED backend's API root, e.g. "/chat/api" (may differ from `mount`). */
  apiBase: string;
  /** Data partition sent on scoped API calls (decoupled from the mount). */
  namespace: string;
  /** Brand accent (any CSS color) → the chat UI's `--accent`. */
  accent?: string;
  /** Instance title (document title + sidebar wordmark). */
  title?: string;
}

const injected = (globalThis as { __APP__?: Partial<AppBoot> }).__APP__ ?? {};

export const appBoot: AppBoot = {
  mount: injected.mount ?? "/chat",
  apiBase: injected.apiBase ?? "/chat/api",
  namespace: injected.namespace ?? "default",
  accent: injected.accent,
  title: injected.title,
};

/** This instance's display title (the wordmark), defaulting to "Pattern Chat". */
export const brandTitle = appBoot.title ?? "Pattern Chat";

/** Apply the instance's brand to the document (accent var + title). Call once. */
export function applyBrand(): void {
  if (appBoot.accent) document.documentElement.style.setProperty("--accent", appBoot.accent);
  document.title = brandTitle;
}
