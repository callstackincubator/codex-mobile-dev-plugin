import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { bundledE2eRoot, testingRuntimeDownload } from "./e2e-runtime.ts";
import { TESTING_DIRECTORY } from "./testing-projects.ts";
import type { BundledModelProvider } from "./testing-run.ts";

export type SetupProvider = BundledModelProvider | "none";
export type SetupTarget = { name: string; platform: "ios" | "android"; bundleId: string };
export type SetupOptions = {
  targets: SetupTarget[];
  provider: SetupProvider;
  model?: string;
  endpoint?: string;
  installDependencies: boolean;
  installSkill: boolean;
  registerMcp: boolean;
};

export const SETUP_PROVIDERS: readonly { id: SetupProvider; label: string; subscription?: "openai" | "github-copilot" | "opencode-console" | "spacexai"; defaultModel?: string }[] = [
  { id: "none", label: "None (deterministic tests)" },
  { id: "vercel", label: "Vercel AI Gateway", defaultModel: "openai/gpt-6-luna-fast" },
  { id: "openrouter", label: "OpenRouter", defaultModel: "openai/gpt-6-luna-fast" },
  { id: "openai-compatible", label: "OpenAI-compatible endpoint", defaultModel: "gpt-6-luna" },
  { id: "chatgpt", label: "ChatGPT Plus/Pro", subscription: "openai", defaultModel: "gpt-6-luna" },
  { id: "copilot", label: "GitHub Copilot", subscription: "github-copilot", defaultModel: "claude-sonnet-5" },
  { id: "opencode-console", label: "OpenCode Console", subscription: "opencode-console", defaultModel: "deepseek-v4.1-flash" },
  { id: "grok", label: "SuperGrok", subscription: "spacexai", defaultModel: "grok-4" },
] as const;

type PlannedWrite = { path: string; relativePath: string; content: string; existing: boolean; kind: "file" | "skill" };
export type SetupPlanAction = { action: "create" | "update" | "skip"; path: string; detail: string };
export type SetupPlan = {
  id: string;
  projectPath: string;
  options: SetupOptions;
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  installCommand: string;
  actions: SetupPlanAction[];
  createdAt: string;
};
type InternalPlan = SetupPlan & { writes: PlannedWrite[]; observed: Record<string, string>; skillLink?: { path: string; target: string } };

export type TestingModelPreference = { provider: BundledModelProvider; model: string; endpoint?: string };
export type TestingLoginStatus = Record<"openai" | "github-copilot" | "opencode-console" | "spacexai", boolean>;
export type TestingSetupInspection = {
  provider?: SetupProvider;
  model?: string;
  endpoint?: string;
  dependencies: { e2e?: string; mobile?: string };
  skillInstalled: boolean;
  mcpRegistrations: string[];
  loginStatus: TestingLoginStatus;
};
const PREFERENCE_FILE = join(TESTING_DIRECTORY, "model-preference.json");

function hash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
async function fileHash(path: string): Promise<string> {
  const info = await lstat(path).catch(() => undefined);
  if (!info) return "missing";
  if (!info.isFile()) return `blocked:${info.isSymbolicLink() ? "symlink" : "other"}`;
  return hash(await readFile(path));
}
function cleanText(value: string | undefined): string | undefined { const next = value?.trim(); return next ? next : undefined; }
function provider(id: SetupProvider) { return SETUP_PROVIDERS.find(entry => entry.id === id); }

const SUBSCRIPTION_IDS = ["openai", "github-copilot", "opencode-console", "spacexai"] as const;

