import { parseGesture, type Gesture } from "./control-contracts";

/** Stable error codes sent by every JSON API failure. */
export const API_ERROR_CODES = [
  "invalid_request",
  "invalid_json",
  "unauthorized",
  "forbidden",
  "not_found",
  "method_not_allowed",
  "conflict",
  "payload_too_large",
  "rate_limited",
  "downstream_failure",
  "service_unavailable",
  "internal_error",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type ApiErrorDetail = {
  code: ApiErrorCode;
  message: string;
};

export type ApiFailure = {
  ok: false;
  error: ApiErrorDetail;
};

export type ApiSuccess<T extends object = Record<never, never>> = { ok: true } & T;
export type ApiResult<T extends object = Record<never, never>> = ApiSuccess<T> | ApiFailure;

export type SessionStatus = "streaming" | "stopped" | "error";
export type DeviceSize = { width: number; height: number };
export type Device = { serial: string; state: string };

export type GridDeviceKind = "physical" | "emulator" | "avd";
export type GridDevice = {
  id: string;
  kind: GridDeviceKind;
  serial: string | null;
  avd: string | null;
  name: string;
  state: string;
  current: boolean;
  canSelect: boolean;
  canStart: boolean;
  canStop: boolean;
};

export type DeviceGridResponse = ApiSuccess<{
  currentSerial: string;
  sessionStatus: SessionStatus;
  devices: GridDevice[];
}>;

export type DeviceListResponse = ApiSuccess<{
  currentSerial: string;
  devices: Array<Device & { current: boolean }>;
}>;

export type DeviceSelectionResponse = ApiSuccess<{
  serial: string;
  device: string;
}>;

export type AvdStartResponse = ApiSuccess<{
  serial: string;
  avd: string;
  device?: string;
}>;

export type AvdStopResponse = ApiSuccess<{ serial: string }>;

export type OrientationMode = "auto" | "portrait" | "landscape";
export type OrientationStatus = {
  mode: "free" | "lock" | "unknown";
  rotation: number | null;
  orientation: OrientationMode | "unknown";
  raw: string;
};
export type OrientationResponse = ApiSuccess<{ orientation: OrientationStatus }>;

export type NightMode = "auto" | "dark" | "light";
export type NightModeStatus = { mode: NightMode | "unknown"; raw: string };
export type NightModeResponse = ApiSuccess<{ nightMode: NightModeStatus }>;

export type FontScaleStatus = { scale: number; raw: string };
export type FontScaleResponse = ApiSuccess<{ fontScale: FontScaleStatus }>;

export type NetworkRadioStatus = "enabled" | "disabled" | "unknown";
export type NetworkStatus = {
  enabled: boolean | null;
  wifi: NetworkRadioStatus;
  mobileData: NetworkRadioStatus;
  raw: { wifi: string; mobileData: string };
};
export type NetworkResponse = ApiSuccess<{ network: NetworkStatus }>;

export type ForegroundApp = {
  packageName: string | null;
  activity: string | null;
  pid: number | null;
  label: string | null;
  versionName: string | null;
  versionCode: string | null;
  debuggable: boolean | null;
};
export type ForegroundResponse = ApiSuccess<{ app: ForegroundApp }>;

export type AccessibilityBounds = { left: number; top: number; right: number; bottom: number };
export type AccessibilityNode = {
  id: string;
  text: string;
  contentDescription: string;
  resourceId: string;
  className: string;
  packageName: string;
  clickable: boolean;
  enabled: boolean;
  bounds: AccessibilityBounds;
};
export type AccessibilitySelector = {
  id?: string;
  text?: string;
  textContains?: string;
  contentDescription?: string;
  contentDescriptionContains?: string;
  resourceId?: string;
  resourceIdContains?: string;
  className?: string;
  packageName?: string;
  clickable?: boolean;
  enabled?: boolean;
  index?: number;
};
export type AccessibilitySnapshot = ApiSuccess<{
  capturedAt: string;
  nodes: AccessibilityNode[];
}>;
export type AccessibilityTapResponse = ApiSuccess<{
  node: AccessibilityNode;
  capturedAt: string;
}>;

export type GeoFix = {
  latitude: number;
  longitude: number;
  altitude?: number;
  satellites?: number;
  velocity?: number;
};
export type LocationPoint = GeoFix;
export type AppliedGeoFix = GeoFix & { appliedAt: string };
export type LocationResponse = {
  serial: string;
  emulator: boolean;
  location: AppliedGeoFix | null;
};
export type LocationUpdateResponse = ApiSuccess<{ location: AppliedGeoFix }>;

export type RouteWaypoint = GeoFix;
export type RoutePlaybackRequest = {
  waypoints: RouteWaypoint[];
  speedKph?: number;
  multiplier?: number;
  intervalMs?: number;
  loop?: boolean;
};
export type RoutePlaybackStatus = "idle" | "running" | "paused" | "completed" | "error";
export type RoutePlaybackSnapshot = {
  status: RoutePlaybackStatus;
  waypointCount: number;
  totalMeters: number;
  progressMeters: number;
  speedKph: number;
  multiplier: number;
  intervalMs: number;
  loop: boolean;
  startedAt: string | null;
  updatedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  currentLocation: AppliedGeoFix | null;
};
export type RouteMutationResponse = ApiSuccess<{ route: RoutePlaybackSnapshot }>;

export type GestureSessionEvent = {
  id: number;
  at: string;
  delayMs: number;
  source: string;
  kind: "gesture";
  gesture: Gesture;
};
export type LocationSessionEvent = {
  id: number;
  at: string;
  delayMs: number;
  source: string;
  kind: "location";
  location: GeoFix;
};
export type SessionEvent = GestureSessionEvent | LocationSessionEvent;
export type RecordedEvent = SessionEvent;
export type SessionSnapshot = {
  events: SessionEvent[];
  recording: boolean;
  replaying: boolean;
  replayStartedAt: string | null;
  replayCompletedAt: string | null;
  lastError: string | null;
};
export type SessionMutationResponse = ApiSuccess<{ session: SessionSnapshot }>;

export type AppActionResponse = ApiSuccess<{ output: string }>;
export type FileImportResponse = ApiSuccess<{
  output: string;
  path: string;
  kind: "image" | "video" | "file";
}>;

export type ScreenshotBase64Response = ApiSuccess<{
  mimeType: "image/png";
  data: string;
}>;

export type LogcatEventMap = {
  ready: {
    serial: string;
    package: string | null;
    pids: string[];
    search: string | null;
  };
  log: { line: string; at: string };
  error: { line: string; at: string };
  close: { code: number | null; signal: string | null };
};

export type FrameStatsSummary = {
  windowFrames: number;
  intervalMs: { p50: number; p95: number; max: number } | null;
  avgKeyFrameBytes: number | null;
  avgDeltaFrameBytes: number | null;
  keyFramesInWindow: number;
};

export type HealthClient = {
  id: number;
  frameMeta: boolean;
  sentFrames: number;
  droppedFrames: number;
  backpressureEvents: number;
  bufferedBytes: number;
  awaitingKeyFrame: boolean;
};

export type HealthResponse = {
  ok: boolean;
  status: SessionStatus;
  serial: string;
  device: string;
  codec: string;
  size: DeviceSize;
  clients: number;
  frames: number;
  sourceFps: number;
  frameStats: FrameStatsSummary | null;
  configPackets: number;
  droppedFrames: number;
  backpressureEvents: number;
  videoResetRequests: number;
  lastVideoResetAt: string | null;
  lastVideoResetReason: string | null;
  location: AppliedGeoFix | null;
  route: RoutePlaybackSnapshot;
  session: SessionSnapshot;
  clientsDetail: HealthClient[];
  startedAt: string;
  stoppedAt: string | null;
  lastFrameAt: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  lastErrorMeta: Record<string, string | number> | null;
  /** Changes whenever the active scrcpy device session changes. */
  sessionGeneration?: number;
};

export type ApiInfoResponse = {
  serial: string;
  device: string;
  codec: string;
  size: DeviceSize;
  status: SessionStatus;
  clients: number;
};

export type EmptyResponse = ApiSuccess;
export type BinaryPngResponse = Uint8Array;

export type TapRequest = { x: number; y: number; record?: boolean };
export type SwipeRequest = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  durationMs?: number;
  record?: boolean;
};
export type TextRequest = { text: string; record?: boolean };
export type KeyRequest =
  | { key: "back" | "home" | "recents" | "power"; record?: boolean }
  | { keycode: number; action?: "down" | "up"; metaState?: number; record?: boolean };

