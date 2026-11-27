import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { ExpectedOperationError } from "@mobile-dev/shared/error-reporting.ts";
import { APP_FLOW_DIRECTORY } from "./app-flow-host.ts";
import { TESTING_DIRECTORY } from "./testing-projects.ts";

/**
 * Code signing for the XCTest runner agent-device builds for a physical iPhone.
 *
 * agent-device signs the runner with Automatic signing and only the team it is told about, so
 * without `AGENT_DEVICE_IOS_TEAM_ID` `xcodebuild build-for-testing` fails on hardware. The team is
 * resolved in this order, first hit wins:
 *
 * 1. `MOBILE_DEV_IOS_TEAM_ID`, Mobile Dev's own setting, then an already-set `AGENT_DEVICE_IOS_TEAM_ID`.
 * 2. The team the user chose in Testing Studio's E2E setup (saved next to the model preference).
 * 3. The project's `DEVELOPMENT_TEAM` build setting, when every target agrees.
 * 4. The one team behind the Apple Development identities in the keychain.
 *
 * More than one candidate is never guessed between: the user names the team.
 */

const execute = promisify(execFile);

export type SigningCommand = (file: string, args: string[]) => Promise<string>;
const defaultCommand: SigningCommand = async (file, args) => (await execute(file, args, { encoding: "utf8", timeout: 15_000, maxBuffer: 4 * 1024 * 1024 })).stdout;

const TEAM_ID = /^[A-Z0-9]{10}$/;

export const SIGNING_SETUP_HINT = "Choose your signing team in E2E setup → Devices (or set MOBILE_DEV_IOS_TEAM_ID to your 10-character Apple Developer Team ID; find it in Xcode → Settings → Accounts), then try again.";

/** Where the user's chosen team is saved: beside the Testing Studio model preference. */
const SIGNING_TEAM_FILE = join(TESTING_DIRECTORY, "ios-signing-team.json");

export type SigningTeamSource = "env" | "user" | "project" | "keychain";
export type SigningTeam = { id: string; name?: string };

/** The team the user chose in the panel, if any and still well-formed. */
export async function readSavedIosTeam(file: string = SIGNING_TEAM_FILE): Promise<string | undefined> {
  try {
    const team = String((JSON.parse(await readFile(file, "utf8")) as { teamId?: unknown }).teamId ?? "").trim().toUpperCase();
    return TEAM_ID.test(team) ? team : undefined;
  } catch { return undefined; }
}

/** Saves the user's team, or clears the choice when `teamId` is undefined. */
export async function saveIosTeam(teamId: string | undefined, file: string = SIGNING_TEAM_FILE): Promise<void> {
  if (!teamId) { await unlink(file).catch(() => undefined); return; }
  const team = teamId.trim().toUpperCase();
  if (!TEAM_ID.test(team)) throw new ExpectedOperationError("invalid_input", "A signing team is 10 letters or digits.");
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ teamId: team }, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => undefined); }
}

/** The explicit team: Mobile Dev's setting first, then agent-device's own variable. */
export const TEAM_ENV_VARS = ["MOBILE_DEV_IOS_TEAM_ID", "AGENT_DEVICE_IOS_TEAM_ID"] as const;
export type TeamEnvVar = (typeof TEAM_ENV_VARS)[number];

/** The explicit team and the variable that named it. */
export function configuredTeam(env: NodeJS.ProcessEnv = process.env): { teamId: string; envVar: TeamEnvVar } | undefined {
  for (const envVar of TEAM_ENV_VARS) {
    const team = env[envVar]?.trim().toUpperCase();
    if (team && TEAM_ID.test(team)) return { teamId: team, envVar };
  }
  return undefined;
}

export function configuredTeamId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return configuredTeam(env)?.teamId;
}

/** Every distinct `DEVELOPMENT_TEAM = XXXXXXXXXX;` in a project file. */
export function developmentTeams(pbxproj: string): string[] {
  const teams = new Set<string>();
  for (const match of pbxproj.matchAll(/DEVELOPMENT_TEAM\s*=\s*"?([A-Z0-9]{10})"?\s*;/g)) teams.add(match[1]!);
  return [...teams];
}

