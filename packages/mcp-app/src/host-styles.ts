import { applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type App } from "@modelcontextprotocol/ext-apps";

/** Applies the host's theme, style tokens and fonts, and returns the host context. */
export function applyHostStyles(app: App) {
  const host = app.getHostContext();
  if (host?.theme) applyDocumentTheme(host.theme);
  if (host?.styles?.variables) applyHostStyleVariables(host.styles.variables);
  if (host?.styles?.css?.fonts) applyHostFonts(host.styles.css.fonts);
  return host;
}
