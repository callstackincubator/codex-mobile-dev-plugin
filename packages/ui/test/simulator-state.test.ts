import test from "node:test";
import assert from "node:assert/strict";
import { frameLayout } from "../src/device-frame-layout.ts";
import { deviceOptions, selectionMessage } from "../src/device-discovery.ts";
import { initialState, panelControls, panelNotice } from "../src/simulator-state.ts";
import type { PanelState } from "../src/simulator-state.ts";
import { streamOpenTools, streamTransports, transportFor } from "../src/stream-transports.ts";
import type { Status } from "@mobile-dev/shared/protocol.ts";
import { androidPhone, iphone, physicalBezel, physicalPhone, pixel } from "./simulator-fixture.ts";

const stage = { width: 300, height: 600 };
const video = { width: 390, height: 844 };
const status = (devices: Status["devices"]): Status => ({ connected: true, managed: true, baseUrl: "http://127.0.0.1:8421/", devices });

test("the frame layout fits each chrome to the stage", () => {
  const plain = frameLayout({ stage, video, showFrame: true, platform: "ios" });
  assert.equal(plain.chrome, "plain");
  const screenWidth = Math.min(stage.width - 14, (stage.height - 14) * video.width / video.height);
  assert.equal(plain.frame.width, `${screenWidth + 14}px`);
  assert.deepEqual(plain.screen, {});
  const bare = frameLayout({ stage, video, showFrame: false, platform: "android" });
  assert.equal(bare.chrome, "none");
  assert.equal(bare.frame.height, `${video.height * Math.min(stage.width / video.width, stage.height / video.height)}px`);
  assert.deepEqual(bare.screen, { left: "0", top: "0", width: "100%", height: "100%", borderRadius: "0" });
  const ninePatch = frameLayout({ stage, video, showFrame: true, platform: "android" });
  assert.equal(ninePatch.chrome, "nine-patch");
  assert.equal(ninePatch.ninePatch?.buttons.length, 2);
  assert.match(String(ninePatch.screen.borderRadius), /px$/);
  const bezel = frameLayout({ stage, video, bezel: physicalBezel, showFrame: true, platform: "ios" });
  assert.equal(bezel.chrome, "bezel");
  assert.equal(bezel.bezelImage, physicalBezel.image);
  assert.equal(bezel.screen.maskImage, `url("${physicalBezel.mask}")`);
  const scale = Math.min(stage.width / physicalBezel.viewport.width, stage.height / physicalBezel.viewport.height);
  assert.equal(bezel.frame.width, `${physicalBezel.viewport.width * scale}px`);
  const hidden = frameLayout({ stage, video, bezel: physicalBezel, showFrame: false, platform: "ios" });
  assert.equal(hidden.bezelImage, undefined, "Turning the frame off hides the bezel too.");
});

test("before the first frame only the bezel's cutout is placed", () => {
  const { rect, viewport, clipRadius } = physicalBezel;
  const layout = frameLayout({ stage, bezel: { ...physicalBezel, mask: undefined }, showFrame: true, platform: "ios" });
  assert.deepEqual(layout.frame, {});
  assert.deepEqual(layout.screen, {
    left: `${rect.x / viewport.width * 100}%`, top: `${rect.y / viewport.height * 100}%`,
    width: `${rect.width / viewport.width * 100}%`, height: `${rect.height / viewport.height * 100}%`,
    borderRadius: `${clipRadius / rect.width * 100}% / ${clipRadius / rect.height * 100}%`,
  });
});

