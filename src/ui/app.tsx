import "@fontsource-variable/inter";
import "./theme.css";
import "./style.css";
import { startRecordingApp } from "./recording-app.tsx";
import { startComparisonApp } from "./comparison-app.tsx";
import { startTraceSiftApp } from "./tracesift-app.tsx";
import { startDevicesApp } from "./devices-app.tsx";

if (document.documentElement.dataset.view === "recording") startRecordingApp();
else if (document.documentElement.dataset.view === "comparison") startComparisonApp();
else if (document.documentElement.dataset.view === "tracesift") startTraceSiftApp();
else if (document.documentElement.dataset.view === "devices") startDevicesApp();
else void import("./workspace-app.tsx");
