/**
 * §12 — Base op catalog aggregation.
 *
 * `coreOps` is every op the engine ships; `registerCoreOps` installs them into a
 * registry (boundaries included). The catalog grows over time; mods add more via
 * the same registry.
 */

import type { OpDefinition } from "../types.js";
import type { OpRegistry } from "../registry.js";
import { constOps } from "./const.js";
import { scalarOps } from "./scalars.js";
import { stringOps } from "./strings.js";
import { objectOps } from "./objects.js";
import { arrayOps } from "./arrays.js";
import { flowOps } from "./flow.js";
import { dataOps } from "./data.js";
import { timeOps } from "./time.js";
import { cryptoOps } from "./crypto.js";
import { httpFetch } from "./http.js";
import { wsOps } from "./ws.js";
import { extensibilityOps } from "./extensibility.js";
import { appOps } from "./app.js";
import { schemaOps } from "./schema.js";
import { streamOps } from "../streams/ops.js";
import { boundaryOps } from "../boundaries/index.js";

/** Every base op (excluding boundaries). */
export const valueAndStreamOps: OpDefinition[] = [
  ...constOps,
  ...scalarOps,
  ...stringOps,
  ...objectOps,
  ...arrayOps,
  ...flowOps,
  ...dataOps,
  ...timeOps,
  ...cryptoOps,
  httpFetch,
  ...wsOps,
  ...extensibilityOps,
  ...appOps,
  ...schemaOps,
  ...streamOps,
];

/** Every base op including boundary triggers/out-gates. */
export const coreOps: OpDefinition[] = [...valueAndStreamOps, ...boundaryOps];

/** Register the full base catalog into a registry (idempotent-safe via has()). */
export function registerCoreOps(registry: OpRegistry): void {
  for (const op of coreOps) {
    if (!registry.has(op.type)) registry.register(op);
  }
}

export {
  constOps,
  scalarOps,
  stringOps,
  objectOps,
  arrayOps,
  flowOps,
  dataOps,
  timeOps,
  cryptoOps,
  httpFetch,
  wsOps,
  extensibilityOps,
  appOps,
  schemaOps,
  streamOps,
  boundaryOps,
};
