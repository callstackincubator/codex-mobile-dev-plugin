import { B as DeviceTarget, H as PlatformSelector, _ as SessionRuntimeHints, c as DaemonServerMode, f as LeaseBackend, g as SessionIsolationMode, l as DaemonTransportPreference } from "./sdk-contracts.js";
//#region packages/contracts/src/companion-tunnel-scope.d.ts
/**
 * The identity a companion tunnel is scoped to.
 *
 * This shape is shared vocabulary rather than a client concern: the public API surface declares
 * command options in terms of it, and `client/`, `metro/` and `cli/` all pass it around. It lived
 * inside `client/client-companion-tunnel-contract.ts` next to the env-var names and worker
 * options that really are client-local, which made every zone that merely needed the shape
 * declare itself in terms of the client. Declaring it below them is what lets the contract be
 * shared without the dependency.
 */
type CompanionTunnelScope = {
  tenantId: string;
  runId: string;
  leaseId: string;
};
/** The companion-tunnel scope as Metro's bridge names it. */
type MetroBridgeScope = CompanionTunnelScope;
//#endregion
//#region packages/contracts/src/metro.d.ts
type MetroPrepareKind = 'auto' | 'react-native' | 'expo' | 'repack';
/** A prepare kind after resolution: `auto` is a request, never an outcome. */
type ResolvedMetroKind = Exclude<MetroPrepareKind, 'auto'>;
type MetroBridgeResult = {
  enabled: boolean;
  baseUrl: string;
  statusUrl: string;
  bundleUrl: string;
  iosRuntime: SessionRuntimeHints;
  androidRuntime: SessionRuntimeHints;
  upstream: {
    bundleUrl: string;
    host: string;
    port: number;
    statusUrl: string;
  };
  probe: {
    reachable: boolean;
    statusCode: number;
    latencyMs: number;
    detail: string;
  };
};
type PrepareMetroRuntimeResult = {
  projectRoot: string;
  kind: ResolvedMetroKind;
  dependenciesInstalled: boolean;
  packageManager: string | null;
  started: boolean;
  reused: boolean;
  pid: number;
  logPath: string;
  statusUrl: string;
  runtimeFilePath: string | null;
  iosRuntime: SessionRuntimeHints;
  androidRuntime: SessionRuntimeHints;
  bridge: MetroBridgeResult | null;
};
/**
 * `transport` says which channel delivered the reload: `http` for the classic GET /reload route,
 * `message-socket` for the /message websocket broadcast used when the server has no HTTP reload
 * route (Expo). `status`/`body` always describe the HTTP probe; on the websocket path `reloadUrl`
 * is the ws(s) message-socket URL.
 */
type ReloadMetroResult = {
  reloaded: true;
  reloadUrl: string;
  status: number;
  body: string;
  transport: 'http' | 'message-socket';
};
type MetroPrepareOptions = {
  projectRoot?: string;
  kind?: MetroPrepareKind;
  publicBaseUrl?: string;
  proxyBaseUrl?: string;
  bearerToken?: string;
  bridgeScope?: MetroBridgeScope;
  launchUrl?: string;
  companionProfileKey?: string;
  companionConsumerKey?: string;
  port?: number;
  listenHost?: string;
  statusHost?: string;
  startupTimeoutMs?: number;
  probeTimeoutMs?: number;
  reuseExisting?: boolean;
  installDependenciesIfNeeded?: boolean;
  runtimeFilePath?: string;
  logPath?: string;
};
type MetroReloadOptions = {
  metroHost?: string;
  metroPort?: number;
  bundleUrl?: string;
  timeoutMs?: number;
};
type MetroPrepareResult = PrepareMetroRuntimeResult;
type MetroReloadResult = ReloadMetroResult;
//#endregion
//#region packages/contracts/src/remote-config-fields.d.ts
/**
 * Screen orientation a hosted provider session starts in. Distinct from `DeviceRotation`
 * (`contracts/device-rotation.ts`): that is a four-way runtime rotation command, this is the
 * two-way session-creation capability hosted providers accept.
 */
declare const PROVIDER_DEVICE_ORIENTATIONS: readonly ['portrait', 'landscape'];
type ProviderDeviceOrientation = (typeof PROVIDER_DEVICE_ORIENTATIONS)[number];
type CloudProviderProfileFields = {
  providerApp?: string;
  providerOsVersion?: string;
  providerProject?: string;
  providerBuild?: string;
  providerSessionName?: string;
  providerDeviceOrientation?: ProviderDeviceOrientation;
  providerGeoLocation?: string;
  providerTimezone?: string;
  providerLanguage?: string;
  providerLocale?: string;
  providerNetworkProfile?: string;
  providerCustomNetwork?: string;
  providerNoResignApp?: boolean;
  awsProjectArn?: string;
  awsDeviceArn?: string;
  awsAppArn?: string;
  awsRegion?: string;
  awsInteractionMode?: 'INTERACTIVE' | 'NO_VIDEO' | 'VIDEO_ONLY';
};
type RemoteConfigMetroOptions = {
  metroProjectRoot?: string;
  metroKind?: MetroPrepareKind;
  metroPublicBaseUrl?: string;
  metroProxyBaseUrl?: string;
  metroBearerToken?: string;
  metroPreparePort?: number;
  metroListenHost?: string;
  metroStatusHost?: string;
  metroStartupTimeoutMs?: number;
  metroProbeTimeoutMs?: number;
  metroRuntimeFile?: string;
  metroNoReuseExisting?: boolean;
  metroNoInstallDeps?: boolean;
  launchUrl?: string;
};
/**
 * How to reach a daemon and which lease/tenant the request belongs to.
 *
 * Sibling of `CloudProviderProfileFields` above, and here for the same reason: `remote/` owns
 * reading and validating a profile, but the field vocabulary is a contract that zones below
 * `remote/` are stated in terms of — the public API config is composed from both groups. Leaving
 * this one in `remote/` made every consumer of that composition declare itself in terms of a
 * rank-4 zone.
 */
type RemoteConnectionProfileFields = {
  stateDir?: string;
  daemonBaseUrl?: string;
  daemonAuthToken?: string;
  daemonTransport?: DaemonTransportPreference;
  daemonServerMode?: DaemonServerMode;
  tenant?: string;
  sessionIsolation?: SessionIsolationMode;
  runId?: string;
  leaseId?: string;
  leaseBackend?: LeaseBackend;
  leaseProvider?: string;
  deviceKey?: string;
  clientId?: string;
};
//#endregion
//#region src/remote/remote-config-schema.d.ts
type RemoteConfigProfile = RemoteConfigMetroOptions & CloudProviderProfileFields & RemoteConnectionProfileFields & {
  platform?: PlatformSelector;
  target?: DeviceTarget;
  device?: string;
  udid?: string;
  serial?: string;
  iosSimulatorDeviceSet?: string;
  androidDeviceAllowlist?: string;
  session?: string;
};
type RemoteConfigProfileOptions = {
  configPath: string;
  cwd: string;
  env?: Record<string, string | undefined>;
};
type ResolvedRemoteConfigProfile = {
  resolvedPath: string;
  profile: RemoteConfigProfile;
};
//#endregion
export { RemoteConnectionProfileFields as a, MetroPrepareResult as c, PrepareMetroRuntimeResult as d, ReloadMetroResult as f, CloudProviderProfileFields as i, MetroReloadOptions as l, RemoteConfigProfileOptions as n, MetroPrepareKind as o, MetroBridgeScope as p, ResolvedRemoteConfigProfile as r, MetroPrepareOptions as s, RemoteConfigProfile as t, MetroReloadResult as u };