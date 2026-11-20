import { Pressable, StyleSheet, Text } from "react-native";
import { colors, spacing } from "../theme";

type Props = { label: string; onPress: () => void };

export function PrimaryButton({ label, onPress }: Props) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: colors.primary, paddingVertical: spacing.md, borderRadius: 12, alignItems: "center" },
  label: { color: colors.surface, fontSize: 16, fontWeight: "600" },
});
