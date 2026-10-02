import { useSyncExternalStore } from "react";

export type DeviceSessionHealth = {
  serial?: string | null;
  generation?: number | null;
  sessionGeneration?: number | null;
};

export type DeviceSessionSnapshot = Readonly<{
  serial: string | null;
  sessionGeneration: number | null;
  revision: number;
  transitioning: boolean;
}>;

export type DeviceSessionHealthRequest = Readonly<{
  barrier: number;
  requestId: number;
}>;

export type DeviceSessionStore = {
  getSnapshot: () => DeviceSessionSnapshot;
  subscribe: (listener: () => void) => () => void;
  beginHealthRequest: () => DeviceSessionHealthRequest;
  applyHealth: (health: DeviceSessionHealth, request?: DeviceSessionHealthRequest) => boolean;
  beginTransition: (serial?: string | null) => void;
  endTransition: () => void;
};

function normalizedGeneration(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function createDeviceSessionStore(): DeviceSessionStore {
  let snapshot: DeviceSessionSnapshot = {
    serial: null,
    sessionGeneration: null,
    revision: 0,
    transitioning: false,
  };
  let barrier = 0;
  let nextRequestId = 0;
  let lastAppliedRequestId = 0;
  let transitionDepth = 0;
  const listeners = new Set<() => void>();

  const publish = (next: Omit<DeviceSessionSnapshot, "revision">) => {
    snapshot = { ...next, revision: snapshot.revision + 1 };
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    beginHealthRequest() {
      return { barrier, requestId: ++nextRequestId };
    },
    applyHealth(health, request) {
      if (snapshot.transitioning) return false;
      if (request) {
        if (request.barrier !== barrier || request.requestId < lastAppliedRequestId) return false;
        lastAppliedRequestId = request.requestId;
      }
      const serial = typeof health.serial === "string" && health.serial ? health.serial : null;
      const sessionGeneration = normalizedGeneration(health.generation ?? health.sessionGeneration);
      if (
        !snapshot.transitioning &&
        snapshot.serial === serial &&
        snapshot.sessionGeneration === sessionGeneration
      ) {
        return true;
      }
      publish({ serial, sessionGeneration, transitioning: false });
      return true;
    },
    beginTransition(serial = snapshot.serial) {
      transitionDepth += 1;
      barrier += 1;
      publish({
        serial: typeof serial === "string" && serial ? serial : null,
        sessionGeneration: null,
        transitioning: true,
      });
    },
    endTransition() {
      if (transitionDepth === 0) return;
      transitionDepth -= 1;
      if (transitionDepth > 0) return;
      barrier += 1;
      publish({
        serial: snapshot.serial,
        sessionGeneration: null,
        transitioning: false,
      });
    },
  };
}

export const deviceSessionStore = createDeviceSessionStore();

export function useDeviceSessionRevision(): number {
  return useSyncExternalStore(
    deviceSessionStore.subscribe,
    () => deviceSessionStore.getSnapshot().revision,
    () => 0,
  );
}

export function useDeviceSessionSnapshot(): DeviceSessionSnapshot {
  return useSyncExternalStore(
    deviceSessionStore.subscribe,
    deviceSessionStore.getSnapshot,
    deviceSessionStore.getSnapshot,
  );
}
