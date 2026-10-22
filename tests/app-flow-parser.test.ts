import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseProject } from "../src/app-flow/parser.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mobile-dev-app-flow-routes-"));
  temporaryRoots.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, contents);
  }
  return root;
}

describe("App Flow parser navigator tree", () => {
  it("recognizes wrapped stack factories and qualifies duplicate screen names by tab", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ dependencies: { "@react-navigation/native": "^7" } }),
      "app.json": JSON.stringify({ expo: { scheme: "demo" } }),
      "src/navigation.tsx": `
        import { HomeScreen } from './screens/Home'
        import { ProfileScreen } from './screens/Profile'
        import { createNativeStackNavigatorWithAuth } from './withAuth'
        const HomeTab = createNativeStackNavigatorWithAuth<HomeTabParams>()
        const ProfileTab = createNativeStackNavigatorWithAuth<ProfileTabParams>()
        const Tab = createBottomTabNavigator<TabParams>()
        function HomeTabNavigator() { return <HomeTab.Navigator>
          <HomeTab.Screen name="Feed" component={HomeScreen} />
        </HomeTab.Navigator> }
        function ProfileTabNavigator() { return <ProfileTab.Navigator>
          <ProfileTab.Screen name="Feed" component={ProfileScreen} />
        </ProfileTab.Navigator> }
        export function Root() { return <Tab.Navigator>
          <Tab.Screen name="HomeTab" getComponent={() => HomeTabNavigator} />
          <Tab.Screen name="ProfileTab" getComponent={() => ProfileTabNavigator} />
        </Tab.Navigator> }
      `,
      "src/screens/Home.tsx": "export function HomeScreen() { return null }",
      "src/screens/Profile.tsx": "export function ProfileScreen() { return null }",
    });

    const parsed = await parseProject(root);
    assert.ok(parsed);
    assert.equal(parsed.rootNavigator, "Tabs");
    assert.deepEqual(parsed.entryLayouts, ["HomeTab", "ProfileTab"]);
    assert.equal(parsed.layouts.find(layout => layout.name === "HomeTab")?.navigator, "Stack");
    assert.equal(parsed.layouts.find(layout => layout.name === "HomeTab")?.parent, "Tab");
    assert.deepEqual(parsed.nodes.map(node => node.id).sort(), ["HomeTab/Feed", "ProfileTab/Feed"]);
    assert.deepEqual(parsed.nodes.map(node => node.group).sort(), ["HomeTab", "ProfileTab"]);
    assert.deepEqual(parsed.entryScreenIds.sort(), ["HomeTab/Feed", "ProfileTab/Feed"]);
  });
});

describe("App Flow parser entry layouts", () => {
  it("treats drawer segments as entry layouts and selects each index route", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ dependencies: { "expo-router": "^6" } }),
      "app/_layout.tsx": "export default function Layout() { return <Drawer /> }",
      "app/home/_layout.tsx": "export default function Layout() { return <Stack /> }",
      "app/home/index.tsx": "export default function Home() { return null }",
      "app/home/details.tsx": "export default function Details() { return null }",
      "app/settings/_layout.tsx": "export default function Layout() { return <Stack /> }",
      "app/settings/index.tsx": "export default function Settings() { return null }",
    });

    const parsed = await parseProject(root);
    assert.equal(parsed?.mode, "expo-router");
    assert.deepEqual(parsed?.entryLayouts, ["home", "settings"]);
    assert.deepEqual(parsed?.entryScreenIds.slice().sort(), ["home/index", "settings/index"]);
  });

  it("keeps tab segments as entry layouts", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ dependencies: { "expo-router": "^6" } }),
      "app/_layout.tsx": "export default function Layout() { return <Tabs /> }",
      "app/home/_layout.tsx": "export default function Layout() { return <Stack /> }",
      "app/home/index.tsx": "export default function Home() { return null }",
      "app/search/_layout.tsx": "export default function Layout() { return <Stack /> }",
      "app/search/index.tsx": "export default function Search() { return null }",
    });

    const parsed = await parseProject(root);
    assert.deepEqual(parsed?.entryLayouts, ["home", "search"]);
  });
});

/**
 * Detection only — see the SEAM note on `parseProject`. These assert what the scan reports about a
 * project's shape, never that a Swift graph was built: a detected Swift project deliberately
 * carries no nodes or edges.
 */
