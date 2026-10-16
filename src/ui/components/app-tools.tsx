import { useId, useRef, useState, useSyncExternalStore } from "react";
import type { LucideIcon } from "lucide-react";
import { ActivityIcon, ArrowRightIcon, BellIcon, BracesIcon, CalendarIcon, CameraIcon, ChevronDownIcon, ClockIcon, ContactIcon, ImageIcon, InfoIcon, LanguagesIcon, ListChecksIcon, MapPinIcon, MicIcon, RotateCcwIcon, RotateCwIcon, SendIcon, ShieldIcon, SquareIcon } from "lucide-react";
import { z } from "zod";
import type { AppPermission, PermissionState } from "../../shared/app-control";
import type { AppEntry, AppSection, AppToolsState, AppToolsStore } from "../app-tools";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./ui/input-group";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/base-select";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

type SectionProps = { store: AppToolsStore; state: AppToolsState; app: AppEntry; blocked: boolean };

const permissionRows: Record<AppPermission, { label: string; icon: LucideIcon }> = {
  location: { label: "Location", icon: MapPinIcon }, photos: { label: "Photos", icon: ImageIcon }, camera: { label: "Camera", icon: CameraIcon },
  microphone: { label: "Microphone", icon: MicIcon }, notifications: { label: "Notifications", icon: BellIcon }, contacts: { label: "Contacts", icon: ContactIcon },
  calendar: { label: "Calendar", icon: CalendarIcon }, reminders: { label: "Reminders", icon: ListChecksIcon }, motion: { label: "Motion & fitness", icon: ActivityIcon },
};
// Only a chosen state is colored, so rows nobody has set stay neutral.
const permissionOptions = [
  { value: "allow", label: "Allow", on: "data-[state=on]:bg-green-500/15 data-[state=on]:text-green-700 dark:data-[state=on]:text-green-400" },
  { value: "deny", label: "Deny", on: "data-[state=on]:bg-destructive/10 data-[state=on]:text-destructive" },
  { value: "ask", label: "Ask", on: "data-[state=on]:text-foreground" },
] as const satisfies readonly { value: PermissionState; label: string; on: string }[];
const payloadSchema = z.record(z.string(), z.unknown());
// Common translation targets, including right-to-left scripts that change the layout.
const languageTags = ["en", "en-GB", "de", "fr", "es", "es-MX", "it", "pt-BR", "nl", "pl", "sv", "tr", "ru", "ja", "ko", "zh-Hans", "zh-Hant", "hi", "ar", "he"];
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
const languageLabel = (tag: string) => { try { return languageNames.of(tag) ?? tag; } catch { return tag; } };
const deviceLanguage = "device";

