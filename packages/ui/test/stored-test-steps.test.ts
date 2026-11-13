import test from "node:test";
import assert from "node:assert/strict";
import { changeStoredStepCommand, duplicateStoredStep, moveStoredStep, removeStoredStep, storedStepCommands, storedTestSteps, storedTestUntilSource } from "../src/stored-test-steps.ts";

test("saved tests show awaited calls at their source lines", () => {
  assert.deepEqual(storedTestSteps(`import { test } from "@e2e-dev/mobile";
test("flow", async ({ app, screen }) => {
  await app.open();
  // await screen.tap(); is only a comment
  await screen.getByRole("button", "Continue").tap();
  await expect(screen.getByText("Done")).toBeVisible();
});`), [
    { line: 5, label: 'screen.getByRole("button", "Continue").tap()' },
    { line: 6, label: 'expect(screen.getByText("Done")).toBeVisible()' },
  ]);
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
