import { t as AndroidAdbExecutor } from "./sdk-android-adb.js";
//#region packages/contracts/src/android-input-ownership.d.ts
type AndroidInputOwner = 'app' | 'ime' | 'unknown';
//#endregion
//#region src/platforms/android/device-input-state.d.ts
type AndroidKeyboardType = 'text' | 'number' | 'email' | 'phone' | 'password' | 'datetime' | 'unknown';
type AndroidKeyboardState = {
  visible: boolean;
  inputType?: string;
  type?: AndroidKeyboardType;
  inputMethodPackage?: string;
  focusedPackage?: string;
  focusedResourceId?: string;
  inputOwner: AndroidInputOwner;
};
type AndroidKeyboardDismissResult = AndroidKeyboardState & {
  attempts: number;
  wasVisible: boolean;
  dismissed: boolean;
};
declare function getAndroidKeyboardStatusWithAdb(adb: AndroidAdbExecutor): Promise<AndroidKeyboardState>;
declare function dismissAndroidKeyboardWithAdb(adb: AndroidAdbExecutor): Promise<AndroidKeyboardDismissResult>;
declare function readAndroidClipboardWithAdb(adb: AndroidAdbExecutor): Promise<string>;
declare function writeAndroidClipboardWithAdb(adb: AndroidAdbExecutor, text: string): Promise<void>;
//#endregion
export { readAndroidClipboardWithAdb as a, getAndroidKeyboardStatusWithAdb as i, AndroidKeyboardState as n, writeAndroidClipboardWithAdb as o, dismissAndroidKeyboardWithAdb as r, AndroidInputOwner as s, AndroidKeyboardDismissResult as t };