export type EndpointContract<Request, Response> = {
  request: Request;
  response: Response;
};

/**
 * Compile-time source of truth for JSON API request and response bodies.
 * Errors are added by ApiResponse so endpoint success shapes stay readable.
 */
export type ApiContractMap = {
  "/api": { GET: EndpointContract<undefined, ApiInfoResponse> };
  "/api/devices": { GET: EndpointContract<undefined, DeviceListResponse> };
  "/api/device-grid": { GET: EndpointContract<undefined, DeviceGridResponse> };
  "/api/devices/select": {
    POST: EndpointContract<{ serial: string }, DeviceSelectionResponse>;
  };
  "/api/avds/start": {
    POST: EndpointContract<{ avd: string; select?: boolean }, AvdStartResponse>;
  };
  "/api/avds/stop": {
    POST: EndpointContract<{ serial?: string; avd?: string }, AvdStopResponse>;
  };
  "/api/orientation": {
    GET: EndpointContract<undefined, OrientationResponse>;
    POST: EndpointContract<{ orientation: OrientationMode }, OrientationResponse>;
  };
  "/api/night-mode": {
    GET: EndpointContract<undefined, NightModeResponse>;
    POST: EndpointContract<{ mode: NightMode }, NightModeResponse>;
  };
  "/api/font-scale": {
    GET: EndpointContract<undefined, FontScaleResponse>;
    POST: EndpointContract<{ scale: number }, FontScaleResponse>;
  };
  "/api/network": {
    GET: EndpointContract<undefined, NetworkResponse>;
    POST: EndpointContract<{ enabled: boolean }, NetworkResponse>;
  };
  "/api/logcat": { GET: EndpointContract<undefined, never> };
  "/api/screenshot": {
    GET: EndpointContract<undefined, ScreenshotBase64Response | BinaryPngResponse>;
    POST: EndpointContract<undefined, ScreenshotBase64Response | BinaryPngResponse>;
  };
  "/api/foreground": { GET: EndpointContract<undefined, ForegroundResponse> };
  "/api/accessibility": { GET: EndpointContract<undefined, AccessibilitySnapshot> };
  "/api/accessibility/tap": {
    POST: EndpointContract<
      { selector: AccessibilitySelector; record?: boolean },
      AccessibilityTapResponse
    >;
  };
  "/api/tap": { POST: EndpointContract<TapRequest, EmptyResponse> };
  "/api/swipe": { POST: EndpointContract<SwipeRequest, EmptyResponse> };
  "/api/text": { POST: EndpointContract<TextRequest, EmptyResponse> };
  "/api/key": { POST: EndpointContract<KeyRequest, EmptyResponse> };
  "/api/session": {
    GET: EndpointContract<undefined, SessionSnapshot>;
    DELETE: EndpointContract<undefined, SessionMutationResponse>;
  };
  "/api/session/replay": {
    POST: EndpointContract<{ multiplier?: number }, SessionMutationResponse>;
  };
  "/api/session/replay/stop": {
    POST: EndpointContract<undefined, SessionMutationResponse>;
  };
  "/api/apps/install": { POST: EndpointContract<FormData, AppActionResponse> };
  "/api/files/import": { POST: EndpointContract<FormData, FileImportResponse> };
  "/api/apps/launch": {
    POST: EndpointContract<{ packageName: string; activity?: string }, AppActionResponse>;
  };
  "/api/apps/clear": {
    POST: EndpointContract<{ packageName: string }, AppActionResponse>;
  };
  "/api/apps/force-stop": {
    POST: EndpointContract<{ packageName: string }, AppActionResponse>;
  };
  "/api/apps/grant": {
    POST: EndpointContract<{ packageName: string; permission: string }, AppActionResponse>;
  };
  "/api/location": {
    GET: EndpointContract<undefined, LocationResponse>;
    POST: EndpointContract<GeoFix, LocationUpdateResponse>;
  };
  "/api/route": {
    GET: EndpointContract<undefined, RoutePlaybackSnapshot>;
    POST: EndpointContract<RoutePlaybackRequest, RouteMutationResponse>;
    DELETE: EndpointContract<undefined, RouteMutationResponse>;
  };
  "/api/route/control": {
    POST: EndpointContract<{ action: "pause" | "resume" | "stop" }, RouteMutationResponse>;
  };
};

