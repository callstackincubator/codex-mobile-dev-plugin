import { VisitorKeys as VisitorKeys$1 } from "eslint-visitor-keys";
import * as eslint0 from "eslint";
import { SourceCode } from "eslint";

//#region src/ast/loc.d.ts
type Range = [number, number];
interface Position {
  /** >= 1 */
  line: number;
  /** >= 0 */
  column: number;
}
interface SourceLocation {
  start: Position;
  end: Position;
}
interface HasLocs {
  loc: SourceLocation;
  range: Range;
}
//#endregion
//#region src/ast/token.d.ts
interface Comment extends HasLocs {
  type: "Block";
  value: string;
}
type TokenType = "Punctuator" | "Bare" | "BasicString" | "MultiLineBasicString" | "LiteralString" | "MultiLineLiteralString" | "Integer" | "Float" | "Boolean" | "OffsetDateTime" | "LocalDateTime" | "LocalDate" | "LocalTime";
interface BaseTOMLToken extends HasLocs {
  type: TokenType;
  value: string;
}
type Token = PunctuatorToken | BareToken | StringToken | MultiLineStringToken | NumberToken | BooleanToken | DateTimeToken;
interface PunctuatorToken extends BaseTOMLToken {
  type: "Punctuator";
  value: string;
}
interface BareToken extends BaseTOMLToken {
  type: "Bare";
  value: string;
}
interface StringToken extends BaseTOMLToken {
  type: "BasicString" | "LiteralString";
  value: string;
  string: string;
}
interface MultiLineStringToken extends BaseTOMLToken {
  type: "MultiLineBasicString" | "MultiLineLiteralString";
  value: string;
  string: string;
}
interface IntegerToken extends BaseTOMLToken {
  type: "Integer";
  value: string;
  number: number;
  bigint: bigint;
}
interface FloatToken extends BaseTOMLToken {
  type: "Float";
  value: string;
  number: number;
}
type NumberToken = IntegerToken | FloatToken;
interface BooleanToken extends BaseTOMLToken {
  type: "Boolean";
  value: string;
  boolean: boolean;
}
interface DateTimeToken extends BaseTOMLToken {
  type: "OffsetDateTime" | "LocalDateTime" | "LocalDate" | "LocalTime";
  value: string;
  date: Date;
}
//#endregion
//#region src/ast/ast.d.ts
interface BaseTOMLNode extends HasLocs {
  type: string;
}
type TOMLNode = TOMLProgram | TOMLTopLevelTable | TOMLTable | TOMLKeyValue | TOMLKey | TOMLBare | TOMLQuoted | TOMLContentNode;
type TOMLContentNode = TOMLValue | TOMLArray | TOMLInlineTable;
interface TOMLProgram extends BaseTOMLNode {
  type: "Program";
  body: [TOMLTopLevelTable];
  sourceType: "module";
  comments: Comment[];
  tokens: Token[];
  parent: null;
}
interface TOMLTopLevelTable extends BaseTOMLNode {
  type: "TOMLTopLevelTable";
  body: (TOMLKeyValue | TOMLTable)[];
  parent: TOMLProgram;
}
interface TOMLTable extends BaseTOMLNode {
  type: "TOMLTable";
  kind: "standard" | "array";
  key: TOMLKey;
  resolvedKey: (string | number)[];
  body: TOMLKeyValue[];
  parent: TOMLTopLevelTable;
}
interface TOMLKeyValue extends BaseTOMLNode {
  type: "TOMLKeyValue";
  key: TOMLKey;
  value: TOMLContentNode;
  parent: TOMLTopLevelTable | TOMLTable | TOMLInlineTable;
}
interface TOMLKey extends BaseTOMLNode {
  type: "TOMLKey";
  keys: (TOMLBare | TOMLQuoted)[];
  parent: TOMLKeyValue | TOMLTable;
}
interface TOMLArray extends BaseTOMLNode {
  type: "TOMLArray";
  elements: TOMLContentNode[];
  parent: TOMLKeyValue | TOMLArray;
}
interface TOMLInlineTable extends BaseTOMLNode {
  type: "TOMLInlineTable";
  body: TOMLKeyValue[];
  parent: TOMLKeyValue | TOMLArray;
}
interface TOMLBare extends BaseTOMLNode {
  type: "TOMLBare";
  name: string;
  parent: TOMLKey;
}
interface TOMLQuoted extends BaseTOMLNode {
  type: "TOMLQuoted";
  value: string;
  style: "basic" | "literal";
  parent: TOMLKey;
  kind: "string";
  multiline: false;
}
type TOMLValue = TOMLStringValue | TOMLNumberValue | TOMLBooleanValue | TOMLDateTimeValue;
interface TOMLStringValue extends BaseTOMLNode {
  type: "TOMLValue";
  kind: "string";
  value: string;
  style: "basic" | "literal";
  multiline: boolean;
  parent: TOMLKeyValue | TOMLArray;
}
interface TOMLIntegerValue extends BaseTOMLNode {
  type: "TOMLValue";
  kind: "integer";
  value: number;
  bigint: bigint;
  number: string;
  parent: TOMLKeyValue | TOMLArray;
}
interface TOMLFloatValue extends BaseTOMLNode {
  type: "TOMLValue";
  kind: "float";
  value: number;
  number: string;
  parent: TOMLKeyValue | TOMLArray;
}
type TOMLNumberValue = TOMLIntegerValue | TOMLFloatValue;
interface TOMLBooleanValue extends BaseTOMLNode {
  type: "TOMLValue";
  kind: "boolean";
  value: boolean;
  parent: TOMLKeyValue | TOMLArray;
}
interface TOMLDateTimeValue extends BaseTOMLNode {
  type: "TOMLValue";
  kind: "offset-date-time" | "local-date-time" | "local-date" | "local-time";
  value: Date;
  datetime: string;
  parent: TOMLKeyValue | TOMLArray;
}
declare namespace index_d_exports {
  export { BareToken, BooleanToken, Comment, DateTimeToken, FloatToken, HasLocs, IntegerToken, MultiLineStringToken, NumberToken, Position, PunctuatorToken, Range, SourceLocation, StringToken, TOMLArray, TOMLBare, TOMLBooleanValue, TOMLContentNode, TOMLDateTimeValue, TOMLFloatValue, TOMLInlineTable, TOMLIntegerValue, TOMLKey, TOMLKeyValue, TOMLNode, TOMLNumberValue, TOMLProgram, TOMLQuoted, TOMLStringValue, TOMLTable, TOMLTopLevelTable, TOMLValue, Token, TokenType };
}
//#endregion
//#region src/parser-options.d.ts
type TOMLVersionOption = "1.0" | "1.1" | "1.0.0" | "1.1.0" | "latest" | "next";
interface ParserOptions {
  filePath?: string;
  tomlVersion?: TOMLVersionOption;
}
//#endregion
//#region src/parser.d.ts
/**
 * Parse source code
 */
