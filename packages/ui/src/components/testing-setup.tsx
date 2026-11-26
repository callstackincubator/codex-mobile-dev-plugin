import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { BotIcon, CheckCircle2Icon, CheckIcon, ChevronRightIcon, CircleDashedIcon, ExternalLinkIcon, FilePlus2Icon, FileCode2Icon, LoaderCircleIcon, MinusIcon, PencilIcon, PlusIcon, Settings2Icon, WandSparklesIcon, XIcon } from "lucide-react";
import type { TestingPanel, TestingSetupOperation, TestingSetupOptions } from "../testing-panel.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/base-select.tsx";
import { Switch } from "./ui/switch.tsx";
import { MatrixDevices } from "./testing-matrix.tsx";

type SetupPlanView = { id: string; actions: { action: string; path: string; detail: string }[]; installCommand: string };
type SetupTarget = { name: string; platform: "ios" | "android"; bundleId: string };

const RUNTIME_HELP = {
  bundled: "Bundled runtime: Testing Studio runs tests with the e2e runtime provided by Mobile Dev. Nothing is written to your project; tests and config stay in Mobile Dev's private state.",
  project: "Project runtime: Testing Studio runs tests with the e2e packages installed in your project, using its own e2e config file.",
} as const;

function useOperation(panel: TestingPanel, initial: TestingSetupOperation | null, onDone?: (operation: TestingSetupOperation) => void) {
  const [operation, setOperation] = useState<TestingSetupOperation | null>(initial);
  useEffect(() => {
    if (!operation || (operation.status !== "running" && operation.status !== "waiting")) return;
    const timer = setInterval(() => { void panel.setupProgress(operation.id).then(next => {
      if (!next) return;
      setOperation(next);
      if (["succeeded", "failed", "cancelled"].includes(next.status)) onDone?.(next);
    }).catch(() => undefined); }, 500);
    return () => clearInterval(timer);
  }, [panel, operation?.id, operation?.status, onDone]);
  return [operation, setOperation] as const;
}

/** A collapsible, titled group inside the setup popover; every section shares this rhythm. */
function Section({ title, hint, action, defaultOpen = false, forceOpen = false, children }: { title: string; hint?: string; action?: ReactNode; defaultOpen?: boolean; forceOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen || forceOpen);
  // A request from outside (a run that needs this section) opens it; the user can still collapse it.
  useEffect(() => { if (forceOpen) setOpen(true); }, [forceOpen]);
  return <Collapsible open={open} onOpenChange={setOpen} className="group/section flex flex-col gap-2.5">
    <div className="flex items-center justify-between gap-2">
      <CollapsibleTrigger title={hint} className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground">
        <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]/section:rotate-90" />{title}
      </CollapsibleTrigger>
      {action && <span className="hidden group-data-[state=open]/section:inline-flex">{action}</span>}
    </div>
    <CollapsibleContent className="flex flex-col gap-2.5">{children}</CollapsibleContent>
  </Collapsible>;
}

function FieldRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1.5"><Label htmlFor={htmlFor} className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}

function ToggleRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between gap-3" title={hint}>
    <Label htmlFor={id} className="text-sm font-normal">{label}</Label>
    <Switch id={id} aria-label={label} checked={checked} onCheckedChange={onChange} />
  </div>;
}

