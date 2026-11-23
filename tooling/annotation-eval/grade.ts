// Deterministic checks on the fixture after a run. Each returns whether the requested
// change landed and stayed within its target, plus a short label for how it was done.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RED = /\bred\b|danger|error|destructive|#(?:f00|ff0000|dc2626|ef4444|b91c1c|f44336|e53935|d32f2f|ff3b30|e11d48|cc0000|c00|b00020)\b|rgb\(\s*2[0-5]\d\s*,\s*[0-6]?\d\s*,/i;
const BLUE = /blue|primary|#(?:00f|0000ff|2563eb|3b82f6|1d4ed8|007aff|0a84ff|1e40af)\b/i;
const GREEN = /green|success|#(?:0f0|00ff00|008000|16a34a|22c55e|10b981|34c759|15803d|059669|2e7d32|4caf50|00c853|28a745)\b/i;
const FILES = ["App.tsx", "src/theme.ts", "src/screens/HomeScreen.tsx", "src/screens/ProfileScreen.tsx", "src/components/Header.tsx", "src/components/CardList.tsx", "src/components/Card.tsx", "src/components/PrimaryButton.tsx", "src/components/Footer.tsx"];

export function grade(scenario: "A" | "B" | "C" | "D" | "E", fixture: string, app: string, diff: string) {
  const read = (root: string, file: string) => { try { return readFileSync(join(root, file), "utf8"); } catch { return ""; } };
  const changed = new Set(FILES.filter(file => read(fixture, file) !== read(app, file)));
  const added = diff.split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++")).join("\n");
  const line = (file: string, pattern: RegExp) => read(app, file).split("\n").find(text => pattern.test(text)) ?? "";
  const only = (...files: string[]) => [...changed].every(file => files.includes(file));
  const linesChanged = diff.split("\n").filter(text => /^[+-](?![+-])/.test(text)).length;
  let pass = false, approach = changed.size ? "edited" : "no edit";

  if (scenario === "A") {
    pass = changed.has("src/components/PrimaryButton.tsx") && RED.test(added) && only("src/components/PrimaryButton.tsx", "src/screens/HomeScreen.tsx", "src/theme.ts");
    approach = !pass ? (changed.size ? "wrong or broad" : approach) : changed.has("src/screens/HomeScreen.tsx") ? "new prop + call site" : "style edit";
  } else if (scenario === "B") {
    const titleRed = RED.test(line("src/components/Card.tsx", /^\s*title:/)) || (RED.test(added) && !changed.has("src/components/CardList.tsx") && changed.has("src/components/Card.tsx"));
    const perInstance = changed.has("src/components/CardList.tsx") || /type Props = \{[^}]*(highlight|color|tone|variant|emphas|accent)/i.test(read(app, "src/components/Card.tsx"));
    const subtitleRed = RED.test(line("src/components/Card.tsx", /^\s*subtitle:/));
    approach = perInstance ? "per-instance" : titleRed ? "shared source" : approach;
    pass = RED.test(added) && (titleRed || perInstance) && !subtitleRed && only("src/components/Card.tsx", "src/components/CardList.tsx", "src/theme.ts");
  } else if (scenario === "C") {
    // A call-site prop in HomeScreen is a valid way to scope the header or button change.
    const home = diffOf(diff, "HomeScreen.tsx");
    const header = changed.has("src/components/Header.tsx") && BLUE.test(diffOf(diff, "Header.tsx") + home);
    const button = changed.has("src/components/PrimaryButton.tsx") && GREEN.test(diffOf(diff, "PrimaryButton.tsx") + home);
    const footer = changed.has("src/components/Footer.tsx") && /underline/i.test(diffOf(diff, "Footer.tsx"));
    const broad = /underline/i.test(line("src/components/Footer.tsx", /^\s*link:/)) || BLUE.test(line("src/components/Header.tsx", /^\s*badge:/));
    pass = header && button && footer && !broad && only("src/components/Header.tsx", "src/components/PrimaryButton.tsx", "src/components/Footer.tsx", "src/screens/HomeScreen.tsx", "src/theme.ts");
    approach = `${[header, button, footer].filter(Boolean).length}/3 edits${broad ? ", broad" : ""}${changed.has("src/screens/HomeScreen.tsx") ? ", props at call site" : ""}`;
  } else if (scenario === "D") {
    const titleRed = RED.test(line("src/components/Card.tsx", /^\s*title:/));
    pass = RED.test(added) && !titleRed && only("src/components/Card.tsx", "src/components/CardList.tsx", "src/theme.ts");
    approach = titleRed ? "all cards (too broad)" : pass ? "one instance" : approach;
  } else {
    const header = read(app, "src/components/Header.tsx"), home = read(app, "src/screens/HomeScreen.tsx");
    const removed = !/badge="New"/.test(home) || !/\{badge\}/.test(header);
    const kept = /\{title\}/.test(header) && /styles\.row/.test(header) && /<CardList/.test(home);
    pass = removed && kept;
    approach = !removed ? approach : !kept ? "removed too much" : !/badge="New"/.test(home) ? "removed prop" : "removed render";
  }
  return { pass, approach, filesChanged: [...changed], linesChanged };
}

function diffOf(diff: string, file: string) {
  const parts = diff.split(/^diff --git /m).filter(part => part.split("\n")[0].includes(file));
  return parts.join("\n").split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++")).join("\n");
}
