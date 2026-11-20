import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceDevices } from "../src/workspace-devices.ts";
import type { SimulatorDevice } from "../../shared/src/protocol.ts";

const IPHONE: SimulatorDevice = {
  udid: "11111111-2222-3333-4444-555555555555", name: "iPhone 17 Pro", state: "Booted",
  platform: "ios", kind: "simulator",
} as SimulatorDevice;

/**
 * A simulator panel as `WorkspaceDevices` uses one: what it is listing, and whether it has been
 * asked to load. The real one is a few thousand lines around a canvas and a device stream.
 */
function panel(platform: "ios" | "android") {
  const stub = {
    platform,
    selected: undefined as SimulatorDevice | undefined,
    loads: 0,
    available: false,
    openingTarget: undefined as unknown,
    root: { hidden: true } as HTMLElement,
    load: async () => { stub.loads++; },
    setAvailable: (value: boolean) => { stub.available = value; },
    setOpeningTarget: (target: unknown) => { stub.openingTarget = target; },
  };
  return stub;
}

function workspace() {
  const panels = [panel("ios"), panel("android")] as const;
  const layouts: string[] = [];
  const devices = new WorkspaceDevices(panels as never, layout => layouts.push(layout));
  return { devices, panels, layouts };
}

test("a device discovery finishes a layout the first device list left unresolved", async () => {
  // The bug this covers: the opening tool starts the backend, so the first device list often comes
  // back before anything has been found. That resolved the layout to "none" once and for good —
  // both panels hidden, the platform selector reading "Platforms", and the panel telling the user
  // to boot the simulator they already had booted.
  const { devices, panels, layouts } = workspace();
  await devices.open({});
  await devices.setAvailable(true);
  assert.deepEqual(layouts, ["none"], "nothing was found yet, so nothing is shown yet");

  // Discovery finds the booted simulator a moment later and the panel selects it, which is the
  // selection change the workspace passes on.
  panels[0].selected = IPHONE;
  devices.settleLayout();

  assert.deepEqual(layouts, ["none", "ios"], "the mirror comes up on the platform that has a device");
});

test("a resolved layout and a layout the user chose are both left alone", async () => {
  const resolved = workspace();
  resolved.panels[0].selected = IPHONE;
  await resolved.devices.open({});
  await resolved.devices.setAvailable(true);
  assert.deepEqual(resolved.layouts, ["ios"]);
  // A second device appearing does not move a workspace that is already showing one.
  resolved.panels[1].selected = { ...IPHONE, platform: "android", kind: "emulator" } as SimulatorDevice;
  resolved.devices.settleLayout();
  assert.deepEqual(resolved.layouts, ["ios"], "an answered layout is not answered again");

  const chosen = workspace();
  await chosen.devices.open({});
  await chosen.devices.setAvailable(true);
  assert.deepEqual(chosen.layouts, ["none"]);
  chosen.devices.selectLayout();
  chosen.panels[0].selected = IPHONE;
  chosen.devices.settleLayout();
  assert.deepEqual(chosen.layouts, ["none"], "the user's own choice of platforms is never overridden");
});

test("a target naming a platform still decides the layout before anything is listed", async () => {
  const { devices, panels, layouts } = workspace();
  await devices.open({ platform: "android" });
  assert.deepEqual(layouts, ["android"], "the task's platform is known, so there is nothing to wait for");
  assert.deepEqual(panels.map(entry => entry.openingTarget), [{ platform: "android" }, { platform: "android" }]);
  // And a device turning up on the other platform does not move it.
  panels[0].selected = IPHONE;
  devices.settleLayout();
  assert.deepEqual(layouts, ["android"]);
});
