import { App } from "@modelcontextprotocol/ext-apps";
import { createRoot } from "react-dom/client";
import { PLUGIN_VERSION } from "@mobile-dev/shared/version.ts";
import { applyHostStyles } from "./host-styles.ts";

/** Card for a view saved by an earlier release that no longer exists; says so instead of failing, and measures nothing. */
export function startRetiredCard(message: string) {
  const app = new App({ name: "mobile-dev-retired", version: PLUGIN_VERSION });
  const root = createRoot(document.getElementById("root")!);
  root.render(<p className="p-3 text-sm text-muted-foreground">{message}</p>);
  const hostChanged = () => { applyHostStyles(app); };
  app.addEventListener("hostcontextchanged", hostChanged);
  app.onteardown = async () => {
    app.removeEventListener("hostcontextchanged", hostChanged);
    root.unmount();
    return {};
  };
  void app.connect().then(hostChanged, () => {});
}
