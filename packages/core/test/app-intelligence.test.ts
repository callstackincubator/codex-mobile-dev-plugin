import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
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
