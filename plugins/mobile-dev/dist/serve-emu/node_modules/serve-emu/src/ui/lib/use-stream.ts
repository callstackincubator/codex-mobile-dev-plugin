import { deviceSessionStore } from "./device-session-store";
import { parseStreamHealth, type StreamHealth } from "./stream-state";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  deriveStreamDisplayStatus,
  gateStreamEventGeneration,
  isCurrentStreamClientEpoch,
  isStreamFatalStatus,
  reduceStreamLifecycle,
} from "./stream-lifecycle";
import type {
  StreamEventGenerationGate,
  StreamFatalStatus,
  StreamLifecycleState,
} from "./stream-lifecycle";
import type { StreamStats, StreamWorkerEvent } from "./stream-worker";

export type DeviceSize = { width: number; height: number };

export type { StreamStats };

export type StreamState = {
  controlError: string | null;
  status: string;
  generation: number;
  lastRenderedAt: number | null;
  fps: number;
  deviceSize: DeviceSize | null;
  stats: StreamStats | null;
};

export type Sender = (msg: Record<string, unknown>, ack?: boolean) => void;

type ApiInfo = StreamHealth;

// A canvas can transfer control to an OffscreenCanvas only once, so the worker
// that received it must be reused if the effect re-runs for the same element.
const workerByCanvas = new WeakMap<HTMLCanvasElement, Worker>();
const workerGenerationByCanvas = new WeakMap<HTMLCanvasElement, number>();
const clientEpochByCanvas = new WeakMap<HTMLCanvasElement, number>();

const HEALTH_POLL_INTERVAL_MS = 1_500;
const HEALTH_REQUEST_TIMEOUT_MS = 5_000;

