/**
 * A Mobile Dev release version: `major.minor.patch`, without prerelease or build
 * labels. The release tooling and the Codex updater accept the same versions, so a
 * tag that publishes is one every installed updater can compare.
 */
export const RELEASE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * A version a build can carry: a release version, or a test deployment's prerelease of
 * one, such as `0.1.172-test.1`. Test deployments publish only GitHub prereleases and
 * never reach a marketplace or the store, so published versions stay release versions.
 */
export const BUILD_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z.-]+)?$/;

export function isReleaseVersion(value: unknown): value is string {
  return typeof value === "string" && RELEASE_VERSION_PATTERN.test(value);
}

export function isBuildVersion(value: unknown): value is string {
  return typeof value === "string" && BUILD_VERSION_PATTERN.test(value);
}

export function parseReleaseVersion(version: string): [bigint, bigint, bigint] {
  const match = RELEASE_VERSION_PATTERN.exec(version);
  if (match === null) throw new Error(`${JSON.stringify(version)} is not a release version.`);
  return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])];
}

/** The release a build version is or precedes: `0.1.172` for `0.1.172-test.1`. */
function buildRelease(version: string): string {
  if (!isBuildVersion(version)) throw new Error(`${JSON.stringify(version)} is not a release version.`);
  return version.split("-")[0];
}

/**
 * Negative, zero or positive as `left` is older than, equal to or newer than `right`.
 * A test deployment's prerelease build compares as the release it precedes.
 */
export function compareReleaseVersions(left: string, right: string): number {
  const leftParts = parseReleaseVersion(buildRelease(left));
  const rightParts = parseReleaseVersion(buildRelease(right));
  for (let index = 0; index < 3; index++) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}
