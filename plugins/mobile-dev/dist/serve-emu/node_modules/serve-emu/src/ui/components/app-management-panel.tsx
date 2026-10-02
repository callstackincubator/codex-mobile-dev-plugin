import { useRef, useState, type DragEvent } from "react";
import { useDeviceSessionSnapshot } from "../lib/device-session-store";
import { usePoll } from "../lib/use-poll";

type AppApiResult = {
  ok?: boolean;
  output?: string;
  error?: string;
  path?: string;
  kind?: string;
};

type ForegroundApp = {
  packageName: string | null;
  activity: string | null;
  pid: number | null;
  label: string | null;
  versionName: string | null;
  versionCode: string | null;
  debuggable: boolean | null;
};

async function postJson(path: string, body: Record<string, unknown>): Promise<AppApiResult> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res.json() as AppApiResult;
}

function outputFor(result: AppApiResult): string {
  return result.ok ? result.output || "OK" : result.error || "Failed";
}

function isApk(file: File): boolean {
  return file.name.toLowerCase().endsWith(".apk") || file.type === "application/vnd.android.package-archive";
}

export function AppManagementPanel() {
  const apkRef = useRef<HTMLInputElement>(null);
  const [packageName, setPackageName] = useState("");
  const [activity, setActivity] = useState("");
  const [permission, setPermission] = useState("android.permission.POST_NOTIFICATIONS");
  const [status, setStatus] = useState("Ready");
  const [dragOver, setDragOver] = useState(false);
  const [foreground, setForeground] = useState<ForegroundApp | null>(null);
  const [foregroundError, setForegroundError] = useState<string | null>(null);
  const deviceSession = useDeviceSessionSnapshot();

  const { refresh: refreshForeground } = usePoll({
    poll: async ({ signal }) => {
      const res = await fetch("/api/foreground", { cache: "no-store", signal });
      return await res.json() as { ok?: boolean; app?: ForegroundApp; error?: string };
    },
    onResult: (json) => {
      if (json.ok && json.app) {
        setForeground(json.app);
        setForegroundError(null);
      } else {
        setForeground(null);
        setForegroundError(json.error || "Foreground app unavailable");
      }
    },
    onError: (error) => {
      setForeground(null);
      setForegroundError(error instanceof Error ? error.message : String(error));
    },
    intervalMs: null,
    pollKey: deviceSession.revision,
    enabled: !deviceSession.transitioning,
  });

  const run = async (label: string, request: () => Promise<AppApiResult>) => {
    setStatus(`${label}...`);
    try {
      const result = await request();
      setStatus(outputFor(result));
      if (result.ok) refreshForeground();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const uploadFile = async (file: File) => {
    const apk = isApk(file);
    await run(apk ? "Installing" : "Importing", async () => {
      const form = new FormData();
      form.set(apk ? "apk" : "file", file);
      const res = await fetch(apk ? "/api/apps/install" : "/api/files/import", {
        method: "POST",
        body: form,
      });
      return await res.json() as AppApiResult;
    });
  };

  const install = async () => {
    const file = apkRef.current?.files?.[0];
    if (!file) {
      setStatus("Choose an APK, image, or video first");
      return;
    }
    await uploadFile(file);
    if (apkRef.current) apkRef.current.value = "";
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    void (async () => {
      for (const file of files) {
        await uploadFile(file);
      }
    })();
  };

  const packageBody = () => ({ packageName: packageName.trim() });

  return (
    <section className="tool-panel app-management-panel">
      <div className="panel-heading">
        <h2>Apps</h2>
        <div className="location-status">{status}</div>
      </div>
      <div className="foreground-card">
        <div className="foreground-title">
          <span>{foreground?.label || foreground?.packageName || "No foreground app"}</span>
          {foreground?.packageName && (
            <button
              type="button"
              onClick={() => {
                setPackageName(foreground.packageName || "");
                setActivity(foreground.activity || "");
              }}
            >
              Use
            </button>
          )}
        </div>
        {foreground?.packageName ? (
          <dl>
            <div>
              <dt>Package</dt>
              <dd>{foreground.packageName}</dd>
            </div>
            <div>
              <dt>Activity</dt>
              <dd>{foreground.activity || "—"}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>
                {foreground.versionName || "—"}
                {foreground.versionCode ? ` (${foreground.versionCode})` : ""}
              </dd>
            </div>
            <div>
              <dt>PID</dt>
              <dd>{foreground.pid ?? "—"}</dd>
            </div>
            <div>
              <dt>Debuggable</dt>
              <dd>{foreground.debuggable == null ? "—" : foreground.debuggable ? "yes" : "no"}</dd>
            </div>
          </dl>
        ) : (
          <div className="foreground-empty">{foregroundError || "Waiting for app focus..."}</div>
        )}
      </div>
      <div
        className={dragOver ? "file-drop active" : "file-drop"}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragOver(false);
        }}
        onDrop={onDrop}
      >
        <span>Drop APK, image, or video</span>
        <small>APK installs; media is pushed to device storage.</small>
      </div>
      <input
        ref={apkRef}
        type="file"
        accept=".apk,application/vnd.android.package-archive,image/*,video/*"
      />
      <button className="primary-action" onClick={() => void install()}>
        Upload Selected File
      </button>
      <label className="stacked-field">
        Package
        <input
          onChange={(e) => setPackageName(e.currentTarget.value)}
          placeholder="com.example.app"
          value={packageName}
        />
      </label>
      <label className="stacked-field">
        Activity
        <input
          onChange={(e) => setActivity(e.currentTarget.value)}
          placeholder=".MainActivity"
          value={activity}
        />
      </label>
      <div className="panel-actions app-actions">
        <button
          onClick={() =>
            void run("Launching", () =>
              postJson("/api/apps/launch", { ...packageBody(), activity: activity.trim() || undefined }),
            )
          }
        >
          Launch
        </button>
        <button onClick={() => void run("Clearing", () => postJson("/api/apps/clear", packageBody()))}>
          Clear
        </button>
        <button
          onClick={() => void run("Stopping", () => postJson("/api/apps/force-stop", packageBody()))}
        >
          Stop
        </button>
      </div>
      <label className="stacked-field">
        Permission
        <input
          onChange={(e) => setPermission(e.currentTarget.value)}
          placeholder="android.permission.POST_NOTIFICATIONS"
          value={permission}
        />
      </label>
      <button
        onClick={() =>
          void run("Granting", () =>
            postJson("/api/apps/grant", { ...packageBody(), permission: permission.trim() }),
          )
        }
      >
        Grant Permission
      </button>
    </section>
  );
}
