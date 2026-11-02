import { appDetailsBatch, appDetailsSchema } from "@mobile-dev/shared/app-control.ts";
import type { AppDetails } from "@mobile-dev/shared/app-control.ts";

type Call = (name: string, args: Record<string, unknown>) => Promise<unknown>;
type LoadOptions = {
  // Wraps each request so callers keep their own telemetry names.
  measure?: <T>(work: () => Promise<T>) => Promise<T>;
  // Runs after each batch lands, so long app lists show their first icons sooner.
  onBatch?: () => void;
};

// App icons and Android labels for every panel in this view, fetched once per device and app.
// The server caches the extracted PNGs; this cache avoids asking again while the view is open.
export class AppIconStore {
  private readonly entries = new Map<string, AppDetails>();
  private readonly pending = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.version;

  private key(platform: string, deviceId: string, bundleId: string) { return `${platform}\u0000${deviceId}\u0000${bundleId}`; }

  get(platform: string, deviceId: string, bundleId: string): AppDetails | undefined {
    return this.entries.get(this.key(platform, deviceId, bundleId));
  }

  async load(call: Call, platform: "ios" | "android", deviceId: string, bundleIds: readonly string[], { measure = work => work(), onBatch }: LoadOptions = {}) {
    const missing = bundleIds.filter(bundleId => {
      const key = this.key(platform, deviceId, bundleId);
      return !this.entries.has(key) && !this.pending.has(key);
    });
    for (const bundleId of missing) this.pending.add(this.key(platform, deviceId, bundleId));
    for (let start = 0; start < missing.length; start += appDetailsBatch) {
      const batch = missing.slice(start, start + appDetailsBatch);
      try {
        const data = appDetailsSchema.parse(await measure(() => call("mobile_app_icons", { platform, deviceId, bundleIds: batch })));
        // Apps without a readable icon are remembered too, so they keep their initial without another request.
        for (const bundleId of batch) this.entries.set(this.key(platform, deviceId, bundleId), data.apps[bundleId] ?? {});
        this.version++;
        for (const listener of this.listeners) listener();
        onBatch?.();
      } catch {
        // Initials remain; the next load tries these apps again.
      } finally {
        for (const bundleId of batch) this.pending.delete(this.key(platform, deviceId, bundleId));
      }
    }
  }
}

export const appIcons = new AppIconStore();