/** Reads only provider ids from e2e's own credential store. Tokens and account data never leave it. */
export async function readTestingLoginStatus(): Promise<TestingLoginStatus> {
  const status = Object.fromEntries(SUBSCRIPTION_IDS.map(id => [id, false])) as TestingLoginStatus;
  try {
    // Reading login status is part of background project discovery.
    const root = testingRuntimeDownload ? join(testingRuntimeDownload.target, "e2e") : await bundledE2eRoot();
    const store = join(root, "node_modules/e2e/dist/oauth/store.js");
    const url = pathToFileURL(store);
    const module = await import(url.href) as {
      defaultCredentialStore(): { list(): Promise<string[]> };
    };
    const stored = new Set(await module.defaultCredentialStore().list());
    for (const id of SUBSCRIPTION_IDS) status[id] = stored.has(id);
  } catch { /* A missing or damaged store is safely reported as signed out. */ }
  return status;
}

function detectedModel(source: string): Pick<TestingSetupInspection, "provider" | "model" | "endpoint"> {
  const choices: { provider: SetupProvider; pattern: RegExp }[] = [
    { provider: "chatgpt", pattern: /\bchatgpt\s*\(\s*["'`]([^"'`]+)["'`]/ },
    { provider: "copilot", pattern: /\bcopilot\s*\(\s*["'`]([^"'`]+)["'`]/ },
    { provider: "opencode-console", pattern: /\bopencodeConsole\s*\(\s*["'`]([^"'`]+)["'`]/ },
    { provider: "grok", pattern: /\bgrok\s*\(\s*["'`]([^"'`]+)["'`]/ },
    { provider: "vercel", pattern: /\bgateway\s*\(\s*["'`]([^"'`]+)["'`]/ },
    { provider: "openrouter", pattern: /\bopenrouter\s*\(\s*["'`]([^"'`]+)["'`]/ },
  ];
  for (const choice of choices) {
    const match = source.match(choice.pattern);
    if (match) return { provider: choice.provider, model: match[1] };
  }
  const compatible = source.match(/createOpenAICompatible\s*\([\s\S]*?baseURL\s*:\s*["'`]([^"'`]+)["'`][\s\S]*?chatModel\s*\(\s*["'`]([^"'`]+)["'`]/);
  return compatible ? { provider: "openai-compatible", endpoint: compatible[1], model: compatible[2] } : {};
}

async function dependencyVersion(root: string, name: string, manifest: Record<string, unknown>): Promise<string | undefined> {
  const installed = await readFile(join(root, "node_modules", name, "package.json"), "utf8").then(value => JSON.parse(value).version as unknown, () => undefined).catch(() => undefined);
  if (typeof installed === "string") return installed;
  for (const field of ["dependencies", "devDependencies"] as const) {
    const entries = manifest[field];
    if (entries && typeof entries === "object" && typeof (entries as Record<string, unknown>)[name] === "string") return (entries as Record<string, string>)[name];
  }
}

function hasE2eRegistration(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const servers = (value as Record<string, unknown>).mcpServers;
  return Boolean(servers && typeof servers === "object" && (servers as Record<string, unknown>).e2e);
}

/** Read-only effective setup shown for an already configured project. */
export async function inspectTestingSetup(root: string, configPath?: string): Promise<TestingSetupInspection> {
  const manifest = await readFile(join(root, "package.json"), "utf8").then(value => JSON.parse(value) as Record<string, unknown>, () => ({})).catch(() => ({}));
  const source = configPath ? await readFile(configPath, "utf8").catch(() => "") : "";
  const [e2eVersion, mobileVersion] = await Promise.all([
    dependencyVersion(root, "e2e", manifest),
    dependencyVersion(root, "@e2e-dev/mobile", manifest),
  ]);
  const mcpRegistrations: string[] = [];
  for (const relativePath of [".mcp.json", ".cursor/mcp.json"]) {
    const registered = await readFile(join(root, relativePath), "utf8").then(value => hasE2eRegistration(JSON.parse(value)), () => false).catch(() => false);
    if (registered) mcpRegistrations.push(relativePath);
  }
  return {
    ...detectedModel(source),
    dependencies: {
      ...(e2eVersion ? { e2e: e2eVersion } : {}),
      ...(mobileVersion ? { mobile: mobileVersion } : {}),
    },
    skillInstalled: await lstat(join(root, ".agents/skills/e2e/SKILL.md")).then(value => value.isFile(), () => false),
    mcpRegistrations,
    loginStatus: await readTestingLoginStatus(),
  };
}

export async function readTestingModelPreference(): Promise<TestingModelPreference | undefined> {
  try {
    const parsed = JSON.parse(await readFile(PREFERENCE_FILE, "utf8")) as Partial<TestingModelPreference>;
    const providerId = parsed.provider as string | undefined;
    if (!provider(providerId as SetupProvider) || providerId === "none" || !cleanText(parsed.model)) return;
    return { provider: providerId as BundledModelProvider, model: parsed.model!.trim(), ...(cleanText(parsed.endpoint) ? { endpoint: parsed.endpoint!.trim() } : {}) };
  } catch { return; }
}

export async function saveTestingModelPreference(preference?: TestingModelPreference): Promise<void> {
  await mkdir(TESTING_DIRECTORY, { recursive: true, mode: 0o700 });
  if (!preference) { await unlink(PREFERENCE_FILE).catch(() => undefined); return; }
  if (!provider(preference.provider) || !cleanText(preference.model)) throw new ExpectedOperationError("invalid_input", "Choose a supported provider and model.");
  const temporary = `${PREFERENCE_FILE}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ provider: preference.provider, model: preference.model.trim(), ...(cleanText(preference.endpoint) ? { endpoint: preference.endpoint!.trim() } : {}) }, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, PREFERENCE_FILE);
  } finally { await unlink(temporary).catch(() => undefined); }
}

function modelSource(options: SetupOptions): { imports: string[]; field?: string; dependencies: Record<string, string> } {
  const id = JSON.stringify(cleanText(options.model) ?? provider(options.provider)?.defaultModel ?? "");
  switch (options.provider) {
    case "none": return { imports: [], dependencies: {} };
    case "vercel": return { imports: ["import { gateway } from 'ai';"], field: `gateway(${id})`, dependencies: {} };
    case "openrouter": return { imports: ["import { openrouter } from '@openrouter/ai-sdk-provider';"], field: `openrouter(${id})`, dependencies: { "@openrouter/ai-sdk-provider": "^3.0.0" } };
    case "openai-compatible": return { imports: ["import { createOpenAICompatible } from '@ai-sdk/openai-compatible';"], field: `createOpenAICompatible({ name: 'openai-compatible', baseURL: ${JSON.stringify(cleanText(options.endpoint) ?? "http://127.0.0.1:11434/v1")}, apiKey: process.env.LLM_API_KEY }).chatModel(${id})`, dependencies: { "@ai-sdk/openai-compatible": "^3.0.0" } };
    case "chatgpt": return { imports: ["import { chatgpt } from 'e2e/oauth/chatgpt';"], field: `chatgpt(${id})`, dependencies: { "@ai-sdk/openai": "^4.0.0" } };
    case "copilot": return { imports: ["import { copilot } from 'e2e/oauth/copilot';"], field: `copilot(${id})`, dependencies: { "@ai-sdk/openai-compatible": "^3.0.0", "@ai-sdk/openai": "^4.0.0" } };
    case "opencode-console": return { imports: ["import { opencodeConsole } from 'e2e/oauth/opencode-console';"], field: `opencodeConsole(${id})`, dependencies: { "@ai-sdk/openai-compatible": "^3.0.0", "@ai-sdk/openai": "^4.0.0", "@ai-sdk/anthropic": "^4.0.0", "@ai-sdk/google": "^4.0.0" } };
    case "grok": return { imports: ["import { grok } from 'e2e/oauth/grok';"], field: `grok(${id})`, dependencies: { "@ai-sdk/xai": "^5.0.0" } };
  }
}

export function setupConfigSource(options: SetupOptions): string {
  const model = modelSource(options);
  const targets = options.targets.map(target => `    { name: ${JSON.stringify(target.name)}, engine: mobile({ platform: ${JSON.stringify(target.platform)} }), app: { bundleId: ${JSON.stringify(target.bundleId)} } },`).join("\n");
  return [
    "import type { E2EConfig } from 'e2e';",
    "import { mobile } from '@e2e-dev/mobile';",
    ...model.imports,
    "", "export default {",
    ...(model.field ? ["  agents: { default: {", `    model: ${model.field},`, "    system: 'You are a thorough QA agent. Verify every outcome.',", "  } },"] : []),
    "  targets: [", targets, "  ],", "  workers: 1,", "} satisfies E2EConfig;", "",
  ].join("\n");
}

const EXAMPLE = `import { test } from 'e2e';\n\ntest('the app opens', async ({ app }) => {\n  await app.open();\n});\n`;
const IGNORE = ["node_modules/", ".e2e/artifacts/", ".e2e/cache/", ".e2e/sessions/", ".e2e/report.json", ".e2e/ai-trace.json", ".e2e/junit.xml", ".e2e/summary.md", ".e2e/failures/", ".e2e/logs/", ".e2e/videos/"];

function packageManager(root: string, manifest: Record<string, unknown>): SetupPlan["packageManager"] {
  const declared = typeof manifest.packageManager === "string" ? manifest.packageManager.split("@")[0] : "";
  if (declared === "pnpm" || declared === "yarn" || declared === "bun" || declared === "npm") return declared;
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun";
  return "npm";
}

async function skillFiles(): Promise<{ relative: string; content: string }[]> {
  const runtime = await bundledE2eRoot();
  const root = join(runtime, "node_modules/e2e/skills/e2e");
  const files: { relative: string; content: string }[] = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push({ relative: relative(root, child), content: await readFile(child, "utf8") });
    }
  };
  await walk(root);
  return files;
}

const plans = new Map<string, InternalPlan>();

function keepMapBounded<T>(map: Map<string, T>, maximum = 32): void {
  while (map.size >= maximum) {
    const oldest = map.keys().next().value as string | undefined;
    if (!oldest) break;
    map.delete(oldest);
  }
}

export async function planTestingSetup(projectPath: string, input: SetupOptions): Promise<SetupPlan> {
  const root = resolve(projectPath.trim());
  if (!isAbsolute(projectPath.trim()) || !(await lstat(root).then(value => value.isDirectory(), () => false))) throw new ExpectedOperationError("invalid_input", "Choose an existing project folder.");
  if (!provider(input.provider)) throw new ExpectedOperationError("invalid_input", "Choose a provider supported by the bundled e2e runtime.");
  const targets = input.targets.map(target => ({ ...target, name: target.name.trim(), bundleId: target.bundleId.trim() }));
  if (targets.length === 0) throw new ExpectedOperationError("invalid_input", "Add at least one iOS or Android target.");
  if (targets.some(target => !target.name)) throw new ExpectedOperationError("invalid_input", "Every target needs a name.");
  if (targets.some(target => !target.bundleId)) throw new ExpectedOperationError("invalid_input", "Every target needs an app identifier.");
  if (new Set(targets.map(target => target.name)).size !== targets.length) throw new ExpectedOperationError("invalid_input", "Target names must be unique.");
  if (input.provider === "openai-compatible") {
    const endpoint = new URL(cleanText(input.endpoint) ?? "http://127.0.0.1:11434/v1");
    if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname))) throw new ExpectedOperationError("invalid_input", "Use HTTPS unless the model endpoint is loopback.");
  }
  const options: SetupOptions = { ...input, targets, ...(cleanText(input.model) ? { model: input.model!.trim() } : {}), ...(cleanText(input.endpoint) ? { endpoint: input.endpoint!.trim() } : {}) };
  const packagePath = join(root, "package.json");
  const originalPackage = await readFile(packagePath, "utf8").catch(() => "{}\n");
  let manifest: Record<string, unknown>;
  try { manifest = JSON.parse(originalPackage); } catch { throw new ExpectedOperationError("invalid_input", "Fix package.json before applying e2e setup."); }
  const model = modelSource(options);
  const devDependencies = { ...((manifest.devDependencies && typeof manifest.devDependencies === "object") ? manifest.devDependencies as Record<string, string> : {}), e2e: "^0.23.1", "@e2e-dev/mobile": "^0.12.7", ...(options.provider === "none" ? {} : { ai: "^7.0.0", zod: "^4.1.8", ...model.dependencies }) };
  const scripts = { ...((manifest.scripts && typeof manifest.scripts === "object") ? manifest.scripts as Record<string, string> : {}) };
  if (scripts["test:e2e"] === undefined) scripts["test:e2e"] = "e2e run";
  const nextPackage = JSON.stringify({ ...manifest, scripts, devDependencies: Object.fromEntries(Object.entries(devDependencies).sort(([a], [b]) => a.localeCompare(b))) }, null, 2) + "\n";
  const writes: PlannedWrite[] = [];
  const actions: SetupPlanAction[] = [];
  const add = async (relativePath: string, content: string, kind: PlannedWrite["kind"] = "file", preserve = false) => {
    const path = join(root, relativePath);
    const existing = await fileHash(path);
    if (existing.startsWith("blocked:")) throw new ExpectedOperationError("invalid_input", `${relativePath} is not a regular file; setup will not replace it.`);
    if (preserve && existing !== "missing") { actions.push({ action: "skip", path: relativePath, detail: "Existing file is preserved." }); return; }
    if (existing === hash(content)) { actions.push({ action: "skip", path: relativePath, detail: "Already up to date." }); return; }
    writes.push({ path, relativePath, content, existing: existing !== "missing", kind });
    actions.push({ action: existing === "missing" ? "create" : "update", path: relativePath, detail: kind === "skill" ? "Install the e2e agent skill." : "Apply e2e setup." });
  };
  await add("package.json", nextPackage);
  await add("e2e.config.ts", setupConfigSource(options), "file", true);
  await add("tests/example.e2e.ts", EXAMPLE, "file", true);
  const ignorePath = join(root, ".gitignore");
  const ignore = await readFile(ignorePath, "utf8").catch(() => "");
  const missing = IGNORE.filter(entry => !ignore.split(/\r?\n/).includes(entry));
  if (missing.length) await add(".gitignore", `${ignore}${ignore && !ignore.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
  else actions.push({ action: "skip", path: ".gitignore", detail: "E2E outputs are already ignored." });
  if (options.installSkill) {
    const skillRoot = join(root, ".agents/skills/e2e");
    const existing = await lstat(skillRoot).catch(() => undefined);
    if (existing) actions.push({ action: "skip", path: ".agents/skills/e2e", detail: "Existing skill is preserved." });
    else for (const file of await skillFiles()) await add(join(".agents/skills/e2e", file.relative), file.content, "skill");
  }
  if (options.registerMcp) {
    for (const relativePath of [".mcp.json", ".cursor/mcp.json"]) {
      const source = await readFile(join(root, relativePath), "utf8").catch(() => "{}");
      let mcp: Record<string, unknown>;
      try { mcp = JSON.parse(source); } catch { throw new ExpectedOperationError("invalid_input", `Fix ${relativePath} before registering the e2e server.`); }
      const servers = mcp.mcpServers && typeof mcp.mcpServers === "object" ? mcp.mcpServers as Record<string, unknown> : {};
      if (servers.e2e) actions.push({ action: "skip", path: relativePath, detail: "Existing e2e MCP registration is preserved." });
      else await add(relativePath, JSON.stringify({ ...mcp, mcpServers: { ...servers, e2e: { command: "npx", args: ["e2e", "mcp"] } } }, null, 2) + "\n");
    }
  }
  const manager = packageManager(root, manifest);
  const installCommand = manager === "npm" ? "npm install" : `${manager} install`;
  if (options.installDependencies) actions.push({ action: "update", path: manager === "npm" ? "package-lock.json" : manager === "pnpm" ? "pnpm-lock.yaml" : manager === "yarn" ? "yarn.lock" : "bun.lock", detail: `Run ${installCommand}.` });
  const observed: Record<string, string> = {};
  for (const write of writes) observed[write.relativePath] = await fileHash(write.path);
  const id = hash(JSON.stringify({ root, options, observed, actions, manager, nonce: randomUUID() }));
  const plan: InternalPlan = { id, projectPath: root, options, packageManager: manager, installCommand, actions, createdAt: new Date().toISOString(), writes, observed };
  keepMapBounded(plans);
  plans.set(id, plan);
  return { id, projectPath: root, options, packageManager: manager, installCommand, actions, createdAt: plan.createdAt };
}

export type SetupOperation = {
  id: string;
  kind: "apply" | "login";
  status: "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  message: string;
  completed: number;
  total: number;
  applied: string[];
  auth?: { url: string; instructions: string; userCode?: string };
  prompt?: { message: string; placeholder?: string };
};
type InternalOperation = SetupOperation & { abort: AbortController; answer?: (value: string) => void };
const operations = new Map<string, InternalOperation>();

function publicOperation(operation: InternalOperation): SetupOperation {
  const { abort: _abort, answer: _answer, ...result } = operation;
  return result;
}
export function testingSetupProgress(id: string): SetupOperation | undefined { const operation = operations.get(id); return operation ? publicOperation(operation) : undefined; }
export function cancelTestingSetup(id: string): boolean {
  const operation = operations.get(id);
  if (!operation || !["running", "waiting"].includes(operation.status)) return false;
  const answer = operation.answer;
  operation.abort.abort(); operation.status = "cancelled"; operation.message = "Cancelled.";
  operation.auth = undefined; operation.prompt = undefined; operation.answer = undefined;
  answer?.("");
  return true;
}
export function answerTestingSetup(id: string, value: string): boolean { const operation = operations.get(id); if (!operation?.answer) return false; const answer = operation.answer; operation.answer = undefined; operation.prompt = undefined; operation.status = "running"; answer(value); return true; }

async function atomicWrite(write: PlannedWrite): Promise<void> {
  await mkdir(dirname(write.path), { recursive: true, mode: write.kind === "skill" ? 0o755 : undefined });
  const temporary = `${write.path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, write.content, "utf8"); await rename(temporary, write.path); }
  finally { await unlink(temporary).catch(() => undefined); }
}

export function applyTestingSetup(planId: string): SetupOperation {
  const plan = plans.get(planId);
  if (!plan) throw new ExpectedOperationError("invalid_input", "Preview setup again; that plan is no longer available.");
  const operation: InternalOperation = { id: randomUUID(), kind: "apply", status: "running", message: "Validating setup plan…", completed: 0, total: plan.writes.length + (plan.options.installDependencies ? 1 : 0), applied: [], abort: new AbortController() };
  keepMapBounded(operations);
  operations.set(operation.id, operation);
  void (async () => {
    try {
      for (const write of plan.writes) {
        if (operation.abort.signal.aborted) throw operation.abort.signal.reason ?? new Error("Cancelled");
        if (await fileHash(write.path) !== plan.observed[write.relativePath]) throw new ExpectedOperationError("invalid_input", `${write.relativePath} changed after the preview. Preview setup again.`);
      }
      for (const write of plan.writes) {
        operation.message = `${write.existing ? "Updating" : "Creating"} ${write.relativePath}…`;
        await atomicWrite(write);
        operation.applied.push(write.relativePath); operation.completed += 1;
      }
      if (plan.options.installDependencies) {
        operation.message = `Running ${plan.installCommand}…`;
        await new Promise<void>((resolvePromise, rejectPromise) => {
          const child = spawn(plan.packageManager, ["install"], { cwd: plan.projectPath, stdio: ["ignore", "ignore", "pipe"], shell: process.platform === "win32" });
          let error = "";
          child.stderr?.setEncoding("utf8"); child.stderr?.on("data", chunk => { error = `${error}${chunk}`.slice(-4000); });
          const abort = () => child.kill("SIGTERM"); operation.abort.signal.addEventListener("abort", abort, { once: true });
          child.on("error", rejectPromise); child.on("close", code => { operation.abort.signal.removeEventListener("abort", abort); code === 0 ? resolvePromise() : rejectPromise(new Error(error.trim() || `${plan.installCommand} exited ${code ?? 1}`)); });
        });
        operation.completed += 1;
      }
      operation.status = "succeeded"; operation.message = "E2E setup is ready.";
      if (plan.options.provider !== "none") await saveTestingModelPreference({ provider: plan.options.provider, model: cleanText(plan.options.model) ?? provider(plan.options.provider)!.defaultModel!, ...(cleanText(plan.options.endpoint) ? { endpoint: plan.options.endpoint!.trim() } : {}) });
    } catch (error) {
      if (operation.abort.signal.aborted) { operation.status = "cancelled"; operation.message = `Cancelled after ${operation.applied.length} change${operation.applied.length === 1 ? "" : "s"}.`; }
      else { operation.status = "failed"; operation.message = `${error instanceof Error ? error.message : String(error)}${operation.applied.length ? ` ${operation.applied.length} change${operation.applied.length === 1 ? " was" : "s were"} already applied; they were not rolled back.` : ""}`; }
    }
  })();
  return publicOperation(operation);
}

type OAuthProvider = "openai" | "github-copilot" | "opencode-console" | "spacexai";
type LoginCallbacks = { signal: AbortSignal; onAuth(auth: { url: string; instructions: string; userCode?: string }): void; onProgress(message: string): void; onPrompt(prompt: { message: string; placeholder?: string }): Promise<string> };
type LoginRunner = (provider: OAuthProvider, callbacks: LoginCallbacks) => Promise<unknown>;
async function e2eLogin(providerId: OAuthProvider, callbacks: LoginCallbacks) {
  const root = await bundledE2eRoot();
  const login = join(root, "node_modules/e2e/dist/oauth/login.js");
  const url = pathToFileURL(login);
  const module = await import(url.href) as { login(provider: string, input: Record<string, unknown>): Promise<unknown> };
  return module.login(providerId, { callbacks });
}
export function startTestingLogin(id: OAuthProvider, runLogin: LoginRunner = e2eLogin): SetupOperation {
  const operation: InternalOperation = { id: randomUUID(), kind: "login", status: "running", message: "Starting sign-in…", completed: 0, total: 1, applied: [], abort: new AbortController() };
  keepMapBounded(operations);
  operations.set(operation.id, operation);
  void (async () => {
    try {
      await runLogin(id, {
        signal: operation.abort.signal,
        onAuth: (auth: { url: string; instructions: string; userCode?: string }) => { operation.auth = auth; operation.status = "waiting"; operation.message = auth.instructions; },
        onProgress: (message: string) => { operation.message = message; },
        onPrompt: (prompt: { message: string; placeholder?: string }) => new Promise<string>(resolvePrompt => { operation.prompt = prompt; operation.answer = resolvePrompt; operation.status = "waiting"; operation.message = prompt.message; }),
      });
      operation.status = "succeeded"; operation.completed = 1; operation.prompt = undefined; operation.auth = undefined; operation.message = "Signed in.";
    } catch (error) {
      operation.status = operation.abort.signal.aborted ? "cancelled" : "failed";
      operation.prompt = undefined; operation.auth = undefined;
      operation.message = operation.abort.signal.aborted ? "Sign-in cancelled." : error instanceof Error ? error.message : String(error);
    }
  })();
  return publicOperation(operation);
}
