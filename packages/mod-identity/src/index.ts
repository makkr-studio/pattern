/**
 * @pattern/mod-identity — public surface.
 *
 * `identityMod(options)` is the brick; everything else is the toolbox for
 * provider mods (magic-link, oidc…) and apps that script identity directly.
 */

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
