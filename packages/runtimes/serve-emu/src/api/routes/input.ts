import type { ApiDependencies } from "../dependencies.ts";
import type { ApiRoute } from "../router.ts";

export function inputRoutes(): ApiRoute<ApiDependencies>[] {
  return [
    {
      method: "POST",
      path: "/api/tap",
      handler: async ({ request: req, deps }) => {
        const { gestureEndpoint, requestContext } = deps;
        return gestureEndpoint(requestContext, req, "tap", "rest:tap");
      },
    },
    {
      method: "POST",
      path: "/api/swipe",
      handler: async ({ request: req, deps }) => {
        const { gestureEndpoint, requestContext } = deps;
        return gestureEndpoint(requestContext, req, "swipe", "rest:swipe");
      },
    },
    {
      method: "POST",
      path: "/api/text",
      handler: async ({ request: req, deps }) => {
        const { gestureEndpoint, requestContext } = deps;
        return gestureEndpoint(requestContext, req, "text", "rest:text");
      },
    },
    {
      method: "POST",
      path: "/api/key",
      handler: async ({ request: req, deps }) => {
        const { keyEndpoint, requestContext } = deps;
        return keyEndpoint(requestContext, req);
      },
    },
  ];
}
