// Preserve DevSuite's ordering: debug < default/notice < info < error < fault.
const subsystemThresholds = new Map<string, number>([
  ["com.apple.network", 2],
  ["com.apple.cfnetwork", 2],
  ["com.apple.pointerui", 2],
  ["com.apple.uikit", 1],
  ["com.apple.cfbundle", 1],
  ["com.apple.backboard", 2],
  ["com.apple.xpc", 2],
  ["com.apple.backlightservices", 2],
  ["com.apple.baseboard", 2],
  ["com.apple.frontboard", 2],
  ["com.apple.runningboard", 2],
  ["com.apple.uiintelligencesupport", 2],
  ["com.apple.securityd", 2],
  ["com.apple.containermanager", 2],
  ["com.apple.fileurl", 2],
  ["com.apple.dt.xctest", 2],
  ["com.apple.accessibility", 2],
  ["com.apple.boardservices", 2],
]);

const imageThresholds: readonly { path: string; threshold: number }[] = [
  { path: "UIKitCore.framework/UIKitCore", threshold: 1 },
  { path: "RunningBoardServices", threshold: 2 },
  { path: "Security.framework/Security", threshold: 2 },
  { path: "CoreFoundation.framework/CoreFoundation", threshold: 1 },
  { path: "lib/libMobileGestalt.dylib", threshold: 1 },
  { path: "libsystem_containermanager.dylib", threshold: 1 },
  { path: "CoreAnalytics.framework/CoreAnalytics", threshold: 1 },
];

function levelIndex(value: unknown): number | undefined {
  if (typeof value !== "string") return;
  const normalized = value.toLowerCase();
  switch (normalized) {
    case "debug": return 0;
    case "default": case "notice": return 1;
    case "info": return 2;
    case "error": return 3;
    case "fault": return 4;
  }
}

export function shouldExcludeIOSLog(level: unknown, subsystem: unknown, senderImagePath: unknown): boolean {
  const index = levelIndex(level);
  if (index === undefined || index > 2) return false;
  if (typeof subsystem === "string") {
    const normalized = subsystem.toLowerCase();
    const threshold = subsystemThresholds.get(normalized);
    if (threshold !== undefined && index <= threshold) return true;
  }
  if (typeof senderImagePath === "string") {
    for (const rule of imageThresholds) {
      if (index <= rule.threshold && senderImagePath.includes(rule.path)) return true;
    }
  }
  return false;
}
