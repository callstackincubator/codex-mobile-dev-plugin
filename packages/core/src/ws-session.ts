import { WebSocket } from "ws";

/** Resolves when the socket opens; rejects if it fails or closes first. */
export function awaitOpen(socket: WebSocket, closedMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const opened = () => { cleanup(); resolve(); };
    const failed = (error: Error) => { cleanup(); reject(error); };
    const closed = () => failed(new Error(closedMessage));
    const cleanup = () => { socket.off("open", opened); socket.off("error", failed); socket.off("close", closed); };
    socket.once("open", opened); socket.once("error", failed); socket.once("close", closed);
  });
}

/** Closes the socket, terminating it if the peer has not finished closing within a second. */
export function closeGracefully(socket: WebSocket) {
  if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
  else socket.close();
  const deadline = setTimeout(() => socket.terminate(), 1000);
  deadline.unref();
  socket.once("close", () => clearTimeout(deadline));
}
