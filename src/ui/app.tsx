import "@openai/mcp-extensions/app/styles.css";
import "@fontsource-variable/inter";
import "./theme.css";
import "./style.css";
import { startRecordingApp } from "./recording-app.tsx";
import { startComparisonApp } from "./comparison-app.tsx";

if (document.documentElement.dataset.view === "recording") startRecordingApp();
else if (document.documentElement.dataset.view === "comparison") startComparisonApp();
else void import("./workspace-app.tsx");