// A collapsible row; the App tab keeps at most one open so the popover stays short.
function Disclosure({ section, state, store, icon: Icon, title, summary, children }: { section: AppSection; state: AppToolsState; store: AppToolsStore; icon: LucideIcon; title: string; summary?: React.ReactNode; children: React.ReactNode }) {
  const open = state.section === section;
  return <Collapsible open={open} onOpenChange={value => store.setSection(value ? section : null)} className="border-t py-1">
    <CollapsibleTrigger className="-mx-2 flex h-8 w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50">
      <Icon className="size-4 text-muted-foreground" />
      <span className="flex-1 font-medium">{title}</span>
      {!open && summary && <span className="truncate text-xs text-muted-foreground">{summary}</span>}
      <ChevronDownIcon className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
    </CollapsibleTrigger>
    <CollapsibleContent className="pb-2 pt-1">{children}</CollapsibleContent>
  </Collapsible>;
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
  const action = "h-auto w-9 shrink-0 rounded-none border-l border-l-border text-muted-foreground hover:text-foreground focus-visible:z-10";
  return <div className="flex rounded-lg border">
    <Select items={state.apps.map(entry => ({ value: entry.bundleId, label: entry.name }))} value={app.bundleId} disabled={blocked} onValueChange={value => { if (value !== null) void store.open(value); }}>
      <SelectTrigger aria-label="App" title="Choose an app to launch" className="min-w-0 flex-1 gap-2.5 rounded-r-none border-0 py-2 pl-2 pr-2 data-[size=default]:h-auto hover:bg-muted/50 focus-visible:z-10 [&>svg]:text-muted-foreground">
        <span className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <AppAvatar app={app} running={false} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium leading-5">{app.name}</span>
            <span className="flex items-center gap-1.5 text-xs leading-4 text-muted-foreground">
              {running && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-green-500" />}
              <span className="truncate">{running ? `Running · ${app.bundleId}` : app.bundleId}</span>
            </span>
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
    <Button variant="ghost" size="icon" className={action} disabled={blocked} aria-label={`${running ? "Relaunch" : "Launch"} ${app.name}`} title={running ? "Relaunch" : "Launch"} onClick={() => void store.launch()}><RotateCwIcon className={state.busy === "launch" ? "animate-spin" : ""} /></Button>
    <Button variant="ghost" size="icon" className={`${action} rounded-r-lg`} disabled={blocked} aria-label={`Stop ${app.name}`} title="Stop" onClick={() => void store.stop()}><SquareIcon className="size-3 fill-current" /></Button>
  </div>;
}

function OpenUrl({ store, state, blocked }: SectionProps) {
  const [url, setUrl] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const suggestions = state.links.filter(link => !state.recentUrls.includes(link));
  const chip = "max-w-44 shrink-0 font-mono font-normal";
  return <div className="space-y-2">
    <form onSubmit={event => { event.preventDefault(); if (url.trim()) void store.openUrl(url); else input.current?.focus(); }}>
      <InputGroup>
        <InputGroupInput ref={input} aria-label="URL to open" className="font-mono text-xs" placeholder={state.links[0] ?? "myapp://checkout"} value={url} disabled={state.disabled} onChange={event => setUrl(event.target.value)} />
        <InputGroupAddon align="inline-end"><InputGroupButton type="submit" variant="default" disabled={blocked}>Open<ArrowRightIcon /></InputGroupButton></InputGroupAddon>
      </InputGroup>
    </form>
    {/* One fixed-height row, so switching apps never changes the popover height. */}
    <div className="flex h-6 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]" aria-label="URL suggestions">
      {state.recentUrls.map(recent => <Button key={recent} type="button" variant="secondary" size="xs" className={chip} title={`Open ${recent}`} disabled={blocked} onClick={() => { setUrl(recent); void store.openUrl(recent); }}><ClockIcon className="text-muted-foreground" /><span className="truncate">{recent}</span></Button>)}
      {/* Declared schemes are usually incomplete, so they start a URL instead of opening one. */}
      {suggestions.map(link => <Button key={link} type="button" variant="outline" size="xs" className={`${chip} border-dashed text-muted-foreground`} title={`Start a URL with ${link}`} disabled={state.disabled} onClick={() => {
        setUrl(link);
        requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(link.length, link.length); });
      }}><span className="truncate">{link}</span></Button>)}
      {suggestions.length === 0 && state.recentUrls.length === 0 && <span className="text-xs text-muted-foreground">This app declares no URL schemes.</span>}
    </div>
  </div>;
}

function permissionSummary(permissions: AppToolsState["permissions"]) {
  if (permissions === null) return "Loading…";
  if (permissions.length === 0) return "None requested";
  const allowed = permissions.filter(entry => entry.state === "allow").length;
  const denied = permissions.filter(entry => entry.state === "deny").length;
  if (!allowed && !denied) return `${permissions.length} available`;
  return <>
    {allowed > 0 && <span className="text-green-700 dark:text-green-400">{allowed} allowed</span>}
    {allowed > 0 && denied > 0 && " · "}
    {denied > 0 && <span className="text-destructive">{denied} denied</span>}
  </>;
}

