import { useId, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDownIcon, RotateCwIcon, SquareIcon } from "lucide-react";
import { z } from "zod";
import type { AppPermission, PermissionState } from "../../shared/app-control";
import type { AppEntry, AppToolsState, AppToolsStore } from "../app-tools";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "./ui/base-select";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

type SectionProps = { store: AppToolsStore; state: AppToolsState; app: AppEntry; blocked: boolean };

const permissionLabels: Record<AppPermission, string> = {
  location: "Location", photos: "Photos", camera: "Camera", microphone: "Microphone", notifications: "Notifications",
  contacts: "Contacts", calendar: "Calendar", reminders: "Reminders", motion: "Motion & fitness",
};
const permissionOptions = [
  { value: "allow", label: "Allow", on: "data-[state=on]:bg-green-500/15 data-[state=on]:text-green-700 dark:data-[state=on]:text-green-400" },
  { value: "deny", label: "Deny", on: "data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive" },
  { value: "ask", label: "Ask", on: "" },
] as const satisfies readonly { value: PermissionState; label: string; on: string }[];
const primaryPermissions = 4;
const payloadSchema = z.record(z.string(), z.unknown());

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="space-y-2 border-t pt-3">
    <div className="flex min-h-6 items-center justify-between gap-2"><h3 className="font-medium">{title}</h3>{action}</div>
    {children}
  </section>;
}

// Matches the device picker's running dot so both pickers read the same way.
function AppAvatar({ app, running, small = false }: { app: AppEntry; running: boolean; small?: boolean }) {
  const shape = small ? "size-6 rounded-md text-xs" : "size-8 rounded-lg text-sm";
  return <span aria-hidden className={`relative grid shrink-0 place-items-center ${shape} ${app.icon ? "" : "border bg-muted font-medium text-muted-foreground"}`}>
    {app.icon ? <img src={app.icon} alt="" draggable={false} className={`size-full object-cover ${small ? "rounded-md" : "rounded-lg"}`} /> : app.name.trim().charAt(0).toUpperCase() || "?"}
    {running && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-green-500 ring-2 ring-popover" />}
  </span>;
}

function AppPicker({ store, state, app, blocked }: SectionProps) {
  const running = state.runningBundleIds.includes(app.bundleId);
  return <div className="space-y-2">
    <Select items={state.apps.map(entry => ({ value: entry.bundleId, label: entry.name }))} value={app.bundleId} disabled={blocked} onValueChange={value => { if (value !== null) void store.open(value); }}>
      <SelectTrigger aria-label="App" title="Choose an app to launch" className="w-full gap-3 py-2 pl-2 pr-2.5 data-[size=default]:h-auto hover:bg-muted/50 [&>svg]:text-muted-foreground">
        <span className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <AppAvatar app={app} running={running} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium leading-5">{app.name}</span>
            <span className="block truncate text-xs leading-4 text-muted-foreground">{app.bundleId}</span>
          </span>
        </span>
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false} className="w-(--anchor-width)"><SelectGroup>
        {state.apps.map(entry => <SelectItem key={entry.bundleId} value={entry.bundleId} className="py-1.5 *:first:min-w-0 *:first:shrink">
          <span className="flex min-w-0 items-center gap-2.5">
            <AppAvatar app={entry} running={state.runningBundleIds.includes(entry.bundleId)} small />
            <span className="flex min-w-0 flex-col"><span className="truncate leading-5">{entry.name}</span>{entry.name !== entry.bundleId && <span className="truncate text-xs leading-4 text-muted-foreground">{entry.bundleId}</span>}</span>
          </span>
        </SelectItem>)}
      </SelectGroup></SelectContent>
    </Select>
    <div className="grid grid-cols-2 gap-2">
      <Button variant="outline" size="sm" disabled={blocked} aria-label={`${running ? "Relaunch" : "Launch"} ${app.name}`} onClick={() => void store.launch()}><RotateCwIcon className={state.busy === "launch" ? "animate-spin" : ""} />{running ? "Relaunch" : "Launch"}</Button>
      <Button variant="outline" size="sm" disabled={blocked} aria-label={`Stop ${app.name}`} onClick={() => void store.stop()}><SquareIcon className="size-3 fill-current" />Stop</Button>
    </div>
  </div>;
}

function OpenUrl({ store, state, blocked }: SectionProps) {
  const [url, setUrl] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const suggestions = state.links.filter(link => !state.recentUrls.includes(link));
  const chip = "max-w-44 shrink-0 font-mono font-normal";
  return <Section title="Open URL">
    <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void store.openUrl(url); }}>
      <Input ref={input} aria-label="URL to open" className="font-mono text-xs" placeholder={state.links[0] ?? "myapp://checkout"} value={url} disabled={state.disabled} onChange={event => setUrl(event.target.value)} />
      <Button type="submit" variant="secondary" disabled={blocked || !url.trim()}>Open</Button>
    </form>
    {/* One fixed-height row, so switching apps never changes the popover height. */}
    <div className="flex h-6 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]" aria-label="URL suggestions">
      {/* Declared schemes are usually incomplete, so they start a URL instead of opening one. */}
      {suggestions.map(link => <Button key={link} type="button" variant="outline" size="xs" className={`${chip} border-dashed text-muted-foreground`} title={`Start a URL with ${link}`} disabled={state.disabled} onClick={() => {
        setUrl(link);
        requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(link.length, link.length); });
      }}><span className="truncate">{link}</span></Button>)}
      {state.recentUrls.map(recent => <Button key={recent} type="button" variant="outline" size="xs" className={chip} title={`Open ${recent}`} disabled={blocked} onClick={() => { setUrl(recent); void store.openUrl(recent); }}><span className="truncate">{recent}</span></Button>)}
      {suggestions.length === 0 && state.recentUrls.length === 0 && <span className="text-xs text-muted-foreground">This app declares no URL schemes.</span>}
    </div>
  </Section>;
}

