import "@fontsource-variable/inter";
import "@mobile-dev/ui/theme.css";
import "@mobile-dev/ui/style.css";
import { startRecordingApp } from "./recording-app.tsx";
import { startComparisonApp } from "./comparison-app.tsx";
import { startTraceSiftApp } from "./tracesift-app.tsx";

if (document.documentElement.dataset.view === "recording") startRecordingApp();
else if (document.documentElement.dataset.view === "comparison") startComparisonApp();
else if (document.documentElement.dataset.view === "tracesift") startTraceSiftApp();
else void import("./workspace-app.tsx");
