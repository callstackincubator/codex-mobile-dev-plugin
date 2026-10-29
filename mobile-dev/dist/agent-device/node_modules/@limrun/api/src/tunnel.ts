import * as crypto from 'crypto';
import * as net from 'net';
import { WebSocket } from 'ws';
import { nodeProxyTransport } from './internal/proxy-transport';

/**
 * Controls the verbosity of logging in the tunnel
 */
export type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'debug';

/**
 * Connection state of the tunnel
 */
export type TunnelConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

/**
 * Callback function for tunnel connection state changes
 */
export type TunnelConnectionStateCallback = (state: TunnelConnectionState) => void;

/**
 * Tunnel mode for TCP connections.
 * - 'singleton': Single TCP connection forwarded to WebSocket (default)
 * - 'multiplexed': Multiple TCP connections multiplexed over a single WebSocket
 */
export type TunnelMode = 'singleton' | 'multiplexed';

export interface Tunnel {
  address: {
    address: string;
    port: number;
  };
  close: () => void;
  /**
   * Get current WebSocket connection state
   */
  getConnectionState: () => TunnelConnectionState;
  /**
   * Register callback for WebSocket connection state changes
   * @returns A function to unregister the callback
   */
  onConnectionStateChange: (callback: TunnelConnectionStateCallback) => () => void;
}

export interface TcpTunnelOptions {
  /**
   * Maximum number of reconnection attempts
   * @default 6
   */
  maxReconnectAttempts?: number;
  /**
   * Initial reconnection delay in milliseconds
   * @default 1000
   */
  reconnectDelay?: number;
  /**
   * Maximum reconnection delay in milliseconds
   * @default 30000
   */
  maxReconnectDelay?: number;
  /**
   * Controls logging verbosity
   * @default 'info'
   */
  logLevel?: LogLevel;
  /**
   * Tunnel mode for handling TCP connections
   * - 'singleton': Single TCP connection forwarded to WebSocket (default)
   * - 'multiplexed': Multiple TCP connections multiplexed over a single WebSocket,
   *                  each packet prefixed with a 4-byte connection ID
   * @default 'singleton'
   */
  mode?: TunnelMode;
}

/**
 * Starts a persistent TCP → WebSocket proxy.
 *
 * The function creates a local TCP server that listens on an ephemeral port on
 * 127.0.0.1. When a TCP client connects, it forwards all traffic between that
 * client and `remoteURL` through an authenticated WebSocket. The server remains
 * active even after the client disconnects, allowing reconnection without
 * recreating the tunnel.
 *
 * @param remoteURL Remote WebSocket endpoint (e.g. wss://example.com/instance)
 * @param token     Bearer token sent as `Authorization` header
 * @param hostname  Optional IP address to listen on. Default is 127.0.0.1
 * @param port      Optional port number to listen on. Default is to ask Node.js
 *                  to find an available non-privileged port.
 * @param options   Optional reconnection configuration
 */
export async function startTcpTunnel(
  remoteURL: string,
  token: string,
  hostname: string,
  port: number,
  options?: TcpTunnelOptions,
): Promise<Tunnel> {
  const mode = options?.mode ?? 'singleton';

  if (mode === 'multiplexed') {
    return startMultiplexedTcpTunnel(remoteURL, token, hostname, port, options);
  }

  return startSingletonTcpTunnel(remoteURL, token, hostname, port, options);
}

/**
 * Singleton mode: Single TCP connection forwarded to WebSocket
 */
