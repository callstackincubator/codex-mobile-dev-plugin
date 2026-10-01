import "@openai/mcp-extensions/app/styles.css";
import "@fontsource-variable/inter";
import "./theme.css";
import "./style.css";
import { startRecordingApp } from "./recording-app.tsx";

if (document.documentElement.dataset.view === "recording") startRecordingApp();
else void import("./workspace-app.tsx");
