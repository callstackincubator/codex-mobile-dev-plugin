// Annotation scenarios for the fixture app, built the way the panel builds them:
// a component list like the React Native inspector (or native accessibility) returns,
// then the shared selection-context helper from the prompt version under test.
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Bounds = { x: number; y: number; width: number; height: number };
export type Formatter = {
  screenSelectionContext: (components: any[], selected: any) => any;
  formatAnnotationMessage: (annotations: any[]) => string;
};
export type PromptOptions = { udid?: string };

const screen = { width: 402, height: 874, units: "points" as const };

function locate(root: string, file: string, needle: string) {
  const path = join(root, file);
  const lines = readFileSync(path, "utf8").split("\n");
  const line = lines.findIndex(text => text.includes(needle));
  if (line < 0) throw new Error(`${needle} not found in ${file}`);
  return { file: path, line: line + 1, column: lines[line].indexOf(needle) + 1 };
}

// React Native tree with creation sources, as Metro symbolication provides them.
function reactNative(root: string) {
  const items: any[] = [];
  const add = (nodeId: string, parentId: string | undefined, role: string, bounds: Bounds, react: { component: string; owners: string[]; key?: string; at?: [string, string] }, label?: string) => {
    const depth = parentId ? items.find(item => item.nodeId === parentId).depth + 1 : 0;
    const found = react.at && locate(root, react.at[0], react.at[1]);
    const source = found && { file: found.file, line: found.line, column: found.column, functionName: react.owners.at(-1) };
    items.push({ name: label ?? role, label, role, bounds, depth, source: "react-native", nodeId, parentId,
      react: { component: react.component, owners: react.owners, ...(react.key ? { key: react.key } : {}), ...(source ? { source, sourceKind: "element" } : {}) } });
  };
  const home = ["App", "HomeScreen"];
  add("n1", undefined, "ScrollView", { x: 0, y: 0, width: 402, height: 874 }, { component: "ScrollView", owners: home, at: ["src/screens/HomeScreen.tsx", "<ScrollView"] });
  add("n2", "n1", "View", { x: 16, y: 60, width: 370, height: 34 }, { component: "View", owners: [...home, "Header"], at: ["src/components/Header.tsx", "<View style={styles.row}>"] });
  add("n3", "n2", "Text", { x: 16, y: 60, width: 132, height: 34 }, { component: "Text", owners: [...home, "Header"], at: ["src/components/Header.tsx", "<Text style={styles.title}>"] }, "Discover");
  add("n4", "n2", "Text", { x: 156, y: 68, width: 38, height: 18 }, { component: "Text", owners: [...home, "Header"], at: ["src/components/Header.tsx", "<Text style={styles.badge}>"] }, "New");
  add("n5", "n1", "View", { x: 16, y: 110, width: 370, height: 244 }, { component: "View", owners: [...home, "CardList"], at: ["src/components/CardList.tsx", "<View style={styles.list}>"] });
  [["trails", "Mountain trails", "12 routes nearby"], ["coffee", "Coffee spots", "8 open now"], ["museums", "Museums", "3 free this week"]].forEach(([key, title, subtitle], index) => {
    const y = 110 + index * 84, card = `n${6 + index * 3}`;
    const owners = [...home, "CardList", "Card"];
    add(card, "n5", "View", { x: 16, y, width: 370, height: 76 }, { component: "View", owners, key, at: ["src/components/Card.tsx", "<View style={styles.card}>"] });
    add(`n${7 + index * 3}`, card, "Text", { x: 32, y: y + 16, width: 220, height: 22 }, { component: "Text", owners, at: ["src/components/Card.tsx", "<Text style={styles.title}>"] }, title);
    add(`n${8 + index * 3}`, card, "Text", { x: 32, y: y + 42, width: 200, height: 18 }, { component: "Text", owners, at: ["src/components/Card.tsx", "<Text style={styles.subtitle}>"] }, subtitle);
  });
  add("n15", "n1", "View", { x: 16, y: 370, width: 370, height: 52 }, { component: "View", owners: [...home, "PrimaryButton"], at: ["src/components/PrimaryButton.tsx", "<Pressable"] }, "Continue");
  add("n16", "n15", "Text", { x: 162, y: 386, width: 78, height: 20 }, { component: "Text", owners: [...home, "PrimaryButton"], at: ["src/components/PrimaryButton.tsx", "<Text style={styles.label}>"] }, "Continue");
  add("n17", "n1", "View", { x: 16, y: 438, width: 370, height: 66 }, { component: "View", owners: [...home, "Footer"], at: ["src/components/Footer.tsx", "<View style={styles.footer}>"] });
  add("n18", "n17", "Text", { x: 128, y: 462, width: 44, height: 18 }, { component: "Text", owners: [...home, "Footer"], at: ["src/components/Footer.tsx", "<Text style={styles.link}>Terms"] }, "Terms");
  add("n19", "n17", "Text", { x: 196, y: 462, width: 54, height: 18 }, { component: "Text", owners: [...home, "Footer"], at: ["src/components/Footer.tsx", "<Text style={styles.link}>Privacy"] }, "Privacy");
  return items;
}

