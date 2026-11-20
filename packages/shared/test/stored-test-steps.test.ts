import test from "node:test";
import assert from "node:assert/strict";
import { branchStoredStepLocator, changeStoredStepCommand, duplicateStoredStep, moveStoredStep, removeStoredStep, storedStepCommands, storedTestCallLines, storedTestSteps, storedTestUntilSource } from "../src/stored-test-steps.ts";

test("saved tests show awaited calls at their source lines", () => {
  const source = `import { test } from "@e2e-dev/mobile";
test("flow", async ({ app, screen }) => {
  await app.open();
  // await screen.tap(); is only a comment
  await screen.getByRole("button", "Continue").tap();
  await expect(screen.getByText("Done")).toBeVisible();
});`;
  assert.deepEqual(storedTestSteps(source), [
    { line: 5, label: 'screen.getByRole("button", "Continue").tap()' },
    { line: 6, label: 'expect(screen.getByText("Done")).toBeVisible()' },
  ]);
  assert.deepEqual(storedTestCallLines(source), [3, 5, 6], "live progress includes app.open and excludes comments");
});

test("reorder, duplicate and command changes edit source without losing its wrapper", () => {
  const source = 'import { test } from "@e2e-dev/mobile";\ntest("flow", async ({ app, screen }) => {\n  await app.open();\n  await screen.getByText("A").tap();\n  await screen.getByText("B").tap();\n});';
  const moved = moveStoredStep(source, 4, 5);
  assert.match(moved, /getByText\("B"\)\.tap\(\);\n  await screen\.getByText\("A"\)\.tap\(\);/);
  const duplicated = duplicateStoredStep(source, 4);
  assert.equal((duplicated.match(/getByText\("A"\)\.tap/g) ?? []).length, 2);
  const removed = removeStoredStep(source, 4);
  assert.doesNotMatch(removed, /getByText\("A"\)/);
  assert.match(removed, /getByText\("B"\)\.tap\(\);/);
  const changed = changeStoredStepCommand(source, 4, "assertVisible");
  assert.match(changed, /import \{ expect \} from "e2e";/);
  assert.match(changed, /await expect\(screen\.getByText\("A"\)\)\.toBeVisible\(\);/);
  assert.ok(storedStepCommands(storedTestSteps(changed)[0]!).some(option => option.id === "tap"));
  assert.ok(storedStepCommands({ line: 1, label: 'expect(screen.getByText("A")).toBeVisible({ timeout: 30000 })' })
    .some(option => option.id === "tap"));
  assert.match(storedTestUntilSource(source, 4) ?? "", /await screen\.getByText\("A"\)\.tap\(\);\n  return;\n  await screen\.getByText\("B"\)\.tap\(\);/);
  const withoutSemicolon = source.replace('getByText("A").tap();', 'getByText("A").tap()');
  assert.match(removeStoredStep(withoutSemicolon, 4), /getByText\("B"\)\.tap\(\);/);
  assert.doesNotMatch(removeStoredStep(withoutSemicolon, 4), /getByText\("A"\)/);
  assert.equal(storedTestUntilSource('await expect(\n  screen.getByText("A")\n).toBeVisible();', 1), undefined);
});

test("a failed line takes another platform's locator behind a platform branch, and keeps its own", () => {
  const source = `import { test } from "@e2e-dev/mobile";
import { expect } from "e2e";

test("flow", async ({ app, screen }) => {
  await app.open();
  await expect(screen.getByTestId("Home")).toBeVisible();
  await screen.getByRole("button", "see users").tap();
});
`;
  let next = branchStoredStepLocator(source, 6, "android", 'screen.getByText("Home")');
  next = branchStoredStepLocator(next, 7, "android", 'screen.getByRole("button", "SEE USERS")');
  const lines = next.split("\n");
  assert.equal(lines[3], 'test("flow", async ({ app, screen, platform }) => {', "the branch reads the platform fixture");
  assert.equal(lines[5], '  await expect(platform === "android" ? screen.getByText("Home") : screen.getByTestId("Home")).toBeVisible();');
  assert.equal(lines[6], '  await (platform === "android" ? screen.getByRole("button", "SEE USERS") : screen.getByRole("button", "see users")).tap();');
  // Re-recording a branched line replaces that platform's side rather than nesting another branch.
  const again = branchStoredStepLocator(next, 6, "android", 'screen.getByText("Start")').split("\n")[5];
  assert.equal(again, '  await expect(platform === "android" ? screen.getByText("Start") : screen.getByTestId("Home")).toBeVisible();');
  const ios = branchStoredStepLocator(next, 7, "ios", 'screen.getByText("see users")').split("\n")[6];
  assert.equal(ios, '  await (platform === "android" ? screen.getByRole("button", "SEE USERS") : screen.getByText("see users")).tap();');
  // A line with no locator to swap, and a coordinate, are left alone.
  assert.equal(branchStoredStepLocator(source, 5, "android", 'screen.getByText("Home")'), source);
  assert.equal(branchStoredStepLocator(source, 6, "android", "tapAt({ x: 1, y: 2 })"), source);
});

test("a locator branch handles commas in quoted titles and requires a platform fixture", () => {
  const source = `import { test } from "@e2e-dev/mobile";
test("sign in, then search", async ({ app, screen }) => {
  await app.open();
  await screen.getByText("Search").tap();
});`;
  const changed = branchStoredStepLocator(source, 4, "android", 'screen.getByTestId("search")');
  assert.match(changed, /test\("sign in, then search", async \(\{ app, screen, platform \}\) =>/);
  assert.match(changed, /await \(platform === "android" \? screen\.getByTestId\("search"\) : screen\.getByText\("Search"\)\)\.tap\(\);/);

  const unrecognized = source.replace('test("sign in, then search",', "test(flowName,");
  assert.equal(branchStoredStepLocator(unrecognized, 4, "android", 'screen.getByTestId("search")'), unrecognized);
});
