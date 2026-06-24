/**
 * @pattern-js/mod-ai — the model + capability catalog.
 *
 * Sources: the static baseline (catalog-static.ts) for direct providers, plus
 * the live Vercel AI Gateway /v1/models listing when a gateway key is available
 * (refreshed on demand / from the settings page). Drives the editor's model
 * dropdowns, op-level capability validation, and the settings capability matrix.
 */

import type { ModelCapability, Modality } from "./types.js";
import { STATIC_CATALOG } from "./catalog-static.js";

export interface ModelCatalogService {
  list(opts?: { routing?: "direct" | "gateway"; modality?: Modality }): Promise<ModelCapability[]>;
  get(routing: "direct" | "gateway", id: string): Promise<ModelCapability | undefined>;
  /** Re-pull the gateway /v1/models listing (no-op without a gateway key). */
  refresh(): Promise<void>;
}

/** Map a gateway /v1/models entry to a capability descriptor (defensive about shape). */
function fromGatewayModel(m: Record<string, unknown>): ModelCapability | undefined {
  const id = typeof m.id === "string" ? m.id : undefined;
  if (!id) return undefined;
  const provider = id.includes("/") ? id.split("/")[0]! : (typeof m.provider === "string" ? m.provider : "gateway");
  const type = typeof m.modelType === "string" ? m.modelType : typeof m.type === "string" ? m.type : "language";
  const modality: Modality =
    type === "embedding" || type === "image" || type === "speech" || type === "transcription" || type === "video"
      ? (type as Modality)
      : "language";
  return {
    id,
    provider,
    routing: "gateway",
    displayName: typeof m.name === "string" ? m.name : id,
    modalities: [modality],
    capabilities: {},
  };
}

export class ModelCatalog implements ModelCatalogService {
  private gatewayModels: ModelCapability[] = [];

  /** `fetchGateway` returns the raw /v1/models `data` array; omit to stay offline. */
  constructor(private readonly fetchGateway?: () => Promise<Record<string, unknown>[]>) {}

  private all(): ModelCapability[] {
    return [...STATIC_CATALOG, ...this.gatewayModels];
  }

  async list(opts?: { routing?: "direct" | "gateway"; modality?: Modality }): Promise<ModelCapability[]> {
    return this.all().filter(
      (m) =>
        (!opts?.routing || m.routing === opts.routing) &&
        (!opts?.modality || m.modalities.includes(opts.modality)),
    );
  }

  async get(routing: "direct" | "gateway", id: string): Promise<ModelCapability | undefined> {
    return this.all().find((m) => m.routing === routing && m.id === id);
  }

  async refresh(): Promise<void> {
    if (!this.fetchGateway) return;
    try {
      const raw = await this.fetchGateway();
      this.gatewayModels = raw.map(fromGatewayModel).filter((m): m is ModelCapability => m != null);
    } catch {
      /* keep the static baseline if the gateway is unreachable */
    }
  }
}