export type ApiPath = keyof ApiContractMap;
export type ApiMethod<Path extends ApiPath> = Extract<keyof ApiContractMap[Path], string>;
type ContractAt<
  Path extends ApiPath,
  Method extends ApiMethod<Path>,
> = ApiContractMap[Path][Method] extends EndpointContract<infer Request, infer Response>
  ? EndpointContract<Request, Response>
  : never;
export type ApiRequest<
  Path extends ApiPath,
  Method extends ApiMethod<Path>,
> = ContractAt<Path, Method>["request"];
export type ApiResponse<
  Path extends ApiPath,
  Method extends ApiMethod<Path>,
> = ContractAt<Path, Method>["response"] | ApiFailure;
export type ApiSuccessResponse<
  Path extends ApiPath,
  Method extends ApiMethod<Path>,
> = Exclude<ApiResponse<Path, Method>, ApiFailure>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new TypeError(message);
}

function record(value: unknown, name: string): Record<string, unknown> {
  return isRecord(value) ? value : fail(`${name} must be an object`);
}

function string(value: unknown, name: string): string {
  return typeof value === "string" ? value : fail(`${name} must be a string`);
}

function nullableString(value: unknown, name: string): string | null {
  return value === null ? null : string(value, name);
}

function number(value: unknown, name: string): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fail(`${name} must be a finite number`);
}

function boolean(value: unknown, name: string): boolean {
  return typeof value === "boolean" ? value : fail(`${name} must be a boolean`);
}

function nullableBoolean(value: unknown, name: string): boolean | null {
  return value === null ? null : boolean(value, name);
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  name: string,
): Values[number] {
  return typeof value === "string" && values.includes(value)
    ? (value as Values[number])
    : fail(`${name} is invalid`);
}

/** Parse the stable failure envelope; throws when a server violates the contract. */
export function parseApiFailure(value: unknown): ApiFailure {
  try {
    const root = record(value, "API failure");
    if (root.ok !== false) fail("invalid API failure");
    const error = record(root.error, "API failure error");
    const code = oneOf(error.code, API_ERROR_CODES, "API failure code");
    const message = string(error.message, "API failure message");
    if (!message) fail("API failure message must not be empty");
    return { ok: false, error: { code, message } };
  } catch {
    throw new TypeError("invalid API failure");
  }
}

export function isApiFailure(value: unknown): value is ApiFailure {
  try {
    parseApiFailure(value);
    return true;
  } catch {
    return false;
  }
}

