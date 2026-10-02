import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { publicRelease } from "../scripts/public-release.mjs";

function git(directory: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
}

async function fixture(t: TestContext) {
  const parent = tmpdir();
  const prefix = join(parent, "mobile-dev-public-release-");
  const directory = await mkdtemp(prefix);
  t.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const repository = join(directory, "repository");
  const remote = join(directory, "remote.git");
  await mkdir(repository);
  git(directory, ["init", "--bare", remote]);
  git(repository, ["init"]);
  git(repository, ["config", "user.name", "Release test"]);
  git(repository, ["config", "user.email", "release@example.com"]);
  git(repository, ["config", "commit.gpgsign", "false"]);
  git(repository, ["remote", "add", "origin", remote]);
  await mkdir(`${repository}/src/shared`, { recursive: true });
  await writeFile(`${repository}/plugin.json`, '{"name":"mobile-dev","version":"1.2.3"}');
  await writeFile(`${repository}/package.json`, '{"version":"1.2.3"}');
  await writeFile(`${repository}/package-lock.json`, '{"version":"1.2.3","packages":{"":{"version":"1.2.3"}}}');
  await writeFile(`${repository}/src/shared/version.ts`, 'export const PLUGIN_VERSION = "1.2.3";\n');
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "Prepare release"]);
  return { repository, remote };
}

test("public-release creates and pushes the current version tag at HEAD", async t => {
  const { repository, remote } = await fixture(t);
  const head = git(repository, ["rev-parse", "HEAD"]);
  const release = await publicRelease(repository);
  assert.equal(release.tag, "v1.2.3");
  const localTag = git(repository, ["rev-parse", "refs/tags/v1.2.3"]);
  const remoteTag = git(remote, ["rev-parse", "refs/tags/v1.2.3"]);
  assert.equal(localTag, head);
  assert.equal(remoteTag, head);
});

test("public-release refuses uncommitted changes before creating a tag", async t => {
  const { repository, remote } = await fixture(t);
  await writeFile(`${repository}/uncommitted.txt`, "pending change");
  const release = publicRelease(repository);
  await assert.rejects(release, /Commit your changes/);
  const localTags = git(repository, ["tag", "--list"]);
  const remoteTags = git(remote, ["tag", "--list"]);
  assert.equal(localTags, "");
  assert.equal(remoteTags, "");
});

test("public-release refuses inconsistent committed versions before creating a tag", async t => {
  const { repository } = await fixture(t);
  await writeFile(`${repository}/package.json`, '{"version":"1.2.4"}');
  git(repository, ["add", "package.json"]);
  git(repository, ["commit", "-m", "Mismatch package version"]);
  const release = publicRelease(repository);
  await assert.rejects(release, /package.json version/);
  const tags = git(repository, ["tag", "--list"]);
  assert.equal(tags, "");
});

test("public-release preserves an existing local tag", async t => {
  const { repository, remote } = await fixture(t);
  git(repository, ["tag", "v1.2.3"]);
  const initialTag = git(repository, ["rev-parse", "refs/tags/v1.2.3"]);
  const release = publicRelease(repository);
  await assert.rejects(release, /already exists locally/);
  const currentTag = git(repository, ["rev-parse", "refs/tags/v1.2.3"]);
  const remoteTags = git(remote, ["tag", "--list"]);
  assert.equal(currentTag, initialTag);
  assert.equal(remoteTags, "");
});

test("public-release never overwrites an existing remote tag and reports how to retry a failed push", async t => {
  const { repository, remote } = await fixture(t);
  git(repository, ["tag", "v1.2.3"]);
  git(repository, ["push", "origin", "refs/tags/v1.2.3"]);
  const initialTag = git(remote, ["rev-parse", "refs/tags/v1.2.3"]);
  git(repository, ["tag", "--delete", "v1.2.3"]);
  await writeFile(`${repository}/later.txt`, "later commit");
  git(repository, ["add", "later.txt"]);
  git(repository, ["commit", "-m", "Later change"]);
  const release = publicRelease(repository);
  await assert.rejects(release, /push failed.*git push origin refs\/tags\/v1\.2\.3/);
  const remoteTag = git(remote, ["rev-parse", "refs/tags/v1.2.3"]);
  assert.equal(remoteTag, initialTag);
});
