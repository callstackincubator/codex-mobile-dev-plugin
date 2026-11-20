/** A saved test has source but no recorder step data; edit its awaited call lines in a working copy. */
export type StoredTestStep = { line: number; label: string };

/** Every awaited call line, including app.open, in the order the runner indexes them. */
export function storedTestCallLines(source: string): number[] {
  return source.split("\n").flatMap((line, index) => /^\s*await\b/.test(line) ? [index + 1] : []);
}

export function storedTestSteps(source: string): StoredTestStep[] {
  return source.split("\n").flatMap((line, index) => {
    const expression = line.match(/^\s*await\s+(.+?)\s*;?\s*$/)?.[1];
    if (!expression || /^app\.open\s*\(/.test(expression)) return [];
    return [{ line: index + 1, label: expression.replace(/;$/, "") }];
  });
}

function editLine(source: string, line: number, replace: (lines: string[], index: number) => void): string {
  const lines = source.split("\n");
  if (!storedTestSteps(source).some(step => step.line === line) || !storedTestUntilSource(source, line)) return source;
  replace(lines, line - 1);
  return lines.join("\n");
}

export function duplicateStoredStep(source: string, line: number): string {
  return editLine(source, line, (lines, index) => { lines.splice(index + 1, 0, lines[index]!); });
}

export function removeStoredStep(source: string, line: number): string {
  return editLine(source, line, (lines, index) => { lines.splice(index, 1); });
}

export function moveStoredStep(source: string, fromLine: number, toLine: number): string {
  if (fromLine === toLine || !storedTestSteps(source).some(step => step.line === toLine)) return source;
  return editLine(source, fromLine, (lines, index) => {
    const [moved] = lines.splice(index, 1);
    lines.splice(toLine - 1, 0, moved!);
  });
}

export type StoredCommand = { id: string; label: string; expression: string };

/** Only commands whose locator can be recovered without guessing are offered. */
export function storedStepCommands(step: StoredTestStep): StoredCommand[] {
  const assertion = step.label.match(/^expect\((.+)\)\.(?:toBeVisible|not\.toBeVisible|toBeEnabled|toBeDisabled|toBeSelected)\((?:\{\s*timeout:\s*\d+\s*\})?\)$/);
  const action = step.label.match(/^(.+)\.(?:tap|doubleTap|longPress)\(\)$/);
  const scroll = step.label.match(/^screen\.scrollUntilVisible\((.+)\)$/);
  const locator = assertion?.[1] ?? action?.[1] ?? scroll?.[1];
  if (!locator) return [];
  return [
    { id: "tap", label: "Tap", expression: `${locator}.tap()` },
    { id: "doubleTap", label: "Double tap", expression: `${locator}.doubleTap()` },
    { id: "longPress", label: "Long press", expression: `${locator}.longPress()` },
    { id: "scrollUntilVisible", label: "Scroll into view", expression: `screen.scrollUntilVisible(${locator})` },
    { id: "assertVisible", label: "Is visible", expression: `expect(${locator}).toBeVisible()` },
    { id: "assertNotVisible", label: "Is not visible", expression: `expect(${locator}).not.toBeVisible()` },
    { id: "assertEnabled", label: "Is enabled", expression: `expect(${locator}).toBeEnabled()` },
    { id: "assertDisabled", label: "Is disabled", expression: `expect(${locator}).toBeDisabled()` },
    { id: "assertSelected", label: "Is selected", expression: `expect(${locator}).toBeSelected()` },
  ];
}

export function changeStoredStepCommand(source: string, line: number, commandId: string): string {
  const step = storedTestSteps(source).find(entry => entry.line === line);
  const command = step && storedStepCommands(step).find(option => option.id === commandId);
  if (!command) return source;
  const changed = editLine(source, line, (lines, index) => {
    const indent = lines[index]!.match(/^\s*/)?.[0] ?? "";
    lines[index] = `${indent}await ${command.expression};`;
  });
  if (!commandId.startsWith("assert") || /import\s*{[^}]*\bexpect\b[^}]*}\s*from\s*["']e2e["']/.test(changed)) return changed;
  const lines = changed.split("\n");
  const lastImport = lines.map(entry => /^import\s/.test(entry)).lastIndexOf(true);
  lines.splice(lastImport + 1, 0, 'import { expect } from "e2e";');
  return lines.join("\n");
}

/** A complete one-line await can be moved safely; a multi-line call stays in the source editor. */
function completeAwaitLine(line: string): boolean {
  const expression = line.match(/^\s*await\s+(.+?);?\s*$/)?.[1];
  if (!expression || /[,(.?:=+\-*/{}\[]$/.test(expression.trimEnd())) return false;
  const closing: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  let quote = "";
  for (let index = 0; index < expression.length; index++) {
    const char = expression[index]!;
    if (char === "\\" && quote) { index++; continue; }
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
    if (closing[char]) stack.push(closing[char]);
    else if ([")", "]", "}"].includes(char) && stack.pop() !== char) return false;
  }
  return !quote && stack.length === 0;
}

/** The runner uses a temporary sibling file; returning here stops after the chosen call. */
export function storedTestUntilSource(source: string, line: number): string | undefined {
  const lines = source.split("\n");
  if (!completeAwaitLine(lines[line - 1] ?? "")) return;
  const indent = lines[line - 1]!.match(/^\s*/)?.[0] ?? "";
  lines.splice(line, 0, `${indent}return;`);
  return lines.join("\n");
}

/** The locator a stored step acts on, and where it sits in the step, or undefined if it cannot be found without guessing. */
function stepLocator(label: string): string | undefined {
  const assertion = label.match(/^expect\((.+)\)\.(?:toBeVisible|not\.toBeVisible|toBeEnabled|toBeDisabled|toBeSelected)\((?:\{\s*timeout:\s*\d+\s*\})?\)$/);
  const action = label.match(/^(.+)\.(?:tap|doubleTap|longPress)\(\)$/);
  const scroll = label.match(/^screen\.scrollUntilVisible\((.+)\)$/);
  return assertion?.[1] ?? action?.[1] ?? scroll?.[1];
}

/** A branch this module wrote: `platform === "android" ? <a> : <b>`, possibly in parentheses. */
const BRANCH = /^platform === "(ios|android)" \? (screen\..+?\)) : (.+)$/;

/**
 * Gives one step a locator for one platform and keeps the one it had for every other:
 * `expect(screen.getByTestId("Home"))` becomes
 * `expect(platform === "android" ? screen.getByText("Home") : screen.getByTestId("Home"))`.
 *
 * A step that already branches on that platform has its branch replaced rather than nested. The
 * test callback gains the `platform` fixture the branch reads. Anything this cannot rewrite with
 * certainty — a multi-line call, a step whose locator it cannot find — comes back unchanged.
 */
export function branchStoredStepLocator(source: string, line: number, platform: "ios" | "android", locator: string): string {
  const step = storedTestSteps(source).find(entry => entry.line === line);
  const current = step && stepLocator(step.label);
  if (!step || !current || !locator.startsWith("screen.")) return source;
  const withFixture = withPlatformFixture(source);
  if (withFixture === undefined) return source;
  // An action's branch is wrapped in parentheses so `.tap()` applies to it; read it without them.
  const existing = (/^\(.*\)$/.test(current) ? current.slice(1, -1) : current).match(BRANCH);
  // An action needs the branch parenthesised for `.tap()` to apply to its result; an argument does not.
  const isAction = /\.(?:tap|doubleTap|longPress)\(\)$/.test(step.label) && !step.label.startsWith("expect(");
  // Two platforms, so one branch is enough: an existing branch keeps its other side and takes the
  // new locator on this platform's side, whichever side that is.
  const branch = !existing ? `platform === "${platform}" ? ${locator} : ${current}`
    : existing[1] === platform ? `platform === "${platform}" ? ${locator} : ${existing[3]}`
    : `platform === "${existing[1]}" ? ${existing[2]} : ${locator}`;
  const replacement = isAction ? `(${branch})` : branch;
  const changed = editLine(withFixture, line, (lines, index) => {
    const text = lines[index]!;
    const at = text.indexOf(current);
    if (at >= 0) lines[index] = text.slice(0, at) + replacement + text.slice(at + current.length);
  });
  return changed === withFixture ? source : changed;
}

/** Adds `platform` to the test callback's destructured fixtures when it is not there yet. */
function withPlatformFixture(source: string): string | undefined {
  let found = false;
  const changed = source.replace(/(\btest\s*\(\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)\s*,\s*async\s*\(\s*\{)([^}]*)(\}\s*\)\s*=>)/, (whole, open: string, fixtures: string, close: string) => {
    found = true;
    if (/\bplatform\b/.test(fixtures)) return whole;
    const names = fixtures.trim().replace(/,$/, "");
    return `${open} ${names ? `${names}, ` : ""}platform ${close}`;
  });
  return found ? changed : undefined;
}
