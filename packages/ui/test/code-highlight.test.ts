import test from "node:test";
import assert from "node:assert/strict";
import { emitE2eTest } from "../../shared/src/test-recording.ts";
import { highlightCode } from "../src/code-highlight.ts";

test("highlighting never changes the code it renders", () => {
  const source = emitE2eTest([
    { id: "1", kind: "tap", selector: { kind: "role", role: "tab", name: "Explore" }, label: "" },
    { id: "2", kind: "tap", selector: { kind: "point", point: { x: 10, y: 20.4 } }, label: "" },
  ], { title: 'a "quoted" flow' });
  assert.equal(highlightCode(source).map(token => token.text).join(""), source);
});

test("the kinds the preview colors are the ones the emitter writes", () => {
  const tokens = highlightCode('// note\nawait screen.getByText("Save").tap();\nconst n = 42;');
  const of = (kind: string) => tokens.filter(token => token.kind === kind).map(token => token.text);
  assert.deepEqual(of("comment"), ["// note"]);
  assert.deepEqual(of("string"), ['"Save"']);
  assert.deepEqual(of("keyword"), ["await", "const"]);
  assert.deepEqual(of("call"), ["getByText", "tap"]);
  assert.deepEqual(of("number"), ["42"]);
  // `screen` is a plain identifier, not a call.
  assert.ok(of("plain").includes("screen"));
});

test("a comment holding quotes or braces does not run on", () => {
  const tokens = highlightCode('// TODO: add a testID to "Save"\nawait a();');
  assert.equal(tokens[0].kind, "comment");
  assert.equal(tokens[0].text, '// TODO: add a testID to "Save"');
  assert.ok(tokens.some(token => token.kind === "keyword" && token.text === "await"));
});
