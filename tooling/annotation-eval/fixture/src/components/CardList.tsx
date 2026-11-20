import { StyleSheet, View } from "react-native";
import { Card } from "./Card";
import { spacing } from "../theme";

const ITEMS = [
  { id: "trails", title: "Mountain trails", subtitle: "12 routes nearby" },
  { id: "coffee", title: "Coffee spots", subtitle: "8 open now" },
  { id: "museums", title: "Museums", subtitle: "3 free this week" },
];

export function CardList() {
  return (
    <View style={styles.list}>
      {ITEMS.map(item => (
        <Card key={item.id} title={item.title} subtitle={item.subtitle} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
});
