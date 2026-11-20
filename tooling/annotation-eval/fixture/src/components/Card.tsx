import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";

type Props = { title: string; subtitle: string };

export function Card({ title, subtitle }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  title: { fontSize: 17, fontWeight: "600", color: colors.text },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: spacing.xs },
});
