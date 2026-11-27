/**
 * What a CoreDevice launch failure means, in words that match its cause.
 *
 * agent-device ends every `devicectl` launch failure it cannot classify with one hint: "Ensure the
 * iOS device is unlocked, trusted, and available in Xcode > Devices". That is right for a locked or
 * unpaired phone and wrong for the two codes below, which arrive on a phone that is unlocked, paired
 * and in front of the user. Those two get their own explanation; every other failure keeps its hint.
 */

const GENERIC_HINT = /(?:Hint:\s*)?Ensure the iOS device is unlocked, trusted, and available in Xcode > Devices, then retry\.?/i;

export type CoreDeviceLaunchCode = "10002" | "10004";

/** The launch error code in devicectl or agent-device output, when it is one of the two explained here. */
export function coreDeviceLaunchCode(text: string): CoreDeviceLaunchCode | undefined {
  const match = /CoreDeviceError error (10002|10004)\b/.exec(text);
  return match ? match[1] as CoreDeviceLaunchCode : undefined;
}

/** Apple's own apps (Settings, Safari, Maps) never carry a developer signature. */
export function isAppleBundle(appId: string | undefined): boolean {
  return appId !== undefined && /^com\.apple\./i.test(appId);
}

export function coreDeviceLaunchHint(code: CoreDeviceLaunchCode, appId?: string): string {
  if (code === "10004")
    return "The app was starting or stopping as it was opened, so the phone could not report its process. This usually clears within a few seconds: wait a moment and try again. If it repeats, open the app on the phone once to check that it does not quit at launch.";
  if (isAppleBundle(appId))
    return "The phone refused to open this Apple app from the Mac (the phone itself is reachable). Open it on the phone yourself and try again; if it still fails, pick one of your own apps instead.";
  return "The phone refused to start the app although it is reachable. Check the phone for a prompt, make sure the screen is on, and that the app is installed and its developer profile is trusted (Settings → General → VPN & Device Management), then try again.";
}

/** Replaces agent-device's generic unlock-and-trust hint when the failure is one of the codes above. `knownCode` is for an error whose code sits in its details rather than its text. */
export function rewriteCoreDeviceHint(text: string, appId?: string, knownCode?: CoreDeviceLaunchCode): string {
  const code = knownCode ?? coreDeviceLaunchCode(text);
  if (code === undefined || !GENERIC_HINT.test(text)) return text;
  return text.replace(GENERIC_HINT, coreDeviceLaunchHint(code, appId)).trim();
}
