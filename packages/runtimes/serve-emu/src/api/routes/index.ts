import type { ApiDependencies } from "../dependencies.ts";
import type { ApiRoute } from "../router.ts";
import { applicationRoutes } from "./applications.ts";
import { deviceRoutes } from "./devices.ts";
import { inputRoutes } from "./input.ts";
import { inspectionRoutes } from "./inspection.ts";
import { locationRoutes } from "./location.ts";
import { sessionRoutes } from "./session.ts";

export function createApiRoutes(): ApiRoute<ApiDependencies>[] {
  return [
    ...deviceRoutes(),
    ...inspectionRoutes(),
    ...inputRoutes(),
    ...applicationRoutes(),
    ...locationRoutes(),
    ...sessionRoutes(),
  ];
}
