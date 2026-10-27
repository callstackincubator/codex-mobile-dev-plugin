import { screencapPng } from "../../adb.ts";
import { getForegroundApp } from "../../app-info.ts";
import type { ApiDependencies } from "../dependencies.ts";
import type { ApiRoute } from "../router.ts";

export function inspectionRoutes(): ApiRoute<ApiDependencies>[] {
  return [
    {
      method: "GET",
      path: "/api/logcat",
      handler: async ({ request: req, url, deps }) => {
        const { sessions, requestContext, srv, logcatStream, errorResponse } =
          deps;
        try {
          sessions.assertCurrent(requestContext);
          srv.timeout(req, 0);
          return logcatStream(requestContext, req, url);
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/screenshot",
      handler: async ({ url, deps }) => {
        const { runForContext, requestContext, errorResponse } = deps;
        try {
          const png = await runForContext(requestContext, (context) =>
            screencapPng(context.serial),
          );
          if (url.searchParams.get("format") === "base64") {
            return Response.json({
              ok: true,
              mimeType: "image/png",
              data: png.toString("base64"),
            });
          }
          return new Response(new Uint8Array(png), {
            headers: { "Content-Type": "image/png" },
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/screenshot",
      handler: async ({ url, deps }) => {
        const { runForContext, requestContext, errorResponse } = deps;
        try {
          const png = await runForContext(requestContext, (context) =>
            screencapPng(context.serial),
          );
          if (url.searchParams.get("format") === "base64") {
            return Response.json({
              ok: true,
              mimeType: "image/png",
              data: png.toString("base64"),
            });
          }
          return new Response(new Uint8Array(png), {
            headers: { "Content-Type": "image/png" },
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/foreground",
      handler: async ({ deps }) => {
        const { runForContext, requestContext, errorResponse } = deps;
        try {
          return Response.json({
            ok: true,
            app: await runForContext(requestContext, (context) =>
              getForegroundApp(context.serial),
            ),
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "GET",
      path: "/api/accessibility",
      handler: async ({ deps }) => {
        const { readAccessibilitySnapshot, requestContext, errorResponse } =
          deps;
        try {
          return Response.json(await readAccessibilitySnapshot(requestContext));
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
    {
      method: "POST",
      path: "/api/accessibility/tap",
      handler: async ({ request: req, deps }) => {
        const { accessibilityTapEndpoint, requestContext } = deps;
        return accessibilityTapEndpoint(requestContext, req);
      },
    },
  ];
}
