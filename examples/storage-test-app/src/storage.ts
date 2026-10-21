import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";
import { openDatabaseSync } from "expo-sqlite";
import { Platform, Settings } from "react-native";
import DefaultPreference from "react-native-default-preference";
import { createMMKV } from "react-native-mmkv";

// Every store the Mobile Dev storage tool reads, written the way a typical app would.
// MMKV: the default instance, a custom ID, and an encrypted instance the tool should show as locked.
export const mmkv = createMMKV({ id: "mmkv.default" });
const settings = createMMKV({ id: "settings" });
const secure = createMMKV({ id: "secure", encryptionKey: "storage-test-key" });
const db = openDatabaseSync("todos.db");
db.execSync("CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)");
const notes = new File(Paths.document, "notes.txt");
const cached = new File(Paths.cache, "thumbnail-cache.bin");

// UserDefaults on iOS, SharedPreferences on Android. Values are strings.
async function preference(key: string, value: string | null) {
  if (value === null) await DefaultPreference.clear(key);
  else await DefaultPreference.set(key, value);
}

export async function recordLaunch() {
  const launches = (mmkv.getNumber("launchCount") ?? 0) + 1;
  mmkv.set("launchCount", launches);
  await AsyncStorage.setItem("stats", JSON.stringify({ launches, lastOpened: new Date().toISOString() }));
}

export async function signIn() {
  mmkv.set("user.id", 4211);
  mmkv.set("user.name", "Ada Lovelace");
  mmkv.set("isLoggedIn", true);
  mmkv.set("session", JSON.stringify({ userId: 4211, plan: "pro", expiresAt: new Date(Date.now() + 86400000).toISOString() }));
  secure.set("authToken", `eyJhbGciOiJIUzI1NiJ9.${Math.random().toString(36).slice(2)}`);
  await AsyncStorage.setItem("auth:user", JSON.stringify({ id: 4211, name: "Ada Lovelace", email: "ada@example.com", roles: ["admin"] }));
  await preference("lastLogin", new Date().toISOString());
}

export async function signOut() {
  for (const key of ["user.id", "user.name", "isLoggedIn", "session"]) mmkv.remove(key);
  secure.remove("authToken");
  await AsyncStorage.removeItem("auth:user");
  await preference("lastLogin", null);
}

export async function finishOnboarding() {
  mmkv.set("onboarding.step", 3);
  await preference("onboardingDone", "true");
  // Typed UserDefaults values (bool, number) that only iOS's Settings API writes.
  if (Platform.OS === "ios") Settings.set({ onboardingCompleted: true, onboardingVersion: 2 });
}

export async function resetOnboarding() {
  mmkv.remove("onboarding.step");
  await preference("onboardingDone", null);
  if (Platform.OS === "ios") Settings.set({ onboardingCompleted: false });
}

export function toggleTheme() {
  const next = settings.getString("theme") === "dark" ? "light" : "dark";
  settings.set("theme", next);
  settings.set("fontScale", next === "dark" ? 1.1 : 1);
  return preference("theme", next);
}

export async function addTodo() {
  const count = (db.getFirstSync<{ count: number }>("SELECT count(*) AS count FROM todos")?.count ?? 0) + 1;
  db.runSync("INSERT INTO todos (title, done, created_at) VALUES (?, ?, ?)", `Todo ${count}`, 0, new Date().toISOString());
  await AsyncStorage.setItem("todos:draft", JSON.stringify({ title: `Todo ${count + 1}`, editing: true }));
}

export function saveBytes() {
  // A binary MMKV value; the tool shows it as bytes because MMKV records no type.
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, Math.floor(Math.random() * 256)]);
  mmkv.set("avatar.header", bytes.buffer);
}

export function writeFiles() {
  if (!notes.exists) notes.create();
  notes.write(`Notes saved ${new Date().toISOString()}\n`);
  if (!cached.exists) cached.create();
  cached.write(new Uint8Array(512 * 1024).fill(7));
}

// Clears everything this app wrote, from inside the app, to compare with the tool's Reset.
export async function clearAll() {
  mmkv.clearAll();
  settings.clearAll();
  secure.clearAll();
  await AsyncStorage.clear();
  await DefaultPreference.clearAll();
  db.runSync("DELETE FROM todos");
  if (notes.exists) notes.delete();
  if (cached.exists) cached.delete();
}

export type Readout = { label: string; value: string }[];

// What the app itself reads back, to confirm the tool's Clear and Reset reached the app.
export async function readAll(): Promise<Readout> {
  const user = await AsyncStorage.getItem("auth:user");
  const stats = await AsyncStorage.getItem("stats");
  const todos = db.getFirstSync<{ count: number }>("SELECT count(*) AS count FROM todos")?.count ?? 0;
  return [
    { label: "Signed in", value: mmkv.getBoolean("isLoggedIn") ? `yes, ${mmkv.getString("user.name")}` : "no" },
    { label: "Auth token (encrypted MMKV)", value: secure.getString("authToken") ? "present" : "none" },
    { label: "Launches", value: String(mmkv.getNumber("launchCount") ?? 0) },
    { label: "Onboarding done", value: (await DefaultPreference.get("onboardingDone")) ?? "no" },
    { label: "Theme", value: settings.getString("theme") ?? "light (default)" },
    { label: "AsyncStorage user", value: user ? JSON.parse(user).email : "none" },
    { label: "AsyncStorage stats", value: stats ?? "none" },
    { label: "SQLite todos", value: String(todos) },
    { label: "Files", value: notes.exists ? `notes.txt (${notes.size} B)` : "none" },
  ];
}
