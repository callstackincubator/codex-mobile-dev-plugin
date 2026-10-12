import { useId, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDownIcon, RotateCwIcon, SquareIcon } from "lucide-react";
import type { AppPermission, PermissionState } from "../../shared/app-control";
import type { AppToolsStore } from "../app-tools";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "./ui/base-select";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

const permissionLabels: Record<AppPermission, string> = {
  location: "Location", photos: "Photos", camera: "Camera", microphone: "Microphone", notifications: "Notifications",
  contacts: "Contacts", calendar: "Calendar", reminders: "Reminders", motion: "Motion & fitness",
};
const stateLabels: Record<PermissionState, string> = { allow: "Allow", deny: "Deny", ask: "Ask" };
const primaryPermissions = 4;

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="space-y-2 border-t pt-3">
    <div className="flex min-h-6 items-center justify-between gap-2"><h3 className="font-medium">{title}</h3>{action}</div>
    {children}
  </section>;
}

// Matches the device picker's running dot so both pickers read the same way.
function AppAvatar({ name, icon, running, small = false }: { name: string; icon?: string; running: boolean; small?: boolean }) {
  const shape = small ? "size-6 rounded-md text-xs" : "size-8 rounded-lg text-sm";
  return <span aria-hidden className={`relative grid shrink-0 place-items-center ${shape} ${icon ? "" : "border bg-muted font-medium text-muted-foreground"}`}>
    {icon ? <img src={icon} alt="" draggable={false} className={`size-full object-cover ${small ? "rounded-md" : "rounded-lg"}`} /> : name.trim().charAt(0).toUpperCase() || "?"}
    {running && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-green-500 ring-2 ring-popover" />}
  </span>;
}

export function AppTools({ store }: { store: AppToolsStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const id = useId();
  const [url, setUrl] = useState("");
  const urlInput = useRef<HTMLInputElement>(null);
  const [morePermissions, setMorePermissions] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [payload, setPayload] = useState<string>();
  const [payloadError, setPayloadError] = useState("");
  const app = state.apps.find(entry => entry.bundleId === state.bundleId);
  const blocked = state.disabled || !!state.busy;
  const isRunning = (bundleId: string) => bundleId === state.foregroundBundleId || state.runningBundleIds.includes(bundleId);
  const running = app !== undefined && isRunning(app.bundleId);

  if (state.disabled) return <p className="py-2 text-muted-foreground">App tools work on running iOS simulators and Android devices.</p>;
  if (!app) {
    return <div className="space-y-2 py-2" role="status">
      <p className="text-muted-foreground">{state.loading ? "Loading apps…" : state.error ? "" : "No user apps are installed on this device."}</p>
      {state.error && <p className="whitespace-pre-wrap text-xs text-destructive" role="alert">{state.error}</p>}
    </div>;
  }

  const suggestions = state.links.filter(link => !state.recentUrls.includes(link));
  const permissions = state.permissions;
  const visiblePermissions = morePermissions ? permissions : permissions.slice(0, primaryPermissions);
  const formPayload = () => ({ aps: { alert: { title: title.trim() || app.name, ...(body.trim() ? { body: body.trim() } : {}) }, sound: "default" } });
  const sendPush = () => {
    let data: Record<string, unknown>;
    if (payload === undefined) data = formPayload();
    else {
      try {
        const parsed: unknown = JSON.parse(payload);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Payload must be a JSON object.");
        data = parsed as Record<string, unknown>;
      } catch (error) { setPayloadError(error instanceof Error ? error.message : String(error)); return; }
    }
    setPayloadError("");
    void store.push(data);
  };

  return <div className="space-y-3">
    <div className="space-y-2">
      <Select items={state.apps.map(entry => ({ value: entry.bundleId, label: entry.name }))} value={app.bundleId} disabled={blocked} onValueChange={value => { if (value !== null) void store.open(value); }}>
        <SelectTrigger aria-label="App" title="Choose an app to launch" className="w-full gap-3 py-2 pl-2 pr-2.5 data-[size=default]:h-auto hover:bg-muted/50 [&>svg]:text-muted-foreground">
          <span className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <AppAvatar name={app.name} icon={state.icons[app.bundleId]} running={running} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium leading-5">{app.name}</span>
              <span className="block truncate text-xs leading-4 text-muted-foreground">{app.bundleId}</span>
            </span>
          </span>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false} className="w-(--anchor-width)"><SelectGroup>
          {state.apps.map(entry => <SelectItem key={entry.bundleId} value={entry.bundleId} className="py-1.5 *:first:min-w-0 *:first:shrink">
            <span className="flex min-w-0 items-center gap-2.5">
              <AppAvatar name={entry.name} icon={state.icons[entry.bundleId]} running={isRunning(entry.bundleId)} small />
              <span className="flex min-w-0 flex-col"><span className="truncate leading-5">{entry.name}</span>{entry.name !== entry.bundleId && <span className="truncate text-xs leading-4 text-muted-foreground">{entry.bundleId}</span>}</span>
            </span>
          </SelectItem>)}
        </SelectGroup></SelectContent>
      </Select>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" disabled={blocked} aria-label={running ? `Relaunch ${app.name}` : `Launch ${app.name}`} onClick={() => void store.launch()}><RotateCwIcon className={state.busy === "launch" ? "animate-spin" : ""} />{running ? "Relaunch" : "Launch"}</Button>
        <Button variant="outline" size="sm" disabled={blocked} aria-label={`Stop ${app.name}`} onClick={() => void store.stop()}><SquareIcon className="size-3 fill-current" />Stop</Button>
      </div>
    </div>

    <Section title="Open URL">
      <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void store.openUrl(url); }}>
        <Input ref={urlInput} aria-label="URL to open" className="font-mono text-xs" placeholder={state.links[0] ?? "myapp://checkout"} value={url} disabled={state.disabled} onChange={event => setUrl(event.target.value)} />
        <Button type="submit" variant="secondary" disabled={blocked || !url.trim()}>Open</Button>
      </form>
      {/* One fixed-height row, so switching apps never changes the popover height. */}
      <div className="flex h-6 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]" aria-label="URL suggestions">
        {/* Declared schemes are usually incomplete, so they start a URL instead of opening one. */}
        {suggestions.map(link => <Button key={link} type="button" variant="outline" size="xs" className="max-w-44 shrink-0 border-dashed font-mono font-normal text-muted-foreground" title={`Start a URL with ${link}`} disabled={state.disabled} onClick={() => {
          setUrl(link);
          requestAnimationFrame(() => { const input = urlInput.current; input?.focus(); input?.setSelectionRange(link.length, link.length); });
        }}><span className="truncate">{link}</span></Button>)}
        {state.recentUrls.map(recent => <Button key={recent} type="button" variant="outline" size="xs" className="max-w-44 shrink-0 font-mono font-normal" title={`Open ${recent}`} disabled={blocked} onClick={() => { setUrl(recent); void store.openUrl(recent); }}><span className="truncate">{recent}</span></Button>)}
        {suggestions.length === 0 && state.recentUrls.length === 0 && <span className="text-xs text-muted-foreground">This app declares no URL schemes.</span>}
      </div>
    </Section>

    <Section title="Permissions" action={<Button variant="ghost" size="xs" className="text-muted-foreground" disabled={blocked || !permissions.length} onClick={() => void store.setPermission("all", "ask")}>Reset all</Button>}>
      {!state.permissionsReady ? <p className="text-xs text-muted-foreground">Loading permissions…</p>
        : permissions.length === 0 ? <p className="text-xs text-muted-foreground">This app does not request supported runtime permissions.</p>
        : <div className="space-y-1.5">
          {visiblePermissions.map(entry => <div key={entry.permission} className="flex items-center justify-between gap-3">
            <span id={`${id}-${entry.permission}`}>{permissionLabels[entry.permission]}</span>
            <ToggleGroup type="single" variant="outline" size="sm" spacing={0} aria-labelledby={`${id}-${entry.permission}`} value={entry.state ?? ""} disabled={blocked}
              onValueChange={value => { if (value) void store.setPermission(entry.permission, value as PermissionState); }}>
              {(["allow", "deny", "ask"] as const).map(option => <ToggleGroupItem key={option} value={option} className={`px-2 text-xs ${option === "allow" ? "data-[state=on]:bg-green-500/15 data-[state=on]:text-green-700 dark:data-[state=on]:text-green-400" : option === "deny" ? "data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive" : ""}`}>{stateLabels[option]}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>)}
          {permissions.length > primaryPermissions && <Button variant="ghost" size="xs" className="-ml-2 text-muted-foreground" aria-expanded={morePermissions} onClick={() => setMorePermissions(!morePermissions)}>
            {morePermissions ? "Fewer permissions" : `${permissions.length - primaryPermissions} more permission${permissions.length - primaryPermissions === 1 ? "" : "s"}`}<ChevronDownIcon className={morePermissions ? "rotate-180" : ""} />
          </Button>}
          {state.platform === "ios" && <p className="text-xs text-muted-foreground">iOS Simulator does not report current choices; highlights show what you set here.</p>}
        </div>}
    </Section>

    {state.platform === "ios" && <Section title="Push notification">
      <Collapsible open={payload !== undefined} onOpenChange={open => { setPayloadError(""); setPayload(open ? JSON.stringify(formPayload(), null, 2) : undefined); }}>
        <form className="space-y-2" onSubmit={event => { event.preventDefault(); sendPush(); }}>
          {payload === undefined && <div className="grid grid-cols-2 gap-2">
            <Input aria-label="Notification title" placeholder="Title" value={title} onChange={event => setTitle(event.target.value)} />
            <Input aria-label="Notification body" placeholder="Body" value={body} onChange={event => setBody(event.target.value)} />
          </div>}
          <CollapsibleContent><Textarea aria-label="Push payload JSON" className="min-h-28 font-mono text-xs" value={payload ?? ""} aria-invalid={!!payloadError} onChange={event => setPayload(event.target.value)} /></CollapsibleContent>
          {payloadError && <p className="text-xs text-destructive" role="alert">{payloadError}</p>}
          <div className="flex items-center justify-between gap-2">
            <CollapsibleTrigger asChild><Button type="button" variant="ghost" size="xs" className="-ml-2 text-muted-foreground">{payload === undefined ? "Edit JSON payload" : "Use title and body"}</Button></CollapsibleTrigger>
            <Button type="submit" variant="secondary" disabled={blocked}>Send</Button>
          </div>
        </form>
      </Collapsible>
    </Section>}

    {state.error && <p className="whitespace-pre-wrap text-xs text-destructive" role="alert">{state.error}</p>}
    {/* The controls show success themselves; announce it without shifting the layout. */}
    <p className="sr-only" role="status">{state.error ? "" : state.status}</p>
  </div>;
}
