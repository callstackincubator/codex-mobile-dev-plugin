import { _ as SessionRuntimeHints } from "./sdk-contracts.js";
import { d as PrepareMetroRuntimeResult, f as ReloadMetroResult, o as MetroPrepareKind, p as MetroBridgeScope } from "./sdk-remote-config.js";
//#region src/utils/url.d.ts
declare function normalizeBaseUrl(input: string): string;
declare function buildBundleUrl(baseUrl: string, platform: 'ios' | 'android', entryPath?: string): string;
//#endregion
//#region src/metro/metro-types.d.ts
/** Re-export of {@link SessionRuntimeHints} under the Metro-specific alias used by public API consumers. */
type MetroRuntimeHints = SessionRuntimeHints;
type MetroBridgeRuntimePayload = {
  metro_host?: string;
  metro_port?: number;
  metro_bundle_url?: string;
  launch_url?: string;
};
type MetroBridgeDescriptor = {
  enabled: boolean;
  base_url: string;
  status_url?: string;
  bundle_url?: string;
  ios_runtime: MetroBridgeRuntimePayload;
  android_runtime: MetroBridgeRuntimePayload;
  upstream: {
    bundle_url?: string;
    host?: string;
    port?: number;
    status_url?: string;
  };
  probe: {
    reachable: boolean;
    status_code: number;
    latency_ms: number;
    detail: string;
  };
};
//#endregion
//#region src/metro/metro.d.ts
declare function resolveRuntimeTransport(runtime: SessionRuntimeHints | undefined): {
  host: string;
  port: number;
  scheme: 'http' | 'https';
} | undefined;
type MetroTunnelPingMessage = {
  type: 'ping';
  timestamp: number;
};
type MetroTunnelPongMessage = {
  type: 'pong';
  timestamp: number;
};
type MetroTunnelHttpRequestMessage = {
  type: 'http-request';
  requestId: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  bodyBase64?: string;
};
type MetroTunnelHttpResponseMessage = {
  type: 'http-response';
  requestId: string;
  status: number;
  headers: Record<string, string>;
  bodyBase64?: string;
};
type MetroTunnelHttpErrorMessage = {
  type: 'http-error';
  requestId: string;
  message: string;
};
type MetroTunnelWebSocketOpenMessage = {
  type: 'ws-open';
  streamId: string;
  path: string;
  headers?: Record<string, string>;
};
type MetroTunnelWebSocketOpenResultMessage = {
  type: 'ws-open-result';
  streamId: string;
  success: boolean;
  headers?: Record<string, string>;
  error?: string;
};
type MetroTunnelWebSocketFrameMessage = {
  type: 'ws-frame';
  streamId: string;
  dataBase64: string;
  binary: boolean;
};
type MetroTunnelWebSocketCloseMessage = {
  type: 'ws-close';
  streamId: string;
  code?: number;
  reason?: string;
};
type MetroTunnelRequestMessage = MetroTunnelPingMessage | MetroTunnelHttpRequestMessage | MetroTunnelWebSocketOpenMessage | MetroTunnelWebSocketFrameMessage | MetroTunnelWebSocketCloseMessage;
type MetroTunnelResponseMessage = MetroTunnelPongMessage | MetroTunnelHttpResponseMessage | MetroTunnelHttpErrorMessage | MetroTunnelWebSocketOpenResultMessage | MetroTunnelWebSocketFrameMessage | MetroTunnelWebSocketCloseMessage;
type StopMetroTunnelOptions = {
  projectRoot: string;
  profileKey?: string;
  consumerKey?: string;
};
declare function stopMetroTunnel(options: StopMetroTunnelOptions): Promise<void>;
//#endregion
//#region src/metro/client-metro.d.ts
type EnvSource = NodeJS.ProcessEnv | Record<string, string | undefined>;
type PrepareMetroRuntimeOptions = {
  projectRoot?: string;
  kind?: MetroPrepareKind;
  metroPort?: number | string;
  listenHost?: string;
  statusHost?: string;
  publicBaseUrl?: string;
  proxyBaseUrl?: string;
  proxyBearerToken?: string;
  bridgeScope?: MetroBridgeScope;
  launchUrl?: string;
  companionProfileKey?: string;
  companionConsumerKey?: string;
  startupTimeoutMs?: number | string;
  probeTimeoutMs?: number | string;
  reuseExisting?: boolean;
  installDependenciesIfNeeded?: boolean;
  runtimeFilePath?: string;
  logPath?: string;
  env?: EnvSource;
};
type ReloadMetroOptions = {
  metroHost?: string;
  metroPort?: number | string;
  bundleUrl?: string;
  runtime?: MetroRuntimeHints;
  timeoutMs?: number | string;
};
declare function prepareMetroRuntime(input?: PrepareMetroRuntimeOptions): Promise<PrepareMetroRuntimeResult>;
declare function reloadMetro(input?: ReloadMetroOptions): Promise<ReloadMetroResult>;
//#endregion
export { type MetroBridgeDescriptor, type MetroTunnelRequestMessage, type MetroTunnelResponseMessage, buildBundleUrl, normalizeBaseUrl, prepareMetroRuntime, reloadMetro, resolveRuntimeTransport, stopMetroTunnel };