import type { HostAttachmentsSource, HostBridge } from "./host-bridge.ts";
import { TraceSiftController } from "./tracesift-controller.ts";

export type TraceSiftState = { open: boolean; available: boolean };

export class TraceSiftPanel {
  readonly controller: TraceSiftController;
  private state: TraceSiftState = { open: false, available: true };
  private listeners = new Set<() => void>();

  constructor(app: HostBridge, attachments?: HostAttachmentsSource) { this.controller = new TraceSiftController(app, { attachments }); }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(next: Partial<TraceSiftState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  setAvailable(available: boolean) { this.update({ available }); }
  hostChanged() { this.controller.hostChanged(); }
  show() { this.controller.restartReadiness(); this.update({ open: true }); }
  // Closing keeps the analysis, so reopening lands where it was left without another service round trip.
  hide() { this.update({ open: false }); }
  dispose() { this.controller.dispose(); this.listeners.clear(); }
}
