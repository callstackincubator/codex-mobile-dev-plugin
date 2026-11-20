/**
 * A tokenizer for the TypeScript the recorder emits.
 *
 * This is deliberately not a parser and not a general highlighter: the preview only ever shows a
 * file this panel wrote, whose shape is fixed by `emitE2eTest`, so literals, line comments,
 * keywords and call names are the whole vocabulary. A real highlighter would add a grammar and
 * hundreds of kilobytes to a panel that renders one twenty-line file.
 */
export type CodeTokenKind = "comment" | "string" | "keyword" | "call" | "number" | "plain";
export type CodeToken = { kind: CodeTokenKind; text: string };

const KEYWORDS = new Set([
  "import", "from", "export", "default", "const", "let", "var", "async", "await", "function",
  "return", "new", "if", "else", "for", "of", "in", "true", "false", "null", "undefined",
]);

// Line comments, then any quoted string, then a word, then a number. Anything else is plain text,
// which keeps whitespace and newlines intact for the <pre> that renders these.
const TOKEN = /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|([A-Za-z_$][\w$]*)|(\d+(?:\.\d+)?)/g;

export function highlightCode(source: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  const push = (kind: CodeTokenKind, text: string) => { if (text) tokens.push({ kind, text }); };
  let last = 0;
  for (const match of source.matchAll(TOKEN)) {
    push("plain", source.slice(last, match.index));
    last = match.index + match[0].length;
    const [, comment, string, word, number] = match;
    if (comment !== undefined) push("comment", comment);
    else if (string !== undefined) push("string", string);
    else if (word !== undefined) push(KEYWORDS.has(word) ? "keyword" : source[last] === "(" ? "call" : "plain", word);
    else push("number", number!);
  }
  push("plain", source.slice(last));
  return tokens;
}

/** The class each kind renders with. Both themes, since the panel follows the host's. */
export const CODE_TOKEN_CLASS: Record<CodeTokenKind, string> = {
  comment: "text-muted-foreground italic",
  string: "text-emerald-600 dark:text-emerald-400",
  keyword: "text-violet-600 dark:text-violet-400",
  call: "text-blue-600 dark:text-blue-400",
  number: "text-amber-600 dark:text-amber-400",
  plain: "",
};

/**
 * The lines of `next` that `previous` did not have, as a `[start, end)` range.
 *
 * The preview is re-emitted whole on every change, so there is no "the step I just added" to
 * point at — it has to be recovered by comparing. Matching from both ends finds it without a real
 * diff: the emitter appends steps in order, so what differs is one contiguous run, and removing a
 * step or renaming the test narrows to the same kind of range.
 */
export function changedLines(previous: readonly string[], next: readonly string[]): [number, number] {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let end = 0;
  while (end < previous.length - start && end < next.length - start
    && previous[previous.length - 1 - end] === next[next.length - 1 - end]) end++;
  return [start, next.length - end];
}