test("the picker lists connected hardware first, then simulators or emulators with their runtimes", () => {
  const ios = deviceOptions(status([{ ...iphone, runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-0" }]), [physicalPhone], "ios");
  assert.deepEqual(ios.map(item => [item.group, item.label, item.canStop]), [["Connected devices", "Physical iPhone · Wi-Fi", false], ["Simulators", "iPhone · iOS 26.0", true]]);
  const android = deviceOptions(status([{ ...pixel, udid: "avd:Pixel", state: "Shutdown" }, { ...androidPhone, state: "unauthorized" }]), [], "android");
  assert.deepEqual(android.map(item => [item.group, item.label, item.running, item.canStop]), [["Connected devices", "Pixel 9 · USB · Unauthorized", false, false], ["Emulators", "Pixel", false, false]]);
});

test("selection messages explain unusable devices and leave a stopped or reconnecting screen alone", () => {
  const options = { platform: "android" as const, reconnecting: false, stopped: false };
  assert.equal(selectionMessage({ ...androidPhone, state: "unauthorized" }, options)?.title, "Pixel 9 · unauthorized");
  assert.equal(selectionMessage(undefined, { ...options, target: { kind: "physical" } })?.title, "Requested device unavailable.");
  assert.match(selectionMessage(undefined, options)?.title ?? "", /No Android devices/);
  assert.equal(selectionMessage(pixel, { ...options, stopped: true }), undefined);
  assert.equal(selectionMessage(physicalPhone, { ...options, reconnecting: true }), undefined);
});

test("each transport names its own tools, and telemetry reads the open tools from them", () => {
  assert.equal(transportFor(physicalPhone), "ios-physical");
  assert.equal(transportFor(androidPhone), "android");
  assert.equal(transportFor(iphone), "ios-simulator");
  assert.deepEqual([...streamOpenTools], ["mobile_stream_session", "mobile_android_stream_session", "mobile_ios_mirror_session"]);
  assert.deepEqual(streamTransports["ios-physical"].input.args({ id: "a", frameUri: "", epoch: 0, transport: "ios-physical", generation: 3, controller: new AbortController() }, []), { sessionId: "a", messages: [], generation: 3 });
});

const ready = (patch: Partial<PanelState>): PanelState => ({ ...initialState("ios", frameLayout({ stage, showFrame: true, platform: "ios" })), available: true, status: status([iphone]), ...patch });
const idle = { selecting: false, draft: false, capture: false };
const host = { canAttach: true, canAttachScreenshots: true, canMessage: true };

test("controls follow the state alone: busy actions, live streams and mirrored iPhones", () => {
  const live = panelControls(ready({ selected: iphone, link: { kind: "live", transport: "ios-simulator" } }), idle, host);
  assert.equal(live.buttons.every(button => !button.disabled), true);
  assert.equal(live.screenshot.disabled, false);
  assert.equal(live.start.disabled, true);
  const busy = panelControls(ready({ selected: iphone, link: { kind: "live", transport: "ios-simulator" }, pending: "screenshot" }), idle, host);
  assert.equal(busy.buttons[0].disabled, true);
  assert.equal(busy.picker.disabled, true);
  const selecting = panelControls(ready({ selected: iphone, link: { kind: "waiting", transport: "ios-simulator" } }), { selecting: true, draft: false, capture: true }, host);
  assert.equal(selecting.annotations.disabled, false, "A frozen selection survives a stream interruption.");
  const mirror = ready({ selected: physicalPhone, physical: [physicalPhone], link: { kind: "waiting", transport: "ios-physical" } });
  assert.equal(panelControls(mirror, idle, host).screenshot.disabled, true, "A mirrored iPhone's screenshot waits for its video.");
  const mirrored = panelControls({ ...mirror, link: { kind: "live", transport: "ios-physical" } }, idle, host);
  assert.equal(mirrored.screenshot.disabled, false);
  assert.equal(mirrored.appTools.disabled, true);
  assert.deepEqual(mirrored.buttons.map(button => [button.disabled, button.unsupported]), [[true, true], [true, true]]);
  assert.equal(panelControls(ready({ selected: { ...iphone, state: "Shutdown" } }), idle, host).start.disabled, false);
  assert.equal(panelControls(ready({ selected: iphone, link: { kind: "live", transport: "ios-simulator" } }), idle, { ...host, canAttachScreenshots: false }).screenshot.title, "This host does not support screenshot attachments");
});

test("the notice shows the most pressing message, and names the agent only where there is a chat", () => {
  const blocked = ready({ input: { blocked: true, repair: "" }, discoveryError: "Physical discovery requires Xcode 27" });
  assert.deepEqual(panelNotice(blocked, true), { message: "Simulator input is blocked. Ask the agent to repair it.", destructive: true });
  assert.equal(panelNotice(blocked, false).message, "Simulator input is blocked.");
  assert.equal(panelNotice({ ...blocked, input: { blocked: true, repair: "Input repaired automatically. Reopen your app." } }, true).message, "Input repaired automatically. Reopen your app.");
  assert.equal(panelNotice({ ...blocked, notice: "Reconnecting…" }, true).message, "Reconnecting…");
  assert.equal(panelNotice({ ...blocked, notice: "Reconnecting…", screenshotError: "The screenshot could not be attached to chat." }, true).message, "The screenshot could not be attached to chat.");
  assert.equal(panelNotice({ ...blocked, input: { blocked: false, repair: "" } }, true).message, "Physical discovery requires Xcode 27");
});
