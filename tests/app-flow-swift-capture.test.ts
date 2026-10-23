/**
 * The capture loop's contract with its two neighbours: `simctl` and the app's control channel.
 *
 * Both are stubbed — a real run needs a booted simulator and an installed build, which a unit suite
 * cannot assume. What is worth testing here is what the single-process loop promises: that the app
 * is launched once and not again between healthy screens, that a dead app still costs one screen
 * rather than the run, that a screen the parser refused is never presented, and that an
 * unsatisfied environment is reported rather than passed off as a clean capture.
 *
 * `simctl` is stubbed by putting a fake `xcrun` first on PATH, which is the only seam the module
 * offers and the same one a real run goes through. That fake toggles the stub app's liveness over
 * the control channel, so "crashed", "terminated" and "relaunched" are the same three states the
 * real loop sees.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureSwiftScreens, registryContents } from "../src/app-flow/swift-capture.ts";

/** A one-pixel PNG, so a written capture is distinguishable from an empty file. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

interface FakeApp {
  /** Screens the registry holds. */
  screens: string[];
  /** What the parser refused, as `/missing` reports it. */
  missing: Record<string, string[]>;
  /** Screens whose `/present` kills the app, as a crashing screen does. */
  crashOn?: Set<string>;
  /** Screens that report unsatisfied environment keys. */
  environmentMissing?: Record<string, string[]>;
  /** What `/screens` claims to be. Omitted means a build predating the field. */
  bundleId?: string;
  /** `/screens` requests to drop before answering, as a real app does while it is starting. */
  deadPolls?: number;
  /** Presentation modes this build knows. Any other is refused, as the harness now refuses one. */
  modes?: Set<string>;
}

/** What the fake `xcrun` was asked to do, so a test can assert how often the app was launched. */
interface SimctlLog {
  lines(): Promise<string[]>;
}

