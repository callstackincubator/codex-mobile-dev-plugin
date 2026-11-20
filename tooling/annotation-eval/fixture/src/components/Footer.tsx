import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";

export function Footer() {
  return (
    <View style={styles.footer}>
      <Text style={styles.link}>Terms</Text>
      <Text style={styles.link}>Privacy</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: "row", justifyContent: "center", gap: spacing.lg, paddingVertical: spacing.lg },
  link: { fontSize: 14, color: colors.muted },
});