/** The team the project at `projectPath` is signed with, when `ios/*.xcodeproj` names exactly one. */
async function projectTeam(projectPath: string): Promise<string | undefined> {
  const teams = new Set<string>();
  for (const directory of [projectPath, join(projectPath, "ios")]) {
    const entries = await readdir(directory).catch(() => [] as string[]);
    for (const entry of entries.filter(name => name.endsWith(".xcodeproj"))) {
      const text = await readFile(join(directory, entry, "project.pbxproj"), "utf8").catch(() => "");
      for (const team of developmentTeams(text)) teams.add(team);
    }
  }
  return teams.size === 1 ? [...teams][0] : undefined;
}

/** The common names of `Apple Development` identities in `security find-identity -v -p codesigning` output. */
export function developmentIdentities(output: string): string[] {
  const names = new Set<string>();
  for (const match of output.matchAll(/^\s*\d+\)\s+[0-9A-F]{40}\s+"((?:Apple Development|iPhone Developer):[^"]+)"/gm)) names.add(match[1]!);
  return [...names];
}

/** The team (organizational unit) in an `openssl x509 -subject` line. */
export function teamFromSubject(subject: string): string | undefined {
  const match = /OU\s*=\s*([A-Z0-9]{10})/.exec(subject);
  return match?.[1];
}

/** The organization (`O=`) in an `openssl x509 -subject` line: the team's display name. */
export function teamNameFromSubject(subject: string): string | undefined {
  const match = /(?:^|[,/\s])O\s*=\s*((?:\\.|[^,/\n])+)/.exec(subject);
  const name = match?.[1]?.replace(/\\(.)/g, "$1").trim();
  return name || undefined;
}

/** The distinct teams behind the keychain's Apple Development identities, with names where the certificate gives one. */
export async function identityTeams(run: SigningCommand): Promise<SigningTeam[]> {
  let output: string;
  try { output = await run("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"]); } catch { return []; }
  const teams = new Map<string, SigningTeam>();
  for (const name of developmentIdentities(output)) {
    try {
      const pem = await run("/usr/bin/security", ["find-certificate", "-c", name, "-p"]);
      const subject = await new Promise<string>((resolve, reject) => {
        const child = execFile("/usr/bin/openssl", ["x509", "-noout", "-subject", "-nameopt", "RFC2253"], { encoding: "utf8", timeout: 10_000 }, (error, stdout) => error ? reject(error) : resolve(stdout));
        child.stdin?.end(pem);
      });
      // RFC2253 prints `OU=XXXXXXXXXX`.
      const id = teamFromSubject(subject);
      if (id && !teams.get(id)?.name) teams.set(id, { id, ...(teamNameFromSubject(subject) ? { name: teamNameFromSubject(subject)! } : {}) });
    } catch { /* an identity we cannot read is not a candidate */ }
  }
  return [...teams.values()];
}

/** The bundle id the runner is built as. It must be unique to the team, so the team is in it. */
export function runnerBundleId(teamId: string): string {
  return `com.mobiledev.agentdevice.${teamId.toLowerCase()}`;
}

export interface ResolveOptions { env?: NodeJS.ProcessEnv; projectPath?: string; run?: SigningCommand; daemons?: DaemonRestartOptions; /** The saved-choice file; tests only. */ savedTeamFile?: string }

/** The team and where it came from, or an error that says how to name one. */
export async function resolveIosTeam(options: ResolveOptions = {}): Promise<{ teamId: string; source: SigningTeamSource; envVar?: TeamEnvVar }> {
  const explicit = configuredTeam(options.env);
  if (explicit) return { ...explicit, source: "env" };
  const saved = await readSavedIosTeam(options.savedTeamFile);
  if (saved) return { teamId: saved, source: "user" };
  const project = options.projectPath ? await projectTeam(options.projectPath) : undefined;
  if (project) return { teamId: project, source: "project" };
  const teams = await identityTeams(options.run ?? defaultCommand);
  if (teams.length === 1) return { teamId: teams[0]!.id, source: "keychain" };
  if (teams.length === 0)
    throw new ExpectedOperationError("invalid_input", `Testing on an iPhone needs a signing team for the test runner, and none was found: this project does not name a DEVELOPMENT_TEAM and the keychain has no Apple Development identity. Sign in to Xcode with your Apple ID, then ${SIGNING_SETUP_HINT}`);
  throw new ExpectedOperationError("invalid_input", `The keychain has Apple Development identities for ${teams.length} teams (${teams.map(team => team.name ? `${team.name} ${team.id}` : team.id).join(", ")}), so Mobile Dev cannot choose the one that signs the test runner. ${SIGNING_SETUP_HINT}`);
}

