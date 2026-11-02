/**
 * The weekly dependency update applies, prepares and, when Claude cannot fix a
 * failure, reverts each lane on its own, so one broken update keeps only its own lane
 * out of the pull request. A lane prepares with shell commands or by preparing native
 * helpers (`tooling/release-native.mjs`), where "all" means every helper.
 * sentry-native comes before the other native lanes because it changes every helper,
 * so the later lanes rebuild only their own.
 */
export const dependencyLanes = [
  { name: "js", label: "npm packages, device runtimes and GitHub Actions", groups: ["npm", "agent-device", "serve-emu", "github-actions"],
    commands: ["npm ci --no-audit --no-fund", "npm run vendor:agent-device", "npm run catalog:agent-device", "npm run vendor:serve-emu"] },
  { name: "sentry-native", label: "sentry-native", helpers: "all" },
  { name: "baguette", label: "Baguette", helpers: ["baguette"] },
  { name: "libimobiledevice", label: "libimobiledevice", helpers: ["ios-logs"] },
  { name: "ios-mirror-crates", label: "iPhone mirror Rust crates", helpers: ["ios-mirror"] },
];

/** Report-only updates (forks, Git pins) belong to this pseudo-lane, which changes no files. */
export const reportLane = "forks";

export function laneOf(group) {
  return dependencyLanes.find(lane => lane.groups?.includes(group))?.name ?? reportLane;
}

/** The helpers a lane prepares, from `nativeHelpers` names. */
export function laneHelpers(lane, helperNames) {
  if (lane.helpers === "all") return [...helperNames];
  return lane.helpers ?? [];
}

const groups = { npm: "npm", "agent-device": "agent-device runtime", "serve-emu": "serve-emu runtime", "github-actions": "GitHub Actions", native: "Native", forked: "Forks and vendored sources" };

/** Markdown tables of applied and held-back updates. */
export function renderUpdates(updates, { apply = true, cargoChanges = 0 } = {}) {
  const row = update => `| ${update.link ? `[${update.name}](${update.link})` : update.name} | ${update.from} | ${update.to} |${update.applied ? "" : ` ${update.reason ?? ""} |`}`;
  const section = (title, rows, heldColumn) => rows.length === 0 ? [] : [
    `### ${title}`, "", heldColumn ? "| Dependency | Current | Available | Why not applied |" : "| Dependency | From | To |", heldColumn ? "| --- | --- | --- | --- |" : "| --- | --- | --- |",
    ...Object.keys(groups).flatMap(group => rows.filter(update => update.group === group).map(update => row({ ...update, name: `${groups[group]}: ${update.name}` }))), "",
  ];
  const applied = updates.filter(update => update.applied);
  const held = updates.filter(update => !update.applied && update.reason !== undefined);
  return [
    ...section(apply ? "Applied" : "Safe updates available", apply ? applied : updates.filter(update => update.reason === undefined), false),
    ...(cargoChanges > 0 ? [`Also updated ${cargoChanges} Rust crate${cargoChanges === 1 ? "" : "s"} of the iPhone mirror within their ranges (see \`Cargo.lock\`).`, ""] : []),
    ...section("Held back", held, true),
  ].join("\n");
}