function Permissions({ store, state, blocked }: SectionProps) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const permissions = state.permissions;
  const hidden = (permissions?.length ?? 0) - primaryPermissions;
  return <Section title="Permissions" action={<Button variant="ghost" size="xs" className="text-muted-foreground" disabled={blocked || !permissions?.length} onClick={() => void store.setPermission("all", "ask")}>Reset all</Button>}>
    {permissions === null ? <p className="text-xs text-muted-foreground">Loading permissions…</p>
      : permissions.length === 0 ? <p className="text-xs text-muted-foreground">This app does not request supported runtime permissions.</p>
      : <div className="space-y-1.5">
        {(expanded ? permissions : permissions.slice(0, primaryPermissions)).map(entry => <div key={entry.permission} className="flex items-center justify-between gap-3">
          <span id={`${id}-${entry.permission}`}>{permissionLabels[entry.permission]}</span>
          <ToggleGroup type="single" variant="outline" size="sm" spacing={0} aria-labelledby={`${id}-${entry.permission}`} value={entry.state ?? ""} disabled={blocked}
            onValueChange={value => { const option = permissionOptions.find(candidate => candidate.value === value); if (option) void store.setPermission(entry.permission, option.value); }}>
            {permissionOptions.map(option => <ToggleGroupItem key={option.value} value={option.value} className={`px-2 text-xs ${option.on}`}>{option.label}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>)}
        {hidden > 0 && <Button variant="ghost" size="xs" className="-ml-2 text-muted-foreground" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Fewer permissions" : `${hidden} more permission${hidden === 1 ? "" : "s"}`}<ChevronDownIcon className={expanded ? "rotate-180" : ""} />
        </Button>}
        {state.platform === "ios" && <p className="text-xs text-muted-foreground">iOS Simulator does not report current choices; highlights show what you set here.</p>}
      </div>}
  </Section>;
}

function PushNotification({ store, app, blocked }: SectionProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // Undefined while composing with title and body; the raw JSON text while editing the payload.
  const [json, setJson] = useState<string>();
  const [jsonError, setJsonError] = useState("");
  const formPayload = () => ({ aps: { alert: { title: title.trim() || app.name, ...(body.trim() ? { body: body.trim() } : {}) }, sound: "default" } });
  const send = () => {
    if (json === undefined) { void store.push(formPayload()); return; }
    try {
      const payload = payloadSchema.safeParse(JSON.parse(json));
      if (!payload.success) throw new Error("Payload must be a JSON object.");
      setJsonError("");
      void store.push(payload.data);
    } catch (error) { setJsonError(error instanceof Error ? error.message : String(error)); }
  };
  return <Section title="Push notification">
    <Collapsible open={json !== undefined} onOpenChange={open => { setJsonError(""); setJson(open ? JSON.stringify(formPayload(), null, 2) : undefined); }}>
      <form className="space-y-2" onSubmit={event => { event.preventDefault(); send(); }}>
        {json === undefined && <div className="grid grid-cols-2 gap-2">
          <Input aria-label="Notification title" placeholder="Title" value={title} onChange={event => setTitle(event.target.value)} />
          <Input aria-label="Notification body" placeholder="Body" value={body} onChange={event => setBody(event.target.value)} />
        </div>}
        <CollapsibleContent><Textarea aria-label="Push payload JSON" className="min-h-28 font-mono text-xs" value={json ?? ""} aria-invalid={!!jsonError} onChange={event => setJson(event.target.value)} /></CollapsibleContent>
        {jsonError && <p className="text-xs text-destructive" role="alert">{jsonError}</p>}
        <div className="flex items-center justify-between gap-2">
          <CollapsibleTrigger asChild><Button type="button" variant="ghost" size="xs" className="-ml-2 text-muted-foreground">{json === undefined ? "Edit JSON payload" : "Use title and body"}</Button></CollapsibleTrigger>
          <Button type="submit" variant="secondary" disabled={blocked}>Send</Button>
        </div>
      </form>
    </Collapsible>
  </Section>;
}

export function AppTools({ store }: { store: AppToolsStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const app = state.apps.find(entry => entry.bundleId === state.bundleId);
  const error = state.error && <p className="whitespace-pre-wrap text-xs text-destructive" role="alert">{state.error}</p>;
  if (state.disabled) return <p className="py-2 text-muted-foreground">App tools work on running iOS simulators and Android devices.</p>;
  if (!app) {
    return <div className="space-y-2 py-2" role="status">
      {!state.error && <p className="text-muted-foreground">{state.loading ? "Loading apps…" : "No user apps are installed on this device."}</p>}
      {error}
    </div>;
  }
  const props: SectionProps = { store, state, app, blocked: state.busy !== null };
  return <div className="space-y-3">
    <AppPicker {...props} />
    <OpenUrl {...props} />
    <Permissions {...props} />
    {state.platform === "ios" && <PushNotification {...props} />}
    {error}
    {/* The controls show success themselves; announce it without shifting the layout. */}
    <p className="sr-only" role="status">{state.error ? "" : state.status}</p>
  </div>;
}