export function parseApiResult<T extends object>(
  value: unknown,
  parseSuccess: (value: unknown) => ApiSuccess<T>,
): ApiResult<T> {
  return isRecord(value) && value.ok === false
    ? parseApiFailure(value)
    : parseSuccess(value);
}

function parseDeviceSize(value: unknown, name = "size"): DeviceSize {
  const item = record(value, name);
  const width = number(item.width, `${name}.width`);
  const height = number(item.height, `${name}.height`);
  if (width <= 0 || height <= 0) fail(`${name} dimensions must be positive`);
  return { width, height };
}

export function parseApiInfoResponse(value: unknown): ApiInfoResponse {
  const root = record(value, "API info response");
  return {
    serial: string(root.serial, "API info response.serial"),
    device: string(root.device, "API info response.device"),
    codec: string(root.codec, "API info response.codec"),
    size: parseDeviceSize(root.size, "API info response.size"),
    status: oneOf(
      root.status,
      ["streaming", "stopped", "error"] as const,
      "API info response.status",
    ),
    clients: number(root.clients, "API info response.clients"),
  };
}

export function parseDeviceListResponse(value: unknown): DeviceListResponse {
  const root = record(value, "device list response");
  if (root.ok !== true) fail("device list response.ok must be true");
  if (!Array.isArray(root.devices)) fail("device list response.devices must be an array");
  return {
    ok: true,
    currentSerial: string(root.currentSerial, "device list response.currentSerial"),
    devices: root.devices.map((value, index) => {
      const item = record(value, `devices[${index}]`);
      return {
        serial: string(item.serial, `devices[${index}].serial`),
        state: string(item.state, `devices[${index}].state`),
        current: boolean(item.current, `devices[${index}].current`),
      };
    }),
  };
}

function parseOkDeviceResponse(value: unknown, kind: "selection" | "avd-start"): DeviceSelectionResponse | AvdStartResponse {
  const root = record(value, `${kind} response`);
  if (root.ok !== true) fail(`${kind} response.ok must be true`);
  const serial = string(root.serial, `${kind} response.serial`);
  if (kind === "selection") {
    return { ok: true, serial, device: string(root.device, "selection response.device") };
  }
  const result: AvdStartResponse = {
    ok: true,
    serial,
    avd: string(root.avd, "avd-start response.avd"),
  };
  if (root.device !== undefined) result.device = string(root.device, "avd-start response.device");
  return result;
}

export function parseDeviceSelectionResponse(value: unknown): DeviceSelectionResponse {
  return parseOkDeviceResponse(value, "selection") as DeviceSelectionResponse;
}

export function parseAvdStartResponse(value: unknown): AvdStartResponse {
  return parseOkDeviceResponse(value, "avd-start") as AvdStartResponse;
}

export function parseAvdStopResponse(value: unknown): AvdStopResponse {
  const root = record(value, "AVD stop response");
  if (root.ok !== true) fail("AVD stop response.ok must be true");
  return { ok: true, serial: string(root.serial, "AVD stop response.serial") };
}

export function parseDeviceGridResponse(value: unknown): DeviceGridResponse {
  const root = record(value, "device grid response");
  if (root.ok !== true) fail("device grid response.ok must be true");
  const devices = Array.isArray(root.devices)
    ? root.devices.map((value, index): GridDevice => {
        const item = record(value, `devices[${index}]`);
        return {
          id: string(item.id, `devices[${index}].id`),
          kind: oneOf(item.kind, ["physical", "emulator", "avd"] as const, `devices[${index}].kind`),
          serial: nullableString(item.serial, `devices[${index}].serial`),
          avd: nullableString(item.avd, `devices[${index}].avd`),
          name: string(item.name, `devices[${index}].name`),
          state: string(item.state, `devices[${index}].state`),
          current: boolean(item.current, `devices[${index}].current`),
          canSelect: boolean(item.canSelect, `devices[${index}].canSelect`),
          canStart: boolean(item.canStart, `devices[${index}].canStart`),
          canStop: boolean(item.canStop, `devices[${index}].canStop`),
        };
      })
    : fail("device grid response.devices must be an array");
  return {
    ok: true,
    currentSerial: string(root.currentSerial, "device grid response.currentSerial"),
    sessionStatus: oneOf(
      root.sessionStatus,
      ["streaming", "stopped", "error"] as const,
      "device grid response.sessionStatus",
    ),
    devices,
  };
}

function parseOrientationStatus(value: unknown): OrientationStatus {
  const item = record(value, "orientation");
  const rotation = item.rotation === null ? null : number(item.rotation, "orientation.rotation");
  return {
    mode: oneOf(item.mode, ["free", "lock", "unknown"] as const, "orientation.mode"),
    rotation,
    orientation: oneOf(
      item.orientation,
      ["auto", "portrait", "landscape", "unknown"] as const,
      "orientation.orientation",
    ),
    raw: string(item.raw, "orientation.raw"),
  };
}

export function parseOrientationResponse(value: unknown): OrientationResponse {
  const root = record(value, "orientation response");
  if (root.ok !== true) fail("orientation response.ok must be true");
  return { ok: true, orientation: parseOrientationStatus(root.orientation) };
}

