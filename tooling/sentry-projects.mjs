/**
 * The Sentry project slugs uploads and releases address. DSNs use project IDs, so
 * events keep arriving if a project is renamed; only these slugs must follow.
 */
export const SENTRY_PROJECTS = {
  ui: "codex-mobile-dev-ui",
  server: "codex-mobile-dev-server",
  native: "codex-mobile-dev-native",
};
