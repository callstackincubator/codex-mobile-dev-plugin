export type JsonResponseMetric = {
  responses: number;
  lastBytes: number;
  maxBytes: number;
  lastSerializationMs: number;
  maxSerializationMs: number;
  lastAt: string | null;
};

type JsonResponseTrackerDependencies = {
  measureNow?: () => number;
  wallNow?: () => Date;
};

function emptyMetric(): JsonResponseMetric {
  return {
    responses: 0,
    lastBytes: 0,
    maxBytes: 0,
    lastSerializationMs: 0,
    maxSerializationMs: 0,
    lastAt: null,
  };
}

function roundedMilliseconds(value: number): number {
  return Math.round(Math.max(0, value) * 1_000) / 1_000;
}

/** Serializes once while retaining compact response-size/timing diagnostics. */
export class JsonResponseTracker<Channel extends string> {
  readonly #metrics: Record<Channel, JsonResponseMetric>;
  readonly #measureNow: () => number;
  readonly #wallNow: () => Date;

  constructor(
    channels: readonly Channel[],
    dependencies: JsonResponseTrackerDependencies = {},
  ) {
    this.#metrics = Object.fromEntries(
      channels.map((channel) => [channel, emptyMetric()]),
    ) as Record<Channel, JsonResponseMetric>;
    this.#measureNow = dependencies.measureNow ?? performance.now.bind(performance);
    this.#wallNow = dependencies.wallNow ?? (() => new Date());
  }

  response(channel: Channel, value: unknown, init: ResponseInit = {}): Response {
    const started = this.#measureNow();
    const body = JSON.stringify(value);
    if (body === undefined) {
      throw new TypeError("JSON response value is not serializable");
    }
    const serializationMs = roundedMilliseconds(
      this.#measureNow() - started,
    );
    const bytes = Buffer.byteLength(body, "utf8");
    const metric = this.#metrics[channel];
    metric.responses++;
    metric.lastBytes = bytes;
    metric.maxBytes = Math.max(metric.maxBytes, bytes);
    metric.lastSerializationMs = serializationMs;
    metric.maxSerializationMs = Math.max(
      metric.maxSerializationMs,
      serializationMs,
    );
    metric.lastAt = this.#wallNow().toISOString();

    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json; charset=utf-8");
    }
    headers.set("Content-Length", String(bytes));
    return new Response(body, { ...init, headers });
  }

  snapshot(): Record<Channel, JsonResponseMetric> {
    const snapshot = {} as Record<Channel, JsonResponseMetric>;
    for (const channel of Object.keys(this.#metrics) as Channel[]) {
      snapshot[channel] = { ...this.#metrics[channel] };
    }
    return snapshot;
  }
}
