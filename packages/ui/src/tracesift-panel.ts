import type { HostAttachmentsSource, HostBridge } from "./host-bridge.ts";
import { TraceSiftController } from "./tracesift-controller.ts";
import { Store } from "./store.ts";

export type TraceSiftState = { open: boolean; available: boolean };

export class TraceSiftPanel extends Store<TraceSiftState> {
  readonly controller: TraceSiftController;

  constructor(app: HostBridge, attachments?: HostAttachmentsSource) { super({ open: false, available: true }); this.controller = new TraceSiftController(app, { attachments }); }

  setAvailable(available: boolean) { this.update({ available }); }
  hostChanged() { this.controller.hostChanged(); }
  show() { this.controller.restartReadiness(); this.update({ open: true }); }
  // Closing keeps the analysis, so reopening lands where it was left without another service round trip.
  hide() { this.update({ open: false }); }
  dispose() { this.controller.dispose(); this.close(); }
}