/** The signing team for the runner, or an error that says how to name one. */
export async function resolveIosTeamId(options: ResolveOptions = {}): Promise<string> {
  return (await resolveIosTeam(options)).teamId;
}

export type IosSigningStatus = {
  teams: SigningTeam[];
  /** The team the runner would be signed with now; absent when none resolves. */
  resolved?: SigningTeam & { source: SigningTeamSource; /** The variable that pinned the team, when source is env. */ envVar?: TeamEnvVar };
  /** The user's saved choice, which an env setting overrides. */
  saved?: string;
  /** Why nothing resolves. */
  error?: string;
};

/** What the Testing Studio picker shows: the keychain's teams, the saved choice, and the team in effect. */
export async function iosSigningStatus(options: ResolveOptions = {}): Promise<IosSigningStatus> {
  const teams = await identityTeams(options.run ?? defaultCommand);
  const saved = await readSavedIosTeam(options.savedTeamFile);
  const status: IosSigningStatus = { teams, ...(saved ? { saved } : {}) };
  try {
    const { teamId, source, envVar } = await resolveIosTeam(options);
    const known = teams.find(team => team.id === teamId);
    status.resolved = { id: teamId, ...(known?.name ? { name: known.name } : {}), source, ...(envVar ? { envVar } : {}) };
  } catch (error) { status.error = error instanceof Error ? error.message : String(error); }
  return status;
}

/** The signing variables agent-device reads, for one team. A runner bundle id the user set stays. */
export function iosSigningEnv(teamId: string, userBundleId?: string): Record<string, string> {
  return {
    AGENT_DEVICE_IOS_TEAM_ID: teamId,
    AGENT_DEVICE_IOS_BUNDLE_ID: userBundleId?.trim() || runnerBundleId(teamId),
  };
}

/** Variables the agent-device runtime process may inherit; the rest of `AGENT_DEVICE_*` is Mobile Dev's own. */
export const SIGNING_ENV_KEYS = ["AGENT_DEVICE_IOS_TEAM_ID", "AGENT_DEVICE_IOS_BUNDLE_ID", "AGENT_DEVICE_IOS_SIGNING_IDENTITY", "AGENT_DEVICE_IOS_PROVISIONING_PROFILE"] as const;

/** The runner bundle id this module exported, so a later team change can replace it but a user's own value never is. */
let exportedBundleId: string | undefined;

/**
 * Resolves the team and exports it to this process, which is where the in-process agent-device
 * client and the spawned e2e runner both read it. A failure is not cached.
 */
export async function ensureIosSigning(options: ResolveOptions = {}): Promise<string> {
  const teamId = await resolveIosTeamId(options);
  if (options.env) return teamId;
  const current = process.env.AGENT_DEVICE_IOS_BUNDLE_ID;
  const user = current && current !== exportedBundleId ? current : undefined;
  const signing = iosSigningEnv(teamId, user);
  Object.assign(process.env, signing);
  exportedBundleId = user ? undefined : signing.AGENT_DEVICE_IOS_BUNDLE_ID;
  // Once per signing: a daemon that predates it would keep building the runner without a team.
  const signature = JSON.stringify(signing);
  if (checkedSigning !== signature) { checkedSigning = signature; await restartStaleDaemons(signing, options.daemons).catch(() => []); }
  return teamId;
}

export interface DaemonRestartOptions {
  /** State directories whose daemon may be stopped; by default only Mobile Dev's pinned one. */
  stateDirs?: string[];
  readFile?: (path: string) => Promise<string>;
  /** `ps eww -p <pid>` output: the command line and environment of the process. */
  processEnvironment?: (pid: number) => Promise<string>;
  kill?: (pid: number) => void;
}

