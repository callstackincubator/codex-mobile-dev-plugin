import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { releaseNotes } from "../scripts/release-notes.mjs";

const repositoryUrl = "https://github.com/example/mobile-dev";

async function fixture(t: TestContext) {
  const parent = tmpdir();
  const prefix = join(parent, "mobile-dev-release-notes-");
  const directory = await mkdtemp(prefix);
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  function git(args: string[]) {
    const result = execFileSync("git", args, {
      cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return result.trim();
  }
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "Release notes test"]);
  git(["config", "user.email", "release@example.test"]);
  git(["config", "commit.gpgsign", "false"]);
  git(["config", "tag.gpgsign", "false"]);
  function commit(message: string) {
    git(["commit", "--allow-empty", "-m", message]);
    return git(["rev-parse", "HEAD"]);
  }
  return { directory, git, commit };
}

test("release notes link all commit titles since the previous public release in chronological order", async t => {
  const { directory, git, commit } = await fixture(t);
  commit("Prepare the old release");
  git(["tag", "-a", "v1.0.0", "-m", "Previous public release"]);
  const feature = commit("feat: add monitoring\n\nPrivate implementation details omitted from release notes.");
  git(["tag", "v1.1.0"]);
  const fix = commit("fix: handle disconnects");
  git(["tag", "v1.2.0"]);
  const notes = releaseNotes("v1.2.0", repositoryUrl, ["v1.0.0"], directory);
  const expected = [
    "## Commits", "",
    `- [feat: add monitoring](${repositoryUrl}/commit/${feature})`,
    `- [fix: handle disconnects](${repositoryUrl}/commit/${fix})`, "",
    `[Full diff](${repositoryUrl}/compare/v1.0.0...v1.2.0)`, "",
  ].join("\n");
  assert.equal(notes, expected);
});

test("the first public release includes legacy history and escapes Markdown in linked titles", async t => {
  const { directory, git, commit } = await fixture(t);
  const legacy = commit("Initial project");
  const feature = commit("feat: handle [labels], `code`, and <tags>");
  git(["tag", "v1.0.0"]);
  const notes = releaseNotes("v1.0.0", repositoryUrl, [], directory);
  const escapedTitle = "feat: handle \\[labels\\], \\`code\\`, and \\<tags\\>";
  const expected = [
    "## Commits", "",
    `- [Initial project](${repositoryUrl}/commit/${legacy})`,
    `- [${escapedTitle}](${repositoryUrl}/commit/${feature})`, "",
  ].join("\n");
  assert.equal(notes, expected);
});

test("notes select the nearest reachable public release and ignore other branch releases", async t => {
  const { directory, git, commit } = await fixture(t);
  commit("chore: start history");
  git(["tag", "v1.0.0"]);
  git(["checkout", "-b", "other"]);
  commit("feat: add another branch");
  git(["tag", "v9.0.0"]);
  git(["checkout", "main"]);
  commit("fix: ship the second release");
  git(["tag", "v1.1.0"]);
  const current = commit("feat: ship the third release");
  git(["tag", "v1.2.0"]);
  const notes = releaseNotes("v1.2.0", repositoryUrl, ["v9.0.0", "v1.0.0", "v1.1.0", "v1.2.0"], directory);
  assert.match(notes, /compare\/v1\.1\.0\.\.\.v1\.2\.0/);
  assert.match(notes, /feat: ship the third release/);
  const includesCurrent = notes.includes(current);
  assert.ok(includesCurrent);
  assert.doesNotMatch(notes, /second release|another branch|start history/);
});

test("release notes require full history rather than silently truncating a shallow checkout", async t => {
  const { directory, git, commit } = await fixture(t);
  commit("chore: start history");
  commit("feat: ship a release");
  git(["tag", "v1.0.0"]);
  const clone = join(directory, "shallow");
  git(["clone", "--depth=1", `file://${directory}`, clone]);
  assert.throws(() => releaseNotes("v1.0.0", repositoryUrl, [], clone), /complete Git history/);
});
