/**
 * Pattern — in-process event bus (§8).
 *
 * Events are fire-and-forget pub/sub: asynchronous, unordered, no return value,
 * subscribers independent. The bus sits behind the `EventBus` interface so a
 * network-backed implementation can replace it without touching workflows (§4).
 */

import type { EventBus } from "../types.js";

export class InProcessEventBus implements EventBus {
  private handlers = new Map<string, Set<(payload: unknown) => void>>();

  emit(event: string, payload: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Deliver asynchronously so emit() never blocks the emitter and a throwing
    // subscriber can't take down its siblings (fire-and-forget).
    for (const handler of [...set]) {
      queueMicrotask(() => {
        try {
          handler(payload);
        } catch (err) {
          // Surface but never propagate — events are independent.
          console.error(`[pattern] event "${event}" subscriber threw:`, err);
        }
      });
    }
  }

  subscribe(event: string, handler: (payload: unknown) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }
}
