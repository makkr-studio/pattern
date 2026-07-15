/**
 * @pattern-js/mod-billing — public surface.
 *
 * Driver mods import the service key + spec types; apps import `billingMod`
 * (or just list the package in pattern.config.json for the defaults).
 */

export { billingMod } from "./mod.js";
export { default } from "./mod.js";

export { BILLING_SERVICE, BILLING_CONFIG_SERVICE, IDENTITY_SERVICE, STORE_SERVICE_KEY } from "./well-known.js";
export type { DocsLike, IdentityLike } from "./well-known.js";

export { BillingConfigService, DEFAULT_ACCOUNT, billingSettingsSchema, type BillingSettings } from "./config.js";
export {
  DefaultBillingService,
  CUSTOMERS_COLLECTION,
  EVENTS_COLLECTION,
  type BillingModOptions,
  type BillingService,
  type CheckoutInput,
  type IngestResult,
} from "./service.js";

export {
  BILLING_EVENT_KINDS,
  BillingSignatureError,
  billingAccountRefSchema,
  billingAccountSchema,
  isEntitled,
  secretRefSchema,
  subscriptionStatusSchema,
  type BillingAccount,
  type BillingAccountRef,
  type BillingCustomer,
  type BillingDriverInfo,
  type BillingDriverSpec,
  type BillingEvent,
  type BillingEventKind,
  type DriverCheckoutRequest,
  type DriverPortalRequest,
  type DriverUsageEvent,
  type ProviderSubscription,
  type SecretRef,
  type SubscriptionStatus,
} from "./types.js";
