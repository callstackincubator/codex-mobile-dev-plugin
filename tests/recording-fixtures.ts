import type { PerformanceRecording } from "../src/shared/recordings.ts";

export function recordingFixture(): PerformanceRecording {
  return {
    schemaVersion: 1, id: "3e6b0a82-ecad-4b88-9276-219d731ff769", title: "Checkout scroll · Run 1", deviceName: "Pixel 9",
    target: { platform: "android", deviceId: "emulator-5554", bundleId: "com.example.shop" }, durationSeconds: 30,
    startedAt: "2026-10-01T15:42:00.000Z", completedAt: "2026-10-01T15:42:30.000Z", status: "finished", memoryMetric: "rss",
    fps: { status: "finished", samples: Array.from({ length: 30 }, (_, index) => ({
      time: index + 1, interval: 1, fps: index >= 12 && index < 18 ? 30 : 60,
    })) },
    samples: Array.from({ length: 31 }, (_, time) => ({
      time, interval: 1, cpuPercent: time === 0 ? null : time >= 12 && time <= 18 ? 72 : 20,
      memoryBytes: (242 + time / 5) * 1048576,
      threads: [{ id: "main", name: "main", cpuPercent: time >= 12 && time <= 18 ? 41 : 10 }, { id: "render", name: "RenderThread", cpuPercent: 18 }],
    })),
  };
}

export const unavailableFps = {
  open() { throw new Error("Display FPS is not supported on this test device."); },
  async read() { throw new Error("No FPS collector was started."); },
  async closeSession() {},
};
