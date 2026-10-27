/**
 * TraceSift as a workspace tool. The inline card is handed an analysis the model
 * already ran; here the reader starts one, so the panel owns the open state and
 * the same controller draws the cards and the explorer that follow.
 */

import type { HostBridge } from "./host-bridge.ts";
import { TraceSiftController } from "./tracesift-controller.ts";

export type TraceSiftState = { open: boolean; available: boolean };

export class TraceSiftPanel {
  readonly controller: TraceSiftController;
  private state: TraceSiftState = { open: false, available: true };
  private listeners = new Set<() => void>();
  /** Whether the saved project has been asked for; it is read once per frame. */
  private projectLoaded = false;

  constructor(app: HostBridge) { this.controller = new TraceSiftController(app); }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(next: Partial<TraceSiftState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  setAvailable(available: boolean) {
    // The host is connected by the time it can say so, which is the first moment
    // the saved project can be asked for; later calls repeat the same answer.
    if (available && !this.projectLoaded) { this.projectLoaded = true; void this.controller.loadProject(); }
    this.update({ available });
  }
  hostChanged() { this.controller.hostChanged(); }
  show() { this.controller.restartReadiness(); this.update({ open: true }); }
  // Closing keeps the analysis: reopening the tool should land where it was left,
  // and re-reading a profile costs a service round trip for nothing.
  hide() { this.update({ open: false }); }
  dispose() { this.controller.dispose(); this.listeners.clear(); }
}
