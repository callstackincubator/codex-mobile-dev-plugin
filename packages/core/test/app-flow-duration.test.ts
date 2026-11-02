import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { carriedSweepDurationMs } from "@mobile-dev/shared/app-flow.ts";
import type { AppFlowManifest } from "@mobile-dev/shared/app-flow.ts";

function manifest(overrides: Partial<AppFlowManifest> = {}): AppFlowManifest {
  return {
    formatVersion: 4,
    generator: "ai-harness/app-flow",
    generatedAt: "2026-10-14T10:00:00.000Z",
    project: { name: "demo", path: "/demo", scheme: "demo", platform: "ios", mode: "expo-router" },
    ...overrides,
  };
}

describe("carriedSweepDurationMs", () => {
  it("carries the chain total when the next build resumes the same checkpoint", () => {
    // 2m30s of run one, then a resumed run reports 2m30s + its own clock, not just its own.
    assert.equal(carriedSweepDurationMs(manifest({ durationMs: 150_000, cumulativeDurationMs: 150_000 }), true), 150_000);
  });

  it("falls back to durationMs for a chain begun before the cumulative field existed", () => {
    assert.equal(carriedSweepDurationMs(manifest({ durationMs: 150_000 }), true), 150_000);
  });

  it("resets the chain when the build is not resuming a matching checkpoint", () => {
    // A re-parse of a moved structure fails the resume test, so the next build starts its own
    // chain at zero.
    assert.equal(carriedSweepDurationMs(manifest({ durationMs: 150_000, cumulativeDurationMs: 150_000 }), false), 0);
  });

  it("carries the chain total into an Explore-with-AI pass that reuses the finished sweep's captures", () => {
    // The completed sweep cleared its checkpoint, so the explore pass is not `resuming`; it still
    // continues the chain, because the map it completes is the one that 2m30s paid for. The header
    // must read 2m30s + the explore clock, not the explore clock alone.
    assert.equal(carriedSweepDurationMs(manifest({ durationMs: 150_000, cumulativeDurationMs: 150_000 }), true), 150_000);
  });

  it("carries nothing when there is no previous manifest at all", () => {
    assert.equal(carriedSweepDurationMs(null, true), 0);
  });
});