export function useStream(canvasRef: RefObject<HTMLCanvasElement>) {
  const [state, setState] = useState<StreamState>({
    status: "connecting…",
    controlError: null,
    generation: 0,
    lastRenderedAt: null,
    fps: 0,
    deviceSize: null,
    stats: null,
  });
  const workerRef = useRef<Worker | null>(null);
  const clientEpochRef = useRef(0);
  const requestSequenceRef = useRef(0);
  const clearControlError = useCallback(() => setState((s) => ({ ...s, controlError: null })), []);

  const send = useCallback<Sender>((msg, ack = true) => {
    const clientEpoch = clientEpochRef.current;
    if (clientEpoch < 1) return;
    workerRef.current?.postMessage({
      type: "send",
      clientEpoch,
      text: JSON.stringify({ ...msg, requestId: `${clientEpoch}:${++requestSequenceRef.current}`, ...(!ack ? { ack: false } : {}) }),
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof Worker !== "function" || typeof canvas.transferControlToOffscreen !== "function") {
      setState((s) => ({ ...s, status: "OffscreenCanvas unsupported" }));
      return;
    }

    let cancelled = false;
    let currentGeneration = 0;
    let currentLifecycle: StreamLifecycleState | null = null;
    let lastRenderedAt: number | null = null;
    let serverTerminalStatus: string | null = null;
    let workerFatalStatus: StreamFatalStatus | null = null;
    let lifecycleTimer: ReturnType<typeof setInterval> | null = null;
    let healthTimer: ReturnType<typeof setTimeout> | null = null;
    let healthController: AbortController | null = null;
    let healthRequestSequence = 0;

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/ws?frame-meta=1`;

    let worker = workerByCanvas.get(canvas);
    const isNewWorker = !worker;
    if (!worker) {
      worker = new Worker(new URL("./stream-worker.ts", import.meta.url), { type: "module" });
      workerByCanvas.set(canvas, worker);
    }
    currentGeneration = workerGenerationByCanvas.get(canvas) ?? 0;
    let generationGate: StreamEventGenerationGate = {
      currentGeneration,
      awaitingConnectBoundary: !isNewWorker,
    };
    const previousClientEpoch = clientEpochByCanvas.get(canvas) ?? 0;
    const clientEpoch = previousClientEpoch + 1;
    clientEpochByCanvas.set(canvas, clientEpoch);
    clientEpochRef.current = clientEpoch;
    workerRef.current = worker;

    const onMessage = (e: MessageEvent) => {
      if (cancelled) return;
      const msg = e.data as StreamWorkerEvent;
      // A transferred canvas keeps its worker across effect replay. The epoch
      // is the connect-command nonce, so events queued by the prior listener
      // cannot satisfy this setup's generation boundary.
      if (!isCurrentStreamClientEpoch(clientEpoch, msg.clientEpoch)) return;
      if (msg.type === "lifecycle" && msg.state.generation !== msg.generation) return;
      const gatedGeneration = gateStreamEventGeneration(
        generationGate,
        msg.generation,
        msg.type === "lifecycle" ? msg.state.reason : null,
      );
      generationGate = gatedGeneration.gate;
      const generationDisposition = gatedGeneration.disposition;
      if (
        generationDisposition === "invalid" ||
        generationDisposition === "stale" ||
        generationDisposition === "awaiting-boundary"
      ) {
        return;
      }

      const isNewGeneration = generationDisposition === "new-generation";
      if (isNewGeneration) {
        currentGeneration = generationGate.currentGeneration;
        workerGenerationByCanvas.set(canvas, currentGeneration);
        currentLifecycle = null;
        lastRenderedAt = null;
        // Terminal health belongs to the previous worker generation. A fresh
        // health response can re-assert it if the server is still terminal.
        serverTerminalStatus = null;
        workerFatalStatus = null;
        refreshHealthForGeneration();
      }

      if (msg.type === "lifecycle") {
        currentLifecycle = msg.state;
        if (
          msg.state.lastRenderedAt !== null &&
          (lastRenderedAt === null || msg.state.lastRenderedAt > lastRenderedAt)
        ) {
          lastRenderedAt = msg.state.lastRenderedAt;
        }
      } else if (msg.type === "rendered") {
        if (lastRenderedAt === null || msg.at > lastRenderedAt) lastRenderedAt = msg.at;
        if (currentLifecycle) {
          currentLifecycle = reduceStreamLifecycle(currentLifecycle, {
            type: "frame-rendered",
            generation: msg.generation,
            at: msg.at,
          });
        }
      }
      if (msg.type === "status" && isStreamFatalStatus(msg.status)) {
        workerFatalStatus = msg.status;
      }

      setState((prev) => {
        let next: StreamState = isNewGeneration
          ? {
              ...prev,
              status:
                serverTerminalStatus ??
                workerFatalStatus ??
                (currentLifecycle
                  ? deriveStreamDisplayStatus(currentLifecycle, Date.now())
                  : "connecting"),
              generation: currentGeneration,
              lastRenderedAt,
              fps: 0,
              stats: null,
            }
          : prev;

        if (
          next.generation !== currentGeneration ||
          next.lastRenderedAt !== lastRenderedAt
        ) {
          next = { ...next, generation: currentGeneration, lastRenderedAt };
        }

        if (msg.type === "control-error") {
          next = { ...next, controlError: msg.error };
        } else if (msg.type === "control-dropped") {
          next = { ...next, controlError: "Connection unavailable. Input was not sent." };
        } else if (msg.type === "lifecycle" || msg.type === "rendered") {
          if (currentLifecycle) {
            const status =
              serverTerminalStatus ??
              workerFatalStatus ??
              deriveStreamDisplayStatus(currentLifecycle, Date.now());
            if (next.status !== status) next = { ...next, status };
          }
        } else if (msg.type === "status") {
          const workerStatus =
            msg.status === "streaming" && lastRenderedAt === null
              ? currentLifecycle
                ? deriveStreamDisplayStatus(currentLifecycle, Date.now())
                : "connecting"
              : msg.status;
          const status = serverTerminalStatus ?? workerFatalStatus ?? workerStatus;
          if (next.status !== status) next = { ...next, status };
        } else if (msg.type === "session") {
          next = { ...next, deviceSize: msg.size };
        } else if (msg.type === "stats") {
          next = { ...next, fps: msg.stats.fps, stats: msg.stats };
        }

        return next;
      });
    };
    worker.addEventListener("message", onMessage);

    // Listen before init/connect: a reused worker can publish its clean
    // generation boundary synchronously with the command.
    if (isNewWorker) {
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage(
        { type: "init", clientEpoch, canvas: offscreen, url },
        [offscreen],
      );
    } else {
      setState((prev) => ({
        ...prev,
        status: "connecting",
        lastRenderedAt: null,
        fps: 0,
        stats: null,
      }));
      worker.postMessage({ type: "connect", clientEpoch });
    }

    lifecycleTimer = setInterval(() => {
      if (cancelled || !currentLifecycle) return;
      const status =
        serverTerminalStatus ??
        workerFatalStatus ??
        deriveStreamDisplayStatus(currentLifecycle, Date.now());
      setState((prev) => (prev.status === status ? prev : { ...prev, status }));
    }, 1_000);

    const applyServerStatus = (d: ApiInfo) => {
      serverTerminalStatus =
        d.status && d.status !== "streaming" ? d.lastError || d.status : null;
      setState((prev) => ({
        ...prev,
        deviceSize: d.size,
        ...(serverTerminalStatus ? { status: serverTerminalStatus } : {}),
      }));
    };

    function refreshHealthForGeneration() {
      if (cancelled) return;
      if (healthTimer !== null) {
        clearTimeout(healthTimer);
        healthTimer = null;
      }
      if (healthController) {
        // Its finally block observes the generation mismatch and schedules an
        // immediate replacement without overlapping requests.
        healthController.abort();
        return;
      }
      void pollHealth();
    }

    async function pollHealth() {
      if (cancelled) return;
      const requestSequence = ++healthRequestSequence;
      const sessionRequest = deviceSessionStore.beginHealthRequest();
      const requestGeneration = currentGeneration;
      const controller = new AbortController();
      healthController = controller;
      const requestTimeout = setTimeout(
        () => controller.abort(),
        HEALTH_REQUEST_TIMEOUT_MS,
      );

      try {
        const response = await fetch("/health", { signal: controller.signal });
        const data = parseStreamHealth(await response.json());
        if (
          cancelled ||
          controller.signal.aborted ||
          requestSequence !== healthRequestSequence ||
          requestGeneration !== currentGeneration
        ) {
          return;
        }
        if (!deviceSessionStore.applyHealth(data, sessionRequest)) return;
        applyServerStatus(data);
      } catch {
        // The stream lifecycle remains authoritative when metadata is
        // temporarily unavailable.
      } finally {
        clearTimeout(requestTimeout);
        if (healthController === controller) healthController = null;
        if (!cancelled && requestSequence === healthRequestSequence) {
          // If a stream boundary made this response stale, refresh metadata
          // immediately; otherwise keep the normal low-frequency cadence.
          const delay =
            requestGeneration === currentGeneration
              ? HEALTH_POLL_INTERVAL_MS
              : 0;
          healthTimer = setTimeout(() => void pollHealth(), delay);
        }
      }
    }
    void pollHealth();

    return () => {
      cancelled = true;
      healthRequestSequence++;
      healthController?.abort();
      if (healthTimer !== null) clearTimeout(healthTimer);
      if (lifecycleTimer !== null) clearInterval(lifecycleTimer);
      worker.removeEventListener("message", onMessage);
      worker.postMessage({ type: "stop", clientEpoch });
      if (clientEpochRef.current === clientEpoch) clientEpochRef.current = 0;
      workerRef.current = null;
    };
  }, [canvasRef]);

  return { state, send, clearControlError };
}