export function parseNightModeResponse(value: unknown): NightModeResponse {
  const root = record(value, "night mode response");
  if (root.ok !== true) fail("night mode response.ok must be true");
  const status = record(root.nightMode, "nightMode");
  return {
    ok: true,
    nightMode: {
      mode: oneOf(status.mode, ["auto", "dark", "light", "unknown"] as const, "nightMode.mode"),
      raw: string(status.raw, "nightMode.raw"),
    },
  };
}

export function parseFontScaleResponse(value: unknown): FontScaleResponse {
  const root = record(value, "font scale response");
  if (root.ok !== true) fail("font scale response.ok must be true");
  const status = record(root.fontScale, "fontScale");
  return {
    ok: true,
    fontScale: {
      scale: number(status.scale, "fontScale.scale"),
      raw: string(status.raw, "fontScale.raw"),
    },
  };
}

export function parseNetworkResponse(value: unknown): NetworkResponse {
  const root = record(value, "network response");
  if (root.ok !== true) fail("network response.ok must be true");
  const status = record(root.network, "network");
  const raw = record(status.raw, "network.raw");
  return {
    ok: true,
    network: {
      enabled: nullableBoolean(status.enabled, "network.enabled"),
      wifi: oneOf(status.wifi, ["enabled", "disabled", "unknown"] as const, "network.wifi"),
      mobileData: oneOf(
        status.mobileData,
        ["enabled", "disabled", "unknown"] as const,
        "network.mobileData",
      ),
      raw: {
        wifi: string(raw.wifi, "network.raw.wifi"),
        mobileData: string(raw.mobileData, "network.raw.mobileData"),
      },
    },
  };
}

function parseForegroundApp(value: unknown): ForegroundApp {
  const item = record(value, "foreground app");
  return {
    packageName: nullableString(item.packageName, "foreground app.packageName"),
    activity: nullableString(item.activity, "foreground app.activity"),
    pid: item.pid === null ? null : number(item.pid, "foreground app.pid"),
    label: nullableString(item.label, "foreground app.label"),
    versionName: nullableString(item.versionName, "foreground app.versionName"),
    versionCode: nullableString(item.versionCode, "foreground app.versionCode"),
    debuggable: nullableBoolean(item.debuggable, "foreground app.debuggable"),
  };
}

export function parseForegroundResponse(value: unknown): ForegroundResponse {
  const root = record(value, "foreground response");
  if (root.ok !== true) fail("foreground response.ok must be true");
  return { ok: true, app: parseForegroundApp(root.app) };
}

function parseAccessibilityNode(value: unknown, name = "accessibility node"): AccessibilityNode {
  const item = record(value, name);
  const bounds = record(item.bounds, `${name}.bounds`);
  return {
    id: string(item.id, `${name}.id`),
    text: string(item.text, `${name}.text`),
    contentDescription: string(item.contentDescription, `${name}.contentDescription`),
    resourceId: string(item.resourceId, `${name}.resourceId`),
    className: string(item.className, `${name}.className`),
    packageName: string(item.packageName, `${name}.packageName`),
    clickable: boolean(item.clickable, `${name}.clickable`),
    enabled: boolean(item.enabled, `${name}.enabled`),
    bounds: {
      left: number(bounds.left, `${name}.bounds.left`),
      top: number(bounds.top, `${name}.bounds.top`),
      right: number(bounds.right, `${name}.bounds.right`),
      bottom: number(bounds.bottom, `${name}.bounds.bottom`),
    },
  };
}

export function parseAccessibilitySnapshot(value: unknown): AccessibilitySnapshot {
  const root = record(value, "accessibility snapshot");
  if (root.ok !== true) fail("accessibility snapshot.ok must be true");
  if (!Array.isArray(root.nodes)) fail("accessibility snapshot.nodes must be an array");
  return {
    ok: true,
    capturedAt: string(root.capturedAt, "accessibility snapshot.capturedAt"),
    nodes: root.nodes.map((node, index) => parseAccessibilityNode(node, `nodes[${index}]`)),
  };
}

export function parseAccessibilityTapResponse(value: unknown): AccessibilityTapResponse {
  const root = record(value, "accessibility tap response");
  if (root.ok !== true) fail("accessibility tap response.ok must be true");
  return {
    ok: true,
    node: parseAccessibilityNode(root.node),
    capturedAt: string(root.capturedAt, "accessibility tap response.capturedAt"),
  };
}

function parseGeoFix(value: unknown, name = "location"): GeoFix {
  const item = record(value, name);
  const result: GeoFix = {
    latitude: number(item.latitude, `${name}.latitude`),
    longitude: number(item.longitude, `${name}.longitude`),
  };
  if (item.altitude !== undefined) result.altitude = number(item.altitude, `${name}.altitude`);
  if (item.satellites !== undefined) result.satellites = number(item.satellites, `${name}.satellites`);
  if (item.velocity !== undefined) result.velocity = number(item.velocity, `${name}.velocity`);
  return result;
}

function parseAppliedGeoFix(value: unknown, name = "location"): AppliedGeoFix {
  const item = record(value, name);
  return { ...parseGeoFix(item, name), appliedAt: string(item.appliedAt, `${name}.appliedAt`) };
}

