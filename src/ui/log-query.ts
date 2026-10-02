import type { LogRecord } from "../shared/logs.ts";

type Match = (log: LogRecord, now: number) => boolean;
type Term = { type: "term"; value: string; field?: string; regex: boolean; negated: boolean };
type Token = Term | { type: "and" | "or" | "open" | "close" | "not" };
export type LogQuery = { match: Match; error: string; usesAge: boolean };

const textFields = ["message", "stack", "process", "tag", "subsystem", "category", "origin", "source", "level", "timestamp"] as const;
const levelAliases: Record<string, string> = { warning: "warn", err: "error", verbose: "debug" };
const ageUnits: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < query.length) {
    const character = query[index];
    if (/\s/.test(character)) { index++; continue; }
    const operator = character === "&" ? "and" : character === "|" ? "or" : character === "(" ? "open" : character === ")" ? "close" : character === "-" ? "not" : undefined;
    if (operator) { tokens.push({ type: operator }); index++; continue; }

    let word = "";
    let colon = -1;
    let quote = "";
    while (index < query.length) {
      const next = query[index];
      if (quote) {
        if (next === quote) quote = "";
        else if (next === "\\" && (query[index + 1] === quote || query[index + 1] === "\\")) word += query[++index];
        else word += next;
      } else if (next === '"' || next === "'") quote = next;
      else if (/\s|[&|()]/.test(next)) break;
      else {
        if (next === ":" && colon === -1) colon = word.length;
        word += next;
      }
      index++;
    }
    if (quote) throw new Error("Close the quoted value.");
    let field: string | undefined;
    let regex = false;
    let value = word;
    if (colon !== -1) {
      field = word.slice(0, colon);
      regex = field.endsWith("~");
      if (regex) field = field.slice(0, -1);
      field = field.toLowerCase();
      if (field === "") throw new Error("Enter a field before the colon.");
      value = word.slice(colon + 1);
      if (!value) throw new Error("Enter a value after the colon.");
    }
    const negated = tokens.at(-1)?.type === "not";
    if (negated) tokens.pop();
    tokens.push({ type: "term", value, field, regex, negated });
  }
  return tokens;
}

function groupFields(tokens: Token[]): Token[] {
  const explicit = tokens.some(token => token.type === "and" || token.type === "or" || token.type === "open" || token.type === "close");
  if (explicit) return tokens;
  const fields = new Map<string, Term[]>();
  const others: Token[] = [];
  for (const token of tokens) {
    if (token.type === "term" && token.field && token.negated === false) {
      const group = fields.get(token.field);
      if (group) group.push(token);
      else fields.set(token.field, [token]);
    } else others.push(token);
  }
  const result: Token[] = [];
  for (const terms of fields.values()) {
    if (result.length) result.push({ type: "and" });
    result.push({ type: "open" });
    terms.forEach((term, index) => {
      if (index) result.push({ type: "or" });
      result.push(term);
    });
    result.push({ type: "close" });
  }
  if (result.length && others.length) result.push({ type: "and" });
  result.push(...others);
  return result;
}

function createTerm(term: Term): Match {
  const value = term.value.toLowerCase();
  let match: Match;
  if (term.field === "age") {
    if (term.regex) throw new Error("Age does not support regex matching.");
    const duration = /^(\d+)([smhd])$/i.exec(term.value);
    if (!duration) throw new Error("Use an age such as 30s, 5m, 1h, or 1d.");
    const amount = Number(duration[1]);
    const unit = duration[2].toLowerCase();
    const milliseconds = amount * ageUnits[unit];
    if (Number.isSafeInteger(milliseconds) === false) throw new Error("Age is too large.");
    match = (log, now) => {
      const timestamp = Date.parse(log.timestamp);
      const age = now - timestamp;
      return age >= 0 && age <= milliseconds;
    };
  } else {
    const field = textFields.find(field => field === term.field);
    if (term.field && field === undefined) throw new Error("Unknown field. Open filter help for supported fields.");
    let pattern: RegExp | undefined;
    if (term.regex) {
      try { pattern = new RegExp(term.value, "i"); }
      catch { throw new Error("Enter a valid regular expression."); }
    }
    const expected = field === "level" ? levelAliases[value] ?? value : value;
    const fields = field ? [field] : textFields;
    const exact = field === "level" || field === "source" || field === "origin";
    match = log => {
      for (const key of fields) {
        const text = log[key];
        if (text === undefined) continue;
        if (pattern) {
          if (pattern.test(text)) return true;
        } else {
          const normalized = text.toLowerCase();
          const matches = exact ? normalized === expected : normalized.includes(expected);
          if (matches) return true;
        }
      }
      return false;
    };
  }
  return term.negated ? (log, now) => !match(log, now) : match;
}

export function compileLogQuery(query: string): LogQuery {
  try {
    if (query.length > 512) throw new Error("Keep filters within 512 characters.");
    const trimmed = query.trim();
    if (trimmed === "") return { match: () => true, error: "", usesAge: false };
    const raw = tokenize(trimmed);
    const tokens = groupFields(raw);
    let index = 0;
    const primary = (): Match => {
      const token = tokens[index++];
      if (!token) throw new Error("Enter a term after the operator.");
      if (token.type === "term") return createTerm(token);
      if (token.type === "not") {
        const match = primary();
        return (log, now) => !match(log, now);
      }
      if (token.type === "open") {
        const match = expression();
        if (tokens[index]?.type !== "close") throw new Error("Close the group with a parenthesis.");
        index++;
        return match;
      }
      throw new Error("Expected a keyword, field filter, or group.");
    };
    const conjunction = (): Match => {
      let left = primary();
      while (index < tokens.length && tokens[index].type !== "or" && tokens[index].type !== "close") {
        if (tokens[index].type === "and") index++;
        const right = primary();
        const previous = left;
        left = (log, now) => {
          const matches = previous(log, now);
          return matches ? right(log, now) : false;
        };
      }
      return left;
    };
    const expression = (): Match => {
      let left = conjunction();
      while (tokens[index]?.type === "or") {
        index++;
        const right = conjunction();
        const previous = left;
        left = (log, now) => {
          const matches = previous(log, now);
          return matches ? true : right(log, now);
        };
      }
      return left;
    };
    const match = expression();
    if (index !== tokens.length) throw new Error("Remove the unexpected closing parenthesis.");
    const usesAge = raw.some(token => token.type === "term" && token.field === "age");
    return { match, error: "", usesAge };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid filter query.";
    return { match: () => false, error: message, usesAge: false };
  }
}
