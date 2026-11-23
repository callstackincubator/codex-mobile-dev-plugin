/** Completion entries for the test API emitted by the recorder. No project or TypeScript indexing. */
export type TestSourceSuggestion = { label: string; insert: string; cursorBack?: number; detail?: string };
export type TestSourceCompletion = { from: number; to: number; items: TestSourceSuggestion[] };

const locatorMethods: TestSourceSuggestion[] = [
  { label: "getByTestId", insert: 'getByTestId("")', cursorBack: 2 },
  { label: "getByRole", insert: 'getByRole("", "")', cursorBack: 6 },
  { label: "getByText", insert: 'getByText("")', cursorBack: 2 },
  { label: "getByLabel", insert: 'getByLabel("")', cursorBack: 2 },
  { label: "getByPlaceholder", insert: 'getByPlaceholder("")', cursorBack: 2 },
];
const locatorActions: TestSourceSuggestion[] = [
  { label: "tap", insert: "tap()" },
  { label: "doubleTap", insert: "doubleTap()" },
  { label: "longPress", insert: "longPress()" },
  { label: "fill", insert: 'fill("")', cursorBack: 2 },
  { label: "nth", insert: "nth(0)", cursorBack: 2 },
];
const assertions: TestSourceSuggestion[] = [
  { label: "not", insert: "not." },
  { label: "toBeVisible", insert: "toBeVisible()", cursorBack: 1 },
  { label: "toHaveText", insert: 'toHaveText("")', cursorBack: 2 },
  { label: "toContainText", insert: 'toContainText("")', cursorBack: 2 },
  { label: "toHaveValue", insert: 'toHaveValue("")', cursorBack: 2 },
  { label: "toBeEnabled", insert: "toBeEnabled()", cursorBack: 1 },
  { label: "toBeDisabled", insert: "toBeDisabled()", cursorBack: 1 },
  { label: "toBeSelected", insert: "toBeSelected()", cursorBack: 1 },
];
const assertionStarts: TestSourceSuggestion[] = [
  { label: "expect visible", insert: 'expect(screen.getByTestId("")).toBeVisible()', cursorBack: 17,
    detail: 'expect(screen.getByTestId("…")).toBeVisible()' },
  { label: "expect not visible", insert: 'expect(screen.getByTestId("")).not.toBeVisible()', cursorBack: 21,
    detail: 'expect(screen.getByTestId("…")).not.toBeVisible()' },
  { label: "expect text", insert: 'expect(screen.getByTestId("")).toHaveText("")', cursorBack: 18,
    detail: 'expect(screen.getByTestId("…")).toHaveText("…")' },
];
const agentMethods: TestSourceSuggestion[] = [
  { label: "act", insert: 'act("")', cursorBack: 2 },
  { label: "assert", insert: 'assert("")', cursorBack: 2 },
  { label: "assert with vision", insert: 'assert("", { vision: true })', cursorBack: 20,
    detail: 'assert("…", { vision: true })' },
  { label: "waitFor", insert: 'waitFor("")', cursorBack: 2 },
];

function matching(items: TestSourceSuggestion[], prefix: string, from: number, to: number): TestSourceCompletion | undefined {
  const filtered = items.filter(item => item.label.toLowerCase().startsWith(prefix.toLowerCase()) && item.label !== prefix);
  return filtered.length ? { from, to, items: filtered } : undefined;
}

function inCommentOrString(line: string): boolean {
  let quote = "";
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === "\\" && quote) { index++; continue; }
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === "/" && line[index + 1] === "/") return true;
    if (char === '"' || char === "'" || char === "`") quote = char;
  }
  return Boolean(quote);
}

export function testSourceSuggestions(source: string, cursor: number): TestSourceCompletion | undefined {
  const before = source.slice(0, cursor).split("\n").at(-1) ?? "";
  // Keep suggestions out of comments and quoted arguments. These are the recorder's single-line
  // strings, not a full TypeScript parse; the editor still accepts arbitrary source.
  if (inCommentOrString(before)) return;
  const visionValue = before.match(/\bagent\.(?:assert|waitFor)\((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'),\s*\{\s*vision:\s*(true|false|"only"|[A-Za-z"]*)$/);
  if (visionValue) {
    const prefix = visionValue[1];
    return matching([
      { label: "true", insert: "true" }, { label: "false", insert: "false" }, { label: '"only"', insert: '"only"' },
    ], prefix, cursor - prefix.length, cursor);
  }
  const agentOption = before.match(/\bagent\.(assert|waitFor|act)\((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'),(\s*\{?\s*[A-Za-z]*)$/);
  if (agentOption) {
    const typed = agentOption[2].replace(/[^A-Za-z]/g, "");
    const options: TestSourceSuggestion[] = agentOption[1] === "act"
      ? [{ label: "params", insert: " { params: {} }", cursorBack: 3, detail: "Pass named values to the agent" }]
      : [
      { label: "vision: true", insert: " { vision: true }", detail: "Use the image when needed" },
      { label: 'vision: "only"', insert: ' { vision: "only" }', detail: "Use only the image" },
      { label: "vision: false", insert: " { vision: false }", detail: "Use the accessibility tree" },
    ];
    return matching(options, typed, cursor - agentOption[2].length, cursor);
  }
  const assertionCall = before.match(/\.(toBeVisible|toHaveText|toContainText|toHaveValue|toBeEnabled|toBeDisabled|toBeSelected)\(([^)]*)$/);
  if (assertionCall) {
    const [, method, args] = assertionCall;
    const option = args.match(/(\s*\{?\s*[A-Za-z]*)$/);
    const needsValue = method === "toHaveText" || method === "toContainText" || method === "toHaveValue";
    if (option && (!needsValue && args === option[1] || needsValue && /,\s*\{?\s*[A-Za-z]*$/.test(args))) {
      const typed = option[1].replace(/[^A-Za-z]/g, "");
      return matching([{ label: "timeout", insert: "{ timeout: 30000 }", detail: "Wait up to 30000 ms" }],
        typed, cursor - option[1].length, cursor);
    }
  }
  const match = before.match(/\.([A-Za-z]*)$/);
  if (!match) {
    const beginning = before.match(/(?:^|\bawait\s+)([A-Za-z]+)$/);
    if (!beginning) return;
    return matching(assertionStarts, beginning[1], cursor - beginning[1].length, cursor);
  }
  const prefix = match[1];
  const owner = before.slice(0, match.index);
  const entries = /(?:^|\W)screen$/.test(owner) ? locatorMethods
    : /(?:^|\W)app$/.test(owner) ? [{ label: "open", insert: "open()" }]
      : /(?:^|\W)agent$/.test(owner) ? agentMethods
        : /expect\([^\n]*\)(?:\.not)?$/.test(owner) ? owner.endsWith(".not") ? assertions.filter(item => item.label !== "not") : assertions
          : /screen\.(?:getBy\w+|tapAt)\(/.test(owner) ? locatorActions : [];
  return matching(entries, prefix, cursor - prefix.length, cursor);
}
