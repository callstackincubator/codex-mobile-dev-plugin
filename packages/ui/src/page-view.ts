const pageViews = ["panel", "workspace", "recording", "comparison", "tracesift", "devices"] as const;

/**
 * The view a served page asks for in `<html data-view>`: the workspace beside the chat
 * (`panel`), the workspace filling the host (`workspace`), or a chat card. Hosts read
 * it once at startup and pass what it implies to the views.
 */
export type PageView = typeof pageViews[number];

export function readPageView(root: HTMLElement = document.documentElement): PageView {
  const view = root.dataset.view;
  return pageViews.find(name => name === view) ?? "panel";
}
