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
