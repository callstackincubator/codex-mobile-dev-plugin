import { b as DeviceInfo } from "./sdk-contracts.js";
import { t as AppsFilter } from "./app-inventory.js";
import { a as ProviderPortReverseOptions, i as ProviderExpiredLeaseRecovery, l as LeaseLifecycleProvider, n as ProviderDeviceInstallResult, o as DeviceInventoryProvider, r as ProviderDeviceRuntime, t as ProviderDeviceInstallOptions, u as Interactor } from "./provider-device-runtime.js";
import { d as AndroidAdbProvider, m as AndroidTextInjectionRequest, n as AndroidKeyboardState, s as AndroidInputOwner, t as AndroidKeyboardDismissResult } from "./device-input-state.js";
//#region packages/provider-limrun/src/runtime-dependencies.d.ts
type LimrunAdbCommandOptions = {
  allowFailure?: boolean;
  binaryStdout?: boolean;
  stdin?: string | Buffer;
  timeoutMs?: number;
  signal?: AbortSignal;
};
type LimrunAdbCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutBuffer?: Buffer;
};
type LimrunAdbExecutor = (args: readonly string[], options?: LimrunAdbCommandOptions) => Promise<LimrunAdbCommandResult>;
type LimrunPortReverseEndpoint = `tcp:${number}` | `localabstract:${string}`;
type LimrunPortReverseMapping = {
  local: LimrunPortReverseEndpoint;
  remote: LimrunPortReverseEndpoint;
  ownerId?: string;
};
type LimrunPortReverseOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};
type LimrunPortReverse = {
  ensure(mapping: LimrunPortReverseMapping, options?: LimrunPortReverseOptions): Promise<void>;
  remove(local: LimrunPortReverseEndpoint, options?: LimrunPortReverseOptions): Promise<void>;
  removeAllOwned(ownerId: string, options?: LimrunPortReverseOptions): Promise<void>;
  list?(options?: LimrunPortReverseOptions): Promise<LimrunPortReverseMapping[]>;
};
type LimrunAdbProvider = {
  exec: LimrunAdbExecutor;
  reverse?: LimrunPortReverse;
  text?: (request: AndroidTextInjectionRequest) => Promise<void>;
};
type LimrunAndroidKeyboardState = {
  visible: boolean;
  inputType?: string;
  type?: 'text' | 'number' | 'email' | 'phone' | 'password' | 'datetime' | 'unknown';
  inputMethodPackage?: string;
  focusedPackage?: string;
  focusedResourceId?: string;
  inputOwner: AndroidInputOwner;
};
type LimrunAndroidKeyboardDismissResult = LimrunAndroidKeyboardState & {
  attempts: number;
  wasVisible: boolean;
  dismissed: boolean;
};
//#endregion
//#region packages/provider-limrun/src/instance-access.d.ts
/** An existing iOS instance's own API URL and token (`status.apiUrl`, `status.token`). */
type LimrunIosInstanceAccess = Readonly<{
  apiUrl: string;
  token: string;
}>;
/** An existing Android instance's own API URL, ADB WebSocket URL, and token. */
type LimrunAndroidInstanceAccess = Readonly<{
  apiUrl: string;
  token: string;
  adbUrl: string;
}>;
/**
 * Existing instances to drive with their own credentials instead of an organization API key. A
 * platform listed here never creates or deletes instances: whoever created the instance owns it.
 */
