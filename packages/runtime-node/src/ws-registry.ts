/**
 * @pattern/runtime-node — connection registry bound to live WebSocket sockets (§7).
 *
 * Implements core's `ConnectionRegistry` interface. Connections are host-local
 * (like a socket), so this registry is the one place that knows about sockets;
 * `core.ws.*` ops and the `boundary.ws.send` out-gate route through the interface
 * and stay socket-agnostic — a pub/sub backplane could replace this for
 * distribution without touching any workflow.
 */

import type { WebSocket } from "ws";
import type { ConnectionRef, ConnectionRegistry, Principal } from "@pattern/core";

const idOf = (c: ConnectionRef | string): string => (typeof c === "string" ? c : c.id);

function encode(data: unknown): string | Uint8Array {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return data;
  return JSON.stringify(data);
}

export class NodeConnectionRegistry implements ConnectionRegistry {
  private sockets = new Map<string, WebSocket>();
  private rooms = new Map<string, Set<string>>();
  private principals = new Map<string, Principal>();

  /** Register a freshly-opened socket; returns its connection ref. */
  add(socket: WebSocket, id: string = crypto.randomUUID(), principal?: Principal): ConnectionRef {
    this.sockets.set(id, socket);
    if (principal) this.principals.set(id, principal);
    return { id };
  }

  remove(id: string): void {
    this.sockets.delete(id);
    this.principals.delete(id);
    for (const set of this.rooms.values()) set.delete(id);
  }

  /** The principal resolved at upgrade time, fixed for the connection's life (§9). */
  principalOf(id: string): Principal | undefined {
    return this.principals.get(id);
  }

  get(id: string): WebSocket | undefined {
    return this.sockets.get(id);
  }

  async send(connection: ConnectionRef | string, data: unknown): Promise<void> {
    this.sockets.get(idOf(connection))?.send(encode(data));
  }

  async sendStream(connection: ConnectionRef | string, data: ReadableStream<unknown>): Promise<void> {
    const socket = this.sockets.get(idOf(connection));
    if (!socket) return;
    const reader = data.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        socket.send(encode(value));
      }
    } finally {
      reader.releaseLock();
    }
  }

  async broadcast(room: string, data: unknown): Promise<void> {
    const encoded = encode(data);
    for (const id of this.rooms.get(room) ?? []) this.sockets.get(id)?.send(encoded);
  }

  async join(connection: ConnectionRef | string, room: string): Promise<void> {
    let set = this.rooms.get(room);
    if (!set) this.rooms.set(room, (set = new Set()));
    set.add(idOf(connection));
  }

  async leave(connection: ConnectionRef | string, room: string): Promise<void> {
    this.rooms.get(room)?.delete(idOf(connection));
  }

  async close(connection: ConnectionRef | string, code?: number, reason?: string): Promise<void> {
    const id = idOf(connection);
    this.sockets.get(id)?.close(code, reason);
    this.remove(id);
  }

  /** Members of a room (inspection/testing). */
  members(room: string): string[] {
    return [...(this.rooms.get(room) ?? [])];
  }

  /**
   * Close every member of a room (§9: session revocation closes the session's
   * sockets via the `session:{id}` room). Copies the member list first — close
   * mutates room membership.
   */
  async closeRoom(room: string, code?: number, reason?: string): Promise<void> {
    for (const id of this.members(room)) await this.close(id, code, reason);
  }
}