export function parseLocationResponse(value: unknown): LocationResponse {
  const root = record(value, "location response");
  return {
    serial: string(root.serial, "location response.serial"),
    emulator: boolean(root.emulator, "location response.emulator"),
    location: root.location === null ? null : parseAppliedGeoFix(root.location),
  };
}

export function parseLocationUpdateResponse(value: unknown): LocationUpdateResponse {
  const root = record(value, "location update response");
  if (root.ok !== true) fail("location update response.ok must be true");
  return { ok: true, location: parseAppliedGeoFix(root.location) };
}

export function parseRoutePlaybackSnapshot(value: unknown): RoutePlaybackSnapshot {
  const root = record(value, "route snapshot");
  return {
    status: oneOf(
      root.status,
      ["idle", "running", "paused", "completed", "error"] as const,
      "route snapshot.status",
    ),
    waypointCount: number(root.waypointCount, "route snapshot.waypointCount"),
    totalMeters: number(root.totalMeters, "route snapshot.totalMeters"),
    progressMeters: number(root.progressMeters, "route snapshot.progressMeters"),
    speedKph: number(root.speedKph, "route snapshot.speedKph"),
    multiplier: number(root.multiplier, "route snapshot.multiplier"),
    intervalMs: number(root.intervalMs, "route snapshot.intervalMs"),
    loop: boolean(root.loop, "route snapshot.loop"),
    startedAt: nullableString(root.startedAt, "route snapshot.startedAt"),
    updatedAt: nullableString(root.updatedAt, "route snapshot.updatedAt"),
    pausedAt: nullableString(root.pausedAt, "route snapshot.pausedAt"),
    completedAt: nullableString(root.completedAt, "route snapshot.completedAt"),
    lastError: nullableString(root.lastError, "route snapshot.lastError"),
    currentLocation:
      root.currentLocation === null
        ? null
        : parseAppliedGeoFix(root.currentLocation, "route snapshot.currentLocation"),
  };
}

export function parseRouteMutationResponse(value: unknown): RouteMutationResponse {
  const root = record(value, "route mutation response");
  if (root.ok !== true) fail("route mutation response.ok must be true");
  return { ok: true, route: parseRoutePlaybackSnapshot(root.route) };
}

function parseSessionEvent(value: unknown, index: number): SessionEvent {
  const item = record(value, `session.events[${index}]`);
  const base = {
    id: number(item.id, `session.events[${index}].id`),
    at: string(item.at, `session.events[${index}].at`),
    delayMs: number(item.delayMs, `session.events[${index}].delayMs`),
    source: string(item.source, `session.events[${index}].source`),
  };
  if (item.kind === "gesture") {
    const gesture = parseGesture(item.gesture);
    return { ...base, kind: "gesture", gesture };
  }
  if (item.kind === "location") {
    return {
      ...base,
      kind: "location",
      location: parseGeoFix(item.location, `session.events[${index}].location`),
    };
  }
  return fail(`session.events[${index}].kind is invalid`);
}

export function parseSessionSnapshot(value: unknown): SessionSnapshot {
  const root = record(value, "session snapshot");
  if (!Array.isArray(root.events)) fail("session snapshot.events must be an array");
  return {
    events: root.events.map(parseSessionEvent),
    recording: boolean(root.recording, "session snapshot.recording"),
    replaying: boolean(root.replaying, "session snapshot.replaying"),
    replayStartedAt: nullableString(root.replayStartedAt, "session snapshot.replayStartedAt"),
    replayCompletedAt: nullableString(root.replayCompletedAt, "session snapshot.replayCompletedAt"),
    lastError: nullableString(root.lastError, "session snapshot.lastError"),
  };
}

export function parseSessionMutationResponse(value: unknown): SessionMutationResponse {
  const root = record(value, "session mutation response");
  if (root.ok !== true) fail("session mutation response.ok must be true");
  return { ok: true, session: parseSessionSnapshot(root.session) };
}

export function parseEmptyResponse(value: unknown): EmptyResponse {
  const root = record(value, "empty response");
  if (root.ok !== true) fail("empty response.ok must be true");
  return { ok: true };
}

export function parseAppActionResponse(value: unknown): AppActionResponse {
  const root = record(value, "app action response");
  if (root.ok !== true) fail("app action response.ok must be true");
  return { ok: true, output: string(root.output, "app action response.output") };
}

export function parseFileImportResponse(value: unknown): FileImportResponse {
  const root = record(value, "file import response");
  if (root.ok !== true) fail("file import response.ok must be true");
  return {
    ok: true,
    output: string(root.output, "file import response.output"),
    path: string(root.path, "file import response.path"),
    kind: oneOf(root.kind, ["image", "video", "file"] as const, "file import response.kind"),
  };
}

export function parseScreenshotBase64Response(value: unknown): ScreenshotBase64Response {
  const root = record(value, "screenshot response");
  if (root.ok !== true) fail("screenshot response.ok must be true");
  if (root.mimeType !== "image/png") fail("screenshot response.mimeType must be image/png");
  return {
    ok: true,
    mimeType: "image/png",
    data: string(root.data, "screenshot response.data"),
  };
}