async function startSingletonTcpTunnel(
  remoteURL: string,
  token: string,
  hostname: string,
  port: number,
  options?: TcpTunnelOptions,
): Promise<Tunnel> {
  const maxReconnectAttempts = options?.maxReconnectAttempts ?? 6;
  const reconnectDelay = options?.reconnectDelay ?? 1000;
  const maxReconnectDelay = options?.maxReconnectDelay ?? 30000;
  const logLevel = options?.logLevel ?? 'info';

  const logger = {
    debug: (...args: any[]) => {
      if (logLevel === 'debug') console.log('[Tunnel]', ...args);
    },
    info: (...args: any[]) => {
      if (logLevel === 'info' || logLevel === 'debug') console.log('[Tunnel]', ...args);
    },
    warn: (...args: any[]) => {
      if (logLevel === 'warn' || logLevel === 'info' || logLevel === 'debug')
        console.warn('[Tunnel]', ...args);
    },
    error: (...args: any[]) => {
      if (logLevel !== 'none') console.error('[Tunnel]', ...args);
    },
  };

  return new Promise((resolve, reject) => {
    const server = net.createServer();

    let ws: WebSocket | undefined;
    let pingInterval: NodeJS.Timeout | undefined;
    let reconnectTimeout: NodeJS.Timeout | undefined;
    let reconnectAttempts = 0;
    let intentionalDisconnect = false;
    let tcpSocket: net.Socket | undefined;
    let connectionState: TunnelConnectionState = 'connecting';
    let sessionId: string | undefined;
    let lastError: string | undefined;

    const stateChangeCallbacks: Set<TunnelConnectionStateCallback> = new Set();

    const updateConnectionState = (newState: TunnelConnectionState): void => {
      if (connectionState !== newState) {
        connectionState = newState;
        logger.debug(`Connection state changed to: ${newState}`);
        stateChangeCallbacks.forEach((callback) => {
          try {
            callback(newState);
          } catch (err) {
            logger.error('Error in connection state callback:', err);
          }
        });
      }
    };

    const cleanup = () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = undefined;
      }
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = undefined;
      }
      if (ws) {
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'close');
        }
        ws = undefined;
      }
    };

    const close = () => {
      intentionalDisconnect = true;
      cleanup();
      updateConnectionState('disconnected');
      if (tcpSocket && !tcpSocket.destroyed) {
        tcpSocket.destroy();
      }
      if (server.listening) {
        server.close();
      }
    };

    const scheduleReconnect = (): void => {
      if (intentionalDisconnect) {
        logger.debug('Skipping reconnection (intentional disconnect)');
        return;
      }

      if (isNonRetryableError(lastError ?? '')) {
        logger.error(`Skipping reconnection (non-retryable error): ${lastError}`);
        return;
      }

      if (!tcpSocket || tcpSocket.destroyed) {
        logger.debug('Skipping reconnection (TCP socket closed)');
        return;
      }

      if (reconnectAttempts >= maxReconnectAttempts) {
        logger.error(
          `Max reconnection attempts (${maxReconnectAttempts}) reached. Closing tunnel.`,
          lastError ? `Last error: ${lastError}` : '',
        );
        close();
        return;
      }

      const currentDelay = Math.min(reconnectDelay * Math.pow(2, reconnectAttempts), maxReconnectDelay);

      reconnectAttempts++;
      logger.debug(`Scheduling reconnection attempt ${reconnectAttempts} in ${currentDelay}ms...`);
      updateConnectionState('reconnecting');

      reconnectTimeout = setTimeout(() => {
        logger.debug(`Attempting to reconnect (attempt ${reconnectAttempts})...`);
        setupWebSocket();
      }, currentDelay);
    };

    const setupWebSocket = (): void => {
      if (!tcpSocket || tcpSocket.destroyed) {
        logger.error('Cannot setup WebSocket: TCP socket is closed');
        return;
      }

      cleanup();
      updateConnectionState('connecting');

      // Append sessionId as query parameter for server-side session persistence
      const url = new URL(remoteURL);
      if (sessionId) {
        url.searchParams.set('sessionId', sessionId);
      }

      const proxyAgent = nodeProxyTransport.getWebSocketAgent(url.toString());
      ws = new WebSocket(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        ...(proxyAgent ? { agent: proxyAgent } : {}),
        perMessageDeflate: false,
      });

      ws.on('error', (err: any) => {
        const errMessage = err.message || String(err);
        lastError = errMessage;
        logger.debug('WebSocket error:', errMessage);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = undefined;
        }

        const shouldReconnect =
          !intentionalDisconnect &&
          !isNonRetryableError(lastError ?? '') &&
          connectionState !== 'disconnected';
        updateConnectionState('disconnected');

        logger.debug(`WebSocket disconnected (code=${code}, reason=${reason.toString()})`);

        // Pause TCP socket to apply backpressure - TCP will handle buffering
        if (tcpSocket && !tcpSocket.destroyed && !tcpSocket.isPaused()) {
          logger.debug('Pausing TCP socket (applying backpressure)');
          tcpSocket.pause();
        }

        if (shouldReconnect && tcpSocket && !tcpSocket.destroyed) {
          scheduleReconnect();
        } else if (isNonRetryableError(lastError ?? '')) {
          // Close entire tunnel on non-retryable errors (not just TCP socket)
          // This prevents adb from reconnecting and triggering the same error
          logger.error(`Closing tunnel due to non-retryable error: ${lastError}`);
          close();
        }
      });

      ws.on('open', () => {
        const socket = ws as WebSocket;
        logger.debug('WebSocket connected');
        reconnectAttempts = 0;
        lastError = undefined;
        updateConnectionState('connected');

        pingInterval = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            (socket as any).ping();
          }
        }, 30_000);

        // Resume TCP socket - queued data will flow through
        if (tcpSocket && tcpSocket.isPaused()) {
          logger.debug('Resuming TCP socket (releasing backpressure)');
          tcpSocket.resume();
        }

        // TCP → WS: Forward data directly
        const onTcpData = (chunk: Buffer) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(chunk);
          }
          // If WebSocket is not ready, data will queue in TCP buffers (backpressure)
        };

        // Remove old listener if exists and add new one
        tcpSocket!.removeListener('data', onTcpData);
        tcpSocket!.on('data', onTcpData);

        // WS → TCP
        socket.on('message', (data: any) => {
          if (tcpSocket && !tcpSocket.destroyed) {
            tcpSocket.write(data as Buffer);
          }
        });
      });
    };

    // TCP server error
    server.once('error', (err) => {
      close();
      reject(new Error(`TCP server error: ${err.message}`));
    });

    const getConnectionState = (): TunnelConnectionState => {
      return connectionState;
    };

    const onConnectionStateChange = (callback: TunnelConnectionStateCallback): (() => void) => {
      stateChangeCallbacks.add(callback);
      return () => {
        stateChangeCallbacks.delete(callback);
      };
    };

    // Listening
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        close();
        return reject(new Error('Failed to obtain listening address'));
      }
      resolve({
        address,
        close,
        getConnectionState,
        onConnectionStateChange,
      });
    });

    // Helper to clean up current connection but keep server alive
    const cleanupConnection = () => {
      cleanup();
      updateConnectionState('disconnected');
      if (tcpSocket && !tcpSocket.destroyed) {
        tcpSocket.destroy();
        tcpSocket = undefined;
      }
      // Reset reconnection state for next connection
      reconnectAttempts = 0;
      intentionalDisconnect = false;
      sessionId = undefined;
      lastError = undefined;
      logger.debug('Connection cleaned up, ready for new TCP connection');
    };

    // On TCP connection (can happen multiple times)
    server.on('connection', (socket) => {
      // If there's already an active connection, reject the new one
      if (tcpSocket && !tcpSocket.destroyed) {
        logger.debug('Rejecting new TCP connection - already have an active connection');
        socket.destroy();
        return;
      }

      // Generate a new sessionId for this TCP connection.
      // This ID persists across WebSocket reconnects, allowing the server
      // to associate reconnecting clients with their existing ADB session.
      sessionId = crypto.randomUUID();
      logger.debug('TCP client connected', 'sessionId', sessionId);
      tcpSocket = socket;

      // TCP socket handlers
      tcpSocket.on('close', () => {
        logger.debug('TCP socket closed by client');
        cleanupConnection();
      });

      tcpSocket.on('error', (err: any) => {
        logger.error('TCP socket error:', err);
        cleanupConnection();
      });

      // Start WebSocket connection
      setupWebSocket();
    });

    // Start listening
    server.listen(port, hostname);
  });
}