async function harness(
  t: test.TestContext,
  app: FakeApp
): Promise<{ controlUrl: string; simctl: SimctlLog }> {
  let alive = true;
  let dropped = 0;

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    // The liveness toggle is the fake `xcrun` talking, so it answers whatever the app's state.
    if (url.pathname === "/__alive") {
      alive = url.searchParams.get("v") === "1";
      response.writeHead(200);
      response.end("ok");
      return;
    }
    if (!alive) {
      // A dead app does not answer politely; it drops the connection.
      request.socket.destroy();
      return;
    }
    const json = (body: unknown) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const screen = url.searchParams.get("screen") ?? "";
    // A launched app does not answer on the first poll. `simctl launch` returns as soon as the
    // process exists, well before the listener is bound.
    if (url.pathname === "/screens" && dropped < (app.deadPolls ?? 0)) {
      dropped += 1;
      request.socket.destroy();
      return;
    }
    switch (url.pathname) {
      case "/screens":
        return json({
          ...(app.bundleId === undefined ? {} : { bundle_id: app.bundleId }),
          screens: app.screens,
          detail: []
        });
      case "/missing":
        return json({
          missing: Object.entries(app.missing).map(([view, why]) => ({ view, missing: why }))
        });
      case "/hud":
        return json({ hud: false });
      // Both are called once per screen by the single-process loop: whatever the previous screen
      // left up has to come down, and the work ledger has to stop answering for it.
      case "/dismiss":
        return json({ ok: true });
      case "/reset":
        return json({ ok: true, outstanding: 0 });
      case "/present": {
        const mode = url.searchParams.get("mode");
        if (app.modes !== undefined && mode !== null && !app.modes.has(mode)) {
          // `refusal` is what tells the loop this is the run's problem and not this screen's.
          return json({ error: "unknown mode", refusal: "mode", mode });
        }
        if (app.crashOn?.has(screen)) {
          alive = false;
          request.socket.destroy();
          return;
        }
        return json({
          screen,
          fired: true,
          wait_ms: 250.5,
          env: { satisfied: [], missing: app.environmentMissing?.[screen] ?? [] }
        });
      }
      case "/snapshot":
        response.writeHead(200, { "Content-Type": "image/png" });
        return response.end(PNG);
      default:
        response.writeHead(404);
        return response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  const controlUrl = `http://127.0.0.1:${String(address.port)}`;

  const binDir = await mkdtemp(join(tmpdir(), "mobile-dev-swift-capture-bin-"));
  t.after(() => rm(binDir, { recursive: true, force: true }));
  const simctlLog = join(binDir, "simctl.log");
  const xcrun = join(binDir, "xcrun");
  await writeFile(
    xcrun,
    [
      "#!/bin/sh",
      `echo "$2" >> "${simctlLog}"`,
      'case "$2" in',
      `  launch) curl -s "${controlUrl}/__alive?v=1" >/dev/null ;;`,
      `  terminate) curl -s "${controlUrl}/__alive?v=0" >/dev/null ;;`,
      "esac",
      "exit 0"
    ].join("\n")
  );
  await chmod(xcrun, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}:${previousPath ?? ""}`;
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  });

  return {
    controlUrl,
    simctl: {
      lines: async () => {
        try {
          return (await readFile(simctlLog, "utf8")).split("\n").filter((line) => line.length > 0);
        } catch {
          return [];
        }
      }
    }
  };
}

async function outputDir(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mobile-dev-swift-capture-out-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

// The whole point of dropping relaunch-per-screen: React Native Fast mode drives a live app and
// does not restart it between screens, and two capture paths in one feature that disagree about
// that is a cost paid on every later change.
test("the app is launched once for a run, not once per screen", async (t) => {
  const { controlUrl, simctl } = await harness(t, {
    screens: ["AboutView", "ProfileView", "SettingsView"],
    missing: {}
  });
  const run = await captureSwiftScreens({
    deviceId: "booted",
    bundleId: "dev.codex.appflow.demo",
    outputDir: await outputDir(t),
    controlUrl
  });

  assert.deepEqual(
    run.captures.map((capture) => capture.outcome),
    ["captured", "captured", "captured"]
  );
  assert.equal((await simctl.lines()).filter((line) => line === "launch").length, 1);
  // Only the screen the launch was paid for reports it; the rest followed a healthy screen.
  assert.deepEqual(
    run.captures.map((capture) => capture.relaunchMs === null),
    [false, true, true]
  );
});

test("a crashing screen costs one capture, not the run", async (t) => {
  const { controlUrl, simctl } = await harness(t, {
    screens: ["AboutView", "CrashOnAppearView", "ProfileView"],
    missing: {},
    crashOn: new Set(["CrashOnAppearView"])
  });
  const out = await outputDir(t);
  const run = await captureSwiftScreens({
    deviceId: "booted",
    bundleId: "dev.codex.appflow.demo",
    outputDir: out,
    controlUrl
  });

  const byScreen = new Map(run.captures.map((capture) => [capture.screen, capture]));
  assert.equal(byScreen.get("CrashOnAppearView")?.outcome, "crashed");
  assert.equal(byScreen.get("CrashOnAppearView")?.screenshotPath, null);
  // The screens on either side are the whole point: the loop recovered from a dead process.
  assert.equal(byScreen.get("AboutView")?.outcome, "captured");
  assert.equal(byScreen.get("ProfileView")?.outcome, "captured");
  assert.equal(run.captures.length, 3);
  assert.deepEqual((await readdir(out)).sort(), ["AboutView.png", "ProfileView.png"]);
  // Twice: the launch that starts the run, and the one that recovers from the crash. The crash is
  // the only thing that buys a relaunch now, and the cost lands on the screen that needed it.
  assert.equal((await simctl.lines()).filter((line) => line === "launch").length, 2);
  assert.equal(byScreen.get("CrashOnAppearView")?.relaunchMs, null);
  assert.notEqual(byScreen.get("ProfileView")?.relaunchMs, null);
});

test("a screen the parser refused is reported, never launched for", async (t) => {
  const { controlUrl } = await harness(t, {
    screens: ["AboutView"],
    missing: { OrderDetailView: ["Route.orderDetail(id: String)"] }
  });
  const run = await captureSwiftScreens({
    deviceId: "booted",
    bundleId: "dev.codex.appflow.demo",
    outputDir: await outputDir(t),
    controlUrl
  });

  const refused = run.captures.find((capture) => capture.screen === "OrderDetailView");
  assert.equal(refused?.outcome, "refused");
  assert.deepEqual(refused?.missing, ["Route.orderDetail(id: String)"]);
  // No process was started on its behalf, so it has no relaunch to report.
  assert.equal(refused?.relaunchMs, null);
  assert.deepEqual(run.refusedByParser, { OrderDetailView: ["Route.orderDetail(id: String)"] });
});

test("an unsatisfied environment key is flagged, and the capture is still kept", async (t) => {
  const { controlUrl } = await harness(t, {
    screens: ["BrandedHeaderView"],
    missing: {},
    environmentMissing: { BrandedHeaderView: ["brandTint"] }
  });
  const out = await outputDir(t);
  const run = await captureSwiftScreens({
    deviceId: "booted",
    bundleId: "dev.codex.appflow.demo",
    outputDir: out,
    controlUrl
  });

  const capture = run.captures[0];
  assert.equal(capture?.outcome, "environment_unsatisfied");
  assert.deepEqual(capture?.environmentMissing, ["brandTint"]);
  // Kept deliberately: a missing `@Environment` key renders a plausible lie, so the screenshot is
  // the evidence of what went out. Discarding it would hide the failure it documents.
  assert.notEqual(capture?.screenshotPath, null);
  assert.deepEqual(await readdir(out), ["BrandedHeaderView.png"]);
});

test("the running build's own registry decides what is captured", async (t) => {
  const { controlUrl } = await harness(t, {
    screens: ["BView", "AView"],
    missing: { ZView: ["x: Int"] }
  });
  const contents = await registryContents({ controlUrl });
  assert.deepEqual(contents.screens.sort(), ["AView", "BView"]);
  assert.deepEqual(contents.refusedByParser, { ZView: ["x: Int"] });
});

// The port is a constant, so any build with the harness in it answers on 8765. If a demo build is
// still running when a real app is captured, every screenshot and timing belongs to the wrong app
// and all of it looks plausible -- the failure is silent, which is the only reason it is worth a
// test. Only a differing screen count exposed it the first time.
test("a control channel belonging to another app is refused, not driven", async (t) => {
  const { controlUrl } = await harness(t, {
    screens: ["AboutView"],
    missing: {},
    bundleId: "dev.codex.appflow.demo"
  });
  const out = await outputDir(t);
  await assert.rejects(
    () =>
      captureSwiftScreens({
        deviceId: "booted",
        bundleId: "com.example.RealApp",
        outputDir: out,
        controlUrl
      }),
    (error: Error) =>
      error.message.includes("dev.codex.appflow.demo") &&
      error.message.includes("com.example.RealApp")
  );
});

test("a mode the build does not have ends the run instead of being swapped for another", async (t) => {
  const { controlUrl, simctl } = await harness(t, {
    screens: ["AboutView", "FeedView"],
    missing: {},
    // A harness predating `window` — the divergence this refusal exists to catch. It used to
    // substitute `overlay` in silence, so a sweep measured one presentation and reported another.
    modes: new Set(["overlay", "bare"])
  });
  const out = await outputDir(t);
  await assert.rejects(
    () =>
      captureSwiftScreens({
        deviceId: "booted",
        bundleId: "dev.codex.appflow.demo",
        outputDir: out,
        controlUrl,
        mode: "window"
      }),
    (error: Error) => error.name === "ControlRequestRefusedError" && error.message.includes("window")
  );
  // Not a crash: the app is healthy and every screen after this one would be refused the same
  // way, so the loop leaves at once rather than relaunching to recover from a wrong request.
  const lines = await simctl.lines();
  assert.deepEqual(
    lines.filter((line) => line === "launch"),
    ["launch"]
  );
  // The device is still handed back, however the loop ended.
  assert.equal(lines.includes("terminate"), true);
});

test("a screen the running build has no entry for is left out, not reported as a crash", async (t) => {
  const { controlUrl } = await harness(t, { screens: ["AboutView"], missing: {} });
  const out = await outputDir(t);
  // `FeedView` is in the source the parser read and not in this build. Presenting it would get
  // `no registry entry` back, which read as a dead app — the app is healthy and simply older than
  // the parse, and `runSwiftSweep` is the layer that gets to say so.
  const run = await captureSwiftScreens({
    deviceId: "booted",
    bundleId: "dev.codex.appflow.demo",
    outputDir: out,
    controlUrl,
    screens: ["AboutView", "FeedView"]
  });
  assert.deepEqual(
    run.captures.map((capture) => [capture.screen, capture.outcome]),
    [["AboutView", "captured"]]
  );
});

// A build made before `/screens` carried `bundle_id` cannot be checked. Refusing those would
// break every older build to catch a case we cannot see, so they are allowed through.
test("a build that does not report its bundle id is still captured", async (t) => {
  const { controlUrl } = await harness(t, { screens: ["AboutView"], missing: {} });
  const out = await outputDir(t);
  const run = await captureSwiftScreens({
    deviceId: "booted",
    bundleId: "com.example.RealApp",
    outputDir: out,
    controlUrl
  });
  assert.equal(run.captures.length, 1);
  assert.equal(run.captures[0]?.outcome, "captured");
});

// The identity check sits inside the launch poll loop, where every ordinary failure means "not
// up yet" and must be retried. Rejecting the wrong class of error there turns a normal launch
// into an immediate failure, which is exactly what happened the first time this was written.
test("a launch is polled until the app answers, not failed on the first refusal", async (t) => {
  const { controlUrl } = await harness(t, {
    screens: ["AboutView"],
    missing: {},
    bundleId: "com.example.RealApp",
    deadPolls: 3
  });
  const out = await outputDir(t);
  const run = await captureSwiftScreens({
    deviceId: "booted",
    bundleId: "com.example.RealApp",
    outputDir: out,
    controlUrl
  });
  assert.equal(run.captures[0]?.outcome, "captured");
});
