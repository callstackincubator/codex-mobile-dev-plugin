import test from "node:test";
import assert from "node:assert/strict";
import { testSourceSuggestions } from "../src/test-source-suggestions.ts";

test("test source suggestions match the recorder's locator, action, and assertion API", () => {
  const labels = (source: string) => testSourceSuggestions(source, source.length)?.items.map(item => item.label);
  assert.deepEqual(labels("await exp"), ["expect visible", "expect not visible", "expect text"]);
  assert.deepEqual(labels("await screen."), ["getByTestId", "getByRole", "getByText", "getByLabel", "getByPlaceholder"]);
  assert.deepEqual(labels("await screen.getByT"), ["getByTestId", "getByText"]);
  assert.deepEqual(labels('await screen.getByText("Save").ta'), ["tap"]);
  assert.deepEqual(labels('await expect(screen.getByText("Save")).toB'), ["toBeVisible", "toBeEnabled", "toBeDisabled", "toBeSelected"]);
  assert.deepEqual(labels('await expect(screen.getByText("Save")).'),
    ["not", "toBeVisible", "toHaveText", "toContainText", "toHaveValue", "toBeEnabled", "toBeDisabled", "toBeSelected"]);
  assert.deepEqual(labels('await expect(screen.getByText("Save")).not.'),
    ["toBeVisible", "toHaveText", "toContainText", "toHaveValue", "toBeEnabled", "toBeDisabled", "toBeSelected"]);
  assert.deepEqual(labels('await expect(screen.getByText("Save")).toBeVisible('), ["timeout"]);
  assert.deepEqual(labels('await expect(screen.getByText("Save")).toHaveText("Done", '), ["timeout"]);
  assert.deepEqual(labels('await agent.assert("The list is visible", '),
    ["vision: true", 'vision: "only"', "vision: false"]);
  assert.deepEqual(labels('await agent.assert("The list is visible", { vision: '), ["true", "false", '"only"']);
  assert.deepEqual(labels('await agent.act("Sign in", '), ["params"]);
  assert.deepEqual(labels("await app.op"), ["open"]);
  assert.equal(labels("// screen."), undefined);
  assert.equal(labels('await screen.getByText("screen.'), undefined);
});
