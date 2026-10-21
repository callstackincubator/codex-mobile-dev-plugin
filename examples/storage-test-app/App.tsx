import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as storage from "./src/storage";

type Action = { title: string; detail: string; run: () => unknown; destructive?: boolean };

const actions: Action[] = [
  { title: "Sign in", detail: "MMKV user + session, encrypted token, AsyncStorage user, lastLogin preference", run: storage.signIn },
  { title: "Sign out", detail: "Removes the sign-in keys", run: storage.signOut },
  { title: "Finish onboarding", detail: "Preference flag, MMKV step, typed iOS UserDefaults", run: storage.finishOnboarding },
  { title: "Reset onboarding", detail: "Removes or flips the onboarding keys", run: storage.resetOnboarding },
  { title: "Toggle theme", detail: "MMKV instance \"settings\" and a theme preference", run: storage.toggleTheme },
  { title: "Add todo", detail: "SQLite row in todos.db and an AsyncStorage draft", run: storage.addTodo },
  { title: "Save bytes", detail: "Binary MMKV value (shown as bytes)", run: storage.saveBytes },
  { title: "Write files", detail: "Documents/notes.txt and a 512 KB cache file", run: storage.writeFiles },
  { title: "Clear everything in the app", detail: "Wipes all stores from inside the app", run: storage.clearAll, destructive: true },
];

export default function App() {
  const [readout, setReadout] = useState<storage.Readout>([]);
  const [error, setError] = useState("");
  const refresh = useCallback(() => { storage.readAll().then(setReadout, (reason: unknown) => setError(String(reason))); }, []);

  useEffect(() => {
    storage.recordLaunch().then(refresh, (reason: unknown) => setError(String(reason)));
    // Re-read when the app returns to the foreground, for example after the tool cleared a store.
    const subscription = AppState.addEventListener("change", state => { if (state === "active") refresh(); });
    return () => subscription.remove();
  }, [refresh]);

  const run = async (action: Action) => {
    setError("");
    try { await action.run(); }
    catch (reason) { setError(`${action.title} failed: ${String(reason)}`); }
    refresh();
  };

  return <SafeAreaProvider><SafeAreaView style={styles.screen}>
    <StatusBar style="dark" />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Storage Test</Text>
      <Text style={styles.subtitle}>Each button writes to real stores. Open Mobile Dev → Tools → Storage to watch them, ideally on the Changes tab.</Text>

      <Text style={styles.section}>Actions</Text>
      {actions.map(action => <Pressable key={action.title} testID={`action-${action.title}`} accessibilityRole="button" onPress={() => void run(action)}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
        <Text style={[styles.actionTitle, action.destructive && styles.destructive]}>{action.title}</Text>
        <Text style={styles.actionDetail}>{action.detail}</Text>
      </Pressable>)}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.sectionRow}>
        <Text style={styles.section}>What the app reads</Text>
        <Pressable accessibilityRole="button" onPress={refresh}><Text style={styles.link}>Refresh</Text></Pressable>
      </View>
      <View style={styles.card}>
        {readout.map(row => <View key={row.label} style={styles.row}>
          <Text style={styles.rowLabel}>{row.label}</Text>
          <Text style={styles.rowValue} numberOfLines={2}>{row.value}</Text>
        </View>)}
      </View>
    </ScrollView>
  </SafeAreaView></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f6f6f7" },
  content: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: "700", marginTop: 8 },
  subtitle: { fontSize: 14, color: "#6b6b70", marginTop: 6, lineHeight: 20 },
  section: { fontSize: 13, fontWeight: "600", color: "#6b6b70", textTransform: "uppercase", marginTop: 24, marginBottom: 8 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  link: { color: "#2563eb", fontSize: 14, marginBottom: 8 },
  action: { backgroundColor: "white", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: "#d4d4d8" },
  pressed: { opacity: 0.6 },
  actionTitle: { fontSize: 16, fontWeight: "600" },
  destructive: { color: "#dc2626" },
  actionDetail: { fontSize: 13, color: "#6b6b70", marginTop: 2 },
  error: { color: "#dc2626", marginTop: 8 },
  card: { backgroundColor: "white", borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: "#d4d4d8" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e4e4e7" },
  rowLabel: { fontSize: 14, color: "#3f3f46", flexShrink: 0 },
  rowValue: { fontSize: 14, fontWeight: "500", flex: 1, textAlign: "right" },
});
