import { SafeAreaView } from "react-native";
import { HomeScreen } from "./src/screens/HomeScreen";

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <HomeScreen />
    </SafeAreaView>
  );
}
