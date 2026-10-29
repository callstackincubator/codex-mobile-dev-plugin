import type { Socket } from "node:net";

/**
 * Reads newline-delimited JSON from a socket. A line longer than `maxLine`, or one that
 * does not parse or that `onLine` rejects by throwing, destroys the socket with `errors`'s message.
 */
export function readJsonLines(socket: Socket, maxLine: number, onLine: (value: unknown) => void, errors: { oversized?: string; invalid?: string } = {}) {
  const destroy = (message?: string) => { socket.destroy(message === undefined ? undefined : new Error(message)); };
  let incoming = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    incoming += chunk;
    let end = incoming.indexOf("\n");
    while (end >= 0) {
      if (end > maxLine) { destroy(errors.oversized); return; }
      const line = incoming.slice(0, end);
      incoming = incoming.slice(end + 1);
      try { onLine(JSON.parse(line)); }
      catch { destroy(errors.invalid); return; }
      if (socket.destroyed) return;
      end = incoming.indexOf("\n");
    }
    if (incoming.length > maxLine) destroy(errors.oversized);
  });
}
