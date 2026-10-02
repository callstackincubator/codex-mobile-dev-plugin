import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { metroTargets } from "../metro-logs.ts";
import { parseBaseUrl } from "../../shared/protocol.ts";

const execute = promisify(execFile);
export type FlowTarget = Omit<Awaited<ReturnType<typeof metroTargets>>[number], "webSocketDebuggerUrl">;
export type MetroServer = { url: string; projectRoot?: string; targets: FlowTarget[] };
export type FlowSetupInput = { projectRoot?: string; metroUrl?: string; deviceId?: string; deviceName?: string; appId?: string };

export function listeningNodePorts(output: string) {
  let pid = "", command = "";
  const ports = new Map<number, string>();
  for (const line of output.split("\n")) {
    if (line[0] === "p") { pid = line.slice(1); command = ""; }
    else if (line[0] === "c") command = line.slice(1);
    else if (line[0] === "n" && /^(node|bun|deno)/i.test(command) && /^\d+$/.test(pid)) {
      const port = Number(line.match(/:(\d+)$/)?.[1]);
      if (port > 0 && port <= 65535 && ports.size < 32) ports.set(port, pid);
    }
  }
  return ports;
}

export async function findMetroServers(metroUrl?: string): Promise<MetroServer[]> {
  const requested = metroUrl ? parseBaseUrl(metroUrl, "Metro URL").origin : undefined;
  let ports = new Map<number, string>();
  try {
    const { stdout } = await execute("/usr/sbin/lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"], { timeout: 1500, maxBuffer: 256 * 1024 });
    ports = listeningNodePorts(stdout);
  } catch { /* Discovery still checks the supplied URL and Metro's default port. */ }
  const origins = new Map([...ports].map(([port, pid]) => [`http://127.0.0.1:${port}`, pid]));
  if (!origins.has("http://127.0.0.1:8081")) origins.set("http://127.0.0.1:8081", "");
  if (requested && !origins.has(requested)) origins.set(requested, "");
  const results = await Promise.all([...origins].map(async ([url, pid]): Promise<MetroServer | undefined> => {
    const signal = AbortSignal.timeout(1500);
    try {
      const response = await fetch(`${url}/status`, { signal, redirect: "error" });
      if (!response.ok || (await response.text()).trim() !== "packager-status:running") return;
      const targets = (await metroTargets(url, signal)).map(({ webSocketDebuggerUrl, ...target }) => target);
      let projectRoot: string | undefined;
      if (pid) {
        try {
          const { stdout } = await execute("/usr/sbin/lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], { timeout: 1000, maxBuffer: 8192 });
          const path = stdout.split("\n").find(line => line.startsWith("n/"))?.slice(1);
          if (path) projectRoot = await realpath(path);
        } catch { /* Keep the server usable when its source folder is unavailable. */ }
      }
      return { url, projectRoot, targets };
    } catch { return; }
  }));
  return results.filter((server): server is MetroServer => !!server);
}

export async function discoverFlowSetup(input: FlowSetupInput, roots: { uri: string }[], findServers = findMetroServers) {
  const [servers, rootPaths] = await Promise.all([
    findServers(input.metroUrl),
    Promise.all(roots.slice(0, 20).map(async root => {
      try { return await realpath(fileURLToPath(root.uri)); } catch { return undefined; }
    })),
  ]);
  const projects = [...new Set(rootPaths.filter((path): path is string => !!path))];
  const projectRoot = input.projectRoot ? await realpath(input.projectRoot) : projects.length === 1 ? projects[0] : undefined;
  const matches = projectRoot ? servers.filter(server => {
    if (!server.projectRoot) return false;
    const local = relative(projectRoot, server.projectRoot);
    return local === "" || !local.startsWith("..") && !isAbsolute(local);
  }) : servers;
  const requested = input.metroUrl ? parseBaseUrl(input.metroUrl, "Metro URL").origin : undefined;
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z\d]/g, "");
  const matchesDevice = (target: FlowTarget) => !!(input.deviceId && target.deviceId === input.deviceId
    || input.deviceName && target.deviceName && normalize(target.deviceName) === normalize(input.deviceName));
  const deviceServers = matches.filter(server => server.targets.some(matchesDevice));
  const appServers = deviceServers.filter(server => server.targets.some(target => matchesDevice(target) && input.appId && target.appId === input.appId));
  const fitting = appServers.length ? appServers : deviceServers.length ? deviceServers : matches;
  const selected = requested ? servers.find(server => server.url === requested) : fitting.length === 1 ? fitting[0] : undefined;
  const targets = selected?.targets ?? [];
  const compatible = targets.filter(target => target.supportsMultipleDebuggers);
  const deviceMatches = compatible.filter(matchesDevice);
  const appMatches = deviceMatches.filter(target => input.appId && target.appId === input.appId);
  const candidates = appMatches.length ? appMatches : deviceMatches;
  const targetId = candidates.length === 1 ? candidates[0].id : undefined;
  const message = !servers.length ? "No running Metro server found. Start Metro for your project, open its development build, then choose Find apps."
    : !selected ? projectRoot && !matches.length ? "No Metro server matches this project. Start Metro in that folder or choose a server below." : "More than one Metro server is running. Choose the server for this project."
    : !targets.length ? "Metro is running, but no app is connected. Open the development build on the selected device."
    : !targetId ? "Choose the running app for the selected device." : "";
  return { projectRoot: input.projectRoot ? projectRoot : selected?.projectRoot ?? projectRoot, metroUrl: selected?.url, targetId, targets, servers, projects, message };
}
