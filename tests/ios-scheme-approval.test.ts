import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  acceptOpenInAppPrompt,
  isUrlSchemePreapproved,
  markUrlSchemeApproved,
  preapproveIosUrlScheme,
  resetUrlSchemeApprovals,
  shouldPreapproveUrlScheme,
  urlSchemeFromUrl,
} from "../src/server/app-flow-deps/ios/scheme-approval.ts";

const udid = "SIM-UNDER-TEST";
const url = "exp://127.0.0.1:8081";

beforeEach(() => {
  resetUrlSchemeApprovals();
});

describe("iOS URL scheme approval", () => {
  it("reads a scheme off a URL and only pre-approves the ones that prompt", () => {
    assert.equal(urlSchemeFromUrl(url), "exp");
    assert.equal(shouldPreapproveUrlScheme(url), true);
    assert.equal(shouldPreapproveUrlScheme("https://example.test"), false);
  });

  it("leaves the open-in probe enabled for the first open after writing the approval", async () => {
    const writes: string[] = [];
    const written = await preapproveIosUrlScheme({
      udid,
      url,
      bundleId: "host.exp.Exponent",
      writeApproval: async write => { writes.push(write.scheme); },
    });

    assert.deepEqual(writes, ["exp"]);
    assert.equal(written, true);
    // The write happens milliseconds after the simulator booted and in the same breath as the open
    // it is for. launchservicesd has not read it back yet, so that first open still lands on the
    // "Open in …?" sheet — and treating the write as proof is what used to skip the one probe that
    // could clear it, leaving the user with a booted simulator and no app until a second click.
    assert.equal(isUrlSchemePreapproved(udid, url), false);
  });

  it("skips the probe only once an open has confirmed the approval is in force", async () => {
    await preapproveIosUrlScheme({ udid, url, bundleId: "host.exp.Exponent", writeApproval: async () => {} });
    markUrlSchemeApproved(udid, url);
    assert.equal(isUrlSchemePreapproved(udid, url), true);
    // Per simulator and per scheme: a second write for the same pair must not demote it back to
    // pending and buy another 15s probe on every later launch.
    await preapproveIosUrlScheme({ udid, url, bundleId: "host.exp.Exponent", writeApproval: async () => {} });
    assert.equal(isUrlSchemePreapproved(udid, url), true);
    assert.equal(isUrlSchemePreapproved("OTHER-SIM", url), false);
    assert.equal(isUrlSchemePreapproved(udid, "myapp://home"), false);
  });

  it("accepts the sheet when the probe finds one", async () => {
    const calls: string[] = [];
    const client = {
      command: {
        alert: async (options?: { action?: string }) => {
          calls.push(options?.action ?? "get");
          return options?.action === "get" ? { label: "Open in Expo Go?" } : {};
        },
      },
      interactions: { press: async () => { throw new Error("not used"); } },
    };
    assert.equal(await acceptOpenInAppPrompt(client), "accepted");
    assert.deepEqual(calls, ["get", "accept"]);
  });
});
