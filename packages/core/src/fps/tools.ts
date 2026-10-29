import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { displayFpsTargetSchema } from "@mobile-dev/shared/display-fps.ts";
import type { DeviceResolver } from "../devices.ts";
import type { DisplayFpsSessions } from "./sessions.ts";
import { registerSessionTools } from "../session-tools.ts";
import { jsonResult } from "../tool-results.ts";

export function registerDisplayFpsTools(server: McpServer, sessions: DisplayFpsSessions, devices: Pick<DeviceResolver, "resolve">) {
  registerSessionTools(server, {
    scheme: "display-fps", operation: "display_fps.tool", writes: true, sessions,
    resource: { name: "display-fps-batch", description: "Read device-wide Display FPS. Samples use the server's monotonic clock in seconds." },
    start: {
      name: "mobile_display_fps_session", title: "Monitor Display FPS",
      description: "Record device-wide display updates independently of an app. Android 12+ uses Perfetto FrameTimeline actual display frames, excluding dropped frames. Physical iOS 17.4+ paired devices use the Instruments CoreAnimationFramesPerSecond counter through a bundled native helper. Requires pairing and Developer Mode; no app SDK, debugger attachment or Instruments GUI. A quiet screen can report zero. This is not the display refresh rate and cannot attribute a drop to one app. Samples use the server monotonic clock in seconds; Android readback is delayed by about three seconds. Returns sessionId, timeOrigin and fpsUri. Read with mobile_read_display_fps or fpsUri, and close with mobile_display_fps_close. Sessions expire after five minutes without reads.",
      inputSchema: { target: displayFpsTargetSchema }, validate: ({ target }) => devices.resolve(target, "fps"), open: ({ target }) => sessions.open(target),
      // Samples use the server's monotonic clock, so the panel aligns them to this origin.
      describe: (_input, sessionId, fpsUri) => jsonResult({ sessionId, timeOrigin: performance.now() / 1000, fpsUri }),
    },
    read: {
      name: "mobile_read_display_fps", title: "Read Display FPS",
      description: "Read complete device-wide FPS sampling intervals. Android intervals include frameTimeline with exact CLOCK_BOOTTIME start/end nanoseconds and tokens as decimal strings, presentation status, and available jank/composition metadata. Dropped frames are retained in frameTimeline but excluded from FPS. Pass the previous cursor as after; revisions replace the entire original interval, including its frames. Zero is a valid idle reading; null means no complete measurement. Startup returns connecting until the first measurement.",
    },
    close: { name: "mobile_display_fps_close", title: "Stop Display FPS", description: "Stop this device's FPS collector and release its tracing connection, leaving apps running.", text: "Display FPS monitor stopped." },
  });
}
