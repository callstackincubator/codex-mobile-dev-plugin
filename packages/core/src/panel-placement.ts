export type PanelPlacement = "inline" | "browser";

/**
 * MCP Apps hosts advertise the same capabilities whether or not an inline panel suits them,
 * such as T3 Code, which asks the user to confirm each app tool call that is not read-only,
 * so only the user can choose the placement.
 */
export function panelPlacement(fallback: PanelPlacement, env: NodeJS.ProcessEnv = process.env): PanelPlacement {
  const requested = env.MOBILE_DEV_PANEL?.trim().toLowerCase();
  if (requested === "inline" || requested === "browser") return requested;
  if (requested) console.error(`[mobile-dev] Ignoring MOBILE_DEV_PANEL=${JSON.stringify(env.MOBILE_DEV_PANEL)}; it accepts "inline" or "browser". Using "${fallback}".`);
  return fallback;
}
