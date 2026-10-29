import { WebSocket, Data } from 'ws';
import { exec } from 'node:child_process';

import { downloadFileToLocalPath } from './internal/download-file';
import { nodeProxyTransport } from './internal/proxy-transport';
import { startTcpTunnel, isNonRetryableError } from './tunnel';
import type { Tunnel } from './tunnel';

const ANDROID_RECORDING_PATH = '/data/local/tmp/recordings/video_recording.mp4';
const ANDROID_SIGNALING_PATH = '/ws';

/**
 * Connection state of the instance client
 */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

/**
 * Callback function for connection state changes
 */
export type ConnectionStateCallback = (state: ConnectionState) => void;

function deriveEndpointWebSocketUrl(apiUrl: string): string {
  const parsed = new URL(apiUrl);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}${ANDROID_SIGNALING_PATH}`;
  return parsed.toString().replace(/\/$/, '');
}

function buildDownloadUrl(apiUrl: string): string {
  return `${apiUrl}/files?path=${encodeURIComponent(ANDROID_RECORDING_PATH)}`;
}

/**
 * A client for interacting with a Limbar instance
 */
export type InstanceClient = {
  /**
   * Take a screenshot of the current screen
   * @returns A promise that resolves to the screenshot data
   */
  screenshot: () => Promise<ScreenshotData>;
  /**
   * Fetch Android UI hierarchy from UIAutomator.
   */
  getElementTree: () => Promise<ElementTreeData>;
  /**
   * Find matching elements by Android-native selector.
   */
  findElement: (selector: AndroidSelector, limit?: number) => Promise<FindElementResult>;
  /**
   * Tap an element by selector/reference (or explicit coordinates).
   */
  tap: (target: AndroidElementTarget) => Promise<TapResult>;
  /**
   * Set text into an element or currently focused input.
   */
  setText: (target: AndroidElementTarget | undefined, text: string) => Promise<SetTextResult>;
  /**
   * Press an Android key by key name, optionally with modifiers.
   * Accepted key strings are case-insensitive and may be plain names like
   * `'BACK'`, `'ENTER'`, `'A'`, `'TAB'`, full Android constants like
   * `'KEYCODE_TAB'`, or digit strings like `'4'`.
   * Supported modifiers are `'shift'`, `'ctrl'`/`'control'`, `'alt'`/`'option'`,
   * `'meta'`/`'command'`/`'cmd'`, `'sym'`, and `'fn'`/`'function'`.
   */
  pressKey: (key: string, modifiers?: string[]) => Promise<PressKeyResult>;
  /**
   * Scroll around the entire screen.
   */
  scrollScreen: (direction: ScrollDirection, amount?: number) => Promise<ScrollResult>;
  /**
   * Scroll inside an element matched by selector/reference.
   */
  scrollElement: (
    target: AndroidElementTarget,
    direction: ScrollDirection,
    amount?: number,
  ) => Promise<ScrollResult>;
  /**
   * Open a URL/deeplink on Android.
   */
  openUrl: (url: string) => Promise<OpenUrlResult>;
  /**
   * Start recording device video. Use stopRecording() to finish the recording.
   * When provided, `quality` must be one of `5`, `6`, `7`, `8`, `9`, or `10`.
   * The server default is `5`.
   */
  startRecording: (options?: { quality?: RecordingQuality }) => Promise<void>;
  /**
   * Stop the active server-side recording.
   * If `saveTo.presignedUrl` is provided, the server uploads the completed file there before resolving.
   * If `saveTo.localPath` is provided, the client downloads the completed file to that path.
   * Returns a download URL for the completed recording.
   */
  stopRecording: (saveTo: { presignedUrl?: string; localPath?: string }) => Promise<string>;
  /** Send an application-level keepAlive message on the control websocket. */
  keepAlive: () => void;
  /**
   * Disconnect from the Limbar instance
   */
  disconnect: () => void;

  /**
   * Establish an ADB tunnel to the instance.
   * Returns the local TCP port and a cleanup function.
   */
  startAdbTunnel: () => Promise<Tunnel>;
  /**
   * Send an asset URL to the instance. The instance will download the asset
   * and process it (currently APK install is supported). Resolves on success,
   * rejects with an Error on failure.
   */
  sendAsset: (url: string, timeoutMs?: number) => Promise<void>;

  /**
   * Get current connection state
   */
  getConnectionState: () => ConnectionState;

  /**
   * Register callback for connection state changes
   * @returns A function to unregister the callback
   */
  onConnectionStateChange: (callback: ConnectionStateCallback) => () => void;
};

/**
 * Controls the verbosity of logging in the client
 */
export type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'debug';

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';
export enum RecordingQuality {
  Q5 = 5,
  Q6 = 6,
  Q7 = 7,
  Q8 = 8,
  Q9 = 9,
  Q10 = 10,
}

export type AndroidSelector = {
  resourceId?: string;
  text?: string;
  contentDesc?: string;
  className?: string;
  packageName?: string;
  index?: number;
  clickable?: boolean;
  enabled?: boolean;
  focused?: boolean;
  boundsContains?: {
    x: number;
    y: number;
  };
};

export type AndroidElementTarget = {
  selector?: AndroidSelector;
  x?: number;
  y?: number;
};

export type AndroidElementNode = {
  index?: string;
  text?: string;
  resourceId?: string;
  className?: string;
  packageName?: string;
  contentDesc?: string;
  clickable?: boolean;
  enabled?: boolean;
  focusable?: boolean;
  focused?: boolean;
  scrollable?: boolean;
  selected?: boolean;
  bounds?: string;
  parsedBounds?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    centerX: number;
    centerY: number;
  };
};

/**
 * Configuration options for creating an Instance API client
 */
export type InstanceClientOptions = {
  /**
   * HTTP base URL for the Android daemon. WebSocket control is derived from it
   * using the `/ws` path, and recording downloads use the same base URL.
   */
  apiUrl: string;
  /**
   * The URL of the ADB WebSocket endpoint.
   */
  adbUrl?: string;
  /**
   * The token to use for the WebSocket connections.
   */
  token: string;
  /**
   * Path to the ADB executable.
   * @default 'adb'
   */
  adbPath?: string;
  /**
   * Controls logging verbosity
   * @default 'info'
   */
  logLevel?: LogLevel;
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
};

type ScreenshotResponse = {
  type: 'screenshot';
  dataUri: string;
  id: string;
};

type ScreenshotData = {
  dataUri: string;
};

export type ElementTreeData = {
  xml: string;
  nodes: AndroidElementNode[];
};

export type FindElementResult = {
  elements: AndroidElementNode[];
  count: number;
};

export type TapResult = {
  x: number;
  y: number;
};

export type SetTextResult = {
  textLength: number;
};

export type PressKeyResult = {
  key: string;
};

export type ScrollResult = {
  direction: ScrollDirection;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

export type OpenUrlResult = {
  url: string;
};

type EmptyCommandResult = Record<string, never>;

type ScreenshotErrorResponse = {
  type: 'screenshotError';
  message: string;
  id: string;
};

type AssetRequest = {
  type: 'asset';
  url: string;
};

type AssetResultResponse = {
  type: 'assetResult';
  result: 'success' | 'failure' | string;
  url: string;
  message?: string;
};

type CommandError = {
  code?: string;
  message?: string;
  retriable?: boolean;
};

type ScreenshotResultMessage = {
  type: 'screenshotResult';
  id: string;
  payload?: ScreenshotData;
  error?: CommandError;
};

type GetElementTreeResultMessage = {
  type: 'getElementTreeResult';
  id: string;
  payload?: ElementTreeData;
  error?: CommandError;
};

type FindElementResultMessage = {
  type: 'findElementResult';
  id: string;
  payload?: FindElementResult;
  error?: CommandError;
};

type TapResultMessage = {
  type: 'tapResult';
  id: string;
  payload?: TapResult;
  error?: CommandError;
};

type SetTextResultMessage = {
  type: 'setTextResult';
  id: string;
  payload?: SetTextResult;
  error?: CommandError;
};

type PressKeyResultMessage = {
  type: 'pressKeyResult';
  id: string;
  payload?: PressKeyResult;
  error?: CommandError;
};

type ScrollScreenResultMessage = {
  type: 'scrollScreenResult';
  id: string;
  payload?: ScrollResult;
  error?: CommandError;
};

type ScrollElementResultMessage = {
  type: 'scrollElementResult';
  id: string;
  payload?: ScrollResult;
  error?: CommandError;
};

type OpenUrlResultMessage = {
  type: 'openUrlResult';
  id: string;
  payload?: OpenUrlResult;
  error?: CommandError;
};

type StartVideoRecordingResultMessage = {
  type: 'startRecordingResult';
  id: string;
  payload?: EmptyCommandResult;
  error?: CommandError;
};

type StopVideoRecordingResultMessage = {
  type: 'stopRecordingResult';
  id: string;
  payload?: EmptyCommandResult;
  error?: CommandError;
};

type KnownCommandResultMessage =
  | ScreenshotResultMessage
  | GetElementTreeResultMessage
  | FindElementResultMessage
  | TapResultMessage
  | SetTextResultMessage
  | PressKeyResultMessage
  | ScrollScreenResultMessage
  | ScrollElementResultMessage
  | OpenUrlResultMessage
  | StartVideoRecordingResultMessage
  | StopVideoRecordingResultMessage;

type ServerMessage =
  | ScreenshotResponse
  | ScreenshotErrorResponse
  | AssetResultResponse
  | KnownCommandResultMessage
  | { type: string; [key: string]: unknown };

type CommandRequestMap = {
  screenshot: {};
  getElementTree: {};
  findElement: { selector: AndroidSelector; limit?: number };
  tap: AndroidElementTarget;
  setText: { text: string } & AndroidElementTarget;
  pressKey: { keyName?: string; key?: string; modifiers?: string[] };
  scrollScreen: { direction: ScrollDirection; amount?: number };
  scrollElement: AndroidElementTarget & { direction: ScrollDirection; amount?: number };
  openUrl: { url: string };
  startRecording: { quality?: RecordingQuality };
  stopRecording: { upload?: { presignedUrl: string } };
};

type CommandResultMap = {
  screenshot: ScreenshotData;
  getElementTree: ElementTreeData;
  findElement: FindElementResult;
  tap: TapResult;
  setText: SetTextResult;
  pressKey: PressKeyResult;
  scrollScreen: ScrollResult;
  scrollElement: ScrollResult;
  openUrl: OpenUrlResult;
  startRecording: EmptyCommandResult;
  stopRecording: EmptyCommandResult;
};

type PendingRequest<T> = {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
};

/**
 * Creates a client for interacting with a Limbar instance
 * @param options Configuration options including webrtcUrl, token and log level
 * @returns An InstanceClient for controlling the instance
 */
export async function createInstanceClient(options: InstanceClientOptions): Promise<InstanceClient> {
  const endpointWebSocketUrl = deriveEndpointWebSocketUrl(options.apiUrl);
  const serverAddress = `${endpointWebSocketUrl}?token=${options.token}`;
  const recordingApiUrl = options.apiUrl;
  const logLevel = options.logLevel ?? 'info';
  const maxReconnectAttempts = options.maxReconnectAttempts ?? 6;
  const reconnectDelay = options.reconnectDelay ?? 1000;
  const maxReconnectDelay = options.maxReconnectDelay ?? 30000;

  let ws: WebSocket | undefined = undefined;
  let connectionState: ConnectionState = 'connecting';
  let reconnectAttempts = 0;
  let reconnectTimeout: NodeJS.Timeout | undefined;
  let intentionalDisconnect = false;
  let lastError: string | undefined;
  const pendingRequests: Map<string, PendingRequest<unknown>> = new Map();
  const pendingAssetRequestsByUrl: Map<string, Array<PendingRequest<void>>> = new Map();

  const stateChangeCallbacks: Set<ConnectionStateCallback> = new Set();

  const logger = {
    debug: (...args: any[]) => {
      if (logLevel === 'debug') console.log('[Endpoint]', ...args);
    },
    info: (...args: any[]) => {
      if (logLevel === 'info' || logLevel === 'debug') console.log('[Endpoint]', ...args);
    },
    warn: (...args: any[]) => {
      if (logLevel === 'warn' || logLevel === 'info' || logLevel === 'debug')
        console.warn('[Endpoint]', ...args);
    },
    error: (...args: any[]) => {
      if (logLevel !== 'none') console.error('[Endpoint]', ...args);
    },
  };

  const updateConnectionState = (newState: ConnectionState): void => {
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

  const failPendingRequests = (reason: string): void => {
    pendingRequests.forEach((request) => {
      clearTimeout(request.timeout);
      request.reject(new Error(reason));
    });
    pendingRequests.clear();
    pendingAssetRequestsByUrl.forEach((requests) => {
      requests.forEach((request) => {
        clearTimeout(request.timeout);
        request.reject(new Error(reason));
      });
    });
    pendingAssetRequestsByUrl.clear();
  };

  const cleanup = (): void => {
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
        ws.close();
      }
      ws = undefined;
    }
  };

  let pingInterval: NodeJS.Timeout | undefined;
  let requestCounter = 0;
  const keepAliveSessionId =
    Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

  return new Promise<InstanceClient>((resolveConnection, rejectConnection) => {
    let hasResolved = false;

    const nextRequestId = (prefix: string): string => {
      requestCounter += 1;
      return `${prefix}-${Date.now()}-${requestCounter}`;
    };

    const resolvePendingRequest = <T>(id: string, value: T): void => {
      const request = pendingRequests.get(id) as PendingRequest<T> | undefined;
      if (!request) {
        logger.debug(`Received response for unknown/already-settled request: ${id}`);
        return;
      }
      clearTimeout(request.timeout);
      pendingRequests.delete(id);
      request.resolve(value);
    };

    const rejectPendingRequest = (id: string, error: Error): void => {
      const request = pendingRequests.get(id);
      if (!request) {
        logger.debug(`Received error for unknown/already-settled request: ${id}`);
        return;
      }
      clearTimeout(request.timeout);
      pendingRequests.delete(id);
      request.reject(error);
    };

    const extractErrorMessage = (message: ServerMessage): string | undefined => {
      if ('message' in message && typeof message.message === 'string') {
        return message.message;
      }
      if ('error' in message && message.error && typeof message.error === 'object') {
        const obj = message.error as CommandError;
        if (typeof obj.message === 'string' && obj.message) {
          return obj.message;
        }
        if (typeof obj.code === 'string' && obj.code) {
          return obj.code;
        }
        // Presence of an error object itself is treated as failure, even if message/code are absent.
        return `Server returned ${String(message.type)} with an error payload but no error message/code`;
      }
      return undefined;
    };

    const isKnownCommandResultMessage = (message: ServerMessage): message is KnownCommandResultMessage => {
      if (!('type' in message) || typeof message.type !== 'string') {
        return false;
      }
      switch (message.type) {
        case 'screenshotResult':
        case 'getElementTreeResult':
        case 'findElementResult':
        case 'tapResult':
        case 'setTextResult':
        case 'pressKeyResult':
        case 'scrollScreenResult':
        case 'scrollElementResult':
        case 'openUrlResult':
        case 'startRecordingResult':
        case 'stopRecordingResult':
          return 'id' in message && typeof message.id === 'string';
        default:
          return false;
      }
    };

    const sendRequest = async <K extends keyof CommandRequestMap>(
      type: K,
      params: CommandRequestMap[K],
      timeoutMs: number = 30000,
    ): Promise<CommandResultMap[K]> => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('WebSocket is not connected or connection is not open.'));
      }
      const id = nextRequestId('ts-client');
      const command =
        Object.keys(params).length > 0 ? { type, id, ...params, payload: params } : { type, id };
      return new Promise<CommandResultMap[K]>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id);
            reject(new Error(`Request ${type} timed out`));
          }
        }, timeoutMs);
        pendingRequests.set(id, {
          resolve: (value: unknown) => resolve(value as CommandResultMap[K]),
          reject: (reason: Error) => reject(reason),
          timeout,
        });
        ws!.send(JSON.stringify(command), (err?: Error) => {
          if (err) {
            clearTimeout(timeout);
            pendingRequests.delete(id);
            reject(err);
          }
        });
      });
    };

    // Reconnection logic with exponential backoff
    const scheduleReconnect = (): void => {
      if (intentionalDisconnect) {
        logger.debug('Skipping reconnection (intentional disconnect)');
        return;
      }

      if (isNonRetryableError(lastError ?? '')) {
        logger.debug('Skipping reconnection (non-retryable error)');
        return;
      }

      if (reconnectAttempts >= maxReconnectAttempts) {
        logger.error(
          `Max reconnection attempts (${maxReconnectAttempts}) reached. Giving up.`,
          lastError ? `Last error: ${lastError}` : '',
        );
        updateConnectionState('disconnected');
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
      cleanup();
      updateConnectionState('connecting');

      const proxyAgent = nodeProxyTransport.getWebSocketAgent(serverAddress);
      ws = new WebSocket(serverAddress, proxyAgent ? { agent: proxyAgent } : {});

      ws.on('message', (data: Data) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(data.toString());
        } catch (e) {
          logger.error({ data, error: e }, 'Failed to parse JSON message');
          return;
        }

        switch (message.type) {
          case 'screenshot': {
            if (!('dataUri' in message) || typeof message.dataUri !== 'string' || !('id' in message)) {
              logger.warn('Received invalid screenshot message:', message);
              break;
            }
            const screenshotMessage = message as ScreenshotResponse;
            logger.debug(`Received screenshot data URI for request ${screenshotMessage.id}.`);
            resolvePendingRequest<ScreenshotData>(screenshotMessage.id, {
              dataUri: screenshotMessage.dataUri,
            });
            break;
          }
          case 'screenshotResult': {
            const resultMessage = message as ScreenshotResultMessage;
            const errorMessage = extractErrorMessage(resultMessage);
            if (errorMessage) {
              rejectPendingRequest(resultMessage.id, new Error(errorMessage));
              break;
            }
            const dataUri =
              typeof resultMessage.payload?.dataUri === 'string' ? resultMessage.payload.dataUri : '';
            if (!dataUri) {
              rejectPendingRequest(
                resultMessage.id,
                new Error('Received screenshotResult without payload.dataUri'),
              );
              break;
            }
            resolvePendingRequest<ScreenshotData>(resultMessage.id, { dataUri });
            break;
          }
          case 'screenshotError': {
            if (!('message' in message) || !('id' in message)) {
              logger.warn('Received invalid screenshot error message:', message);
              break;
            }
            const errorMessage = message as ScreenshotErrorResponse;
            logger.error(
              `Server reported an error capturing screenshot for request ${errorMessage.id}:`,
              errorMessage.message,
            );
            rejectPendingRequest(errorMessage.id, new Error(errorMessage.message));
            break;
          }
          case 'assetResult': {
            logger.debug('Received assetResult:', message);
            const url = message.url as string;
            const queue = pendingAssetRequestsByUrl.get(url);
            if (!queue || queue.length === 0) {
              logger.warn(`Received assetResult for unknown or already handled url: ${message.url}`);
              break;
            }
            const request = queue.shift()!;
            if (queue.length === 0) {
              pendingAssetRequestsByUrl.delete(url);
            } else {
              pendingAssetRequestsByUrl.set(url, queue);
            }
            clearTimeout(request.timeout);
            if (message.result === 'success') {
              logger.debug('Asset result is success');
              request.resolve();
              break;
            }
            const assetErrorMessage =
              typeof message.message === 'string' && message.message ?
                message.message
              : `Asset processing failed: ${JSON.stringify(message)}`;
            logger.debug('Asset result is failure', assetErrorMessage);
            request.reject(new Error(assetErrorMessage));
            break;
          }
          default: {
            if (isKnownCommandResultMessage(message)) {
              const err = extractErrorMessage(message);
              if (err) {
                rejectPendingRequest(message.id, new Error(err));
              } else {
                resolvePendingRequest(message.id, message.payload ?? message);
              }
              break;
            }
            logger.warn(`Received unexpected message type: ${message.type}`);
            break;
          }
        }
      });

      ws.on('error', (err: Error) => {
        const errMessage = err.message;
        lastError = errMessage;
        logger.debug('WebSocket error:', errMessage);
        if (!hasResolved && (ws?.readyState === WebSocket.CONNECTING || ws?.readyState === WebSocket.OPEN)) {
          rejectConnection(err);
        }
      });

      ws.on('close', () => {
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = undefined;
        }

        const shouldReconnect =
          !intentionalDisconnect &&
          !isNonRetryableError(lastError ?? '') &&
          connectionState !== 'disconnected';
        updateConnectionState('disconnected');

        logger.debug('Disconnected from server.');

        failPendingRequests('Connection closed');

        if (shouldReconnect) {
          scheduleReconnect();
        } else if (isNonRetryableError(lastError ?? '')) {
          logger.error(`Closing connection due to non-retryable error: ${lastError}`);
          cleanup();
          updateConnectionState('disconnected');
          failPendingRequests('Non-retryable error');
          logger.debug('Non-retryable error. Closing connection.');
        }
      });

      ws.on('open', () => {
        logger.debug(`Connected to ${serverAddress}`);
        reconnectAttempts = 0;
        lastError = undefined;
        updateConnectionState('connected');

        pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            (ws as any).ping();
          }
        }, 30_000);

        if (!hasResolved) {
          hasResolved = true;
          resolveConnection({
            screenshot,
            getElementTree,
            findElement,
            tap,
            setText,
            pressKey,
            scrollScreen,
            scrollElement,
            openUrl,
            startRecording,
            stopRecording,
            keepAlive,
            disconnect,
            startAdbTunnel,
            sendAsset,
            getConnectionState,
            onConnectionStateChange,
          });
        }
      });
    };

    const screenshot = async (): Promise<ScreenshotData> => {
      return sendRequest('screenshot', {});
    };

    const getElementTree = async (): Promise<ElementTreeData> => {
      const result = await sendRequest('getElementTree', {});
      return {
        xml: typeof result.xml === 'string' ? result.xml : '',
        nodes: Array.isArray(result.nodes) ? result.nodes : [],
      };
    };

    const findElement = async (selector: AndroidSelector, limit = 20): Promise<FindElementResult> => {
      const result = await sendRequest('findElement', { selector, limit });
      const elements = Array.isArray(result.elements) ? result.elements : [];
      return {
        elements,
        count: typeof result.count === 'number' ? result.count : elements.length,
      };
    };

    const tap = async (target: AndroidElementTarget): Promise<TapResult> => {
      const result = await sendRequest('tap', target);
      return {
        x: Number(result.x ?? 0),
        y: Number(result.y ?? 0),
      };
    };

    const setText = async (
      target: AndroidElementTarget | undefined,
      text: string,
    ): Promise<SetTextResult> => {
      const payload: CommandRequestMap['setText'] = { text };
      if (target?.selector) payload.selector = target.selector;
      if (typeof target?.x === 'number') payload.x = target.x;
      if (typeof target?.y === 'number') payload.y = target.y;
      const result = await sendRequest('setText', payload);
      return {
        textLength: Number(result.textLength ?? text.length),
      };
    };

    const pressKey = async (key: string, modifiers?: string[]): Promise<PressKeyResult> => {
      const payload: CommandRequestMap['pressKey'] = {
        keyName: key,
        ...(modifiers ? { modifiers } : {}),
      };
      const result = await sendRequest('pressKey', payload);
      return {
        key: typeof result.key === 'string' ? result.key : String(key),
      };
    };

    const scrollScreen = async (direction: ScrollDirection, amount = 6): Promise<ScrollResult> => {
      const result = await sendRequest('scrollScreen', { direction, amount });
      return result;
    };

    const scrollElement = async (
      target: AndroidElementTarget,
      direction: ScrollDirection,
      amount = 6,
    ): Promise<ScrollResult> => {
      const result = await sendRequest('scrollElement', {
        ...target,
        direction,
        amount,
      });
      return result;
    };

    const openUrl = async (url: string): Promise<OpenUrlResult> => {
      const result = await sendRequest('openUrl', { url });
      return {
        url: typeof result.url === 'string' ? result.url : url,
      };
    };

    const startRecording = async (recordingOptions?: { quality?: RecordingQuality }): Promise<void> => {
      const request: CommandRequestMap['startRecording'] = {};
      if (recordingOptions?.quality !== undefined) {
        if (
          !Number.isInteger(recordingOptions.quality) ||
          recordingOptions.quality < 5 ||
          recordingOptions.quality > 10
        ) {
          throw new Error('quality must be one of: 5, 6, 7, 8, 9, 10');
        }
        request.quality = recordingOptions.quality;
      }
      await sendRequest('startRecording', request);
    };

    const stopRecording = async (saveTo: { presignedUrl?: string; localPath?: string }): Promise<string> => {
      const request: CommandRequestMap['stopRecording'] = {};
      if (saveTo.presignedUrl) {
        request.upload = { presignedUrl: saveTo.presignedUrl };
      }
      await sendRequest('stopRecording', request);
      const downloadUrl = buildDownloadUrl(recordingApiUrl);
      if (saveTo.localPath) {
        await downloadFileToLocalPath(downloadUrl, options.token, saveTo.localPath);
      }
      return downloadUrl;
    };

    const keepAlive = (): void => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      ws.send(
        JSON.stringify({
          type: 'keepAlive',
          sessionId: keepAliveSessionId,
        }),
      );
    };

    const disconnect = (): void => {
      intentionalDisconnect = true;
      cleanup();
      updateConnectionState('disconnected');
      failPendingRequests('Intentional disconnect');
      logger.debug('Intentionally disconnected from WebSocket.');
    };

    const getConnectionState = (): ConnectionState => {
      return connectionState;
    };

    const onConnectionStateChange = (callback: ConnectionStateCallback): (() => void) => {
      stateChangeCallbacks.add(callback);
      return () => {
        stateChangeCallbacks.delete(callback);
      };
    };

    /**
     * Opens a WebSocket TCP proxy for the ADB port and connects the local adb
     * client to it.
     */
    const startAdbTunnel = async (): Promise<Tunnel> => {
      if (!options.adbUrl) {
        throw new Error('adbUrl is required to start an ADB tunnel.');
      }
      const tunnel = await startTcpTunnel(options.adbUrl, options.token, '127.0.0.1', 0, {
        maxReconnectAttempts,
        reconnectDelay,
        maxReconnectDelay,
        logLevel,
      });
      try {
        await new Promise<void>((resolve, reject) => {
          exec(
            `${options.adbPath ?? 'adb'} connect ${tunnel.address.address}:${tunnel.address.port}`,
            (err) => {
              if (err) return reject(err);
              resolve();
            },
          );
        });
        logger.debug(`ADB connected on ${tunnel.address.address}`);
      } catch (err) {
        tunnel.close();
        throw err;
      }
      return tunnel;
    };

    const sendAsset = async (url: string, timeoutMs?: number): Promise<void> => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('WebSocket is not connected or connection is not open.'));
      }
      const assetRequest: AssetRequest = {
        type: 'asset',
        url,
      };
      return new Promise<void>((resolve, reject) => {
        let request: PendingRequest<void>;
        const timeout = setTimeout(() => {
          const queue = pendingAssetRequestsByUrl.get(url);
          if (!queue) {
            return;
          }
          const idx = queue.indexOf(request);
          if (idx >= 0) {
            queue.splice(idx, 1);
            reject(new Error(`Request asset timed out for url: ${url}`));
          }
          if (queue.length === 0) {
            pendingAssetRequestsByUrl.delete(url);
          } else {
            pendingAssetRequestsByUrl.set(url, queue);
          }
        }, timeoutMs ?? 120_000);
        request = {
          resolve,
          reject: (reason: Error) => reject(reason),
          timeout,
        };
        const queue = pendingAssetRequestsByUrl.get(url) ?? [];
        queue.push(request);
        pendingAssetRequestsByUrl.set(url, queue);
        ws!.send(JSON.stringify(assetRequest), (err?: Error) => {
          if (err) {
            clearTimeout(timeout);
            const queued = pendingAssetRequestsByUrl.get(url) ?? [];
            const idx = queued.indexOf(request);
            if (idx >= 0) {
              queued.splice(idx, 1);
            }
            if (queued.length === 0) {
              pendingAssetRequestsByUrl.delete(url);
            } else {
              pendingAssetRequestsByUrl.set(url, queued);
            }
            logger.error('Failed to send asset request:', err);
            reject(err);
          }
        });
      });
    };

    // Start the initial connection
    setupWebSocket();
  });
}
