import type { JSDOM } from "jsdom";

export const VIEW_OPTIONS = [{ value: "flow", label: "Flow graph" }, { value: "ui-states", label: "UI states" }];

export function appFlowGraphFixture() {
  const uiStates = [
    { id: "cart", name: "Cart Sheet", screenshot: "screens/home-cart.png", file: "app/home.tsx", line: 12, openedBy: "state" },
    { id: "error", name: "Error Dialog", screenshot: null, error: "Setter threw: cannot read id", file: "app/home.tsx", line: 40 },
  ];
  const node = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    id, title, urlPath: `/${id}`, reach: "navigation-only", groups: [], group: "root", navigator: null,
    capture: { status: "ok", needsNavigation: false, note: null, screenshot: `screens/${id}.png`, pressables: [], ...extra },
  });
  return { nodes: [node("home", "Home", { uiStates }), node("about", "About")] };
}

export function graphPickerHarness(dom: JSDOM["window"], act: (callback: () => void | Promise<void>) => unknown) {
  const trigger = (label: string) => dom.document.querySelector(`[data-slot="select-trigger"][aria-label="${label}"]`) as HTMLElement | null;
  const openOptions = async (label: string) => {
    const control = trigger(label)!;
    await act(async () => { control.click(); });
    await act(async () => { await Promise.resolve(); });
    const list = dom.document.getElementById(control.getAttribute("aria-controls")!)!;
    return Array.from(list.querySelectorAll('[role="option"]')) as HTMLElement[];
  };
  const closeOptions = async (label: string) => {
    await act(async () => { trigger(label)!.click(); });
    await act(async () => { await Promise.resolve(); });
  };
  const jumpTrigger = (label: string) => Array.from(dom.document.querySelectorAll("button"))
    .find(entry => entry.getAttribute("aria-label") === label) as HTMLButtonElement | undefined;
  const jumpList = (label: string) => dom.document.querySelector(`[aria-label="${label} options"]`)!;
  const jumpOptions = (label: string) => Array.from(jumpList(label).querySelectorAll('[role="option"]')) as HTMLElement[];
  const openJump = async (label: string) => {
    for (let attempt = 0; attempt < 2 && !dom.document.querySelector(`[aria-label="${label} options"]`); attempt += 1) {
      await act(async () => { jumpTrigger(label)!.click(); });
      await act(async () => { await Promise.resolve(); });
    }
    return jumpOptions(label);
  };
  const type = async (label: string, text: string) => {
    const field = dom.document.querySelector(`[aria-label="${label} search"]`) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(field, text); field.dispatchEvent(new dom.Event("input", { bubbles: true })); });
  };
  return { closeOptions, jumpOptions, jumpTrigger, openJump, openOptions, type };
}

