import type { App } from "@modelcontextprotocol/ext-apps";
import { LIVE_UI_URI } from "@mobile-dev/shared/live-ui.ts";
import type { LiveUIUpdate } from "@mobile-dev/shared/live-ui.ts";

function replaceLiveDocument(html: string, hostDocument: Document) {
  const Parser = hostDocument.defaultView!.DOMParser;
  const next = new Parser().parseFromString(html, "text/html");
  const scripts = Array.from(next.querySelectorAll("script"));
  for (const script of scripts) script.remove();
  // The update is the page as first served; the page keeps the view and layout its host opened.
  const root = hostDocument.documentElement;
  const kept = ["data-view", "data-layout"].flatMap(name => {
    const value = root.getAttribute(name);
    return value === null ? [] : [[name, value] as const];
  });
  for (const attribute of Array.from(root.attributes)) root.removeAttribute(attribute.name);
  for (const attribute of Array.from(next.documentElement.attributes)) root.setAttribute(attribute.name, attribute.value);
  for (const [name, value] of kept) root.setAttribute(name, value);
  // document.open() would also remove the native host's window listeners.
  hostDocument.head.replaceChildren(...Array.from(next.head.childNodes));
  hostDocument.body.replaceChildren(...Array.from(next.body.childNodes));
  for (const source of scripts) {
    const script = hostDocument.createElement("script");
    for (const attribute of Array.from(source.attributes)) script.setAttribute(attribute.name, attribute.value);
    script.textContent = source.textContent;
    hostDocument.body.append(script);
  }
}

export function startLiveReload(app: App, beforeReload: () => Promise<void>, hostDocument: Document = document): () => void {
  const revision = hostDocument.querySelector('meta[name="mobile-dev-live-revision"]')?.getAttribute("content");
  if (!revision) return () => {};
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const stop = () => { stopped = true; clearTimeout(timer); controller.abort(); hostDocument.defaultView?.removeEventListener("pagehide", stop); };
  hostDocument.defaultView?.addEventListener("pagehide", stop);

  async function poll() {
    try {
      const result = await app.readServerResource({ uri: `${LIVE_UI_URI}?after=${revision}` }, { signal: controller.signal, timeout: 5000 });
      if (stopped) return;
      const content = result.contents.find(item => "text" in item);
      if (content && "text" in content) {
        const update: LiveUIUpdate = JSON.parse(content.text);
        // Turning off development stops polling without disturbing the panel.
        if (!update.revision) { stop(); return; }
        if (/^[a-f0-9]{64}$/.test(update.revision) && update.revision !== revision && typeof update.html === "string") {
          await beforeReload();
          if (stopped) return;
          stop();
          await app.close();
          replaceLiveDocument(update.html, hostDocument);
          return;
        }
      }
    } catch (error) {
      if (!stopped) console.warn("Mobile Dev live reload could not read an update.", error);
    }
    if (!stopped) timer = setTimeout(() => void poll(), 1000);
  }
  void poll();
  return stop;
}
