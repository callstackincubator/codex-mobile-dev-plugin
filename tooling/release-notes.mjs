import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function releaseNotes(tag, repositoryUrl, publishedTags, directory = ".") {
  function git(args) {
    return execFileSync("git", args, {
      cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  }
  const versionTag = /^v\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?$/;
  if (versionTag.test(tag) === false) throw new Error("Release notes require a version tag.");
  const shallow = git(["rev-parse", "--is-shallow-repository"]);
  if (shallow.trim() === "true") throw new Error("Release notes require the complete Git history and tags.");
  git(["rev-parse", "--verify", `refs/tags/${tag}^{commit}`]);
  const tagsText = git(["tag", "--merged", `refs/tags/${tag}`]);
  const trimmedTags = tagsText.trim();
  const reachableTags = trimmedTags.split("\n");
  const previousTags = publishedTags.filter(candidate => {
    const valid = versionTag.test(candidate);
    const reachable = reachableTags.includes(candidate);
    return candidate !== tag && valid && reachable;
  });
  let previousTag;
  if (previousTags.length > 0) {
    const matches = previousTags.flatMap(candidate => ["--match", candidate]);
    const previous = git(["describe", "--tags", "--abbrev=0", ...matches, `refs/tags/${tag}`]);
    previousTag = previous.trim();
  }
  const range = previousTag ? `refs/tags/${previousTag}..refs/tags/${tag}` : `refs/tags/${tag}`;
  const log = git(["log", "--reverse", "--format=%H%x00%s", range]);
  const trimmedLog = log.trimEnd();
  const lines = trimmedLog.split("\n");
  const baseUrl = repositoryUrl.replace(/\/$/, "");
  const notes = ["## Commits", ""];
  for (const line of lines) {
    if (line.length === 0) continue;
    const [hash, subject] = line.split("\0");
    const title = subject.replace(/[\\`*_[\]<>]/g, "\\$&");
    notes.push(`- [${title}](${baseUrl}/commit/${hash})`);
  }
  if (previousTag) {
    notes.push("", `[Full diff](${baseUrl}/compare/${previousTag}...${tag})`);
  }
  const text = notes.join("\n");
  return text + "\n";
}

const scriptPath = fileURLToPath(import.meta.url);
const executedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executedPath === scriptPath) {
  const published = await readFile(process.argv[2], "utf8");
  const trimmedTags = published.trim();
  const tags = trimmedTags.split("\n");
  const repositoryUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GH_REPO}`;
  const notes = releaseNotes(process.env.RELEASE_TAG, repositoryUrl, tags);
  await writeFile(process.argv[3], notes);
}
