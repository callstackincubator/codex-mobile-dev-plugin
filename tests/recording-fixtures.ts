import type { PerformanceRecording } from "../src/shared/recordings.ts";

export function recordingFixture(): PerformanceRecording {
  return {
    schemaVersion: 1, id: "3e6b0a82-ecad-4b88-9276-219d731ff769", title: "Checkout scroll · Run 1", deviceName: "Pixel 9",
    target: { platform: "android", deviceId: "emulator-5554", bundleId: "com.example.shop" }, durationSeconds: 30,
    startedAt: "2026-10-01T15:42:00.000Z", completedAt: "2026-10-01T15:42:30.000Z", status: "finished", memoryMetric: "rss",
    samples: Array.from({ length: 31 }, (_, time) => ({
      time, interval: 1, cpuPercent: time === 0 ? null : time >= 12 && time <= 18 ? 72 : 20,
      memoryBytes: (242 + time / 5) * 1048576,
      threads: [{ id: "main", name: "main", cpuPercent: time >= 12 && time <= 18 ? 41 : 10 }, { id: "render", name: "RenderThread", cpuPercent: 18 }],
    })),
  };
}
