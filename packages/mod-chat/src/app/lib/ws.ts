/**
 * Pattern Chat — the notification channel (WS). The runtime auto-accepts
 * upgrades on the app's port; authenticated users auto-join `user:{id}` and
 * receive {kind:"notify", type, payload} envelopes (chat.turn.updated…).
 * Anonymous sessions simply never get pushes — the SSE + replay path carries
 * them fully.
 */

export interface Notify {
  kind: "notify";
  type: string;
  payload: unknown;
  ts: number;
}

export function connectNotify(onNotify: (n: Notify) => void): () => void {
  let ws: WebSocket | undefined;
  let closed = false;
  let retry = 1000;

  const open = () => {
    if (closed) return;
    try {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}`);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(String(e.data)) as Notify;
          if (msg && msg.kind === "notify") onNotify(msg);
        } catch {
          /* not for us */
        }
      };
      ws.onopen = () => (retry = 1000);
      ws.onclose = () => {
        if (!closed) setTimeout(open, (retry = Math.min(retry * 2, 30_000)));
      };
      ws.onerror = () => ws?.close();
    } catch {
      setTimeout(open, (retry = Math.min(retry * 2, 30_000)));
    }
  };
  open();
  return () => {
    closed = true;
    ws?.close();
  };
}