/**
 * Multiplexed mode: Multiple TCP connections multiplexed over a single WebSocket
 *
 * Each TCP connection is assigned a unique 32-bit connection ID. All data sent
 * to the WebSocket is prefixed with a 4-byte big-endian header containing the
 * connection ID. The server responds with data prefixed with the same header.
 *
 * A close signal for a connection is indicated by sending a header-only packet
 * (4 bytes with no payload) for that connection ID.
 */
async function startMultiplexedTcpTunnel(
  remoteURL: string,
  token: string,
  hostname: string,
  port: number,
  options?: TcpTunnelOptions,
): Promise<Tunnel> {
  const logLevel = options?.logLevel ?? 'info';

  const logger = {
    debug: (...args: any[]) => {
      if (logLevel === 'debug') console.log('[Tunnel:Mux]', ...args);
    },
    info: (...args: any[]) => {
      if (logLevel === 'info' || logLevel === 'debug') console.log('[Tunnel:Mux]', ...args);
    },
    warn: (...args: any[]) => {
      if (logLevel === 'warn' || logLevel === 'info' || logLevel === 'debug')
        console.warn('[Tunnel:Mux]', ...args);
    },
    error: (...args: any[]) => {
      if (logLevel !== 'none') console.error('[Tunnel:Mux]', ...args);
    },
  };

  return new Promise((resolve, reject) => {
    const server = net.createServer();

    // Map of connection ID to TCP socket
    const connections: Map<number, net.Socket> = new Map();
    // Counter for generating unique connection IDs
    let nextConnId = 1;

    let ws: WebSocket | undefined;
    let pingInterval: NodeJS.Timeout | undefined;
    let intentionalDisconnect = false;
    let connectionState: TunnelConnectionState = 'connecting';

    const stateChangeCallbacks: Set<TunnelConnectionStateCallback> = new Set();

    const updateConnectionState = (newState: TunnelConnectionState): void => {
      if (connectionState !== newState) {
        connectionState = newState;
        logger.debug(`Connection state changed to: ${newState}`);
        stateChangeCallbacks.forEach((callback) => {
          try {
            callback(newState);
          } catch (err) {
            logger.error('Error in connection state callback:', err);
          }
        });
      }
    };

    const cleanupWebSocket = () => {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = undefined;
      }
      if (ws) {
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'close');
        }
        ws = undefined;
      }
    };

    const closeAllConnections = () => {
      for (const [connId, socket] of connections) {
        logger.debug(`Closing TCP connection ${connId}`);
        if (!socket.destroyed) {
          socket.destroy();
        }
      }
      connections.clear();
    };

    const close = () => {
      intentionalDisconnect = true;
      cleanupWebSocket();
      closeAllConnections();
      updateConnectionState('disconnected');
      if (server.listening) {
        server.close();
      }
    };

    // Send close signal for a connection (header-only packet)
    const sendCloseSignal = (connId: number) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        const header = encodeConnectionHeader(connId);
        ws.send(header);
        logger.debug(`Sent close signal for connection ${connId}`);
      }
    };

    // Remove a connection from tracking
    const removeConnection = (connId: number) => {
      const socket = connections.get(connId);
      if (socket) {
        if (!socket.destroyed) {
          socket.destroy();
        }
        connections.delete(connId);
        logger.debug(`Removed connection ${connId}`);
      }
    };

    const setupWebSocket = (): Promise<void> => {
      return new Promise((resolveWs, rejectWs) => {
        cleanupWebSocket();
        updateConnectionState('connecting');

        // Build URL with mode=multiplexed query parameter
        const url = new URL(remoteURL);
        url.searchParams.set('mode', 'multiplexed');

        logger.debug(`Connecting WebSocket to: ${url.toString()}`);

        const proxyAgent = nodeProxyTransport.getWebSocketAgent(url.toString());
        ws = new WebSocket(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
          ...(proxyAgent ? { agent: proxyAgent } : {}),
          perMessageDeflate: false,
        });

        ws.on('error', (err: any) => {
          const errMessage = err.message || String(err);
          logger.error('WebSocket error:', errMessage, err.code || '');
          rejectWs(err);
        });

        ws.on('close', (code: number, reason: Buffer) => {
          if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = undefined;
          }

          updateConnectionState('disconnected');
          logger.debug(`WebSocket disconnected (code=${code}, reason=${reason.toString()})`);

          // Close all TCP connections when WebSocket closes
          closeAllConnections();
        });

        ws.on('open', () => {
          const socket = ws as WebSocket;
          logger.debug('WebSocket connected');
          updateConnectionState('connected');

          pingInterval = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              (socket as any).ping();
            }
          }, 30_000);

          // WS → TCP: Demultiplex incoming data
          socket.on('message', (data: any) => {
            const buffer = data as Buffer;
            logger.debug(`WS→TCP raw message: ${buffer.length} bytes`);
            if (buffer.length < 4) {
              logger.error('Received binary frame shorter than 4 bytes; dropping');
              return;
            }

            const connId = decodeConnectionHeader(buffer);
            const payload = buffer.subarray(4);

            // Close signal (header only, no payload)
            if (payload.length === 0) {
              logger.debug(`Received close signal for connection ${connId}`);
              removeConnection(connId);
              return;
            }

            logger.debug(
              `WS→TCP [conn=${connId}] ${payload.length} bytes: ${payload
                .subarray(0, Math.min(200, payload.length))
                .toString('utf8')
                .replace(/[\x00-\x1f]/g, '.')}`,
            );

            const tcpSocket = connections.get(connId);
            if (tcpSocket && !tcpSocket.destroyed) {
              tcpSocket.write(payload);
            } else {
              logger.debug(`Received data for unknown/closed connection ${connId}`);
            }
          });

          // WebSocket is now ready - resolve the promise
          resolveWs();
        });
      });
    };

    // TCP server error
    server.once('error', (err) => {
      close();
      reject(new Error(`TCP server error: ${err.message}`));
    });

    const getConnectionState = (): TunnelConnectionState => {
      return connectionState;
    };

    const onConnectionStateChange = (callback: TunnelConnectionStateCallback): (() => void) => {
      stateChangeCallbacks.add(callback);
      return () => {
        stateChangeCallbacks.delete(callback);
      };
    };

    // Listening
    server.once('listening', async () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        close();
        return reject(new Error('Failed to obtain listening address'));
      }

      logger.debug(`Multiplexed tunnel listening on ${address.address}:${address.port}`);

      // Start WebSocket connection and wait for it to be ready
      try {
        await setupWebSocket();
        logger.debug('WebSocket ready, tunnel fully initialized');
        resolve({
          address,
          close,
          getConnectionState,
          onConnectionStateChange,
        });
      } catch (err) {
        close();
        reject(new Error(`Failed to establish WebSocket connection: ${err}`));
      }
    });

    // On TCP connection - allow multiple connections in multiplexed mode
    server.on('connection', (socket) => {
      // Assign a unique connection ID
      const connId = nextConnId++;
      // Wrap around at 32-bit max to stay within uint32 range
      if (nextConnId > 0xffffffff) {
        nextConnId = 1;
      }

      connections.set(connId, socket);
      logger.debug(
        `New TCP connection ${connId} from ${socket.remoteAddress}:${socket.remotePort}, WS state=${ws?.readyState}, total connections=${connections.size}`,
      );

      // TCP → WS: Forward data with connection ID header
      socket.on('data', (chunk: Buffer) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          const header = encodeConnectionHeader(connId);
          const framed = Buffer.concat([header, chunk]);
          logger.debug(
            `TCP→WS [conn=${connId}] ${chunk.length} bytes: ${chunk
              .subarray(0, Math.min(200, chunk.length))
              .toString('utf8')
              .replace(/[\x00-\x1f]/g, '.')}`,
          );
          ws.send(framed, (err) => {
            if (err) {
              logger.error(`TCP→WS [conn=${connId}] send error: ${err.message}`);
            }
          });
        } else {
          logger.debug(
            `TCP→WS [conn=${connId}] WS not open (state=${ws?.readyState}), dropping ${chunk.length} bytes`,
          );
        }
        // If WebSocket is not ready, data will queue in TCP buffers (backpressure)
      });

      socket.on('close', () => {
        logger.debug(`TCP connection ${connId} closed by client`);
        sendCloseSignal(connId);
        connections.delete(connId);
      });

      socket.on('error', (err: any) => {
        logger.error(`TCP connection ${connId} error:`, err);
        sendCloseSignal(connId);
        connections.delete(connId);
      });
    });

    // Start listening
    server.listen(port, hostname);
  });
}

export const isNonRetryableError = (errMessage: string): boolean => {
  const match = errMessage.match(/Unexpected server response: (\d+)/);
  if (match && match[1]) {
    const statusCode = parseInt(match[1], 10);
    return statusCode >= 400 && statusCode < 500;
  }
  return false;
};

/**
 * Encode a 32-bit connection ID as a 4-byte big-endian header
 */
export function encodeConnectionHeader(connId: number): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(connId, 0);
  return header;
}

/**
 * Decode a 4-byte big-endian header into a 32-bit connection ID
 */
export function decodeConnectionHeader(header: Buffer): number {
  if (header.length < 4) {
    throw new Error('Header must be at least 4 bytes');
  }
  return header.readUInt32BE(0);
}
