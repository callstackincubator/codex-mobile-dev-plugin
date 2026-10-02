import os from 'os';
import path from 'path';
import crypto from 'crypto';

import { XcodeInstances as GeneratedXcodeInstances, type XcodeInstance } from './xcode-instances';
import { type IosInstance } from './ios-instances';
import { exec, type ExecChildProcess, type ExecRequest } from '../exec-client';
import { syncFolder as syncFolderImpl, type FolderSyncOptions } from '../folder-sync';
import { createIgnoreFn } from '../folder-sync-ignore';
import { nodeProxyTransport } from '../internal/proxy-transport';

export type LogLevel = 'none' | 'error' | 'warn' | 'info' | 'debug';

export type SyncOptions = {
  /**
   * If true, watch the folder and re-sync on any changes. Defaults to true.
   */
  watch?: boolean;
  /**
   * Directory for the client-side folder-sync cache.
   * Defaults to a temporary directory under the OS temp directory.
   */
  basisCacheDir?: string;
  /** Max patch size (bytes) to send as delta before falling back to full upload. */
  maxPatchBytes?: number;
  /** If true, install the app after syncing. Defaults to true. */
  install?: boolean;
  /**
   * Optional predicate for ignoring files and directories during sync.
   * Called with the relative path from the sync root (using forward slashes).
   * For directories, the path ends with '/'.
   * Return true to ignore, false to keep.
   */
  ignore?: (relativePath: string) => boolean;
};

export type SyncResult = {
  /** Present only when watch=true; call to stop watching */
  stopWatching?: () => void;
};

export type XcodeProjectConfig = {
  workspace?: string;
  project?: string;
  scheme?: string;
  sdk?: 'iphonesimulator' | 'iphoneos';
};

export type XcodeBuildOptions = {
  upload?: { assetName: string };
};

export type XcodeClient = {
  /**
   * Sync source code to the xcode instance. In watch mode, keeps syncing on changes.
   */
  sync: (localCodePath: string, opts?: SyncOptions) => Promise<SyncResult>;

  /**
   * Trigger xcodebuild on the synced source code.
   * Returns a ChildProcess-like object for streaming output.
   *
   * @example
   * const build = xcode.xcodebuild({ scheme: 'MyApp' });
   * build.stdout.on('data', (line) => console.log(line));
   * const { exitCode } = await build;
   */
  xcodebuild: (settings?: XcodeProjectConfig, options?: XcodeBuildOptions) => ExecChildProcess;

  /**
   * Attach a simulator to this xcode instance.
   * After attaching, builds will auto-install on the simulator.
   */
  attachSimulator: (simulator: IosInstance | { apiUrl: string; token: string }) => Promise<void>;
};

export type XcodeCreateClientParams =
  | { instance: XcodeInstance; logLevel?: LogLevel }
  | { apiUrl: string; token: string; logLevel?: LogLevel };

function createLogger(logLevel: LogLevel) {
  const shouldLog = (level: LogLevel) => {
    const levels: LogLevel[] = ['none', 'error', 'warn', 'info', 'debug'];
    return levels.indexOf(logLevel) >= levels.indexOf(level);
  };
  return (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => {
    if (!shouldLog(level)) return;
    const prefix = '[XcodeInstance]';
    if (level === 'error' || level === 'warn') {
      console[level](prefix, msg);
    } else {
      console.log(prefix, msg);
    }
  };
}

export class XcodeInstances extends GeneratedXcodeInstances {
  async createClient(params: XcodeCreateClientParams): Promise<XcodeClient> {
    let apiUrl: string;
    let token: string;
    if ('instance' in params) {
      if (!params.instance.status.apiUrl) {
        throw new Error('Instance not ready: apiUrl is not available');
      }
      apiUrl = params.instance.status.apiUrl;
      token = params.instance.status.token;
    } else {
      apiUrl = params.apiUrl;
      token = params.token;
    }

    const log = createLogger(params.logLevel ?? 'info');
    const client = this._client;

    return {
      async sync(localCodePath: string, opts?: SyncOptions): Promise<SyncResult> {
        const resolvedPath = path.resolve(localCodePath);
        const folderName = path.basename(resolvedPath);
        const hash = crypto.createHash('sha1').update(resolvedPath).digest('hex').slice(0, 8);
        const cacheKey = `limsync-cache-${folderName}-${hash}`;
        const basisCacheDir = opts?.basisCacheDir ?? path.join(os.tmpdir(), cacheKey);
        const codeSyncOpts: FolderSyncOptions = {
          apiUrl,
          token,
          udid: cacheKey,
          install: opts?.install ?? true,
          ignoreFn: await createIgnoreFn(localCodePath, {
            basisCacheDir,
            additional: (relativePath: string) => {
              if (
                relativePath.startsWith('build/') ||
                relativePath.startsWith('.build/') ||
                relativePath.startsWith('DerivedData/') ||
                relativePath.startsWith('Index.noindex/') ||
                relativePath.startsWith('ModuleCache.noindex/') ||
                relativePath.startsWith('.index-build/')
              ) {
                return true;
              }
              if (
                relativePath.startsWith('.swiftpm/') ||
                relativePath.startsWith('Pods/') ||
                relativePath.startsWith('Carthage/Build/')
              ) {
                return true;
              }
              if (relativePath.includes('/xcuserdata/')) {
                return true;
              }
              if (relativePath.includes('.dSYM/')) {
                return true;
              }
              if (opts?.ignore?.(relativePath)) {
                return true;
              }
              return false;
            },
          }),
          basisCacheDir,
          watch: opts?.watch ?? true,
          maxPatchBytes: opts?.maxPatchBytes ?? 4 * 1024 * 1024,
          launchMode: 'ForegroundIfRunning',
          log,
        };

        const result = await syncFolderImpl(localCodePath, codeSyncOpts);
        if (result.stopWatching) {
          return { stopWatching: result.stopWatching };
        }
        return {};
      },

      xcodebuild(settings?: XcodeProjectConfig, options?: XcodeBuildOptions): ExecChildProcess {
        const request: ExecRequest = {
          command: 'xcodebuild',
          ...(settings && { xcodebuild: settings }),
        };

        if (options?.upload) {
          const uploadName = options.upload.assetName;
          const requestPromise = client.assets
            .getOrCreate({ name: uploadName })
            .then((asset) => {
              request.signedUploadUrl = asset.signedUploadUrl;
              request.additionalMetadata = { signedDownloadUrl: asset.signedDownloadUrl };
              return request;
            })
            .catch((err) => {
              throw new Error(
                `Failed to create upload URL for artifact '${uploadName}': ${
                  err instanceof Error ? err.message : err
                }`,
              );
            });
          return exec(requestPromise, { apiUrl, token, log });
        }

        return exec(request, { apiUrl, token, log });
      },

      async attachSimulator(simulator: IosInstance | { apiUrl: string; token: string }): Promise<void> {
        let simApiUrl: string;
        let simToken: string;
        if ('status' in simulator) {
          if (!simulator.status.apiUrl) {
            throw new Error('Simulator instance not ready: apiUrl is not available');
          }
          simApiUrl = simulator.status.apiUrl;
          simToken = simulator.status.token;
        } else {
          simApiUrl = simulator.apiUrl;
          simToken = simulator.token;
        }

        const res = await nodeProxyTransport.fetch(`${apiUrl}/simulator`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ apiUrl: simApiUrl, token: simToken }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`POST /simulator failed: ${res.status} ${text}`);
        }
      },
    };
  }
}
