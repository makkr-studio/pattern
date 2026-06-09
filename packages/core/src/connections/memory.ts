/**
 * Pattern — in-memory connection registry (§7).
 *
 * Core ships this minimal, no-socket implementation so `core.ws.*` ops are
 * testable and the engine stays runtime-neutral. `runtime-node` provides the
 * real registry bound to live WebSocket sockets. Both sit behind the
 * `ConnectionRegistry` interface so a pub/sub backplane can be added later for
 * distribution.
 */

import type { ConnectionRef, ConnectionRegistry } from "../types.js";
import { streamToIterable } from "../streams/util.js";

const idOf = (c: ConnectionRef | string): string => (typeof c === "string" ? c : c.id);

/** A sink that receives messages for a connection (the adapter wires this up). */
export type MessageSink = (data: unknown) => void;

export class InMemoryConnectionRegistry implements ConnectionRegistry {
  private sinks = new Map<string, MessageSink>();
  private rooms = new Map<string, Set<string>>();
  /** Test/inspection helper: messages captured per connection. */
  readonly outbox = new Map<string, unknown[]>();

  /** Register a live connection with the sink that delivers to it. */
  attach(id: string, sink?: MessageSink): void {
    this.sinks.set(
      id,
      sink ??
        ((data) => {
          const box = this.outbox.get(id) ?? [];
          box.push(data);
          this.outbox.set(id, box);
        }),
    );
    if (!this.outbox.has(id)) this.outbox.set(id, []);
  }

  detach(id: string): void {
    this.sinks.delete(id);
    for (const set of this.rooms.values()) set.delete(id);
  }

  async send(connection: ConnectionRef | string, data: unknown): Promise<void> {
    const id = idOf(connection);
    const sink = this.sinks.get(id);
    if (sink) sink(data);
  }

  async sendStream(connection: ConnectionRef | string, data: ReadableStream<unknown>): Promise<void> {
    for await (const chunk of streamToIterable(data)) {
      await this.send(connection, chunk);
    }
  }

  async broadcast(room: string, data: unknown): Promise<void> {
    const set = this.rooms.get(room);
    if (!set) return;
    for (const id of set) await this.send(id, data);
  }

  async join(connection: ConnectionRef | string, room: string): Promise<void> {
    const id = idOf(connection);
    let set = this.rooms.get(room);
    if (!set) {
      set = new Set();
      this.rooms.set(room, set);
    }
    set.add(id);
  }

  async leave(connection: ConnectionRef | string, room: string): Promise<void> {
    this.rooms.get(room)?.delete(idOf(connection));
  }

  async close(connection: ConnectionRef | string): Promise<void> {
    this.detach(idOf(connection));
  }

  /** Members of a room (inspection). */
  members(room: string): string[] {
    return [...(this.rooms.get(room) ?? [])];
  }
}
