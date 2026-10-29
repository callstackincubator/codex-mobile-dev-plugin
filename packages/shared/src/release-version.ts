/**
 * A Mobile Dev release version: `major.minor.patch`, without prerelease or build
 * labels. The release tooling and the Codex updater accept the same versions, so a
 * tag that publishes is one every installed updater can compare.
 */
export const RELEASE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isReleaseVersion(value: unknown): value is string {
  return typeof value === "string" && RELEASE_VERSION_PATTERN.test(value);
}

export function parseReleaseVersion(version: string): [bigint, bigint, bigint] {
  const match = RELEASE_VERSION_PATTERN.exec(version);
  if (match === null) throw new Error(`${JSON.stringify(version)} is not a release version.`);
  return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
}

/** Negative, zero or positive as `left` is older than, equal to or newer than `right`. */
export function compareReleaseVersions(left: string, right: string): number {
  const leftParts = parseReleaseVersion(left);
  const rightParts = parseReleaseVersion(right);
  for (let index = 0; index < 3; index++) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}
