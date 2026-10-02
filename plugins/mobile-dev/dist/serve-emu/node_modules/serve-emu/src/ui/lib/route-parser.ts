export type RoutePoint = {
  latitude: number;
  longitude: number;
  altitude?: number;
};

export type RouteFormat = "gpx" | "kml" | "json";

export type RouteParseLimits = {
  maxWaypoints: number;
  maxComplexity: number;
  maxDepth: number;
};

export const DEFAULT_ROUTE_PARSE_LIMITS: Readonly<RouteParseLimits> = Object.freeze({
  maxWaypoints: 10_000,
  maxComplexity: 100_000,
  maxDepth: 128,
});

// Keep local route input below the server's bounded request-body budget. The
// UI can use this constant for a preflight check; the worker enforces it again
// before calling File.text().
export const DEFAULT_MAX_ROUTE_FILE_BYTES = 2 * 1024 * 1024;

export type RouteParseErrorCode =
  | "cancelled"
  | "complexity-limit"
  | "dangerous-xml"
  | "depth-limit"
  | "file-too-large"
  | "invalid-json"
  | "invalid-route"
  | "invalid-xml"
  | "waypoint-limit";

export class RouteParseError extends Error {
  readonly code: RouteParseErrorCode;

  constructor(code: RouteParseErrorCode, message: string) {
    super(message);
    this.name = "RouteParseError";
    this.code = code;
  }
}

export type RouteParseProgress = {
  stage: "parsing";
  format: RouteFormat;
  processed: number;
  waypoints: number;
};

export type RouteParseOptions = {
  limits?: Partial<RouteParseLimits>;
  signal?: AbortSignal;
  onProgress?: (progress: RouteParseProgress) => void;
  /** Primarily useful for deterministic tests. */
  yieldEvery?: number;
  /** Primarily useful for deterministic tests. */
  yieldControl?: () => Promise<void>;
};

export type RouteParseResult = {
  format: RouteFormat;
  points: RoutePoint[];
  complexity: number;
};

const DEFAULT_YIELD_EVERY = 512;

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RouteParseError("invalid-route", "route parser limits must be positive integers");
  }
  return Math.min(value, fallback);
}

function resolveLimits(input: Partial<RouteParseLimits> | undefined): RouteParseLimits {
  return {
    maxWaypoints: positiveInteger(input?.maxWaypoints, DEFAULT_ROUTE_PARSE_LIMITS.maxWaypoints),
    maxComplexity: positiveInteger(input?.maxComplexity, DEFAULT_ROUTE_PARSE_LIMITS.maxComplexity),
    maxDepth: positiveInteger(input?.maxDepth, DEFAULT_ROUTE_PARSE_LIMITS.maxDepth),
  };
}

function cancellationError(): RouteParseError {
  return new RouteParseError("cancelled", "route parsing was cancelled");
}

class ParseBudget {
  readonly limits: RouteParseLimits;
  readonly format: RouteFormat;
  readonly signal: AbortSignal | undefined;
  readonly onProgress: ((progress: RouteParseProgress) => void) | undefined;
  readonly yieldEvery: number;
  readonly yieldControl: () => Promise<void>;
  complexity = 0;
  waypoints = 0;
  #sinceYield = 0;

  constructor(format: RouteFormat, options: RouteParseOptions) {
    this.format = format;
    this.limits = resolveLimits(options.limits);
    this.signal = options.signal;
    this.onProgress = options.onProgress;
    this.yieldEvery = positiveInteger(options.yieldEvery, DEFAULT_YIELD_EVERY);
    this.yieldControl =
      options.yieldControl ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }

  throwIfCancelled(): void {
    if (this.signal?.aborted) throw cancellationError();
  }

  report(): void {
    this.onProgress?.({
      stage: "parsing",
      format: this.format,
      processed: this.complexity,
      waypoints: this.waypoints,
    });
  }

