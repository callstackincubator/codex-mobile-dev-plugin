import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { analyzeApp } from "../src/app-intelligence/analyzer.ts";
import { lookupAppIntel } from "../src/app-intelligence/lookup.ts";

async function runWorker(projectPath: string) {
  return await new Promise<any>((resolve, reject) => {
    const worker = new Worker(new URL("../src/app-intelligence/worker.ts", import.meta.url), { workerData: { projectPath } });
    worker.on("message", message => {
      if (message.type === "result") resolve(message.snapshot);
      else if (message.type === "error") reject(new Error(message.message));
    });
    worker.on("error", reject);
  });
}

test("App Intelligence discovers Expo Router and React Navigation without App Flow", async () => {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-app-intel-"));
  try {
    await mkdir(join(root, "app"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
    await writeFile(join(root, "app", "index.tsx"), "import { nativeValue } from '../src/native-value'; export default function Home(){ return nativeValue }\n");
    await writeFile(join(root, "app", "_layout.tsx"), "import { Stack } from 'expo-router'; export default () => <Stack />\n");
    await writeFile(join(root, "src", "native-value.ios.ts"), "export const nativeValue = 'ios'\n");
    await writeFile(join(root, "src", "native-value.android.ts"), "export const nativeValue = 'android'\n");
    await writeFile(join(root, "src", "Details.tsx"), "export default function Details(){ return null }\n");
    await writeFile(join(root, "src", "Navigator.tsx"), "import Details from './Details'; export default () => <Stack.Screen name='Details' component={Details} />\n");

    const snapshot = await analyzeApp(root);
    assert.equal(snapshot.screens["expo:index"].route, "/");
    assert.equal(snapshot.screens["navigation:Details"].source, "src/Details.tsx");
    const platformEdges = snapshot.edges.filter(edge => edge.from === "file:app/index.tsx" && edge.kind === "import");
    assert.deepEqual(platformEdges.map(edge => [edge.to, edge.platforms]).sort(), [
      ["file:src/native-value.android.ts", ["android"]],
      ["file:src/native-value.ios.ts", ["ios"]],
    ]);
    const result = lookupAppIntel(snapshot, { operation: "screen", query: "Details", direction: "outgoing", depth: 1, offset: 0, limit: 30 });
    assert.ok(result.items.some(item => item.kind === "file" && item.path === "src/Details.tsx"));
    const home = lookupAppIntel(snapshot, { operation: "screen", query: "Home", direction: "outgoing", depth: 1, offset: 0, limit: 30 });
    assert.ok(home.items.some(item => item.kind === "file" && item.path === "src/native-value.ios.ts"));
    assert.ok(home.items.some(item => item.kind === "file" && item.path === "src/native-value.android.ts"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("App Intelligence analysis runs in its cancellable worker entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-app-intel-worker-"));
  try {
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "worker-fixture" }));
    await writeFile(join(root, "app", "index.tsx"), "export default function Home(){ return null }\n");
    const snapshot = await runWorker(root);
    assert.equal(snapshot.screens["expo:index"].route, "/");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("App Intelligence counts how many screens reach each file", async () => {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-app-intel-reach-"));
  try {
    await mkdir(join(root, "app"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "reach-fixture" }));
    await writeFile(join(root, "app", "_layout.tsx"), "import './../src/theme'; export default () => null\n");
    await writeFile(join(root, "app", "index.tsx"), "import { shared } from '../src/shared'; export default function Home(){ return shared }\n");
    await writeFile(join(root, "app", "profile.tsx"), "import { shared } from '../src/shared'; import { only } from '../src/only'; export default function Profile(){ return shared + only }\n");
    // shared <-> cycle makes sure the walk terminates and still counts each screen once.
    await writeFile(join(root, "src", "shared.ts"), "import { deep } from './deep'; export const shared = deep\n");
    await writeFile(join(root, "src", "deep.ts"), "import { shared } from './shared'; export const deep = shared\n");
    await writeFile(join(root, "src", "only.ts"), "export const only = 1\n");
    await writeFile(join(root, "src", "theme.ts"), "export const theme = 1\n");
    await writeFile(join(root, "src", "orphan.ts"), "export const orphan = 1\n");

    const snapshot = await analyzeApp(root);
    assert.equal(snapshot.files["src/shared.ts"].reach, 2);
    assert.equal(snapshot.files["src/deep.ts"].reach, 2);
    assert.equal(snapshot.files["src/only.ts"].reach, 1);
    assert.equal(snapshot.files["src/theme.ts"].reach, 2, "a shared layout reaches every screen under it");
    assert.equal(snapshot.files["src/orphan.ts"].reach, 0);
    assert.equal(snapshot.files["app/index.tsx"].reach, 1, "a screen reaches its own source");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("App Intelligence reads JSONC path aliases and gives each screen its own component", async () => {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-app-intel-alias-"));
  try {
    await mkdir(join(root, "src", "screens"), { recursive: true });
    await mkdir(join(root, "node_modules", "@react-native", "typescript-config"), { recursive: true });
    await mkdir(join(root, "node_modules", "react-native-screens", "lib"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "alias-fixture" }));
    // Comments and trailing commas are legal in tsconfig.json, and the aliases live one `extends` up.
    await writeFile(join(root, "node_modules", "@react-native", "typescript-config", "tsconfig.json"),
      '{\n  "compilerOptions": {\n    // the app aliases its own source\n    "baseUrl": "../../..",\n    "paths": {"#/*": ["./src/*"], "@repeat/*": ["./src/*/nested/*"],},\n  },\n}\n');
    await writeFile(join(root, "tsconfig.json"), '{\n  /* inherited */\n  "extends": "@react-native/typescript-config/tsconfig.json",\n}\n');
    await writeFile(join(root, "node_modules", "react-native-screens", "package.json"), JSON.stringify({ name: "react-native-screens", main: "lib/index.js" }));
    await writeFile(join(root, "node_modules", "react-native-screens", "lib", "index.js"), "require('./deep'); module.exports = {}\n");
    await writeFile(join(root, "node_modules", "react-native-screens", "lib", "deep.js"), "module.exports = {}\n");
    await writeFile(join(root, "src", "screens", "Settings.tsx"), "import { helper } from '#/util/helper'; export function SettingsScreen(){ return helper }\n");
    await writeFile(join(root, "src", "screens", "Profile.tsx"), "export function ProfileScreen(){ return null }\n");
    await mkdir(join(root, "src", "util"), { recursive: true });
    await mkdir(join(root, "src", "shared", "nested"), { recursive: true });
    await writeFile(join(root, "src", "util", "helper.ts"), "export const helper = 1\n");
    await writeFile(join(root, "src", "shared", "nested", "shared.ts"), "export const repeated = 1\n");
    await writeFile(join(root, "src", "Navigation.tsx"), [
      "import 'react-native-screens'",
      "import { repeated } from '@repeat/shared'",
      "import { SettingsScreen } from '#/screens/Settings'",
      "function TabsNavigator(){ return repeated }",
      "export default () => <><Stack.Screen name='Settings' getComponent={() => SettingsScreen} />",
      "<Stack.Screen name='Profile' getComponent={() => require('#/screens/Profile').ProfileScreen} />",
      "<Stack.Screen name='Tabs' getComponent={() => TabsNavigator} /></>",
    ].join("\n") + "\n");

    const snapshot = await analyzeApp(root);
    assert.equal(snapshot.screens["navigation:Settings"].source, "src/screens/Settings.tsx", "getComponent names the screen's own file");
    assert.equal(snapshot.screens["navigation:Profile"].source, "src/screens/Profile.tsx", "a require() inside getComponent resolves too");
    assert.equal(snapshot.screens["navigation:Tabs"].source, "src/Navigation.tsx", "a navigator declared in place belongs to its own file");
    assert.deepEqual(snapshot.diagnostics.filter(entry => entry.code === "unresolved-screen"), []);
    assert.ok(!("#" in snapshot.packages), "an aliased '#/' import is app code, not a package named '#'");
    assert.equal(snapshot.files["src/util/helper.ts"].reach, 2, "the alias is followed into the app's own source, from Settings and from the navigator");
    assert.ok(snapshot.edges.some(edge => edge.from === "file:src/Navigation.tsx" && edge.to === "file:src/shared/nested/shared.ts"), "every wildcard in an alias target is substituted");
    // A dependency is one leaf: its entry file is recorded, its internals never enter the graph.
    assert.equal(snapshot.packages["react-native-screens"].entry, "node_modules/react-native-screens/lib/index.js");
    assert.deepEqual(Object.keys(snapshot.files).filter(path => path.includes("node_modules/")), []);
    assert.deepEqual(snapshot.edges.filter(edge => edge.to?.includes("node_modules/")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("App Intelligence treats a workspace package behind a node_modules symlink as app code", async () => {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-app-intel-workspace-"));
  try {
    await mkdir(join(root, "app"), { recursive: true });
    await mkdir(join(root, "modules", "ui", "src"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "workspace-fixture" }));
    await writeFile(join(root, "modules", "ui", "package.json"), JSON.stringify({ name: "ui", main: "src/index.ts" }));
    await writeFile(join(root, "modules", "ui", "src", "index.ts"), "export const button = 1\n");
    await symlink(join(root, "modules", "ui"), join(root, "node_modules", "ui"), "dir");
    await writeFile(join(root, "app", "index.tsx"), "import { button } from 'ui'; export default function Home(){ return button }\n");

    const snapshot = await analyzeApp(root);
    assert.ok(!("ui" in snapshot.packages), "a workspace package is this app's own code");
    assert.equal(snapshot.files["modules/ui/src/index.ts"].reach, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the project picker remembers recent projects, most recent first", async () => {
  // Preferences live under the home directory, so the check runs against a throwaway one.
  const home = await mkdtemp(join(tmpdir(), "mobile-dev-app-intel-home-"));
  try {
    const storage = new URL("../src/app-intelligence/storage.ts", import.meta.url).href;
    const script = [
      `const { readPreferences, rememberProject } = await import(${JSON.stringify(storage)});`,
      "await rememberProject('/one'); await rememberProject('/two'); await rememberProject('/one');",
      "process.stdout.write(JSON.stringify(await readPreferences()));",
    ].join("\n");
    const { stdout } = await promisify(execFile)(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], { env: { ...process.env, HOME: home } });
    assert.deepEqual(JSON.parse(stdout), { projectPath: "/one", recents: ["/one", "/two"] });
  } finally { await rm(home, { recursive: true, force: true }); }
});
