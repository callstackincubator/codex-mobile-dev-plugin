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
  const lastImport = lines.findLastIndex(entry => /^import\s/.test(entry));
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
