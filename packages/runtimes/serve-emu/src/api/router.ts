import {
  ApiError,
  apiErrorResponse,
  internalApiError,
} from "./api-error.ts";

export type ApiMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS";

export type ApiRouteContext<Deps> = {
  readonly request: Request;
  readonly url: URL;
  readonly deps: Deps;
};

export type ApiRouteHandler<Deps> = (
  context: ApiRouteContext<Deps>,
) => Response | Promise<Response>;

export type ApiRoute<Deps> = {
  readonly method: ApiMethod;
  readonly path: string;
  readonly handler: ApiRouteHandler<Deps>;
};

export type ApiErrorLogContext = {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly code: string;
  readonly cause: unknown;
};

export type ApiLogger = {
  error(message: string, context: ApiErrorLogContext): void;
};

export type ApiRouterOptions = {
  logger?: ApiLogger;
  isApiPath?: (pathname: string) => boolean;
};

export type ApiRouter<Deps> = {
  readonly routes: readonly ApiRoute<Deps>[];
  handle(request: Request, deps: Deps): Promise<Response | null>;
};

const METHOD_ORDER: readonly ApiMethod[] = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];

const METHOD_RANK = new Map<string, number>(
  METHOD_ORDER.map((method, index) => [method, index]),
);

const defaultApiPath = (pathname: string): boolean =>
  pathname === "/api" || pathname.startsWith("/api/");

function validateRoute<Deps>(route: ApiRoute<Deps>): void {
  if (
    !route.path.startsWith("/") ||
    route.path.includes("?") ||
    route.path.includes("#")
  ) {
    throw new TypeError(
      `API route path must be an absolute pathname: ${route.path}`,
    );
  }
  if (!METHOD_RANK.has(route.method)) {
    throw new TypeError(`Unsupported API method: ${route.method}`);
  }
  if (typeof route.handler !== "function") {
    throw new TypeError(
      `API route handler must be a function: ${route.method} ${route.path}`,
    );
  }
}

function sortedMethods<Deps>(routes: readonly ApiRoute<Deps>[]): ApiMethod[] {
  return routes
    .map((route) => route.method)
    .sort((a, b) => (METHOD_RANK.get(a) ?? 99) - (METHOD_RANK.get(b) ?? 99));
}

function logServerError(
  logger: ApiLogger,
  request: Request,
  url: URL,
  error: ApiError,
): void {
  try {
    logger.error("API request failed", {
      method: request.method,
      path: url.pathname,
      status: error.status,
      code: error.code,
      cause: error.cause,
    });
  } catch {
    // Logging must not turn a handled API failure into a rejected fetch.
  }
}

export function createApiRouter<Deps>(
  definitions: readonly ApiRoute<Deps>[],
  options: ApiRouterOptions = {},
): ApiRouter<Deps> {
  const routes = Object.freeze(
    definitions.map((route) => Object.freeze({ ...route })),
  );
  const routesByPath = new Map<string, ApiRoute<Deps>[]>();
  const registered = new Set<string>();

  for (const route of routes) {
    validateRoute(route);
    const key = `${route.method} ${route.path}`;
    if (registered.has(key)) {
      throw new TypeError(`Duplicate API route: ${key}`);
    }
    registered.add(key);
    const pathRoutes = routesByPath.get(route.path) ?? [];
    pathRoutes.push(route);
    routesByPath.set(route.path, pathRoutes);
  }

  const logger = options.logger ?? console;
  const isApiPath = options.isApiPath ?? defaultApiPath;

  return {
    routes,
    async handle(request, deps) {
      const url = new URL(request.url);
      if (!isApiPath(url.pathname)) return null;

      const pathRoutes = routesByPath.get(url.pathname);
      if (!pathRoutes) {
        return apiErrorResponse(
          new ApiError(404, "not_found", "API route not found"),
        );
      }

      const route = pathRoutes.find((item) => item.method === request.method);
      if (!route) {
        const allow = sortedMethods(pathRoutes);
        return apiErrorResponse(
          new ApiError(
            405,
            "method_not_allowed",
            "Method not allowed for this API route",
            { headers: { Allow: allow.join(", ") } },
          ),
        );
      }

      try {
        const response = await route.handler({ request, url, deps });
        if (!(response instanceof Response)) {
          throw new TypeError("API route handler did not return a Response");
        }
        return response;
      } catch (cause) {
        const error =
          cause instanceof ApiError ? cause : internalApiError(cause);
        if (error.status >= 500) {
          logServerError(logger, request, url, error);
        }
        return apiErrorResponse(error);
      }
    },
  };
}