type LimrunInstanceAccess = Readonly<{
  ios?: LimrunIosInstanceAccess;
  android?: LimrunAndroidInstanceAccess;
}>;
//#endregion
//#region packages/provider-limrun/src/ios.d.ts
type LimrunIosRemoteInstallOptions = {
  md5?: string;
  relaunch?: boolean;
  appIdentifierHint?: string;
};
type LimrunIosRemoteInstallResult = {
  appId?: string;
};
//#endregion
//#region packages/provider-limrun/src/device-session.d.ts
type LimrunRecordingQuality = 5 | 6 | 7 | 8 | 9 | 10;
type LimrunInstalledApp = {
  id: string;
  name?: string;
  installType?: string;
};
type LimrunForegroundApp = {
  appId?: string;
  activity?: string;
};
type LimrunIosCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};
type LimrunIosCommandExecution = {
  on(event: 'line-stdout' | 'line-stderr', listener: (line: string) => void): LimrunIosCommandExecution;
  on(event: 'exit', listener: (code: number) => void): LimrunIosCommandExecution;
  on(event: 'error', listener: (error: Error) => void): LimrunIosCommandExecution;
  off(event: 'line-stdout' | 'line-stderr', listener: (line: string) => void): LimrunIosCommandExecution;
  off(event: 'exit', listener: (code: number) => void): LimrunIosCommandExecution;
  off(event: 'error', listener: (error: Error) => void): LimrunIosCommandExecution;
  wait(): Promise<LimrunIosCommandResult>;
  stop(): void;
};
type LimrunDeviceSessionBase = {
  readonly platform: 'android' | 'ios';
  readonly device: DeviceInfo;
  readonly interactor: Interactor;
  listApps(filter?: AppsFilter): Promise<LimrunInstalledApp[]>;
  pressKey(key: string, modifiers?: string[]): Promise<void>;
  startRecording(options?: {
    quality?: LimrunRecordingQuality;
  }): Promise<void>;
  /** Stops the instance recorder and answers where the finished file is served; nothing is downloaded. */
  stopRecording(): Promise<{
    downloadUrl: string;
  }>;
  /** Fetches a served recording to `outPath` within a fixed deadline. Retriable while the instance lives. */
  downloadRecording(input: {
    downloadUrl: string;
    outPath: string;
  }): Promise<void>;
};
type LimrunAndroidDeviceSession$1 = LimrunDeviceSessionBase & {
  readonly platform: 'android';
  readonly adb: LimrunAdbProvider;
  getForegroundApp(signal?: AbortSignal): Promise<LimrunForegroundApp | undefined>;
  getKeyboardState(): Promise<LimrunAndroidKeyboardState>;
  dismissKeyboard(): Promise<LimrunAndroidKeyboardDismissResult>;
  readLogs(lineLimit: number): Promise<string>;
  installRemoteApp(url: string): Promise<void>;
};
type LimrunIosDeviceSession = LimrunDeviceSessionBase & {
  readonly platform: 'ios';
  readonly viewport: {
    width: number;
    height: number;
  };
  readLogs(appId: string, lineLimit: number): Promise<string>;
  installRemoteApp(url: string, options?: LimrunIosRemoteInstallOptions): Promise<LimrunIosRemoteInstallResult>;
  runSimctl(args: string[]): LimrunIosCommandExecution;
};
//#endregion
//#region packages/provider-limrun/src/runtime.d.ts
type LimrunRuntimeOptions = {
  /** Organization API key. It creates and deletes instances for platforms without `instances`. */
  apiKey?: string;
  region?: string;
  /** Pings each leased instance every 30 s so Limrun's inactivity timeout does not end idle sessions. */
  keepAlive?: boolean;
  runtimeInstance?: string;
  instances?: LimrunInstanceAccess;
};
//#endregion
//#region src/sdk/limrun-runtime-types.d.ts
type LimrunAndroidDeviceSession = Omit<LimrunAndroidDeviceSession$1, 'adb' | 'getKeyboardState' | 'dismissKeyboard'> & {
  readonly adb: AndroidAdbProvider;
  getKeyboardState(): Promise<AndroidKeyboardState>;
  dismissKeyboard(): Promise<AndroidKeyboardDismissResult>;
};
type LimrunDeviceSession = LimrunAndroidDeviceSession | LimrunIosDeviceSession;
//#endregion
//#region src/provider-limrun-runtime.d.ts
declare class LimrunRuntime implements ProviderDeviceRuntime {
  private readonly implementation;
  readonly provider = "limrun";
  constructor(options: LimrunRuntimeOptions);
  get leaseLifecycle(): LeaseLifecycleProvider;
  get recoverExpiredLease(): ProviderExpiredLeaseRecovery;
  get deviceInventoryProvider(): DeviceInventoryProvider;
  ownsDevice(device: DeviceInfo): boolean;
  getInteractor(device: DeviceInfo): Interactor | undefined;
  getDeviceSession(device: DeviceInfo): LimrunDeviceSession | undefined;
  installApp(device: DeviceInfo, app: string, appPath: string, options?: ProviderDeviceInstallOptions): Promise<ProviderDeviceInstallResult | undefined>;
  installInstallablePath(device: DeviceInfo, installablePath: string, options?: ProviderDeviceInstallOptions): Promise<ProviderDeviceInstallResult | undefined>;
  configurePortReverse(options: ProviderPortReverseOptions): Promise<Record<string, unknown> | undefined>;
  shutdown(): Promise<void>;
}
//#endregion
export { type LimrunAndroidDeviceSession, type LimrunDeviceSession, type LimrunInstanceAccess, type LimrunIosCommandExecution, type LimrunIosDeviceSession, LimrunRuntime, type LimrunRuntimeOptions };