/**
 * @pattern/mod-identity — public surface.
 *
 * `identityMod(options)` is the brick; everything else is the toolbox for
 * provider mods (magic-link, oidc…) and apps that script identity directly.
 */

export { resolveOptions, type IdentityOptions, type ResolvedIdentityOptions } from "./options.js";
export {
  DefaultIdentityService,
  type FindOrCreateInput,
  type IdentityService,
  type IssuedToken,
  type LoginMethod,
  type MintedSession,
  type ResolvedSession,
} from "./service.js";
export { sessionAuthProvider, SESSION_PROVIDER_NAME } from "./auth-provider.js";
export { parseCookies, serializeSessionCookie, clearSessionCookie } from "./cookies.js";
export { isCrossSiteWrite, isStateChanging } from "./csrf.js";
export { randomToken, sha256hex, normalizeEmail, looksLikeEmail } from "./tokens.js";
export { memoryIdentityStores } from "./store/memory.js";
export { sqliteIdentityStores } from "./store/sqlite.js";
export { KeyedMutex } from "./store/mutex.js";
export {
  UniqueViolationError,
  type IdentityStores,
  type SessionRow,
  type SessionStore,
  type TokenPurpose,
  type TokenRow,
  type TokenStore,
  type UserRow,
  type UserStore,
} from "./store/types.js";
