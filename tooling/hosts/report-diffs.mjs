import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/**
 * Shows a pull request's visual changes in one comment that each run updates: for
 * each changed screenshot, main's baseline, the pull request's render and their
 * diff. The images go to the `visual-diffs` branch, one folder per pull request,
 * and the comment links them by commit so earlier comments keep their images.
 *
 * Usage: node tooling/hosts/report-diffs.mjs <downloaded artifact directory>
 * Environment: GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, RUN_URL, VISUAL_RESULT.
 */
const [results = "visual-regression"] = process.argv.slice(2);
const { GITHUB_REPOSITORY: repository, PR_NUMBER: pr, RUN_URL: runUrl, VISUAL_RESULT: outcome } = process.env;
const branch = "visual-diffs";
const marker = "<!-- mobile-dev-visual-diff -->";

function files(directory) {
  try {
    return readdirSync(directory).flatMap(name => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  } catch { return []; }
}

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" });
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

// Playwright writes <name>-expected.png, <name>-actual.png and <name>-diff.png per changed
// screenshot. A retry writes the same images again under a -retry1 folder; keep one set.
const byName = new Map();
for (const diff of files(results).filter(path => path.endsWith("-diff.png")).sort()) {
  const stem = diff.slice(0, -"-diff.png".length);
  byName.set(basename(stem), { name: basename(stem), expected: `${stem}-expected.png`, actual: `${stem}-actual.png`, diff });
}
const changed = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

let body;
if (changed.length === 0) {
  body = outcome === "success"
    ? `${marker}\n### Visual regression (codex)\n\nNo visual changes from main.`
    : `${marker}\n### Visual regression (codex)\n\nThe visual job failed without screenshot diffs. See the [run](${runUrl}).`;
} else {
  const checkout = mkdtempSync(join(tmpdir(), "visual-diffs-"));
  const remote = `https://x-access-token:${process.env.GH_TOKEN}@github.com/${repository}.git`;
  git(checkout, "init", "-q");
  git(checkout, "remote", "add", "origin", remote);
  try { git(checkout, "fetch", "-q", "--depth", "1", "origin", branch); git(checkout, "checkout", "-q", "FETCH_HEAD"); }
  catch { git(checkout, "checkout", "-q", "--orphan", branch); }
  // Two commits per run: main's screenshots and the diffs, then this pull request's
  // screenshots over main's at the same paths. GitHub shows the second commit as an
  // image change with 2-up, swipe and onion skin views. Only this pull request's
  // latest run is kept; the comment pins its images by commit.
  const folder = `pr-${pr}`;
  const commitAll = message => {
    git(checkout, "add", "-A");
    git(checkout, "-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "commit", "-q", "--allow-empty", "-m", message);
    return git(checkout, "rev-parse", "HEAD").trim();
  };
  rmSync(join(checkout, folder), { recursive: true, force: true });
  for (const image of changed) {
    cpSync(image.expected, join(checkout, folder, `${image.name}.png`));
    cpSync(image.diff, join(checkout, folder, "diff", `${image.name}.png`));
  }
  const before = commitAll(`chore: main's screenshots for #${pr}`);
  for (const image of changed) cpSync(image.actual, join(checkout, folder, `${image.name}.png`));
  const after = commitAll(`chore: #${pr}'s screenshots`);
  git(checkout, "push", "-q", "origin", `HEAD:refs/heads/${branch}`);
  rmSync(checkout, { recursive: true, force: true });
  const raw = (commit, file) => `https://raw.githubusercontent.com/${repository}/${commit}/${folder}/${file}`;
  const rows = changed.map(({ name }) =>
    `| \`${name}\` | <img src="${raw(before, `${name}.png`)}" width="260"> | <img src="${raw(after, `${name}.png`)}" width="260"> | <img src="${raw(before, `diff/${name}.png`)}" width="260"> |`);
  body = [
    marker,
    "### Visual regression (codex)",
    "",
    `${changed.length} screenshot${changed.length === 1 ? "" : "s"} differ from main. **[Compare them with swipe and onion skin](https://github.com/${repository}/commit/${after})**: pick a mode above each image. Click an image here for full size, or open the [run's Playwright report](${runUrl}).`,
    "",
    "| Screen | main | this PR | diff |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "If the changes are intended, update the baselines with `npm run test:visual:docker -- --update-snapshots` and commit them.",
  ].join("\n");
}

// One comment per pull request, edited in place on every run.
const comments = JSON.parse(gh("api", `repos/${repository}/issues/${pr}/comments`, "--paginate", "--slurp")).flat();
const existing = comments.find(comment => comment.body?.startsWith(marker));
if (existing) gh("api", "-X", "PATCH", `repos/${repository}/issues/comments/${existing.id}`, "-f", `body=${body}`);
else if (changed.length > 0 || outcome !== "success") gh("api", "-X", "POST", `repos/${repository}/issues/${pr}/comments`, "-f", `body=${body}`);
console.log(changed.length === 0 ? "No screenshot diffs." : `Posted ${changed.length} screenshot diffs.`);