export function parseLogcatEvent<Event extends keyof LogcatEventMap>(
  event: Event,
  value: unknown,
): LogcatEventMap[Event] {
  const item = record(value, `logcat ${event} event`);
  if (event === "ready") {
    if (!Array.isArray(item.pids)) fail("logcat ready event.pids must be an array");
    return {
      serial: string(item.serial, "logcat ready event.serial"),
      package: nullableString(item.package, "logcat ready event.package"),
      pids: item.pids.map((pid, index) =>
        string(pid, `logcat ready event.pids[${index}]`)
      ),
      search: nullableString(item.search, "logcat ready event.search"),
    } as LogcatEventMap[Event];
  }
  if (event === "log" || event === "error") {
    return {
      line: string(item.line, `logcat ${event} event.line`),
      at: string(item.at, `logcat ${event} event.at`),
    } as LogcatEventMap[Event];
  }
  return {
    code: item.code === null ? null : number(item.code, "logcat close event.code"),
    signal: nullableString(item.signal, "logcat close event.signal"),
  } as LogcatEventMap[Event];
}

export function parseLogcatEventJson<Event extends keyof LogcatEventMap>(
  event: Event,
  raw: string,
): LogcatEventMap[Event] {
  try {
    return parseLogcatEvent(event, JSON.parse(raw) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new TypeError(`logcat ${event} event must be valid JSON`);
    }
    throw error;
  }
}

function parseScreenshotResponse(value: unknown): ScreenshotBase64Response | BinaryPngResponse {
  return value instanceof Uint8Array ? value : parseScreenshotBase64Response(value);
}

function parseFrameStatsSummary(value: unknown): FrameStatsSummary | null {
  if (value === null) return null;
  const item = record(value, "health response.frameStats");
  const interval = item.intervalMs === null
    ? null
    : record(item.intervalMs, "health response.frameStats.intervalMs");
  return {
    windowFrames: number(item.windowFrames, "health response.frameStats.windowFrames"),
    intervalMs: interval === null
      ? null
      : {
          p50: number(interval.p50, "health response.frameStats.intervalMs.p50"),
          p95: number(interval.p95, "health response.frameStats.intervalMs.p95"),
          max: number(interval.max, "health response.frameStats.intervalMs.max"),
        },
    avgKeyFrameBytes: item.avgKeyFrameBytes === null
      ? null
      : number(item.avgKeyFrameBytes, "health response.frameStats.avgKeyFrameBytes"),
    avgDeltaFrameBytes: item.avgDeltaFrameBytes === null
      ? null
      : number(item.avgDeltaFrameBytes, "health response.frameStats.avgDeltaFrameBytes"),
    keyFramesInWindow: number(
      item.keyFramesInWindow,
      "health response.frameStats.keyFramesInWindow",
    ),
  };
}

function parseHealthClient(value: unknown, index: number): HealthClient {
  const item = record(value, `health response.clientsDetail[${index}]`);
  return {
    id: number(item.id, `health response.clientsDetail[${index}].id`),
    frameMeta: boolean(
      item.frameMeta,
      `health response.clientsDetail[${index}].frameMeta`,
    ),
    sentFrames: number(
      item.sentFrames,
      `health response.clientsDetail[${index}].sentFrames`,
    ),
    droppedFrames: number(
      item.droppedFrames,
      `health response.clientsDetail[${index}].droppedFrames`,
    ),
    backpressureEvents: number(
      item.backpressureEvents,
      `health response.clientsDetail[${index}].backpressureEvents`,
    ),
    bufferedBytes: number(
      item.bufferedBytes,
      `health response.clientsDetail[${index}].bufferedBytes`,
    ),
    awaitingKeyFrame: boolean(
      item.awaitingKeyFrame,
      `health response.clientsDetail[${index}].awaitingKeyFrame`,
    ),
  };
}

function parseErrorMeta(value: unknown): Record<string, string | number> | null {
  if (value === null) return null;
  const item = record(value, "health response.lastErrorMeta");
  const result: Record<string, string | number> = {};
  for (const [key, entry] of Object.entries(item)) {
    if (typeof entry === "string") result[key] = entry;
    else result[key] = number(entry, `health response.lastErrorMeta.${key}`);
  }
  return result;
}