declare function parseForESLint(code: string, options?: ParserOptions): {
  ast: TOMLProgram;
  visitorKeys: SourceCode.VisitorKeys;
  services: {
    isTOML: boolean;
  };
};
//#endregion
//#region src/traverse.d.ts
interface Visitor<N> {
  visitorKeys?: VisitorKeys$1;
  enterNode(node: N, parent: N | null): void;
  leaveNode(node: N, parent: N | null): void;
}
declare function traverseNodes(node: TOMLNode, visitor: Visitor<TOMLNode>): void;
//#endregion
//#region src/utils.d.ts
type TOMLContentValue<V> = V | TOMLContentValue<V>[] | TOMLTableValue<V>;
type TOMLTableValue<V> = {
  [key: string]: TOMLContentValue<V>;
};
type ConvertTOMLValue<V> = {
  (node: TOMLValue): V;
  (node: TOMLArray): TOMLContentValue<V>[];
  (node: TOMLContentNode): TOMLContentValue<V>;
  (node: TOMLProgram | TOMLTopLevelTable | TOMLTable | TOMLKeyValue | TOMLInlineTable): TOMLTableValue<V>;
  (node: TOMLStringValue | TOMLBare | TOMLQuoted): string;
  (node: TOMLKey): string[];
  (node: TOMLNode): TOMLContentValue<V> | string | string[];
};
type GetStaticTOMLValue = ConvertTOMLValue<TOMLValue["value"]>;
/**
 * Gets the static value for the given node.
 */
declare const getStaticTOMLValue: GetStaticTOMLValue;
//#endregion
//#region src/errors.d.ts
declare const MESSAGES: {
  "unterminated-string": string;
  "unterminated-table-key": string;
  "unterminated-array": string;
  "unterminated-inline-table": string;
  "missing-key": string;
  "missing-newline": string;
  "missing-equals-sign": string;
  "missing-value": string;
  "missing-comma": string;
  "dupe-keys": string;
  "unexpected-char": string;
  "unexpected-token": string;
  "invalid-control-character": string;
  "invalid-comment-character": string;
  "invalid-key-value-newline": string;
  "invalid-inline-table-newline": string;
  "invalid-underscore": string;
  "invalid-space": string;
  "invalid-three-quotes": string;
  "invalid-date": string;
  "invalid-time": string;
  "invalid-leading-zero": string;
  "invalid-trailing-comma-in-inline-table": string;
  "invalid-char-in-escape-sequence": string;
  "invalid-consecutive-dots-in-key": string;
  "invalid-code-point": string;
  "invalid-trailing-dot-in-key": string;
  "invalid-leading-dot-in-key": string;
};
/**
 * TOML parse errors.
 */
declare class ParseError extends SyntaxError {
  index: number;
  lineNumber: number;
  column: number;
  /**
   * Initialize this ParseError instance.
   *
   */
  constructor(code: ErrorCode, offset: number, line: number, column: number, data?: {
    [key: string]: any;
  });
}
type ErrorCode = keyof typeof MESSAGES;
declare namespace meta_d_exports {
  export { name, version };
}
declare const name: string;
declare const version: string;
//#endregion
//#region src/index.d.ts
declare const VisitorKeys: eslint0.SourceCode.VisitorKeys;
/**
 * Parse TOML source code
 */
declare function parseTOML(code: string, options?: ParserOptions): TOMLProgram;
//#endregion
export { type index_d_exports as AST, ParseError, type TOMLVersionOption, VisitorKeys, getStaticTOMLValue, meta_d_exports as meta, name, parseForESLint, parseTOML, traverseNodes };