// Native accessibility only: labels and roles, no React tree or source, as when Metro
// inspection is unavailable or the app is not React Native.
function accessibility() {
  const element = (nodeId: string, role: string, label: string, bounds: Bounds) => ({ name: label, label, role, bounds, depth: 3, source: "accessibility", nodeId });
  return [
    element("a1", "AXStaticText", "Discover", { x: 16, y: 60, width: 132, height: 34 }),
    element("a2", "AXStaticText", "New", { x: 156, y: 68, width: 38, height: 18 }),
    ...[["Mountain trails", "12 routes nearby"], ["Coffee spots", "8 open now"], ["Museums", "3 free this week"]].flatMap(([title, subtitle], index) => [
      element(`a${3 + index * 2}`, "AXStaticText", title, { x: 32, y: 126 + index * 84, width: 220, height: 22 }),
      element(`a${4 + index * 2}`, "AXStaticText", subtitle, { x: 32, y: 152 + index * 84, width: 200, height: 18 }),
    ]),
    element("a9", "AXButton", "Continue", { x: 16, y: 370, width: 370, height: 52 }),
    element("a10", "AXStaticText", "Terms", { x: 128, y: 462, width: 44, height: 18 }),
    element("a11", "AXStaticText", "Privacy", { x: 196, y: 462, width: 54, height: 18 }),
  ];
}

function nearby(all: any[], selected: any) {
  const b = selected.bounds;
  const distance = (item: any) => {
    const r = item.bounds;
    return Math.hypot(Math.max(b.x - r.x - r.width, r.x - b.x - b.width, 0), Math.max(b.y - r.y - r.height, r.y - b.y - b.height, 0));
  };
  return all.filter(item => /Text/.test(item.role) && item.label && item !== selected && distance(item) <= 100).sort((a, b) => distance(a) - distance(b)).map(item => item.label).slice(0, 5);
}

export const SCENARIOS = {
  A: { title: "1 note, unique element", tree: "rn", grader: "A", notes: [["n16", "make this text red"]] },
  B: { title: "3 notes, all instances, same edit", tree: "rn", grader: "B", notes: [["n7", "make this red"], ["n10", "make this red"], ["n13", "make this red"]] },
  C: { title: "3 notes, 3 different components", tree: "rn", grader: "C", notes: [["n3", "make this blue"], ["n15", "make the background green"], ["n18", "underline this"]] },
  D: { title: "1 note, instance 2 of 3", tree: "rn", grader: "D", notes: [["n10", "make this red"]] },
  E: { title: "1 note, remove a child", tree: "rn", grader: "E", notes: [["n4", "remove this"]] },
  F: { title: "1 note, no source", tree: "ax", grader: "A", notes: [["a9", "make this text red"]] },
  G: { title: "3 notes, no source, 3 components", tree: "ax", grader: "C", notes: [["a1", "make this blue"], ["a9", "make the background green"], ["a10", "underline this"]] },
} as const;
export type ScenarioId = keyof typeof SCENARIOS;

export function buildPrompt(root: string, scenario: ScenarioId, formatter: Formatter, options: PromptOptions = {}) {
  const spec = SCENARIOS[scenario];
  const all = spec.tree === "rn" ? reactNative(root) : accessibility();
  const simulator = { udid: options.udid ?? "6F1C2A10-0000-4000-8000-000000000001", name: "iPhone 17 Pro", platform: "ios", state: "Booted", runtime: "iOS 27.0" };
  const annotations = spec.notes.map(([nodeId, text], index) => {
    const component = all.find(item => item.nodeId === nodeId);
    const b = component.bounds;
    return { id: `note-${index + 1}`, number: index + 1, text, simulator, screen,
      point: { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) },
      component, selection: formatter.screenSelectionContext(all, component), nearbyText: nearby(all, component),
      screenshot: { id: "shot-1", data: "", capturedAt: new Date(0).toISOString() } };
  });
  const message = formatter.formatAnnotationMessage(annotations);
  // Panel model context names the active device, as PanelContext.publish does.
  return options.udid ? `${message}\n\nMobile Dev devices. Logs follow the active device.\nActive iOS simulator: ${simulator.name}. Device ID: ${simulator.udid}. State: Booted. Use this UDID with the Mobile Dev tools for platform ios.` : message;
}
