import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";

export function ProfileScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.name}>Alex</Text>
      <Text style={styles.meta}>14 saved places</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.md, gap: spacing.md },
  name: { fontSize: 22, fontWeight: "700", color: colors.text },
  meta: { fontSize: 14, color: colors.muted },
});