function Permissions({ store, state, blocked }: SectionProps) {
  const id = useId();
  const permissions = state.permissions;
  return <Disclosure section="permissions" state={state} store={store} icon={ShieldIcon} title="Permissions" summary={permissionSummary(permissions)}>
    {permissions === null ? <p className="text-xs text-muted-foreground">Loading permissions…</p>
      : permissions.length === 0 ? <p className="text-xs text-muted-foreground">This app does not request supported runtime permissions.</p>
      : <div className="space-y-1">
        {permissions.map(entry => {
          const { label, icon: Icon } = permissionRows[entry.permission];
          return <div key={entry.permission} className="flex h-7 items-center gap-2">
            <Icon aria-hidden className="size-4 text-muted-foreground" />
            <span id={`${id}-${entry.permission}`} className="flex-1 truncate">{label}</span>
            <ToggleGroup type="single" variant="outline" size="sm" spacing={0} aria-labelledby={`${id}-${entry.permission}`} value={entry.state ?? ""} disabled={blocked}
              onValueChange={value => { const option = permissionOptions.find(candidate => candidate.value === value); if (option) void store.setPermission(entry.permission, option.value); }}>
              {permissionOptions.map(option => <ToggleGroupItem key={option.value} value={option.value} className={`h-6 min-w-0 px-2 text-xs font-normal text-muted-foreground data-[state=on]:font-medium ${option.on}`}>{option.label}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>;
        })}
        <Button variant="ghost" size="xs" className="-ml-2 mt-1 text-muted-foreground" disabled={blocked} onClick={() => void store.setPermission("all", "ask")}><RotateCcwIcon />Reset all</Button>
        {state.platform === "ios" && <p className="flex gap-1.5 text-xs text-muted-foreground"><InfoIcon aria-hidden className="mt-0.5 size-3 shrink-0" />The simulator doesn't report current choices. Highlights show what you set here.</p>}
      </div>}
  </Disclosure>;
}

function Language({ store, state, blocked }: SectionProps) {
  const current = state.language;
  const tags = current && !languageTags.some(tag => tag.toLowerCase() === current.toLowerCase()) ? [current, ...languageTags] : languageTags;
  const items = [{ value: deviceLanguage, label: "Device language" }, ...tags.map(tag => ({ value: tag, label: languageLabel(tag) }))];
  const selected = items.find(item => item.value.toLowerCase() === (current ?? deviceLanguage).toLowerCase())?.value ?? deviceLanguage;
  return <Disclosure section="language" state={state} store={store} icon={LanguagesIcon} title="Language" summary={current === undefined ? "Loading…" : current ? languageLabel(current) : "Device language"}>
    <Select items={items} value={selected} disabled={blocked || current === undefined} onValueChange={value => { if (value !== null && value !== selected) void store.setLanguage(value === deviceLanguage ? null : value); }}>
      <SelectTrigger aria-label="App language" className="w-full min-w-0"><SelectValue /></SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false} className="w-(--anchor-width)"><SelectGroup>
        {items.map(item => <SelectItem key={item.value} value={item.value}>
          <span className="flex-1 truncate">{item.label}</span>
          {item.value !== deviceLanguage && <span className="font-mono text-xs text-muted-foreground">{item.value}</span>}
        </SelectItem>)}
      </SelectGroup></SelectContent>
    </Select>
    <p className="mt-2 flex gap-1.5 text-xs text-muted-foreground"><InfoIcon aria-hidden className="mt-0.5 size-3 shrink-0" />Changing it relaunches the app. The device keeps its language.</p>
  </Disclosure>;
}

function PushNotification({ store, state, app, blocked }: SectionProps) {
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
  return <Disclosure section="push" state={state} store={store} icon={BellIcon} title="Test notification">
    <form className="space-y-2" onSubmit={event => { event.preventDefault(); send(); }}>
      {json === undefined ? <>
        <Input aria-label="Notification title" placeholder="Title" value={title} onChange={event => setTitle(event.target.value)} />
        <Textarea aria-label="Notification body" placeholder="Body" className="min-h-14 resize-none" value={body} onChange={event => setBody(event.target.value)} />
      </> : <Textarea aria-label="Push payload JSON" className="min-h-28 font-mono text-xs" value={json} aria-invalid={!!jsonError} onChange={event => setJson(event.target.value)} />}
      {jsonError && <p className="text-xs text-destructive" role="alert">{jsonError}</p>}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="xs" className="-ml-2 text-muted-foreground" onClick={() => { setJsonError(""); setJson(json === undefined ? JSON.stringify(formPayload(), null, 2) : undefined); }}>
          <BracesIcon />{json === undefined ? "Edit JSON" : "Use title and body"}
        </Button>
        <Button type="submit" size="sm" disabled={blocked}><SendIcon />Send</Button>
      </div>
    </form>
  </Disclosure>;
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
    <div>
      <Permissions {...props} />
      <Language {...props} />
      {state.platform === "ios" && <PushNotification {...props} />}
    </div>
    {error}
    {/* The controls show success themselves; announce it without shifting the layout. */}
    <p className="sr-only" role="status">{state.error ? "" : state.status}</p>
  </div>;
}
