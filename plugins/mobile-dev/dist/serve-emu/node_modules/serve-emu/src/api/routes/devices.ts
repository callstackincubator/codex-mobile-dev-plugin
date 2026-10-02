import {
  getFontScale,
  getNetworkStatus,
  getNightMode,
  getUserRotation,
  setFontScale,
  setNetworkEnabled,
  setNightMode,
  setUserRotation,
  type NightMode,
  type OrientationMode,
} from "../../adb.ts";
import type { ApiDependencies } from "../dependencies.ts";
import type { ApiRoute } from "../router.ts";

export function deviceRoutes(): ApiRoute<ApiDependencies>[] {
  return [
    {
      method: "GET",
      path: "/api",
      handler: async ({ deps }) => {
        const { requestContext } = deps;
        return Response.json({
          generation: requestContext.generation,
          serial: requestContext.serial,
          device: requestContext.scrcpy.meta.deviceName,
          codec: requestContext.scrcpy.meta.codecId,
          size: {
            width: requestContext.screen.width,
            height: requestContext.screen.height,
          },
          status: requestContext.status,
          clients: requestContext.clients.size,
        });
      },
    },
    {
      method: "GET",
      path: "/api/devices",
      handler: async ({ deps }) => {
        const {
          runForPublishedContext,
          requestContext,
          listDevices,
          errorResponse,
        } = deps;
        try {
          const devices = await runForPublishedContext(requestContext, () =>
            listDevices(),
          );
          return Response.json({
            ok: true,
            currentSerial: requestContext.serial,
            devices: devices.map((device) => ({
              ...device,
              current: device.serial === requestContext.serial,
            })),
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/device-grid",
      handler: async ({ deps }) => {
        const { deviceGrid, requestContext, errorResponse } = deps;
        try {
          return Response.json(await deviceGrid(requestContext));
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/devices/select",
      handler: async ({ request: req, deps }) => {
        const {
          readJsonBody,
          MAX_JSON_BODY_BYTES,
          requestContext,
          switchSession,
          errorResponse,
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES,
            requestContext,
            false,
          );
          if (
            typeof payload !== "object" ||
            payload === null ||
            Array.isArray(payload)
          ) {
            throw new Error("select payload must be an object");
          }
          const serial = (payload as Record<string, unknown>).serial;
          if (typeof serial !== "string" || !serial.trim()) {
            throw new Error("serial is required");
          }
          return Response.json(await switchSession(serial.trim()));
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/avds/start",
      handler: async ({ request: req, deps }) => {
        const {
          readJsonBody,
          MAX_JSON_BODY_BYTES,
          requestContext,
          launchEmulator,
          sessions,
          switchSession,
          errorResponse,
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES,
            requestContext,
            false,
          );
          if (
            typeof payload !== "object" ||
            payload === null ||
            Array.isArray(payload)
          ) {
            throw new Error("start payload must be an object");
          }
          const avd = (payload as Record<string, unknown>).avd;
          if (typeof avd !== "string" || !avd.trim())
            throw new Error("avd is required");
          const launch = await launchEmulator({ avd: avd.trim() });
          try {
            sessions.assertPublished(requestContext);
          } catch (err) {
            launch.stop();
            throw err;
          }
          const select = (payload as Record<string, unknown>).select !== false;
          if (select) {
            try {
              const switched = await switchSession(launch.serial);
              return Response.json({ ...switched, avd: avd.trim() });
            } catch (err) {
              launch.stop();
              throw err;
            }
          }
          return Response.json({
            ok: true,
            serial: launch.serial,
            avd: avd.trim(),
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/avds/stop",
      handler: async ({ request: req, deps }) => {
        const {
          readJsonBody,
          MAX_JSON_BODY_BYTES,
          requestContext,
          listActiveAvds,
          sessions,
          stopCurrentSession,
          killEmulator,
          errorResponse,
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES,
            requestContext,
            false,
          );
          if (
            typeof payload !== "object" ||
            payload === null ||
            Array.isArray(payload)
          ) {
            throw new Error("stop payload must be an object");
          }
          const body = payload as Record<string, unknown>;
          let serial =
            typeof body.serial === "string" ? body.serial.trim() : "";
          if (!serial && typeof body.avd === "string" && body.avd.trim()) {
            const running = await listActiveAvds();
            sessions.assertPublished(requestContext);
            serial =
              running.find((running) => running.avd === body.avd)?.serial ?? "";
          }
          if (!serial) throw new Error("serial or running avd is required");
          if (!/^emulator-\d+$/.test(serial))
            throw new Error(`${serial} is not an emulator`);
          if (serial === requestContext.serial) {
            await stopCurrentSession(
              requestContext,
              "current emulator stopped",
            );
          }
          await killEmulator(serial);
          sessions.assertPublished(requestContext);
          return Response.json({ ok: true, serial });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/orientation",
      handler: async ({ deps }) => {
        const { runForContext, requestContext, errorResponse } = deps;
        try {
          return Response.json({
            ok: true,
            orientation: await runForContext(requestContext, (context) =>
              getUserRotation(context.serial),
            ),
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/orientation",
      handler: async ({ request: req, deps }) => {
        const {
          runForContext,
          requestContext,
          errorResponse,
          readJsonBody,
          MAX_JSON_BODY_BYTES,
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES,
            requestContext,
          );
          if (
            typeof payload !== "object" ||
            payload === null ||
            Array.isArray(payload)
          ) {
            throw new Error("orientation payload must be an object");
          }
          const orientation = (payload as Record<string, unknown>).orientation;
          if (
            orientation !== "auto" &&
            orientation !== "portrait" &&
            orientation !== "landscape"
          ) {
            throw new Error("orientation must be auto, portrait, or landscape");
          }
          return Response.json({
            ok: true,
            orientation: await runForContext(requestContext, (context) =>
              setUserRotation(context.serial, orientation as OrientationMode),
            ),
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/night-mode",
      handler: async ({ deps }) => {
        const { runForContext, requestContext, errorResponse } = deps;
        try {
          return Response.json({
            ok: true,
            nightMode: await runForContext(requestContext, (context) =>
              getNightMode(context.serial),
            ),
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/night-mode",
      handler: async ({ request: req, deps }) => {
        const {
          runForContext,
          requestContext,
          errorResponse,
          readJsonBody,
          MAX_JSON_BODY_BYTES,
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES,
            requestContext,
          );
          if (
            typeof payload !== "object" ||
            payload === null ||
            Array.isArray(payload)
          ) {
            throw new Error("night mode payload must be an object");
          }
          const mode = (payload as Record<string, unknown>).mode;
          if (mode !== "dark" && mode !== "light" && mode !== "auto") {
            throw new Error("mode must be dark, light, or auto");
          }
          return Response.json({
            ok: true,
            nightMode: await runForContext(requestContext, (context) =>
              setNightMode(context.serial, mode as NightMode),
            ),
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/font-scale",
      handler: async ({ deps }) => {
        const { runForContext, requestContext, errorResponse } = deps;
        try {
          return Response.json({
            ok: true,
            fontScale: await runForContext(requestContext, (context) =>
              getFontScale(context.serial),
            ),
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/font-scale",
      handler: async ({ request: req, deps }) => {
        const {
          runForContext,
          requestContext,
          errorResponse,
          readJsonBody,
          MAX_JSON_BODY_BYTES,
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES,
            requestContext,
          );
          if (
            typeof payload !== "object" ||
            payload === null ||
            Array.isArray(payload)
          ) {
            throw new Error("font scale payload must be an object");
          }
          const scale = Number((payload as Record<string, unknown>).scale);
          if (!Number.isFinite(scale) || scale < 0.7 || scale > 2) {
            throw new Error("scale must be a number between 0.7 and 2.0");
          }
          return Response.json({
            ok: true,
            fontScale: await runForContext(requestContext, (context) =>
              setFontScale(context.serial, scale),
            ),
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/network",
      handler: async ({ deps }) => {
        const { runForContext, requestContext, errorResponse } = deps;
        try {
          return Response.json({
            ok: true,
            network: await runForContext(requestContext, (context) =>
              getNetworkStatus(context.serial),
            ),
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/network",
      handler: async ({ request: req, deps }) => {
        const {
          runForContext,
          requestContext,
          errorResponse,
          readJsonBody,
          MAX_JSON_BODY_BYTES,
        } = deps;
        try {
          const payload = await readJsonBody(
            req,
            MAX_JSON_BODY_BYTES,
            requestContext,
          );
          if (
            typeof payload !== "object" ||
            payload === null ||
            Array.isArray(payload)
          ) {
            throw new Error("network payload must be an object");
          }
          const enabled = (payload as Record<string, unknown>).enabled;
          if (typeof enabled !== "boolean") {
            throw new Error("enabled must be a boolean");
          }
          return Response.json({
            ok: true,
            network: await runForContext(requestContext, (context) =>
              setNetworkEnabled(context.serial, enabled),
            ),
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  ];
}