export function parseHealthResponse(value: unknown): HealthResponse {
  const root = record(value, "health response");
  // Validate the fields consumed by clients plus the nested state contracts.
  const health: HealthResponse = {
    ok: boolean(root.ok, "health response.ok"),
    status: oneOf(root.status, ["streaming", "stopped", "error"] as const, "health response.status"),
    serial: string(root.serial, "health response.serial"),
    device: string(root.device, "health response.device"),
    codec: string(root.codec, "health response.codec"),
    size: parseDeviceSize(root.size, "health response.size"),
    clients: number(root.clients, "health response.clients"),
    frames: number(root.frames, "health response.frames"),
    sourceFps: number(root.sourceFps, "health response.sourceFps"),
    frameStats: parseFrameStatsSummary(root.frameStats),
    configPackets: number(root.configPackets, "health response.configPackets"),
    droppedFrames: number(root.droppedFrames, "health response.droppedFrames"),
    backpressureEvents: number(root.backpressureEvents, "health response.backpressureEvents"),
    videoResetRequests: number(root.videoResetRequests, "health response.videoResetRequests"),
    lastVideoResetAt: nullableString(root.lastVideoResetAt, "health response.lastVideoResetAt"),
    lastVideoResetReason: nullableString(root.lastVideoResetReason, "health response.lastVideoResetReason"),
    location: root.location === null ? null : parseAppliedGeoFix(root.location, "health response.location"),
    route: parseRoutePlaybackSnapshot(root.route),
    session: parseSessionSnapshot(root.session),
    clientsDetail: Array.isArray(root.clientsDetail)
      ? root.clientsDetail.map(parseHealthClient)
      : fail("health response.clientsDetail must be an array"),
    startedAt: string(root.startedAt, "health response.startedAt"),
    stoppedAt: nullableString(root.stoppedAt, "health response.stoppedAt"),
    lastFrameAt: nullableString(root.lastFrameAt, "health response.lastFrameAt"),
    lastError: nullableString(root.lastError, "health response.lastError"),
    lastErrorCode: nullableString(root.lastErrorCode, "health response.lastErrorCode"),
    lastErrorMeta: parseErrorMeta(root.lastErrorMeta),
  };
  if (root.sessionGeneration !== undefined) {
    const generation = number(
      root.sessionGeneration,
      "health response.sessionGeneration",
    );
    if (!Number.isSafeInteger(generation) || generation < 0) {
      fail("health response.sessionGeneration must be a non-negative safe integer");
    }
    health.sessionGeneration = generation;
  }
  return health;
}

type AnySuccessParser = (value: unknown) => unknown;
type ApiSuccessParserMap = {
  [Path in ApiPath]: {
    [Method in ApiMethod<Path>]: (
      value: unknown,
    ) => ApiSuccessResponse<Path, Method>;
  };
};

const unsupportedStreamingResponse = (): never => fail("streaming responses are not JSON API payloads");

/** Runtime parser table used by both server tests and the typed UI client. */
export const API_SUCCESS_PARSERS = {
  "/api": { GET: parseApiInfoResponse },
  "/api/devices": { GET: parseDeviceListResponse },
  "/api/device-grid": { GET: parseDeviceGridResponse },
  "/api/devices/select": { POST: parseDeviceSelectionResponse },
  "/api/avds/start": { POST: parseAvdStartResponse },
  "/api/avds/stop": { POST: parseAvdStopResponse },
  "/api/orientation": { GET: parseOrientationResponse, POST: parseOrientationResponse },
  "/api/night-mode": { GET: parseNightModeResponse, POST: parseNightModeResponse },
  "/api/font-scale": { GET: parseFontScaleResponse, POST: parseFontScaleResponse },
  "/api/network": { GET: parseNetworkResponse, POST: parseNetworkResponse },
  "/api/logcat": { GET: unsupportedStreamingResponse },
  "/api/screenshot": { GET: parseScreenshotResponse, POST: parseScreenshotResponse },
  "/api/foreground": { GET: parseForegroundResponse },
  "/api/accessibility": { GET: parseAccessibilitySnapshot },
  "/api/accessibility/tap": { POST: parseAccessibilityTapResponse },
  "/api/tap": { POST: parseEmptyResponse },
  "/api/swipe": { POST: parseEmptyResponse },
  "/api/text": { POST: parseEmptyResponse },
  "/api/key": { POST: parseEmptyResponse },
  "/api/session": { GET: parseSessionSnapshot, DELETE: parseSessionMutationResponse },
  "/api/session/replay": { POST: parseSessionMutationResponse },
  "/api/session/replay/stop": { POST: parseSessionMutationResponse },
  "/api/apps/install": { POST: parseAppActionResponse },
  "/api/files/import": { POST: parseFileImportResponse },
  "/api/apps/launch": { POST: parseAppActionResponse },
  "/api/apps/clear": { POST: parseAppActionResponse },
  "/api/apps/force-stop": { POST: parseAppActionResponse },
  "/api/apps/grant": { POST: parseAppActionResponse },
  "/api/location": { GET: parseLocationResponse, POST: parseLocationUpdateResponse },
  "/api/route": {
    GET: parseRoutePlaybackSnapshot,
    POST: parseRouteMutationResponse,
    DELETE: parseRouteMutationResponse,
  },
  "/api/route/control": { POST: parseRouteMutationResponse },
} satisfies ApiSuccessParserMap;

export function parseApiSuccess<
  Path extends ApiPath,
  Method extends ApiMethod<Path>,
>(path: Path, method: Method, value: unknown): ApiSuccessResponse<Path, Method> {
  const methods = API_SUCCESS_PARSERS[path] as Partial<Record<ApiMethod<Path>, AnySuccessParser>>;
  const parser = methods[method];
  if (!parser) fail(`no API parser registered for ${method} ${path}`);
  return parser(value) as ApiSuccessResponse<Path, Method>;
}

export function parseApiResponse<
  Path extends ApiPath,
  Method extends ApiMethod<Path>,
>(path: Path, method: Method, value: unknown): ApiResponse<Path, Method> {
  return isRecord(value) && value.ok === false
    ? parseApiFailure(value)
    : parseApiSuccess(path, method, value);
}