  async visit(amount = 1): Promise<void> {
    this.throwIfCancelled();
    if (!Number.isSafeInteger(amount) || amount < 1) return;
    if (this.complexity > this.limits.maxComplexity - amount) {
      throw new RouteParseError(
        "complexity-limit",
        `route exceeds the ${this.limits.maxComplexity} item complexity limit`,
      );
    }
    this.complexity += amount;
    this.#sinceYield += amount;
    if (this.#sinceYield < this.yieldEvery) return;
    this.#sinceYield = 0;
    this.report();
    await this.yieldControl();
    this.throwIfCancelled();
  }

  checkDepth(depth: number): void {
    if (depth > this.limits.maxDepth) {
      throw new RouteParseError(
        "depth-limit",
        `route exceeds the ${this.limits.maxDepth} level nesting limit`,
      );
    }
  }

  ensurePending(currentPending: number, additions: number): void {
    if (this.complexity + currentPending + additions > this.limits.maxComplexity) {
      throw new RouteParseError(
        "complexity-limit",
        `route exceeds the ${this.limits.maxComplexity} item complexity limit`,
      );
    }
  }

  addPoint(points: RoutePoint[], point: RoutePoint): void {
    this.throwIfCancelled();
    if (this.waypoints >= this.limits.maxWaypoints) {
      throw new RouteParseError(
        "waypoint-limit",
        `route exceeds the ${this.limits.maxWaypoints} waypoint limit`,
      );
    }
    points.push(point);
    this.waypoints += 1;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function pointFromValues(latitudeValue: unknown, longitudeValue: unknown, altitudeValue?: unknown): RoutePoint {
  const latitude = finiteNumber(latitudeValue);
  const longitude = finiteNumber(longitudeValue);
  const altitude = altitudeValue === undefined || altitudeValue === null || altitudeValue === ""
    ? undefined
    : finiteNumber(altitudeValue);
  if (latitude === undefined || latitude < -90 || latitude > 90) {
    throw new RouteParseError("invalid-route", "waypoint latitude must be between -90 and 90");
  }
  if (longitude === undefined || longitude < -180 || longitude > 180) {
    throw new RouteParseError("invalid-route", "waypoint longitude must be between -180 and 180");
  }
  if (altitudeValue !== undefined && altitudeValue !== null && altitudeValue !== "" && altitude === undefined) {
    throw new RouteParseError("invalid-route", "waypoint altitude must be finite");
  }
  if (altitude !== undefined && (altitude < -1_000 || altitude > 100_000)) {
    throw new RouteParseError(
      "invalid-route",
      "waypoint altitude must be between -1000 and 100000",
    );
  }
  return { latitude, longitude, ...(altitude === undefined ? {} : { altitude }) };
}

function pointFromRecord(value: unknown): RoutePoint {
  if (!isRecord(value)) throw new RouteParseError("invalid-route", "waypoint must be an object");
  return pointFromValues(
    value.latitude ?? value.lat,
    value.longitude ?? value.lng ?? value.lon,
    value.altitude ?? value.alt ?? value.ele,
  );
}

async function parseWaypointArray(
  values: unknown[],
  budget: ParseBudget,
  points: RoutePoint[],
): Promise<void> {
  for (const value of values) {
    await budget.visit();
    budget.addPoint(points, pointFromRecord(value));
  }
}

type JsonTask = { kind: "geo" | "coordinates"; value: unknown; depth: number };

async function parseGeoJson(value: unknown, budget: ParseBudget, points: RoutePoint[]): Promise<void> {
  const stack: JsonTask[] = [{ kind: "geo", value, depth: 1 }];
  while (stack.length > 0) {
    const task = stack.pop()!;
    budget.checkDepth(task.depth);
    await budget.visit();

    if (task.kind === "coordinates") {
      if (!Array.isArray(task.value)) {
        throw new RouteParseError("invalid-route", "GeoJSON coordinates must be arrays");
      }
      if (
        task.value.length >= 2 &&
        typeof task.value[0] === "number" &&
        typeof task.value[1] === "number"
      ) {
        budget.addPoint(points, pointFromValues(task.value[1], task.value[0], task.value[2]));
        continue;
      }
      if (task.value.length === 0) continue;
      budget.ensurePending(stack.length, task.value.length);
      for (let index = task.value.length - 1; index >= 0; index -= 1) {
        if (!Array.isArray(task.value[index])) {
          throw new RouteParseError("invalid-route", "GeoJSON coordinate nesting is malformed");
        }
        stack.push({ kind: "coordinates", value: task.value[index], depth: task.depth + 1 });
      }
      continue;
    }

    if (!isRecord(task.value) || typeof task.value.type !== "string") {
      throw new RouteParseError("invalid-route", "GeoJSON objects require a type");
    }
    switch (task.value.type) {
      case "FeatureCollection": {
        if (!Array.isArray(task.value.features)) {
          throw new RouteParseError("invalid-route", "GeoJSON FeatureCollection requires features");
        }
        budget.ensurePending(stack.length, task.value.features.length);
        for (let index = task.value.features.length - 1; index >= 0; index -= 1) {
          stack.push({ kind: "geo", value: task.value.features[index], depth: task.depth + 1 });
        }
        break;
      }
      case "Feature":
        if (task.value.geometry === null) break;
        stack.push({ kind: "geo", value: task.value.geometry, depth: task.depth + 1 });
        break;
      case "GeometryCollection": {
        if (!Array.isArray(task.value.geometries)) {
          throw new RouteParseError("invalid-route", "GeoJSON GeometryCollection requires geometries");
        }
        budget.ensurePending(stack.length, task.value.geometries.length);
        for (let index = task.value.geometries.length - 1; index >= 0; index -= 1) {
          stack.push({ kind: "geo", value: task.value.geometries[index], depth: task.depth + 1 });
        }
        break;
      }
      case "Point":
      case "MultiPoint":
      case "LineString":
      case "MultiLineString":
      case "Polygon":
      case "MultiPolygon":
        stack.push({ kind: "coordinates", value: task.value.coordinates, depth: task.depth + 1 });
        break;
      default:
        throw new RouteParseError("invalid-route", `unsupported GeoJSON type: ${task.value.type}`);
    }
  }
}

async function parseJson(text: string, budget: ParseBudget): Promise<RoutePoint[]> {
  let value: unknown;
  try {
    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    value = JSON.parse(source) as unknown;
  } catch {
    throw new RouteParseError("invalid-json", "route JSON could not be parsed");
  }
  budget.throwIfCancelled();
  const points: RoutePoint[] = [];
  await budget.visit();
  if (Array.isArray(value)) {
    await parseWaypointArray(value, budget, points);
  } else if (isRecord(value) && Array.isArray(value.waypoints)) {
    await parseWaypointArray(value.waypoints, budget, points);
  } else {
    await parseGeoJson(value, budget, points);
  }
  return points;
}

type XmlToken =
  | { type: "open"; name: string; localName: string; attributes: Map<string, string>; selfClosing: boolean }
  | { type: "close"; name: string; localName: string }
  | { type: "text"; text: string };

function xmlNameStart(character: string): boolean {
  return /[A-Za-z_:]/.test(character);
}

function xmlNameCharacter(character: string): boolean {
  return /[A-Za-z0-9_.:-]/.test(character);
}

function localXmlName(name: string): string {
  const colon = name.lastIndexOf(":");
  return (colon < 0 ? name : name.slice(colon + 1)).toLowerCase();
}

function findTagEnd(text: string, start: number): number {
  let quote = "";
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function parseOpenTag(source: string): XmlToken & { type: "open" } {
  let index = 0;
  while (/\s/.test(source[index] ?? "")) index += 1;
  const nameStart = index;
  if (!xmlNameStart(source[index] ?? "")) {
    throw new RouteParseError("invalid-xml", "XML tag name is invalid");
  }
  index += 1;
  while (xmlNameCharacter(source[index] ?? "")) index += 1;
  const name = source.slice(nameStart, index);
  const attributes = new Map<string, string>();
  let selfClosing = false;
  while (index < source.length) {
    while (/\s/.test(source[index] ?? "")) index += 1;
    if (index >= source.length) break;
    if (source[index] === "/") {
      selfClosing = true;
      index += 1;
      while (/\s/.test(source[index] ?? "")) index += 1;
      if (index !== source.length) throw new RouteParseError("invalid-xml", "XML self-closing tag is invalid");
      break;
    }
    const attributeStart = index;
    if (!xmlNameStart(source[index] ?? "")) {
      throw new RouteParseError("invalid-xml", "XML attribute name is invalid");
    }
    index += 1;
    while (xmlNameCharacter(source[index] ?? "")) index += 1;
    const attributeName = localXmlName(source.slice(attributeStart, index));
    while (/\s/.test(source[index] ?? "")) index += 1;
    if (source[index] !== "=") throw new RouteParseError("invalid-xml", "XML attributes require quoted values");
    index += 1;
    while (/\s/.test(source[index] ?? "")) index += 1;
    const quote = source[index];
    if (quote !== '"' && quote !== "'") {
      throw new RouteParseError("invalid-xml", "XML attributes require quoted values");
    }
    index += 1;
    const valueStart = index;
    while (index < source.length && source[index] !== quote) index += 1;
    if (index >= source.length) throw new RouteParseError("invalid-xml", "XML attribute quote is not closed");
    if (attributes.has(attributeName)) {
      throw new RouteParseError("invalid-xml", `duplicate XML attribute: ${attributeName}`);
    }
    attributes.set(attributeName, source.slice(valueStart, index));
    index += 1;
  }
  return { type: "open", name, localName: localXmlName(name), attributes, selfClosing };
}

async function* tokenizeXml(text: string, budget: ParseBudget): AsyncGenerator<XmlToken> {
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (index < text.length) {
    budget.throwIfCancelled();
    const open = text.indexOf("<", index);
    if (open < 0) {
      if (text.slice(index).trim()) yield { type: "text", text: text.slice(index) };
      break;
    }
    if (open > index) yield { type: "text", text: text.slice(index, open) };
    if (text.startsWith("<!--", open)) {
      const end = text.indexOf("-->", open + 4);
      if (end < 0) throw new RouteParseError("invalid-xml", "XML comment is not closed");
      await budget.visit();
      index = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", open)) {
      const end = text.indexOf("]]>", open + 9);
      if (end < 0) throw new RouteParseError("invalid-xml", "XML CDATA is not closed");
      await budget.visit();
      yield { type: "text", text: text.slice(open + 9, end) };
      index = end + 3;
      continue;
    }
    if (text.startsWith("<?", open)) {
      const end = text.indexOf("?>", open + 2);
      if (end < 0) throw new RouteParseError("invalid-xml", "XML processing instruction is not closed");
      await budget.visit();
      index = end + 2;
      continue;
    }
    if (text.startsWith("<!", open)) {
      throw new RouteParseError("invalid-xml", "unsupported XML declaration");
    }
    const end = findTagEnd(text, open + 1);
    if (end < 0) throw new RouteParseError("invalid-xml", "XML tag is not closed");
    const source = text.slice(open + 1, end);
    await budget.visit();
    if (source.startsWith("/")) {
      const name = source.slice(1).trim();
      if (!name || !xmlNameStart(name[0]) || [...name].some((character) => !xmlNameCharacter(character))) {
        throw new RouteParseError("invalid-xml", "XML closing tag is invalid");
      }
      yield { type: "close", name, localName: localXmlName(name) };
    } else {
      yield parseOpenTag(source);
    }
    index = end + 1;
  }
}

function rejectDangerousXml(text: string): void {
  if (/<\s*!\s*DOCTYPE\b/i.test(text) || /<\s*!\s*ENTITY\b/i.test(text)) {
    throw new RouteParseError("dangerous-xml", "DOCTYPE and entity declarations are not allowed in route XML");
  }
}

function parseKmlCoordinateTuple(tuple: string): RoutePoint {
  const firstComma = tuple.indexOf(",");
  const secondComma = firstComma < 0 ? -1 : tuple.indexOf(",", firstComma + 1);
  if (firstComma < 1) throw new RouteParseError("invalid-route", "KML coordinate tuple is invalid");
  const longitude = tuple.slice(0, firstComma);
  const latitude = secondComma < 0 ? tuple.slice(firstComma + 1) : tuple.slice(firstComma + 1, secondComma);
  const altitude = secondComma < 0 ? undefined : tuple.slice(secondComma + 1);
  return pointFromValues(latitude, longitude, altitude);
}

async function addKmlCoordinates(source: string, budget: ParseBudget, points: RoutePoint[]): Promise<void> {
  let index = 0;
  while (index < source.length) {
    while (/\s/.test(source[index] ?? "")) index += 1;
    if (index >= source.length) break;
    const start = index;
    while (index < source.length && !/\s/.test(source[index])) index += 1;
    await budget.visit();
    budget.addPoint(points, parseKmlCoordinateTuple(source.slice(start, index)));
  }
}

async function addGxCoordinate(source: string, budget: ParseBudget, points: RoutePoint[]): Promise<void> {
  const values = source.trim().split(/\s+/);
  await budget.visit();
  if (values.length < 2 || values.length > 3) {
    throw new RouteParseError("invalid-route", "KML gx:coord value is invalid");
  }
  budget.addPoint(points, pointFromValues(values[1], values[0], values[2]));
}

async function parseXml(text: string, format: "gpx" | "kml", budget: ParseBudget): Promise<RoutePoint[]> {
  rejectDangerousXml(text);
  const points: RoutePoint[] = [];
  const stack: string[] = [];
  let root: string | undefined;
  let rootClosed = false;
  let activeGpxPoint: { tag: string; point: RoutePoint; elevation: string[] } | undefined;
  let capture: { tag: "ele" | "coordinates" | "coord"; text: string[] } | undefined;

  for await (const token of tokenizeXml(text, budget)) {
    if (token.type === "text") {
      if (capture) capture.text.push(token.text);
      else if (stack.length === 0 && token.text.trim()) {
        throw new RouteParseError("invalid-xml", "XML text appears outside the root element");
      }
      continue;
    }
    if (token.type === "open") {
      if (!root) root = token.localName;
      else if (stack.length === 0 || rootClosed) {
        throw new RouteParseError("invalid-xml", "XML must contain exactly one root element");
      }
      budget.checkDepth(stack.length + 1);
      if (!token.selfClosing) stack.push(token.name);

      if (format === "gpx" && ["trkpt", "rtept", "wpt"].includes(token.localName)) {
        if (activeGpxPoint) throw new RouteParseError("invalid-xml", "GPX waypoint elements cannot be nested");
        activeGpxPoint = {
          tag: token.name,
          point: pointFromValues(token.attributes.get("lat"), token.attributes.get("lon")),
          elevation: [],
        };
        if (token.selfClosing) {
          budget.addPoint(points, activeGpxPoint.point);
          activeGpxPoint = undefined;
        }
      } else if (format === "gpx" && token.localName === "ele" && activeGpxPoint) {
        if (capture) throw new RouteParseError("invalid-xml", "GPX elevation elements cannot be nested");
        capture = { tag: "ele", text: [] };
      } else if (format === "kml" && (token.localName === "coordinates" || token.localName === "coord")) {
        if (capture) throw new RouteParseError("invalid-xml", "KML coordinate elements cannot be nested");
        capture = { tag: token.localName, text: [] };
      }

      if (token.selfClosing && capture) {
        if (capture.tag === "coordinates") await addKmlCoordinates("", budget, points);
        else if (capture.tag === "coord") throw new RouteParseError("invalid-route", "KML gx:coord is empty");
        capture = undefined;
      }
      continue;
    }

    const expected = stack.pop();
    if (expected !== token.name) throw new RouteParseError("invalid-xml", `XML closing tag does not match ${expected ?? "root"}`);
    if (format === "gpx" && capture?.tag === "ele" && token.localName === "ele") {
      if (!activeGpxPoint) throw new RouteParseError("invalid-xml", "GPX elevation has no waypoint");
      activeGpxPoint.elevation.push(capture.text.join(""));
      capture = undefined;
    } else if (
      format === "kml" &&
      capture &&
      (capture.tag === "coordinates" || capture.tag === "coord") &&
      token.localName === capture.tag
    ) {
      const coordinateText = capture.text.join("");
      if (capture.tag === "coordinates") await addKmlCoordinates(coordinateText, budget, points);
      else await addGxCoordinate(coordinateText, budget, points);
      capture = undefined;
    }

    if (format === "gpx" && activeGpxPoint?.tag === token.name) {
      const elevation = activeGpxPoint.elevation.join("").trim();
      if (elevation) activeGpxPoint.point = pointFromValues(
        activeGpxPoint.point.latitude,
        activeGpxPoint.point.longitude,
        elevation,
      );
      budget.addPoint(points, activeGpxPoint.point);
      activeGpxPoint = undefined;
    }
    if (stack.length === 0) rootClosed = true;
  }

  if (stack.length > 0 || capture || activeGpxPoint) {
    throw new RouteParseError("invalid-xml", "XML document ended before its elements were closed");
  }
  if (root !== format) {
    throw new RouteParseError("invalid-xml", `expected a ${format.toUpperCase()} root element`);
  }
  return points;
}

function detectFormat(text: string, fileName: string): RouteFormat {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".gpx")) return "gpx";
  if (lowerName.endsWith(".kml")) return "kml";
  if (lowerName.endsWith(".json") || lowerName.endsWith(".geojson")) return "json";
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (/^\s*</.test(withoutBom)) {
    if (/<(?:[A-Za-z_][\w.-]*:)?gpx(?:\s|>)/i.test(withoutBom)) return "gpx";
    if (/<(?:[A-Za-z_][\w.-]*:)?kml(?:\s|>)/i.test(withoutBom)) return "kml";
    throw new RouteParseError("invalid-xml", "route XML must have a GPX or KML root element");
  }
  return "json";
}

export async function parseRouteText(
  text: string,
  fileName: string,
  options: RouteParseOptions = {},
): Promise<RouteParseResult> {
  if (typeof text !== "string" || typeof fileName !== "string") {
    throw new RouteParseError("invalid-route", "route text and file name are required");
  }
  const format = detectFormat(text, fileName);
  const budget = new ParseBudget(format, options);
  budget.throwIfCancelled();
  budget.report();
  const points = format === "json"
    ? await parseJson(text, budget)
    : await parseXml(text, format, budget);
  budget.throwIfCancelled();
  if (points.length === 0) throw new RouteParseError("invalid-route", "route file has no waypoints");
  budget.report();
  return { format, points, complexity: budget.complexity };
}