/** One check in the summary: a state icon, what it is, and its current value. */
function StatusItem({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return <li className="flex items-start gap-2 rounded-lg border bg-muted/20 px-2.5 py-2">
    {ok ? <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-label="Ready" /> : <CircleDashedIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Missing" />}
    <div className="min-w-0"><p className="text-xs font-medium">{label}</p><p className="break-words text-xs text-muted-foreground">{value}</p></div>
  </li>;
}

const ACTION_STYLE: Record<string, { label: string; icon: ReactNode; className: string }> = {
  create: { label: "Create", icon: <FilePlus2Icon />, className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  update: { label: "Update", icon: <PencilIcon />, className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  skip: { label: "Unchanged", icon: <MinusIcon />, className: "bg-muted text-muted-foreground" },
};

/** Paths in a plan are shown relative to the project so they stay short and comparable. */
export function relativeToProject(path: string, projectPath: string) {
  const root = projectPath.replace(/\/+$/, "");
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function PlanRow({ action, path, detail }: { action: string; path: string; detail: string }) {
  const style = ACTION_STYLE[action] ?? ACTION_STYLE.skip!;
  return <li className="flex items-start gap-2 py-1.5">
    <Badge variant="ghost" className={`mt-0.5 w-[4.75rem] justify-start ${style.className}`}>{style.icon}{style.label}</Badge>
    <div className="min-w-0"><p className="break-all font-mono text-xs">{path}</p><p className="text-xs text-muted-foreground">{detail}</p></div>
  </li>;
}

function PlanPreview({ plan, projectPath, busy, onEdit, onApply }: { plan: SetupPlanView; projectPath: string; busy: boolean; onEdit: () => void; onApply: () => void }) {
  const rows = plan.actions.map(action => ({ ...action, path: relativeToProject(action.path, projectPath) }));
  const changes = rows.filter(row => row.action !== "skip");
  const unchanged = rows.filter(row => row.action === "skip");
  return <section className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3" aria-label="Confirmed plan preview">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-medium">Review changes</h3>
      <span className="text-xs text-muted-foreground">{changes.length} {changes.length === 1 ? "change" : "changes"} · {unchanged.length} unchanged</span>
    </div>
    {changes.length > 0 ? <ul className="flex flex-col divide-y">{changes.map((row, index) => <PlanRow key={`${row.path}-${index}`} {...row} />)}</ul>
      : <p className="text-xs text-muted-foreground">Everything is already set up. Nothing will change.</p>}
    {unchanged.length > 0 && <Collapsible className="group/skipped">
      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronRightIcon className="size-3 transition-transform group-data-[state=open]/skipped:rotate-90" />{unchanged.length} unchanged</CollapsibleTrigger>
      <CollapsibleContent><ul className="flex flex-col divide-y opacity-70">{unchanged.map((row, index) => <PlanRow key={`${row.path}-${index}`} {...row} />)}</ul></CollapsibleContent>
    </Collapsible>}
    <p className="text-xs text-muted-foreground">The plan is immutable and will be rejected if an affected file changes.</p>
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="ghost" onClick={onEdit}>Edit options</Button>
      <Button size="sm" disabled={busy} onClick={onApply}>Confirm and apply</Button>
    </div>
  </section>;
}

/**
 * The single entry for everything e2e: which runtime Testing Studio uses, the agent-step model, the mobile
 * targets, and the optional write of a project-local setup (the GUI equivalent of e2e init).
 * Both runtimes open on a compact summary; the editable setup form only opens on request.
 */
export function TestingSetup({ panel }: { panel: TestingPanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const providers = state.providers ?? [];
  const toTargets = (): SetupTarget[] => state.targets.filter(target => target.bundleId && (target.platform === "ios" || target.platform === "android")).map(target => ({ name: target.name, platform: target.platform as "ios" | "android", bundleId: target.bundleId! }));
  const bundled = state.runtimeMode === "bundled";
  const open = state.setupOpen || state.modelPickerOpen;
  const [view, setView] = useState<"summary" | "setup">("summary");
  const [targets, setTargets] = useState<SetupTarget[]>(toTargets);
  const [provider, setProvider] = useState<TestingSetupOptions["provider"]>(state.modelPreference?.provider ?? "none");
  const providerInfo = providers.find(entry => entry.id === provider);
  const [model, setModel] = useState(state.modelPreference?.model ?? "");
  const [endpoint, setEndpoint] = useState(state.modelPreference?.endpoint ?? "");
  const [installDependencies, setInstallDependencies] = useState(true);
  const [installSkill, setInstallSkill] = useState(true);
  const [registerMcp, setRegisterMcp] = useState(true);
  const [plan, setPlan] = useState<SetupPlanView | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [operation, setOperation] = useOperation(panel, null, next => { if (next.status === "succeeded") void panel.selectProject(state.projectPath); });
  const [login, setLogin] = useOperation(panel, null);
  const [answer, setAnswer] = useState("");
  const openedAuth = useRef("");
  const targetKey = state.targets.map(target => `${target.name}\0${target.platform ?? ""}\0${target.bundleId ?? ""}`).join("\x01");
  useEffect(() => {
    if (!open) { setView("summary"); setSaved(false); return; }
    setTargets(toTargets());
    setProvider(state.modelPreference?.provider ?? "none"); setModel(state.modelPreference?.model ?? ""); setEndpoint(state.modelPreference?.endpoint ?? "");
  }, [open, targetKey, state.modelPreference?.provider, state.modelPreference?.model, state.modelPreference?.endpoint]);
  useEffect(() => {
    const url = login?.auth?.url;
    if (!url || openedAuth.current === url) return;
    openedAuth.current = url;
    void panel.openLoginUrl(url).catch(() => undefined);
  }, [panel, login?.auth?.url]);
  const dirty = () => { setPlan(null); setError(""); setSaved(false); };
  const preview = async () => {
    setBusy(true); setError("");
    try {
      const next = await panel.planSetup({ targets, provider, ...(model.trim() ? { model: model.trim() } : {}), ...(endpoint.trim() ? { endpoint: endpoint.trim() } : {}), installDependencies, installSkill, registerMcp });
      setPlan(next as SetupPlanView | null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const apply = async () => { if (!plan) return; setBusy(true); try { setOperation(await panel.applySetup(plan.id)); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  /** Saves the provider/model that agent steps use in bundled runs (it also resumes a run that was waiting for one). */
  const saveModel = async () => {
    if (provider === "none" || !model.trim()) return;
    setSaving(true); setError("");
    try {
      await panel.saveModelPreference({ provider, model: model.trim(), ...(endpoint.trim() ? { endpoint: endpoint.trim() } : {}) } as Parameters<TestingPanel["saveModelPreference"]>[0]);
      setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const startLogin = async () => {
    if (!providerInfo?.subscription) return;
    openedAuth.current = "";
    setLogin(await panel.startLogin(providerInfo.subscription));
  };
  const signedIn = Boolean(providerInfo?.subscription && (login?.status === "succeeded" || state.setupDetails?.loginStatus[providerInfo.subscription]));
  const loginActive = login?.status === "running" || login?.status === "waiting";
  const targetsValid = targets.length > 0 && targets.every(target => target.name.trim() && target.bundleId.trim()) && new Set(targets.map(target => target.name.trim())).size === targets.length;
  const details = state.setupDetails;
  const mode = bundled ? "bundled" : "project";
  const field = "h-8 text-xs";
  const savedModel = state.modelPreference;
  const modelUnchanged = Boolean(savedModel && savedModel.provider === provider && savedModel.model === model.trim() && (savedModel.endpoint ?? "") === endpoint.trim());

  const modelFields = <>
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
      <FieldRow label="Provider">
        <Select items={providers.map(entry => ({ value: entry.id, label: entry.label }))} value={provider} onValueChange={value => { if (!value) return; setProvider(value as TestingSetupOptions["provider"]); setModel(providers.find(entry => entry.id === value)?.defaultModel ?? ""); setLogin(null); dirty(); }}>
          <SelectTrigger size="sm" className="w-full" aria-label="Model provider"><SelectValue>{providerInfo?.label ?? provider}</SelectValue></SelectTrigger>
          <SelectContent>{providers.map(entry => <SelectItem key={entry.id} value={entry.id}>{entry.label}</SelectItem>)}</SelectContent>
        </Select>
      </FieldRow>
      {provider !== "none" && <FieldRow label="Model ID" htmlFor="testing-setup-model"><Input id="testing-setup-model" aria-label="Model ID" className={field} value={model} onChange={event => { setModel(event.target.value); dirty(); }} /></FieldRow>}
    </div>
    {provider === "openai-compatible" && <FieldRow label="Base URL" htmlFor="testing-setup-endpoint"><Input id="testing-setup-endpoint" className={field} value={endpoint} placeholder="http://127.0.0.1:11434/v1" onChange={event => { setEndpoint(event.target.value); dirty(); }} /></FieldRow>}
    {providerInfo?.subscription && <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-2.5">
      <div className="flex items-center justify-between gap-2">
        {signedIn ? <p role="status" className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2Icon className="size-3.5" />Signed in</p> : <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CircleDashedIcon className="size-3.5" />Not signed in</p>}
        <Button type="button" size="xs" variant={signedIn ? "ghost" : "outline"} disabled={loginActive} onClick={() => void startLogin()}><ExternalLinkIcon />Sign in with {providerInfo.label}</Button>
      </div>
      {login && login.status !== "succeeded" && <p role="status" className="break-words text-xs text-muted-foreground">{login.message}</p>}
      {login?.auth && loginActive && <a className="text-xs text-primary underline" href={login.auth.url} target="_blank" rel="noreferrer">Open sign-in page{login.auth.userCode ? ` · code ${login.auth.userCode}` : ""}</a>}
      {login?.prompt && <div className="flex gap-2"><Input className={`${field} flex-1`} value={answer} onChange={event => setAnswer(event.target.value)} placeholder={login.prompt.placeholder ?? "Authorization code"} /><Button size="sm" onClick={() => { void panel.answerLogin(login.id, answer); setAnswer(""); }}>Continue</Button></div>}
      {loginActive && <Button size="xs" variant="ghost" className="self-start" onClick={() => void panel.cancelSetup(login.id)}>Cancel sign-in</Button>}
    </div>}
  </>;
  const needsModel = state.modelPickerOpen && !state.modelPreference;
  const modelHint = "Deterministic steps never use a model. Only the provider, model and endpoint are saved, never credentials or prompts.";

  return <Popover open={open} onOpenChange={next => { if (next) panel.openSetup(); else { panel.closeSetup(); panel.closeModelPicker(); } }}>
    <PopoverTrigger asChild>
      <Button type="button" size="sm" variant="outline" data-testing-setup data-testing-runtime-mode={mode} title={RUNTIME_HELP[mode]} className="gap-1.5">
        <span aria-hidden className={`size-1.5 rounded-full ${bundled ? "bg-amber-500" : "bg-emerald-500"}`} />
        E2E setup
        <span className="text-xs font-normal text-muted-foreground">{bundled ? "Bundled" : "Project"}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="flex max-h-[min(44rem,var(--radix-popover-content-available-height))] w-[min(34rem,var(--radix-popover-content-available-width))] flex-col gap-5 overflow-y-auto p-4" aria-label="E2E setup">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">E2E setup</h2>
        <Badge variant="outline" title={RUNTIME_HELP[mode]} className="gap-1.5"><span aria-hidden className={`size-1.5 rounded-full ${bundled ? "bg-amber-500" : "bg-emerald-500"}`} />{bundled ? "Bundled runtime" : "Project runtime"}</Badge>
      </header>
      {needsModel && <p role="status" className="rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs">An agent step needs a model. Choose one to continue.</p>}

      {view === "summary" ? (bundled ? <>
        <Section title="Agent model" hint={modelHint} forceOpen={needsModel}>
          {modelFields}
          <div className="flex items-center justify-end gap-2">
            {saved && <span role="status" className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckIcon className="size-3.5" />Saved</span>}
            <Button size="sm" variant="outline" disabled={saving || provider === "none" || !model.trim() || (modelUnchanged && !saved)} onClick={() => void saveModel()} title="Use this model for agent steps in Testing Studio runs. Nothing is written to the project.">{saving ? <LoaderCircleIcon className="animate-spin" /> : <BotIcon />}Use model</Button>
          </div>
        </Section>
        <Section key="devices" title="Devices" hint="Run the open test on several devices at once."><MatrixDevices panel={panel} /></Section>
        <Section title="Project">
          <ul className="grid grid-cols-1 gap-2"><StatusItem ok={false} label={panel.noProject ? "No project open" : "Project setup"} value={panel.noProject ? "Recording against the app in the mirror. Tests stay in Mobile Dev." : "None. Tests stay in Mobile Dev."} /></ul>
          {!panel.noProject && <div className="flex justify-end"><Button size="sm" onClick={() => setView("setup")}><WandSparklesIcon />Set up project</Button></div>}
        </Section>
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      </> : <>
        <Section title="Project">
          <ul className="grid grid-cols-2 gap-2">
            <StatusItem ok={Boolean(state.configPath)} label="Config" value={state.configPath ? relativeToProject(state.configPath, state.projectPath) : "Not detected"} />
            <StatusItem ok={Boolean(details?.provider)} label="Model" value={details?.provider ? `${details.provider}${details.model ? ` · ${details.model}` : ""}` : "Not statically discoverable"} />
            <StatusItem ok={Boolean(details?.dependencies.e2e && details.dependencies.mobile)} label="Dependencies" value={`e2e ${details?.dependencies.e2e ?? "not detected"}; mobile ${details?.dependencies.mobile ?? "not detected"}`} />
            <StatusItem ok={Boolean(details?.skillInstalled)} label="Agent skill" value={details?.skillInstalled ? "Installed" : "Not installed"} />
            <StatusItem ok={Boolean(details?.mcpRegistrations.length)} label="MCP server" value={details?.mcpRegistrations.length ? details.mcpRegistrations.join(", ") : "Not registered"} />
          </ul>
        </Section>
        <Section title="Mobile apps">
          {state.targets.length > 0 ? <ul className="flex flex-wrap gap-1.5">{state.targets.map(target => <li key={target.name}><Badge variant="outline" className="h-auto gap-1.5 py-1 font-normal"><span className="font-medium">{target.name}</span><span className="text-muted-foreground">{target.platform ?? "unknown"} · {target.bundleId ?? "no identifier"}</span></Badge></li>)}</ul>
            : <p className="text-xs text-muted-foreground">No targets configured.</p>}
        </Section>
        <Section key="devices" title="Devices"><MatrixDevices panel={panel} /></Section>
        <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setView("setup")}><WandSparklesIcon />Update setup</Button></div>
      </>) : <>
        <Section title="Agent model" hint={modelHint} forceOpen={needsModel}>{modelFields}</Section>

        <Section title="Mobile apps" action={<Button size="xs" variant="ghost" onClick={() => { const platform = targets.some(target => target.platform === "ios") ? "android" : "ios"; setTargets(items => [...items, { name: platform, platform, bundleId: "" }]); dirty(); }}><PlusIcon />Add target</Button>}>
          <div className="flex flex-col gap-2">{targets.map((target, index) => <div key={`${target.platform}-${index}`} className="grid grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,2fr)_auto] items-center gap-2">
            <Input value={target.name} aria-label={`Target ${index + 1} name`} className={field} placeholder="name" onChange={event => { const value = event.target.value; setTargets(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, name: value } : item)); dirty(); }} />
            <Select items={[{ value: "ios", label: "iOS" }, { value: "android", label: "Android" }]} value={target.platform} onValueChange={value => { if (!value) return; setTargets(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, platform: value as "ios" | "android" } : item)); dirty(); }}>
              <SelectTrigger size="sm" className="w-full" aria-label={`Target ${index + 1} platform`}><SelectValue>{target.platform === "ios" ? "iOS" : "Android"}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="ios">iOS</SelectItem><SelectItem value="android">Android</SelectItem></SelectContent>
            </Select>
            <Input value={target.bundleId} aria-label={`${target.platform} app identifier`} className={field} placeholder="com.example.app" onChange={event => { const value = event.target.value; setTargets(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, bundleId: value } : item)); dirty(); }} />
            <Button size="icon-sm" variant="ghost" aria-label={`Remove ${target.platform} target`} onClick={() => { setTargets(items => items.filter((_, itemIndex) => itemIndex !== index)); dirty(); }}><XIcon /></Button>
          </div>)}</div>
        </Section>

        <Section title="Project files" hint="Writes a project-local setup equivalent to e2e init. You review every change first.">
          <div className="flex flex-col gap-3">
            <ToggleRow id="testing-setup-deps" label="Install dependencies" hint="Uses the detected package manager." checked={installDependencies} onChange={value => { setInstallDependencies(value); dirty(); }} />
            <ToggleRow id="testing-setup-skill" label="Install agent skill" hint="Only when it is absent." checked={installSkill} onChange={value => { setInstallSkill(value); dirty(); }} />
            <ToggleRow id="testing-setup-mcp" label="Register MCP server" hint="Only when it is absent." checked={registerMcp} onChange={value => { setRegisterMcp(value); dirty(); }} />
          </div>
        </Section>

        {!plan && !operation && <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setView("summary")}>Back</Button>
          <Button size="sm" disabled={busy || !targetsValid} onClick={() => void preview()}>{busy ? <LoaderCircleIcon className="animate-spin" /> : <Settings2Icon />}Preview setup</Button>
        </div>}
        {plan && !operation && <PlanPreview plan={plan} projectPath={state.projectPath} busy={busy} onEdit={() => setPlan(null)} onApply={() => void apply()} />}
        {operation && <section className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3 text-xs">
          <p role="status" className="flex items-center gap-1.5">{(operation.status === "running" || operation.status === "waiting") && <LoaderCircleIcon className="size-3.5 animate-spin" />}{operation.message}</p>
          <progress className="h-1.5 w-full" value={operation.completed} max={Math.max(1, operation.total)} />
          {operation.applied.length > 0 && <p className="flex items-start gap-1.5 text-muted-foreground"><FileCode2Icon className="mt-0.5 size-3.5 shrink-0" />{operation.applied.map(path => relativeToProject(path, state.projectPath)).join(", ")}</p>}
          <div className="flex justify-end gap-2">
            {(operation.status === "running" || operation.status === "waiting") && <Button size="sm" variant="ghost" onClick={() => void panel.cancelSetup(operation.id)}>Cancel</Button>}
            {operation.status === "succeeded" && <Button size="sm" onClick={() => panel.closeSetup()}>Done</Button>}
          </div>
        </section>}
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      </>}
    </PopoverContent>
  </Popover>;
}