const defaultProcessEnvironment = async (pid: number): Promise<string> =>
  (await execute("/bin/ps", ["eww", "-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 5_000 })).stdout;

/**
 * Stops an agent-device daemon that was started without this signing.
 *
 * A daemon reads `AGENT_DEVICE_IOS_TEAM_ID` once, from the environment it was started in, and every
 * later client reuses it. One started from a terminal, or before the team was chosen, keeps failing
 * `build-for-testing` with a provisioning error however the next run is configured. The next client
 * starts a fresh daemon from this process's environment, so the stale one is simply asked to stop.
 * Only a process that is an agent-device daemon and does not carry this team and bundle id is touched.
 * Returns the pids stopped.
 */
export async function restartStaleDaemons(signing: Record<string, string>, options: DaemonRestartOptions = {}): Promise<number[]> {
  const read = options.readFile ?? ((path: string) => readFile(path, "utf8"));
  const environmentOf = options.processEnvironment ?? defaultProcessEnvironment;
  const kill = options.kill ?? ((pid: number) => process.kill(pid, "SIGTERM"));
  // Only Mobile Dev's own daemons: one under `~/.agent-device`, or a state dir the user set, may be
  // serving their own agent-device work and is not ours to stop.
  const dirs = options.stateDirs ?? await mobileDevStateDirs();
  const stopped: number[] = [];
  for (const dir of dirs) {
    let pid = NaN;
    try { pid = Number((JSON.parse(await read(join(dir, "daemon.json"))) as { pid?: unknown }).pid); } catch { continue; }
    if (!Number.isInteger(pid) || pid <= 1 || stopped.includes(pid)) continue;
    const environment = await environmentOf(pid).catch(() => "");
    if (!/agent-device/.test(environment) || !/daemon/.test(environment)) continue;
    const carries = Object.entries(signing).every(([key, value]) => environment.includes(`${key}=${value}`));
    if (carries) continue;
    try { kill(pid); stopped.push(pid); } catch { /* already gone */ }
  }
  return stopped;
}

let checkedSigning: string | undefined;

/**
 * Where a project-mode run on iOS hardware keeps its agent-device state: one folder per project, under
 * the app's directory. Such a run cannot share the app's folder (the project's agent-device is another
 * build, and a daemon refuses a client of a different version), and the terminal's `~/.agent-device`
 * may hold a daemon started without the signing team, which is the user's and not ours to stop. A
 * folder of our own gets a daemon started from this process's signed environment, and a stale one
 * left there by an earlier process is restarted like the app's own.
 */
export const PROJECT_STATE_ROOT = join(APP_FLOW_DIRECTORY, "agent-device-projects");

export function projectStateDir(projectPath: string): string {
  return join(PROJECT_STATE_ROOT, createHash("sha256").update(projectPath).digest("hex").slice(0, 16));
}

async function mobileDevStateDirs(): Promise<string[]> {
  const projects = await readdir(PROJECT_STATE_ROOT, { withFileTypes: true }).catch(() => []);
  return [join(APP_FLOW_DIRECTORY, "agent-device"), ...projects.filter(entry => entry.isDirectory()).map(entry => join(PROJECT_STATE_ROOT, entry.name))];
}

/** Forgets what was exported; tests only. */
export function resetIosSigning(): void { exportedBundleId = undefined; checkedSigning = undefined; }

/** Runner startup classes agent-device names in `details.reason` that the user fixes on their machine. */
const USER_FIXABLE_REASONS = /^(?:signing_|bundle_identifier_already_registered|devtools_security_|developer_mode|device_locked|not_ready)/;

/**
 * Turns an agent-device failure the user can fix (signing, Developer Mode, a locked or unreachable
 * phone) into an expected one that carries agent-device's hint, so it reaches the panel as an
 * instruction and is not reported as a plugin bug. Anything else is returned unchanged.
 */
export function withAgentDeviceHint(error: unknown, hint: (error: unknown) => string | undefined, message: (error: unknown) => string): unknown {
  if (error instanceof ExpectedOperationError || error === null || typeof error !== "object") return error;
  const details = (error as { details?: { reason?: unknown } }).details;
  const reason = typeof details?.reason === "string" ? details.reason : "";
  if (!USER_FIXABLE_REASONS.test(reason) || !hint(error)) return error;
  return new ExpectedOperationError(reason.startsWith("signing_") || reason.startsWith("bundle_") ? "invalid_input" : "device_unavailable", message(error));
}