describe("App Flow parser Swift project detection", () => {
  it("detects a bare .xcodeproj and its conventional source root", async () => {
    const root = await fixture({
      "Demo.xcodeproj/project.pbxproj": "// objects",
      "Demo/DemoApp.swift": "import SwiftUI\n@main struct DemoApp: App {}",
      "Demo/ContentView.swift": "import SwiftUI\nstruct ContentView: View {}",
    });

    const parsed = await parseProject(root);
    assert.ok(parsed);
    assert.equal(parsed.mode, "swiftui");
    assert.ok(parsed.swift);
    assert.equal(parsed.swift.container, "xcodeproj");
    assert.equal(parsed.swift.projectPath, join(root, "Demo.xcodeproj"));
    assert.equal(parsed.swift.workspacePath, null);
    assert.equal(parsed.swift.packageManifestPath, null);
    assert.deepEqual(parsed.swift.sourceRoots, [join(root, "Demo")]);
    assert.deepEqual(parsed.swift.schemes, []);
    // Detection, not a graph: the seam is what fills these in.
    assert.deepEqual(parsed.nodes, []);
    assert.deepEqual(parsed.edges, []);
    assert.deepEqual(parsed.layouts, []);
    assert.equal(parsed.scheme, null);
    assert.equal(parsed.appDir, join(root, "Demo"));
  });

  it("prefers the workspace over the project it wraps and unions their shared schemes", async () => {
    const root = await fixture({
      "Demo.xcworkspace/contents.xcworkspacedata": "<Workspace></Workspace>",
      "Demo.xcworkspace/xcshareddata/xcschemes/Demo.xcscheme": "<Scheme></Scheme>",
      "Demo.xcodeproj/project.pbxproj": "// objects",
      "Demo.xcodeproj/xcshareddata/xcschemes/DemoTests.xcscheme": "<Scheme></Scheme>",
      "Demo.xcodeproj/xcshareddata/xcschemes/notes.txt": "ignored",
      // An SPM manifest beside a project is a local module, not the app that gets built.
      "Package.swift": "// swift-tools-version:5.9",
      "Demo/ContentView.swift": "import SwiftUI",
    });

    const parsed = await parseProject(root);
    assert.equal(parsed?.mode, "swiftui");
    assert.equal(parsed?.swift?.container, "xcworkspace");
    assert.equal(parsed?.swift?.workspacePath, join(root, "Demo.xcworkspace"));
    assert.equal(parsed?.swift?.projectPath, join(root, "Demo.xcodeproj"));
    assert.equal(parsed?.swift?.packageManifestPath, join(root, "Package.swift"));
    assert.deepEqual(parsed?.swift?.schemes, ["Demo", "DemoTests"]);
    assert.deepEqual(parsed?.swift?.sourceRoots, [join(root, "Demo")]);
  });

  it("detects an SPM-only package through its manifest and Sources folder", async () => {
    const root = await fixture({
      "Package.swift": "// swift-tools-version:5.9\nimport PackageDescription",
      "Sources/Feature/Feature.swift": "public struct Feature {}",
      "Tests/FeatureTests/FeatureTests.swift": "import XCTest",
    });

    const parsed = await parseProject(root);
    assert.equal(parsed?.mode, "swiftui");
    assert.equal(parsed?.swift?.container, "swiftpm");
    assert.equal(parsed?.swift?.projectPath, null);
    assert.equal(parsed?.swift?.workspacePath, null);
    assert.equal(parsed?.swift?.packageManifestPath, join(root, "Package.swift"));
    assert.deepEqual(parsed?.swift?.sourceRoots, [join(root, "Sources")]);
  });

  it("falls back to a one-level scan for an unconventional layout and never treats Pods as source", async () => {
    const root = await fixture({
      "Weird.xcodeproj/project.pbxproj": "// objects",
      "Feature/ProfileView.swift": "import SwiftUI",
      "Pods/SomeDependency.swift": "import Foundation",
      "Resources/logo.png": "",
    });

    const parsed = await parseProject(root);
    assert.deepEqual(parsed?.swift?.sourceRoots, [join(root, "Feature")]);
  });

  it("leaves a React Native project alone even when it ships an iOS workspace", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({ dependencies: { "expo-router": "^6" } }),
      "app/_layout.tsx": "export default function Layout() { return <Tabs /> }",
      "app/home/_layout.tsx": "export default function Layout() { return <Stack /> }",
      "app/home/index.tsx": "export default function Home() { return null }",
      // The nested Xcode bundle every RN app ships; detection only ever looks at the root.
      "ios/Demo.xcworkspace/contents.xcworkspacedata": "<Workspace></Workspace>",
      "ios/Demo.xcodeproj/project.pbxproj": "// objects",
    });

    const parsed = await parseProject(root);
    assert.equal(parsed?.mode, "expo-router");
    assert.equal(parsed?.swift, null);
    assert.deepEqual(parsed?.entryLayouts, ["home"]);
  });

  it("still returns null for a folder that is neither", async () => {
    const root = await fixture({
      "README.md": "# not an app",
      "docs/notes.md": "nothing here",
    });

    assert.equal(await parseProject(root), null);
  });
});
