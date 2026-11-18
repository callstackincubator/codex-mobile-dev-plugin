import { ScrollView, StyleSheet } from "react-native";
import { Header } from "../components/Header";
import { CardList } from "../components/CardList";
import { PrimaryButton } from "../components/PrimaryButton";
import { Footer } from "../components/Footer";
import { spacing } from "../theme";

export function HomeScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header title="Discover" badge="New" />
      <CardList />
      <PrimaryButton label="Continue" onPress={() => {}} />
      <Footer />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md },
});
