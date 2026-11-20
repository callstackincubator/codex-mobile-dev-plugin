import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";

type Props = { title: string; badge?: string };

export function Header({ title, badge }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { fontSize: 28, fontWeight: "700", color: colors.text },
  badge: { fontSize: 12, fontWeight: "600", color: colors.surface, backgroundColor: colors.badge, paddingHorizontal: spacing.sm, borderRadius: 8 },
});
