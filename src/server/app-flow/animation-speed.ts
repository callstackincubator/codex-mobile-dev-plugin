import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir, readFile, rename, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';

type Execute = (file: string, args: string[], options: {signal?: AbortSignal; timeout?: number; env?: NodeJS.ProcessEnv}) => Promise<{stdout: string}>;

/** Ten times faster native animations while a run captures. */
export const FAST_ANIMATIONS = 10;
const speedName = 'dev.mobile-dev.app-flow.animation-speed';
const loadedName = (appId: string) => `dev.mobile-dev.app-flow.animation-library.${appId}`;
const bundled = () => fileURLToPath(new URL(import.meta.url.endsWith('/server.mjs')
  ? './ios-animation/MobileDevAnimationSpeed.dylib' : '../../../vendor/ios-animation/MobileDevAnimationSpeed.dylib', import.meta.url));

/** iOS simulators only. The plugin's animation library scales Core Animation
 * time in an app App Flow launches; see native/ios-animation/README.md. */
export class SimulatorAnimations {
  private copy?: Promise<string | undefined>;
  private directory: string; private execute: Execute; private source: string;
  constructor(directory: string, execute: Execute = promisify(execFile) as Execute, source = bundled()) {
    this.directory = directory; this.execute = execute; this.source = source;
  }
  /** A copy outside folders macOS privacy protection covers. A simulator app
   * cannot load a library from Documents and stops at its launch screen. */
  library() {
    return this.copy ??= (async () => {
      const bytes = await readFile(this.source);
      const directory = join(this.directory, 'native');
      const target = join(directory, `MobileDevAnimationSpeed-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.dylib`);
      if ((await stat(target).catch(() => undefined))?.size === bytes.length) return target;
      await mkdir(directory, {recursive: true, mode: 0o700});
      const temporary = `${target}.${process.pid}.tmp`;
      await writeFile(temporary, bytes, {mode: 0o644});
      await rename(temporary, target);
      return target;
    })().catch(() => { this.copy = undefined; return undefined; });
  }
  /** Launch the app with the library at ten times speed. Without confirmation
   * that the new process loaded it, the app is terminated and false returned,
   * so the caller launches it normally. */
  async launch(udid: string, appId: string, signal: AbortSignal) {
    const library = await this.library();
    if (!library) return false;
    try {
      const {stdout} = await this.execute('xcrun', ['simctl', 'launch', udid, appId], {signal, timeout: 20000,
        env: {...process.env, SIMCTL_CHILD_DYLD_INSERT_LIBRARIES: library, SIMCTL_CHILD_MOBILE_DEV_ANIMATION_SPEED: String(FAST_ANIMATIONS)}});
      const pid = Number(/:\s*(\d+)\s*$/.exec(stdout.trim())?.[1]);
      // The library records its process while the app loads, before any app code.
      for (let attempt = 0; Number.isInteger(pid) && attempt < 20; attempt++) {
        if (await this.loader(udid, appId, signal) === pid) return true;
        await delay(250, undefined, {signal});
      }
    } catch (error) { if (signal.aborted) throw error; }
    await this.execute('xcrun', ['simctl', 'terminate', udid, appId], {signal, timeout: 20000}).catch(() => {});
    return false;
  }
  /** Whether the app's running process loaded the library. */
  async loaded(udid: string, appId: string, signal: AbortSignal) {
    try {
      const [loader, running] = await Promise.all([this.loader(udid, appId, signal), this.pid(udid, appId, signal)]);
      return !!running && loader === running;
    } catch (error) { if (signal.aborted) throw error; return false; }
  }
  /** Speed of an app that loaded the library; 1 is normal. Apps without it ignore it. */
  async speed(udid: string, speed: number, signal?: AbortSignal) {
    const state = String(Math.round(Math.min(20, Math.max(1, speed)) * 100));
    await this.execute('xcrun', ['simctl', 'spawn', udid, 'notifyutil', '-s', speedName, state, '-p', speedName], {signal, timeout: 10000});
  }
  private async loader(udid: string, appId: string, signal: AbortSignal) {
    const {stdout} = await this.execute('xcrun', ['simctl', 'spawn', udid, 'notifyutil', '-g', loadedName(appId)], {signal, timeout: 10000});
    return Number(stdout.trim().split(/\s+/).at(-1));
  }
  private async pid(udid: string, appId: string, signal: AbortSignal) {
    const {stdout} = await this.execute('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list'], {signal, timeout: 10000});
    for (const line of stdout.split('\n')) {
      const [pid, , label] = line.trim().split(/\s+/);
      if (label?.startsWith(`UIKitApplication:${appId}[`) && /^\d+$/.test(pid ?? '')) return Number(pid);
    }
  }
}
