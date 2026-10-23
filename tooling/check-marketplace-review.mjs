import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../apps/codex-plugin/.codex-plugin/plugin.json", import.meta.url), "utf8"));
const openai = manifest.extensions["com.openai"];
assert.equal(manifest.interface.defaultPrompt.length, 3);
assert.ok(manifest.interface.defaultPrompt.every(prompt => prompt.length <= 128));
for (const [kind, count] of [["positive", 5], ["negative", 3]]) {
  const cases = openai.review.test_cases[kind];
  assert.equal(cases.length, count, `Expected ${count} ${kind} cases`);
  for (const entry of cases) {
    for (const field of ["description", "prompt", "tools_triggered", "expected_behavior"]) {
      assert.ok(typeof entry[field] === "string" && entry[field].trim(), `${kind}: missing ${field}`);
    }
  }
}
assert.ok(openai.publication.release_notes.trim());
assert.equal("test_credentials" in openai.review, false);
assert.equal("reviewer_instructions" in openai.review, false);
const demo = openai.review.demo_recording_url;
if (process.argv.includes("--ready") || demo !== undefined) {
  assert.ok(demo, "TODO: add review.demo_recording_url before submission (see docs/review/README.md)");
  const url = new URL(demo);
  assert.equal(url.protocol, "https:");
  assert.ok(!/example\.(com|org)|localhost/i.test(url.hostname), "Use the actual accessible recording URL");
  assert.ok(!/TODO|PLACEHOLDER/i.test(demo), "Replace the recording stub");
} else {
  console.log("TODO: demo_recording_url is intentionally omitted until the real recording is supplied.");
}
console.log("Marketplace review metadata checks passed. This does not verify URL access or execute review cases.");
