const require_chunk = require('./chunk-Bnu9O96Y.cjs');
const require_mcp = require('./mcp-uPg2RfP3.cjs');
const require_src = require('./src-BvE2tDzk.cjs');
let _modelcontextprotocol_core_ext_skills = require("@modelcontextprotocol/core/ext/skills");

//#region src/ext/skills/errors.ts
/**
* Thrown when a skill catalog cannot be built: storage failures always, skill problems under `strict`.
* Branded, so `instanceof` also matches an instance from another bundled copy of the SDK.
*/
var SkillCatalogError = class extends Error {
	static {
		Object.defineProperty(this, "mcpBrand", { value: "mcp.SkillCatalogError" });
	}
	static [Symbol.hasInstance](value) {
		return require_src.brandedHasInstance(this, value);
	}
	/**
	* Brand-based type guard: equivalent to `value instanceof this`, as an
	* explicit static predicate (the axios/AWS-SDK `isInstance` style). Must be
	* invoked on the class — in callback position write
	* `v => SkillCatalogError.isInstance(v)`, not `.filter(SkillCatalogError.isInstance)`.
	*/
	static isInstance(value) {
		if (typeof this !== "function") throw new TypeError("isInstance must be called on the class (e.g. `SkillCatalogError.isInstance(value)`); for callbacks use `v => SkillCatalogError.isInstance(v)`");
		return require_src.brandedHasInstance(this, value);
	}
	problems;
	constructor(problems) {
		const lines = problems.map((problem) => `  ${problem.path}: ${problem.message}`).join("\n");
		super(`${problems.length} skill problem${problems.length === 1 ? "" : "s"}:\n${lines}`);
		this.name = "SkillCatalogError";
		this.problems = problems;
		require_src.stampErrorBrands(this, new.target);
	}
};
function defaultWarn(warning) {
	console.warn(`[mcp-sdk] skills: ${warning.path}: ${warning.message}`);
}

//#endregion
//#region ../core-internal/src/ext/skills/bytes.ts
const encoder = new TextEncoder();
/** UTF-8 bytes of `text`. */
function encodeUtf8(text) {
	return encoder.encode(text);
}
/** Decodes UTF-8 only if decoding loses nothing (a BOM is kept); otherwise `undefined`. */
function decodeUtf8Lossless(bytes) {
	try {
		return new TextDecoder("utf-8", {
			fatal: true,
			ignoreBOM: true
		}).decode(bytes);
	} catch {
		return;
	}
}
/** Standard base64 of `bytes`. */
function encodeBase64(bytes) {
	let binary = "";
	const chunk = 32768;
	for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCodePoint(...bytes.subarray(offset, offset + chunk));
	return btoa(binary);
}
/** Bytes of a standard base64 string. */
function decodeBase64(base64) {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.codePointAt(index);
	return bytes;
}
/** `sha256:` followed by the lowercase hex SHA-256 of `bytes` (WebCrypto, every runtime). */
async function sha256Digest(bytes) {
	const { buffer, byteOffset, byteLength } = bytes;
	const view = buffer instanceof ArrayBuffer ? new Uint8Array(buffer, byteOffset, byteLength) : new Uint8Array(bytes);
	const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", view));
	let hex = "";
	for (const byte of hash) hex += byte.toString(16).padStart(2, "0");
	return `sha256:${hex}`;
}

//#endregion
//#region ../core-internal/src/ext/skills/frontmatter.ts
/**
* Frontmatter reader for `SKILL.md` (SEP-2640).
*
* Reads the YAML subset real skills use — block mappings and sequences;
* plain, quoted and block scalars; one-line flow collections; comments — with
* YAML 1.2 core-schema typing. Anything outside the subset throws a
* {@linkcode FrontmatterError} instead of being read differently from a full
* YAML parser. Server catalogs and client verification both call it; it is
* kept behind this module so it can be swapped for a YAML library.
*/
var FrontmatterError = class extends Error {
	line;
	constructor(message, line) {
		super(line === void 0 ? message : `line ${line}: ${message}`);
		this.name = "FrontmatterError";
		this.line = line;
	}
};
const MAX_DEPTH = 32;
/** Splits `SKILL.md` into its frontmatter YAML and markdown body. */
function splitFrontmatter(markdown) {
	let text = markdown.replaceAll("\r\n", "\n");
	if (text.codePointAt(0) === 65279) text = text.slice(1);
	if (!text.startsWith("---\n")) throw new FrontmatterError("SKILL.md must begin with a \"---\" line", 1);
	const rest = text.slice(4);
	const close = /^---[\t ]*$/m.exec(rest);
	if (close === null) throw new FrontmatterError("frontmatter has no closing \"---\" line");
	let body = rest.slice(close.index + close[0].length);
	if (body.startsWith("\n")) body = body.slice(1);
	return {
		yaml: rest.slice(0, close.index),
		body
	};
}
/** Splits and parses `SKILL.md`. Line numbers in errors count from the file's first line. */
function parseSkillMarkdown(markdown) {
	const { yaml, body } = splitFrontmatter(markdown);
	return {
		frontmatter: parseFrontmatterYaml(yaml, 2),
		body
	};
}
/** Parses frontmatter YAML into a JSON object. `firstLine` numbers the first YAML line in errors. */
function parseFrontmatterYaml(yaml, firstLine = 1) {
	return new Parser(toLines(yaml, firstLine)).parseDocument();
}
function toLines(yaml, firstLine) {
	const raws = yaml.split("\n");
	if (raws.at(-1) === "") raws.pop();
	return raws.map((raw, index) => ({
		no: firstLine + index,
		indent: /^ */.exec(raw)?.[0].length ?? 0,
		text: trimWhiteStart(raw),
		raw
	}));
}
const TAB_INDENT = "tabs cannot be used for indentation";
const isSkippable = (line) => line.text === "" || line.text.startsWith("#");
const isTabIndented = (line) => line.raw[line.indent] === "	";
const isSequenceItem = (text) => /^-(?:[\t ]|$)/.test(text);
var Parser = class {
	index = 0;
	constructor(lines) {
		this.lines = lines;
	}
	parseDocument() {
		const first = this.peek();
		if (first === void 0) return {};
		if (first.text.startsWith("﻿")) throw new FrontmatterError("a byte order mark inside the frontmatter is not supported", first.no);
		if (isSequenceItem(first.text) || matchKey(first.text, first.no) === void 0) throw new FrontmatterError("frontmatter must be a mapping of keys to values", first.no);
		const map = this.parseMapping(first.indent, 0);
		const extra = this.peek();
		if (extra !== void 0) throw new FrontmatterError("unexpected content", extra.no);
		return map;
	}
	peek() {
		while (this.index < this.lines.length && isSkippable(this.lines[this.index])) this.index++;
		const line = this.lines[this.index];
		if (line !== void 0 && isTabIndented(line)) throw new FrontmatterError(TAB_INDENT, line.no);
		return line;
	}
	parseMapping(indent, depth) {
		assertDepth(depth, this.lines[this.index]?.no);
		const map = {};
		for (let line = this.peek(); line !== void 0 && line.indent >= indent; line = this.peek()) {
			if (line.indent > indent) throw new FrontmatterError("unexpected indentation", line.no);
			if (isSequenceItem(line.text)) break;
			const match = matchKey(line.text, line.no);
			if (match === void 0) throw new FrontmatterError("expected \"key: value\"", line.no);
			if (Object.hasOwn(map, match.key)) throw new FrontmatterError(`duplicate key "${match.key}"`, line.no);
			this.index++;
			map[match.key] = this.parseValue(match.rest, line, indent, depth + 1, true);
		}
		return map;
	}
	parseSequence(indent, depth) {
		assertDepth(depth, this.lines[this.index]?.no);
		const items = [];
		for (let line = this.peek(); line !== void 0 && line.indent >= indent; line = this.peek()) {
			if (line.indent > indent) throw new FrontmatterError("unexpected indentation", line.no);
			if (!isSequenceItem(line.text)) break;
			const after = line.text.slice(1);
			const rest = trimWhiteStart(after);
			const column = line.indent + 1 + (after.length - rest.length);
			if (rest !== "" && !rest.startsWith("#") && (isSequenceItem(rest) || matchKey(rest, line.no) !== void 0)) {
				if (/^ *\t/.test(after)) throw new FrontmatterError(TAB_INDENT, line.no);
				this.lines[this.index] = {
					...line,
					indent: column,
					text: rest
				};
				items.push(isSequenceItem(rest) ? this.parseSequence(column, depth + 1) : this.parseMapping(column, depth + 1));
				continue;
			}
			this.index++;
			items.push(this.parseValue(rest, line, indent, depth + 1, false));
		}
		return items;
	}
	parseValue(rest, line, parentIndent, depth, allowCompactSequence) {
		if (rest === "" || rest.startsWith("#")) {
			const next = this.peek();
			if (next !== void 0 && next.indent > parentIndent) return this.parseIndented(parentIndent, depth);
			if (allowCompactSequence && next !== void 0 && next.indent === parentIndent && isSequenceItem(next.text)) return this.parseSequence(parentIndent, depth);
			return null;
		}
		const first = rest[0];
		if (first === "|" || first === ">") return this.parseBlockScalar(rest, line, parentIndent);
		if (first === "\"" || first === "'") {
			const { value, end } = readQuoted(rest, 0, line.no);
			expectOnlyComment(rest.slice(end), line.no);
			return value;
		}
		if (first === "[" || first === "{") {
			const { value, end } = readFlow(rest, 0, line.no, depth);
			expectOnlyComment(rest.slice(end), line.no);
			return value;
		}
		if ("&*!".includes(first)) throw new FrontmatterError("anchors, aliases and tags are not supported", line.no);
		if ("%@`,]}".includes(first)) throw new FrontmatterError(`"${first}" cannot start a plain value; quote it`, line.no);
		if (isSequenceItem(rest) || /^\?(?:[\t ]|$)/.test(rest)) throw new FrontmatterError("a nested collection must start on its own line", line.no);
		return this.parsePlain(rest, line, parentIndent);
	}
	parseIndented(parentIndent, depth) {
		const line = this.peek();
		if (isSequenceItem(line.text)) return this.parseSequence(line.indent, depth);
		if (matchKey(line.text, line.no) !== void 0) return this.parseMapping(line.indent, depth);
		this.index++;
		return this.parseValue(line.text, line, parentIndent, depth, false);
	}
	parsePlain(first, line, parentIndent) {
		let value = stripComment(first);
		assertPlain(value, line.no);
		let commented = COMMENT.test(first);
		let blanks = 0;
		while (this.index < this.lines.length) {
			const next = this.lines[this.index];
			if (next.text === "") {
				blanks++;
				this.index++;
				continue;
			}
			if (next.indent <= parentIndent || next.text.startsWith("#")) break;
			if (isTabIndented(next)) throw new FrontmatterError(TAB_INDENT, next.no);
			if (commented) throw new FrontmatterError("a comment ends a plain value; quote a value that continues past it", next.no);
			const part = stripComment(next.text);
			assertPlain(part, next.no);
			commented = COMMENT.test(next.text);
			value += blanks > 0 ? "\n".repeat(blanks) : " ";
			value += part;
			blanks = 0;
			this.index++;
		}
		return resolvePlain(value, line.no);
	}
	parseBlockScalar(header, line, parentIndent) {
		const match = /^([>|])([+-]?)(?:[\t ]+#.*)?[\t ]*$/.exec(header);
		if (match === null) throw new FrontmatterError(/^[>|][+-]?\d|^[>|]\d/.test(header) ? "block scalar indentation indicators are not supported" : "invalid block scalar header", line.no);
		const contents = [];
		let contentIndent = -1;
		let leadingWidth = 0;
		while (this.index < this.lines.length) {
			const next = this.lines[this.index];
			const spacesOnly = next.indent === next.raw.length;
			if (contentIndent === -1 && !spacesOnly && next.indent > parentIndent) {
				contentIndent = next.indent;
				if (leadingWidth > contentIndent) throw new FrontmatterError("a leading blank line is indented more than the block scalar content", next.no);
			}
			if (contentIndent !== -1 && next.indent >= contentIndent) contents.push(next.raw.slice(contentIndent));
			else if (spacesOnly) {
				if (contentIndent === -1) leadingWidth = Math.max(leadingWidth, next.indent);
				contents.push("");
			} else if (isTabIndented(next)) throw new FrontmatterError(TAB_INDENT, next.no);
			else break;
			this.index++;
		}
		return foldBlock(contents, match[1] === ">", match[2] ?? "");
	}
};
function assertDepth(depth, line) {
	if (depth > MAX_DEPTH) throw new FrontmatterError(`nesting deeper than ${MAX_DEPTH} levels is not supported`, line);
}
function matchKey(text, no) {
	const first = text[0];
	if (first === "\"" || first === "'") {
		const { value, end } = readQuoted(text, 0, no);
		const after = text.slice(end);
		if (after === ":" || /^:[\t ]/.test(after)) return {
			key: checkKey(value, no),
			rest: trimWhiteStart(after.slice(1))
		};
		return;
	}
	if (first === "?") throw new FrontmatterError("complex keys (\"?\") are not supported", no);
	if (first === void 0 || "[]{}&*!|>%@`#,".includes(first)) return void 0;
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		const previous = text[index - 1];
		if (char === "#" && (previous === " " || previous === "	")) return void 0;
		if (char === ":") {
			const next = text[index + 1];
			if (next === void 0 || next === " " || next === "	") {
				const key = trimWhiteEnd(text.slice(0, index));
				if (key === "") return void 0;
				return {
					key: resolveKey(key, no),
					rest: trimWhiteStart(text.slice(index + 1))
				};
			}
		}
	}
}
function checkKey(key, no) {
	if (key === "__proto__") throw new FrontmatterError("the key \"__proto__\" is not supported", no);
	return key;
}
function resolveKey(raw, no) {
	if (typeof resolvePlain(raw, no) !== "string") throw new FrontmatterError(`key "${raw}" must be a string; quote it`, no);
	return checkKey(raw, no);
}
function assertPlain(text, no) {
	if (/:(?:[\t ]|$)/.test(text)) throw new FrontmatterError("a plain value cannot contain \": \"; quote the value", no);
}
const COMMENT = /[\t ]#/;
function stripComment(text) {
	const match = COMMENT.exec(text);
	return trimWhiteEnd(match === null ? text : text.slice(0, match.index));
}
function expectOnlyComment(after, no) {
	if (trimWhiteStart(after) === "" || /^[\t ]+#/.test(after)) return;
	throw new FrontmatterError("unexpected text after the value", no);
}
function trimWhiteStart(text) {
	return text.slice(skipSpaces(text, 0));
}
function trimWhiteEnd(text) {
	let end = text.length;
	while (end > 0 && (text[end - 1] === " " || text[end - 1] === "	")) end--;
	return text.slice(0, end);
}
const NULL = /^(?:~|null|Null|NULL)$/;
const TRUE = /^(?:true|True|TRUE)$/;
const FALSE = /^(?:false|False|FALSE)$/;
const INTEGER = /^[+-]?\d+$/;
const OCTAL = /^0o[0-7]+$/;
const HEXADECIMAL = /^0x[\dA-Fa-f]+$/;
const FLOAT = /^[+-]?(?:\.\d+|\d+(?:\.\d*)?)(?:[Ee][+-]?\d+)?$/;
const SPECIAL_FLOAT = /^(?:[+-]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;
function resolvePlain(text, no) {
	if (text === "" || NULL.test(text)) return null;
	if (TRUE.test(text)) return true;
	if (FALSE.test(text)) return false;
	let number;
	if (INTEGER.test(text) || FLOAT.test(text)) number = Number(text);
	else if (OCTAL.test(text)) number = Number.parseInt(text.slice(2), 8);
	else if (HEXADECIMAL.test(text)) number = Number.parseInt(text.slice(2), 16);
	else if (SPECIAL_FLOAT.test(text)) number = NaN;
	if (number === void 0) return text;
	if (!Number.isFinite(number)) throw new FrontmatterError(`"${text}" cannot be represented in JSON; quote it`, no);
	return number;
}
const SIMPLE_ESCAPES = {
	"0": "\0",
	a: "\x07",
	b: "\b",
	t: "	",
	"	": "	",
	n: "\n",
	v: "\v",
	f: "\f",
	r: "\r",
	e: "\x1B",
	" ": " ",
	"\"": "\"",
	"/": "/",
	"\\": "\\",
	N: "",
	_: "\xA0",
	L: "\u2028",
	P: "\u2029"
};
const HEX_ESCAPE_WIDTH = {
	x: 2,
	u: 4,
	U: 8
};
const UNCLOSED_QUOTE = "a quoted value must close on the same line (multi-line quoted values are not supported)";
function readQuoted(text, start, no) {
	const quote = text[start];
	let value = "";
	let index = start + 1;
	while (index < text.length) {
		const char = text[index];
		if (quote === "'") {
			if (char === "'") {
				if (text[index + 1] === "'") {
					value += "'";
					index += 2;
					continue;
				}
				return {
					value,
					end: index + 1
				};
			}
			value += char;
			index++;
			continue;
		}
		if (char === "\"") return {
			value,
			end: index + 1
		};
		if (char === "\\") {
			const escape = decodeEscape(text, index, no);
			value += escape.decoded;
			index += escape.length;
			continue;
		}
		value += char;
		index++;
	}
	throw new FrontmatterError(UNCLOSED_QUOTE, no);
}
function decodeEscape(text, index, no) {
	const code = text[index + 1];
	if (code === void 0) throw new FrontmatterError(UNCLOSED_QUOTE, no);
	const simple = SIMPLE_ESCAPES[code];
	if (simple !== void 0) return {
		decoded: simple,
		length: 2
	};
	const width = HEX_ESCAPE_WIDTH[code];
	if (width === void 0) throw new FrontmatterError(`unknown escape "\\${code}"`, no);
	const hex = text.slice(index + 2, index + 2 + width);
	if (hex.length !== width || !/^[\dA-Fa-f]+$/.test(hex) || Number.parseInt(hex, 16) > 1114111) throw new FrontmatterError(`invalid escape "\\${code}${hex}"`, no);
	return {
		decoded: String.fromCodePoint(Number.parseInt(hex, 16)),
		length: 2 + width
	};
}
function skipSpaces(text, index) {
	let position = index;
	while (text[position] === " " || text[position] === "	") position++;
	return position;
}
const UNCLOSED_FLOW = "a flow collection must close on the same line";
function readFlow(text, start, no, depth) {
	assertDepth(depth, no);
	const open = text[start];
	const close = open === "[" ? "]" : "}";
	const list = [];
	const map = {};
	let index = skipSpaces(text, start + 1);
	if (text[index] === close) return {
		value: open === "[" ? list : map,
		end: index + 1
	};
	for (;;) {
		if (open === "[") {
			const item = readFlowValue(text, index, no, depth);
			list.push(item.value);
			index = skipSpaces(text, item.end);
		} else {
			const key = readFlowKey(text, index, no);
			const item = readFlowValue(text, key.end + 1, no, depth);
			if (Object.hasOwn(map, key.key)) throw new FrontmatterError(`duplicate key "${key.key}"`, no);
			map[key.key] = item.value;
			index = skipSpaces(text, item.end);
		}
		const char = text[index];
		if (char === ",") {
			index = skipSpaces(text, index + 1);
			if (text[index] === close) return {
				value: open === "[" ? list : map,
				end: index + 1
			};
			continue;
		}
		if (char === close) return {
			value: open === "[" ? list : map,
			end: index + 1
		};
		if (char === void 0) throw new FrontmatterError(UNCLOSED_FLOW, no);
		throw new FrontmatterError(`unexpected "${char}" in a flow collection`, no);
	}
}
function readFlowKey(text, start, no) {
	const index = skipSpaces(text, start);
	const char = text[index];
	if (char === void 0) throw new FrontmatterError(UNCLOSED_FLOW, no);
	if (char === "\"" || char === "'") {
		const quoted = readQuoted(text, index, no);
		const colon = skipSpaces(text, quoted.end);
		if (text[colon] !== ":") throw new FrontmatterError("expected \": \" after a key in a flow mapping", no);
		return {
			key: checkKey(quoted.value, no),
			end: colon
		};
	}
	if (char === "[" || char === "{") throw new FrontmatterError("complex keys (flow collections as keys) are not supported", no);
	assertFlowPlainStart(text, index, no);
	const end = scanFlowPlain(text, index);
	const raw = trimWhiteEnd(text.slice(index, end));
	const after = text[end + 1];
	if (raw === "" || text[end] !== ":" || after !== " " && after !== "	") throw new FrontmatterError("expected \"key: value\" in a flow mapping", no);
	return {
		key: resolveKey(raw, no),
		end
	};
}
const FLOW_SEPARATORS = " 	,[]{}";
function assertFlowPlainStart(text, index, no) {
	const char = text[index];
	if ("&*!".includes(char)) throw new FrontmatterError("anchors, aliases and tags are not supported", no);
	if ("|>%@`#".includes(char) || "-?:".includes(char) && FLOW_SEPARATORS.includes(text[index + 1] ?? " ")) throw new FrontmatterError(`"${char}" cannot start a plain value in a flow collection; quote it`, no);
}
function scanFlowPlain(text, index) {
	let end = index;
	while (end < text.length) {
		const char = text[end];
		if (",[]{}".includes(char)) break;
		if (char === "#" && (text[end - 1] === " " || text[end - 1] === "	")) break;
		if (char === ":" && FLOW_SEPARATORS.includes(text[end + 1] ?? " ")) break;
		end++;
	}
	return end;
}
function readFlowValue(text, start, no, depth) {
	const index = skipSpaces(text, start);
	const char = text[index];
	if (char === void 0) throw new FrontmatterError(UNCLOSED_FLOW, no);
	if (char === "[" || char === "{") return readFlow(text, index, no, depth + 1);
	if (char === "\"" || char === "'") return readQuoted(text, index, no);
	assertFlowPlainStart(text, index, no);
	const end = scanFlowPlain(text, index);
	if (text[end] === ":") throw new FrontmatterError("mappings inside flow collections are not supported; quote the value", no);
	const raw = trimWhiteEnd(text.slice(index, end));
	if (raw === "") throw new FrontmatterError("empty value in a flow collection", no);
	return {
		value: resolvePlain(raw, no),
		end
	};
}
function foldBlock(contents, folded, chomping) {
	let result = "";
	let emptyLines = 0;
	let didReadContent = false;
	let atMoreIndented = false;
	for (const content of contents) {
		if (content === "") {
			emptyLines++;
			continue;
		}
		if (folded) if (content.startsWith(" ") || content.startsWith("	")) {
			atMoreIndented = true;
			result += "\n".repeat(didReadContent ? 1 + emptyLines : emptyLines);
		} else if (atMoreIndented) {
			atMoreIndented = false;
			result += "\n".repeat(emptyLines + 1);
		} else if (emptyLines === 0) {
			if (didReadContent) result += " ";
		} else result += "\n".repeat(emptyLines);
		else result += "\n".repeat(didReadContent ? 1 + emptyLines : emptyLines);
		result += content;
		didReadContent = true;
		emptyLines = 0;
	}
	if (chomping === "+") result += "\n".repeat(didReadContent ? 1 + emptyLines : emptyLines);
	else if (chomping === "" && didReadContent) result += "\n";
	return result;
}

//#endregion
//#region ../core-internal/src/ext/skills/uri.ts
const ENCODED_IN_SEGMENT = /[^\w!$&'()*+,.:;=@[\]|~-]/gu;
function encodePathText(text) {
	return text.replaceAll(ENCODED_IN_SEGMENT, (char) => encodeURIComponent(char));
}
/** Percent-encodes one path segment as WHATWG URL does, plus `%`, `/`, `\` and the dots of `.` and `..`; throws `URIError` on a lone surrogate. */
function encodeSegment(segment) {
	if (segment === "." || segment === "..") return segment.replaceAll(".", "%2E");
	return encodePathText(segment);
}
/** `text` without its trailing `/`s; a loop, since `/\/+$/` backtracks polynomially on a long run of `/`. */
function trimTrailingSlashes(text) {
	let end = text.length;
	while (end > 0 && text.codePointAt(end - 1) === 47) end--;
	return text.slice(0, end);
}
/** `base` (`scheme://`, or a URI without a trailing slash) + `/`-joined encoded segments; an authority is encoded strictly. */
function joinUri(base, segments) {
	if (!base.endsWith("://")) return `${trimTrailingSlashes(base)}/${segments.map((segment) => encodeSegment(segment)).join("/")}`;
	const [authority, ...path] = segments;
	if (authority === void 0) return base;
	return [base + encodeURIComponent(authority), ...path.map((segment) => encodeSegment(segment))].join("/");
}
/** WHATWG-serialised form of `uri`, or `undefined` if it does not parse. */
function canonicalUri(uri) {
	try {
		return new URL(uri).href;
	} catch {
		return;
	}
}
/** True when `uri` is already in canonical form. */
function isRoundTripUri(uri) {
	return canonicalUri(uri) === uri;
}
const MANIFEST_SUFFIX = "/SKILL.md";
/** The skill's root directory URI (no trailing slash), or `undefined` if `skillMdUri` is not a `…/SKILL.md` URI in a named directory. */
function skillRootUri(skillMdUri) {
	const canonical = canonicalUri(skillMdUri);
	if (canonical === void 0 || !canonical.endsWith(MANIFEST_SUFFIX)) return void 0;
	const root = canonical.slice(0, -9);
	return root.endsWith("/") ? void 0 : root;
}
function safeDecode(segment) {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}
/** The decoded last segment of a directory URI (the authority when the path is empty). */
function lastSegmentOf(rootUri) {
	const url = new URL(rootUri);
	const path = url.pathname;
	return safeDecode(path === "" || path === "/" ? url.host : path.slice(path.lastIndexOf("/") + 1));
}
/** True when `uri` is strictly inside `rootUri` and no segment below it decodes to empty, `.`, `..`, or a name holding `/` or NUL. */
function isWithin(rootUri, uri) {
	const canonical = canonicalUri(uri);
	if (canonical === void 0 || !canonical.startsWith(`${rootUri}/`)) return false;
	return canonical.slice(rootUri.length + 1).split("/").every((segment) => {
		const decoded = safeDecode(segment);
		return decoded !== "" && decoded !== "." && decoded !== ".." && !decoded.includes("/") && !decoded.includes("\0");
	});
}
function decodeOrUndefined(escapes) {
	try {
		return decodeURIComponent(escapes);
	} catch {
		return;
	}
}
function utf8Width(lead) {
	if (lead >= 240) return 4;
	if (lead >= 224) return 3;
	if (lead >= 192) return 2;
	return 1;
}
function keyOfEscapes(run) {
	let key = "";
	for (let at = 0; at < run.length;) {
		const width = 3 * utf8Width(Number.parseInt(run.slice(at + 1, at + 3), 16));
		const decoded = decodeOrUndefined(run.slice(at, at + width));
		if (decoded === void 0) {
			key += `%25${run.slice(at + 1, at + 3)}`;
			at += 3;
		} else {
			key += encodePathText(decoded);
			at += width;
		}
	}
	return key;
}
const ESCAPE_RUN = /((?:%[\dA-Fa-f]{2})+)/;
function keyOfSegment(segment) {
	return segment.split(ESCAPE_RUN).map((part, index) => index % 2 === 0 ? encodePathText(part) : keyOfEscapes(part)).join("");
}
/** The one spelling all ways of writing a file's URI below `rootUri` share (`Q&A.md`, `Q%26A.md#x`); `undefined` if it does not parse. */
function skillFileKey(rootUri, uri) {
	let url;
	try {
		url = new URL(uri);
	} catch {
		return;
	}
	url.hash = "";
	const canonical = url.href;
	if (canonical.includes("?") || !canonical.startsWith(`${rootUri}/`)) return canonical;
	return `${rootUri}/${canonical.slice(rootUri.length + 1).split("/").map((segment) => keyOfSegment(segment)).join("/")}`;
}
/** Code-unit order of two URIs: the one order for entries, directory children and cursors. */
function compareUris(a, b) {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

//#endregion
//#region ../core-internal/src/ext/skills/entry.ts
/** Agent Skills name rule: lowercase letters, digits and single hyphens (length checked separately). */
const SKILL_NAME_PATTERN = /^[\da-z]+(?:-[\da-z]+)*$/;
const isStringMap = (value) => typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((item) => typeof item === "string");
function countCharacters(text) {
	let count = 0;
	for (let index = 0; index < text.length; index += text.codePointAt(index) > 65535 ? 2 : 1) count++;
	return count;
}
/** Structural rules of the stable spec and Agent Skills. Empty array = valid. */
function validateSkillEntry(skill) {
	const problems = [];
	const root = skillRootUri(skill.uri);
	if (root === void 0) return [`uri "${skill.uri}" must be a URI ending in /SKILL.md inside a named directory`];
	const frontmatter = skill.frontmatter;
	const { name, description } = skill.frontmatter;
	if (name.length === 0 || name.length > 64 || !SKILL_NAME_PATTERN.test(name)) problems.push(`frontmatter name "${name}" must be 1-64 lowercase letters, digits and single hyphens`);
	else if (lastSegmentOf(root) !== name) problems.push(`frontmatter name "${name}" must match the last path segment "${lastSegmentOf(root)}"`);
	if (description === "" || countCharacters(description) > 1024) problems.push("frontmatter description must be 1-1024 characters");
	const compatibility = frontmatter["compatibility"];
	if (compatibility !== void 0 && (typeof compatibility !== "string" || compatibility === "" || countCharacters(compatibility) > 500)) problems.push("frontmatter compatibility must be a string of 1-500 characters");
	if (frontmatter["metadata"] !== void 0 && !isStringMap(frontmatter["metadata"])) problems.push("frontmatter metadata must map strings to strings");
	if (skill.resources !== "dynamic") {
		const self = canonicalUri(skill.uri);
		const seen = /* @__PURE__ */ new Set();
		let hasSelf = false;
		for (const resource of skill.resources) {
			const canonical = canonicalUri(resource.uri);
			if (canonical === void 0) {
				problems.push(`resource "${resource.uri}" is not a valid URI`);
				continue;
			}
			if (/[#?]/.test(canonical)) {
				problems.push(`resource "${resource.uri}" must not have a query or fragment`);
				continue;
			}
			const key = skillFileKey(root, canonical) ?? canonical;
			if (seen.has(key)) problems.push(`resource "${resource.uri}" is listed more than once`);
			seen.add(key);
			if (canonical === self) hasSelf = true;
			else if (!isWithin(root, resource.uri)) problems.push(`resource "${resource.uri}" is outside the skill directory ${root}`);
		}
		if (!hasSelf) problems.push(`resources must include ${skill.uri}`);
	}
	return problems;
}
/** Schema check plus {@linkcode validateSkillEntry}, for values received from elsewhere. */
function skillEntryProblems(value) {
	const parsed = _modelcontextprotocol_core_ext_skills.SkillSchema.safeParse(value);
	if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".") || "(entry)"}: ${issue.message}`);
	return validateSkillEntry(parsed.data);
}
/** Builds an entry from a skill's files: parses `SKILL.md`, hashes every file, sorts by URI, validates. */
async function buildSkillEntry(skillMdUri, files) {
	const manifest = files.find((file) => file.uri === skillMdUri);
	if (manifest === void 0) return { problems: ["SKILL.md is missing"] };
	const text = decodeUtf8Lossless(manifest.bytes);
	if (text === void 0) return { problems: ["SKILL.md is not valid UTF-8"] };
	let frontmatter;
	try {
		frontmatter = parseSkillMarkdown(text).frontmatter;
	} catch (error) {
		if (error instanceof FrontmatterError) return { problems: [`SKILL.md frontmatter: ${error.message}`] };
		throw error;
	}
	if (typeof frontmatter["name"] !== "string" || typeof frontmatter["description"] !== "string") return { problems: ["SKILL.md frontmatter must contain string \"name\" and \"description\""] };
	const resources = await Promise.all(files.map(async (file) => ({
		uri: file.uri,
		digest: await sha256Digest(file.bytes),
		size: file.bytes.byteLength
	})));
	resources.sort((a, b) => compareUris(a.uri, b.uri));
	const skill = {
		uri: skillMdUri,
		frontmatter,
		resources
	};
	return {
		skill,
		problems: validateSkillEntry(skill)
	};
}

//#endregion
//#region ../core-internal/src/ext/skills/mime.ts
const BY_EXTENSION = {
	md: "text/markdown",
	markdown: "text/markdown",
	txt: "text/plain",
	json: "application/json",
	yaml: "application/yaml",
	yml: "application/yaml",
	py: "text/x-python",
	sh: "application/x-sh",
	bash: "application/x-sh",
	js: "text/javascript",
	mjs: "text/javascript",
	ts: "text/typescript",
	html: "text/html",
	css: "text/css",
	csv: "text/csv",
	xml: "application/xml",
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	pdf: "application/pdf"
};
/** MIME type from the file extension; `application/octet-stream` when unknown. */
function mimeTypeFor(fileName) {
	const dot = fileName.lastIndexOf(".");
	if (dot <= 0) return "application/octet-stream";
	const extension = fileName.slice(dot + 1).toLowerCase();
	return Object.hasOwn(BY_EXTENSION, extension) ? BY_EXTENSION[extension] : "application/octet-stream";
}

//#endregion
//#region src/ext/skills/catalogBuild.ts
const basename = (path) => path.slice(path.lastIndexOf("/") + 1);
const dirname = (path) => {
	const slash = path.lastIndexOf("/");
	return slash === -1 ? "" : path.slice(0, slash);
};
const errorText$1 = (error) => error instanceof Error ? error.message : String(error);
const NOT_FOLLOWED = "symlinks and other special files are not followed; copy the file instead";
const isManifest = (entry) => entry.kind !== "directory" && basename(entry.path) === "SKILL.md";
function append(lists, key, value) {
	const list = lists.get(key);
	if (list === void 0) lists.set(key, [value]);
	else list.push(value);
}
function representableUri(uriOf, path) {
	let uri;
	try {
		uri = uriOf(path);
	} catch (error) {
		if (error instanceof URIError) return void 0;
		throw error;
	}
	return isRoundTripUri(uri) ? uri : void 0;
}
async function walk(files) {
	const tree = [];
	const visit = async (dir) => {
		let entries;
		try {
			entries = await files.list(dir);
		} catch (error) {
			throw new SkillCatalogError([{
				path: dir === "" ? "." : dir,
				message: `cannot be listed: ${errorText$1(error)}`
			}]);
		}
		for (const entry of entries.toSorted((a, b) => compareUris(a.name, b.name))) {
			if (entry.name.startsWith(".")) continue;
			const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
			tree.push({
				path,
				kind: entry.kind
			});
			if (entry.kind === "directory") await visit(path);
		}
	};
	await visit("");
	return tree;
}
async function readFile(files, path) {
	try {
		return await files.read(path);
	} catch (error) {
		throw new SkillCatalogError([{
			path,
			message: `cannot be read: ${errorText$1(error)}`
		}]);
	}
}
async function buildCatalogSnapshot(files, options) {
	const tree = await walk(files);
	const problems = [];
	const report = (warning) => {
		if (options.strict) problems.push(warning);
		else options.warn(warning);
	};
	const uriOf = (path) => joinUri("skill://", [...options.prefix, ...path.split("/")]);
	for (const entry of tree) {
		const name = basename(entry.path);
		if (entry.kind === "file" && name !== "SKILL.md" && name.toLowerCase() === "skill.md") options.warn({
			path: entry.path,
			message: "did you mean SKILL.md? File names are case-sensitive"
		});
	}
	const skillDirs = new Set(tree.filter((entry) => isManifest(entry)).map((entry) => dirname(entry.path)));
	const insideOf = /* @__PURE__ */ new Map();
	for (const entry of tree) {
		let inSkill = false;
		for (let dir = dirname(entry.path); dir !== ""; dir = dirname(dir)) {
			if (!skillDirs.has(dir)) continue;
			inSkill = true;
			append(insideOf, dir, entry);
		}
		if (!inSkill && entry.kind === "unsupported" && !isManifest(entry)) report({
			path: entry.path,
			message: `${NOT_FOLLOWED} (skipped)`
		});
	}
	const built = [];
	const hashed = /* @__PURE__ */ new Map();
	const manifests = tree.filter((entry) => isManifest(entry)).toSorted((a, b) => b.path.split("/").length - a.path.split("/").length);
	for (const entry of manifests) {
		const dir = dirname(entry.path);
		if (dir === "") {
			report({
				path: entry.path,
				message: "a SKILL.md at the root has no skill path; point loadSkills (or your adapter) at its parent folder (skipped)"
			});
			continue;
		}
		const skill = await buildOne(files, insideOf.get(dir) ?? [], dir, uriOf, options, report, hashed);
		if (skill !== void 0) built.push(skill);
	}
	if (problems.length > 0) throw new SkillCatalogError(problems);
	if (built.length === 0) options.warn({
		path: ".",
		message: "no skills found (a skill is a folder containing SKILL.md)"
	});
	return assemble(built, tree, uriOf);
}
async function buildOne(files, inside, dir, uriOf, options, report, hashed) {
	const unsupported = inside.find((entry) => entry.kind === "unsupported");
	if (unsupported !== void 0) {
		report({
			path: unsupported.path,
			message: `${NOT_FOLLOWED} (skill skipped)`
		});
		return;
	}
	const manifestPath = `${dir}/SKILL.md`;
	const manifest = [];
	const catalogFiles = [];
	for (const entry of inside) {
		const uri = representableUri(uriOf, entry.path);
		if (uri === void 0) {
			report({
				path: entry.path,
				message: "this name cannot be represented in a URI (skill skipped)"
			});
			return;
		}
		if (entry.kind !== "file") continue;
		const own = entry.path === manifestPath;
		let file = own ? void 0 : hashed.get(entry.path);
		if (file === void 0) {
			const bytes = await readFile(files, entry.path);
			if (own) manifest.push({
				uri,
				bytes
			});
			file = {
				digest: await sha256Digest(bytes),
				size: bytes.byteLength
			};
			hashed.set(entry.path, file);
		}
		catalogFiles.push({
			path: entry.path,
			uri,
			...file,
			mimeType: mimeTypeFor(basename(entry.path))
		});
	}
	const parsed = await buildSkillEntry(uriOf(manifestPath), manifest);
	const resources = catalogFiles.map(({ uri, digest, size }) => ({
		uri,
		digest,
		size
	})).toSorted((a, b) => compareUris(a.uri, b.uri));
	const skill = parsed.skill === void 0 ? void 0 : {
		...parsed.skill,
		resources
	};
	const problems = skill === void 0 ? parsed.problems : validateSkillEntry(skill);
	if (skill === void 0 || problems.length > 0) {
		for (const message of problems) report({
			path: manifestPath,
			message: `${message} (skill skipped)`
		});
		return;
	}
	let totalBytes = 0;
	for (const file of catalogFiles) totalBytes += file.size;
	if (catalogFiles.length > options.limits.files || totalBytes > options.limits.bytes) {
		const remedy = options.strict ? "Raise limits to allow it" : "Set strict: true to fail instead, or raise limits";
		report({
			path: dir,
			message: `${catalogFiles.length} files / ${totalBytes} bytes exceeds the limit of ${options.limits.files} files / ${options.limits.bytes} bytes; some hosts may decline it. ${remedy}`
		});
	}
	return {
		dir,
		skill,
		files: catalogFiles,
		manifestSize: catalogFiles.find((file) => file.path === manifestPath)?.size ?? 0,
		inside
	};
}
function deepFreeze(value) {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const item of Object.values(value)) deepFreeze(item);
	}
	return value;
}
function assemble(built, tree, uriOf) {
	const ordered = Object.freeze(built.map((item) => deepFreeze(item.skill)).toSorted((a, b) => compareUris(a.uri, b.uri)));
	const files = /* @__PURE__ */ new Map();
	const dirPaths = /* @__PURE__ */ new Set();
	for (const item of built) {
		for (const file of item.files) files.set(file.uri, file);
		dirPaths.add(item.dir);
		for (const entry of item.inside) if (entry.kind === "directory") dirPaths.add(entry.path);
	}
	const childrenOf = /* @__PURE__ */ new Map();
	for (const entry of tree) append(childrenOf, dirname(entry.path), entry);
	const dirs = /* @__PURE__ */ new Map();
	for (const dirPath of dirPaths) {
		const children = [];
		for (const entry of childrenOf.get(dirPath) ?? []) {
			if (entry.kind === "directory") {
				children.push({
					uri: uriOf(entry.path),
					name: basename(entry.path),
					mimeType: _modelcontextprotocol_core_ext_skills.DIRECTORY_MIME_TYPE
				});
				continue;
			}
			const file = files.get(uriOf(entry.path));
			if (entry.kind === "file" && file !== void 0) children.push({
				uri: file.uri,
				name: basename(entry.path),
				mimeType: file.mimeType,
				size: file.size
			});
		}
		children.sort((a, b) => compareUris(a.uri, b.uri));
		dirs.set(uriOf(dirPath), children);
	}
	const listed = built.map((item) => ({
		uri: item.skill.uri,
		name: item.skill.frontmatter.name,
		description: item.skill.frontmatter.description,
		mimeType: "text/markdown",
		size: item.manifestSize
	})).toSorted((a, b) => compareUris(a.uri, b.uri));
	return {
		ordered,
		skills: new Map(ordered.map((skill) => [skill.uri, skill])),
		files,
		dirs,
		listed
	};
}

//#endregion
//#region src/ext/skills/internal.ts
const trustedSources = /* @__PURE__ */ new WeakSet();

//#endregion
//#region src/ext/skills/paging.ts
const CURSOR_PREFIX = "after:";
function encodeCursor(uri) {
	return encodeBase64(encodeUtf8(CURSOR_PREFIX + uri)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decodeCursor(cursor) {
	try {
		const base64 = cursor.replaceAll("-", "+").replaceAll("_", "/");
		const decoded = decodeUtf8Lossless(decodeBase64(base64 + "=".repeat((4 - base64.length % 4) % 4)));
		return decoded?.startsWith(CURSOR_PREFIX) ? decoded.slice(6) : void 0;
	} catch {
		return;
	}
}
function paginate(items, cursor, pageSize, key) {
	let start = 0;
	if (cursor !== void 0) {
		const after = decodeCursor(cursor);
		if (after === void 0) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, "Invalid cursor");
		start = items.findIndex((item) => compareUris(key(item), after) > 0);
		if (start === -1) start = items.length;
	}
	const end = Math.min(items.length, start + pageSize);
	const page = items.slice(start, end);
	const last = page.at(-1);
	return end < items.length && last !== void 0 ? {
		items: page,
		nextCursor: encodeCursor(key(last))
	} : { items: page };
}
function resolvePageSize(pageSize) {
	if (pageSize === void 0) return 100;
	if (pageSize === Number.POSITIVE_INFINITY || Number.isSafeInteger(pageSize) && pageSize > 0) return pageSize;
	throw new RangeError(`pageSize must be a positive integer or Infinity (got ${pageSize})`);
}

//#endregion
//#region src/ext/skills/catalogSource.ts
const errorText = (error) => error instanceof Error ? error.message : String(error);
function catalogSource(state, files, pageSize, warn) {
	const source = {
		async list({ cursor }) {
			const page = paginate(state.current.ordered, cursor, pageSize, (skill) => skill.uri);
			return page.nextCursor === void 0 ? { skills: page.items } : {
				skills: page.items,
				nextCursor: page.nextCursor
			};
		},
		async get(uri) {
			const canonical = canonicalUri(uri);
			return canonical === void 0 ? void 0 : state.current.skills.get(canonical);
		},
		read: (uri) => readChecked(state.current, files, uri, warn),
		async readDirectory(uri, { cursor }) {
			const canonical = canonicalUri(uri);
			const children = canonical === void 0 ? void 0 : state.current.dirs.get(canonical);
			if (children === void 0) return;
			const page = paginate(children, cursor, pageSize, (child) => child.uri);
			return page.nextCursor === void 0 ? { resources: page.items } : {
				resources: page.items,
				nextCursor: page.nextCursor
			};
		},
		async listResources() {
			return [...state.current.listed];
		}
	};
	trustedSources.add(source);
	return source;
}
async function readChecked(snapshot, files, uri, warn) {
	const canonical = canonicalUri(uri);
	const file = canonical === void 0 ? void 0 : snapshot.files.get(canonical);
	if (file === void 0) {
		if (canonical !== void 0 && snapshot.dirs.has(canonical)) throw new require_src.ResourceNotFoundError(uri, `${uri} is a directory; use resources/directory/read`);
		return;
	}
	let bytes;
	try {
		bytes = await files.read(file.path);
	} catch (error) {
		warn({
			path: file.path,
			message: `could not be read: ${errorText(error)}`
		});
		throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, `${uri} could not be read`);
	}
	if (bytes.byteLength !== file.size || await sha256Digest(bytes) !== file.digest) {
		warn({
			path: file.path,
			message: "changed since the catalog was loaded; call reload()"
		});
		throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, `${uri} changed since the skills catalog was loaded`);
	}
	const text = decodeUtf8Lossless(bytes);
	return text === void 0 ? {
		bytes,
		mimeType: file.mimeType
	} : {
		text,
		mimeType: file.mimeType
	};
}

//#endregion
//#region src/ext/skills/files.ts
function splitRelativePath(path, label) {
	const segments = path.split("/").filter((segment) => segment !== "" && segment !== ".");
	if (segments.length === 0 || segments.includes("..")) throw new TypeError(`${label} must be a relative path without ".." (got ${JSON.stringify(path)})`);
	return segments;
}
function indexRecord(keys) {
	const dirs = /* @__PURE__ */ new Map();
	const files = /* @__PURE__ */ new Map();
	for (const key of keys) {
		const segments = splitRelativePath(key, "file path");
		let dir = "";
		for (const [depth, name] of segments.entries()) {
			let children = dirs.get(dir);
			if (children === void 0) {
				children = /* @__PURE__ */ new Map();
				dirs.set(dir, children);
			}
			children.set(name, {
				name,
				kind: depth < segments.length - 1 ? "directory" : "file"
			});
			dir = dir === "" ? name : `${dir}/${name}`;
		}
		files.set(dir, key);
	}
	return {
		dirs,
		files
	};
}
/**
* An in-memory adapter. The record is re-read whenever a walk starts — `list('')` — so `reload()` sees later changes.
* Other calls use the index from that read (built on first use if no walk has started), so their cost does not grow
* with the record. File contents are always read live.
*/
function memorySkillFiles(files) {
	let index;
	const reindex = () => {
		index = indexRecord(Object.keys(files));
		return index;
	};
	return {
		async list(dir) {
			const children = (dir === "" ? reindex() : index ?? reindex()).dirs.get(dir);
			if (children !== void 0) return Array.from(children.values(), (entry) => ({ ...entry }));
			if (dir === "") return [];
			throw new Error(`no such directory: ${dir}`);
		},
		async read(path) {
			const key = Object.hasOwn(files, path) ? path : (index ?? reindex()).files.get(path);
			const content = key === void 0 ? void 0 : files[key];
			if (content === void 0) throw new Error(`no such file: ${path}`);
			return typeof content === "string" ? encodeUtf8(content) : content;
		}
	};
}

//#endregion
//#region src/ext/skills/extension.ts
const SCHEME_URI = /^[a-z][\d+.a-z-]*:\/\//i;
function describeEntry(value) {
	const uri = value?.uri;
	return typeof uri === "string" ? uri : "(entry without a uri)";
}
function toContents(uri, result) {
	const mimeType = result.mimeType === void 0 ? {} : { mimeType: result.mimeType };
	return "text" in result ? {
		uri,
		...mimeType,
		text: result.text
	} : {
		uri,
		...mimeType,
		blob: encodeBase64(result.bytes)
	};
}
const skillsServers = /* @__PURE__ */ new WeakSet();
const afterAttach = /* @__PURE__ */ new WeakMap();
const ONE_PER_SERVER = "another skills extension is already attached to this server; attach one per server (to serve several folders or sources, combine them behind one SkillFiles adapter or SkillSource)";
/**
* The MCP Skills extension (SEP-2640) for one catalog of skills. One instance
* serves any number of servers: call {@linkcode SkillsExtension.attach} on each
* (before connecting). Build it from a {@linkcode SkillSource}, or with
* `SkillsExtension.load(files)` from storage.
*/
var SkillsExtension = class {
	id = _modelcontextprotocol_core_ext_skills.SKILLS_EXTENSION_ID;
	#source;
	#trusted;
	#baseRoot;
	#cacheHint;
	#cache;
	#strict;
	#warn;
	#attached = /* @__PURE__ */ new WeakSet();
	/**
	* Builds a catalog from storage through a {@linkcode SkillFiles} adapter
	* (`memorySkillFiles`, `nodeSkillFiles`, or your own).
	*/
	static load(files, options) {
		return SkillCatalog.load(files, options);
	}
	constructor(options) {
		if (options.cacheHint !== void 0) require_src.assertValidCacheHint(options.cacheHint, "skills cacheHint");
		const baseUri = options.baseUri ?? "skill://";
		const canonical = SCHEME_URI.test(baseUri) ? canonicalUri(baseUri) : void 0;
		if (canonical === void 0) throw new TypeError(`baseUri must be a "scheme://…" URI (got ${JSON.stringify(baseUri)})`);
		this.#baseRoot = canonical.endsWith("://") ? canonical : `${trimTrailingSlashes(canonical)}/`;
		this.#source = options.source;
		this.#trusted = trustedSources.has(options.source);
		this.#cacheHint = options.cacheHint;
		this.#cache = {
			ttlMs: options.cacheHint?.ttlMs ?? 0,
			cacheScope: options.cacheHint?.cacheScope ?? "private"
		};
		this.#strict = options.strict ?? false;
		this.#warn = options.onWarning ?? defaultWarn;
	}
	/**
	* Serves these skills on `mcp`: registers the skill resource template and
	* the skills methods, then declares the capability. Must run before
	* connecting. Calling it again for the same server does nothing. One
	* skills extension per server: attaching another one throws and leaves the
	* server as it was, as does attaching to a server that already handles one
	* of the skills methods.
	*
	* @experimental How an extension is wired to a server may change in a minor release.
	*/
	attach(mcp) {
		if (this.#attached.has(mcp)) return;
		if (mcp.isConnected()) throw new Error("attach skills before connecting the server");
		if (skillsServers.has(mcp)) throw new Error(ONE_PER_SERVER);
		const server = mcp.server;
		const directoryRead = this.#source.readDirectory !== void 0;
		const list = this.#source.listResources === void 0 ? void 0 : (ctx) => this.#listResources(ctx);
		server.assertCanSetRequestHandler(_modelcontextprotocol_core_ext_skills.SKILLS_LIST_METHOD);
		server.assertCanSetRequestHandler(_modelcontextprotocol_core_ext_skills.SKILLS_GET_METHOD);
		if (directoryRead) server.assertCanSetRequestHandler(_modelcontextprotocol_core_ext_skills.RESOURCES_DIRECTORY_READ_METHOD);
		mcp.registerResource(_modelcontextprotocol_core_ext_skills.SKILLS_EXTENSION_ID, new require_mcp.ResourceTemplate(`${this.#baseRoot}{+path}`, { list }), this.#cacheHint === void 0 ? {} : { cacheHint: this.#cacheHint }, (uri, _variables, ctx) => this.#read(uri, ctx));
		server.setRequestHandler(_modelcontextprotocol_core_ext_skills.SKILLS_LIST_METHOD, { params: _modelcontextprotocol_core_ext_skills.ListSkillsRequestParamsSchema }, (params, ctx) => this.#list(server, params.cursor, ctx));
		server.setRequestHandler(_modelcontextprotocol_core_ext_skills.SKILLS_GET_METHOD, { params: _modelcontextprotocol_core_ext_skills.GetSkillRequestParamsSchema }, (params, ctx) => this.#get(server, params.uri, ctx));
		if (directoryRead) server.setRequestHandler(_modelcontextprotocol_core_ext_skills.RESOURCES_DIRECTORY_READ_METHOD, { params: _modelcontextprotocol_core_ext_skills.ReadResourceDirectoryRequestParamsSchema }, (params, ctx) => this.#readDirectory(server, params.uri, params.cursor, ctx));
		server.registerCapabilities({ extensions: { [_modelcontextprotocol_core_ext_skills.SKILLS_EXTENSION_ID]: directoryRead ? { directoryRead: true } : {} } });
		this.#attached.add(mcp);
		skillsServers.add(mcp);
		afterAttach.get(this)?.(mcp);
	}
	#cacheFields(server) {
		return require_src.isModernProtocolVersion(server.getNegotiatedProtocolVersion() ?? "") ? { ...this.#cache } : {};
	}
	#keepValid(skills) {
		if (this.#trusted) return [...skills];
		const kept = [];
		for (const candidate of skills) {
			const problems = skillEntryProblems(candidate);
			if (problems.length === 0) {
				kept.push(candidate);
				continue;
			}
			const message = `invalid skill entry from the source: ${problems.join("; ")}`;
			if (this.#strict) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, `${describeEntry(candidate)}: ${message}`);
			this.#warn({
				path: describeEntry(candidate),
				message: `${message} (dropped from skills/list)`
			});
		}
		return kept;
	}
	async #list(server, cursor, ctx) {
		const page = await this.#source.list(cursor === void 0 ? {} : { cursor }, ctx);
		return {
			skills: this.#keepValid(page.skills),
			...page.nextCursor === void 0 ? {} : { nextCursor: page.nextCursor },
			...this.#cacheFields(server)
		};
	}
	async #get(server, uri, ctx) {
		const skill = await this.#source.get(uri, ctx);
		if (skill === void 0) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `No skill is served at ${uri}`);
		if (!this.#trusted) {
			const problems = skillEntryProblems(skill);
			if (problems.length > 0) {
				const message = `invalid skill entry from the source: ${problems.join("; ")}`;
				this.#warn({
					path: uri,
					message
				});
				throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, message);
			}
		}
		if (canonicalUri(skill.uri) !== canonicalUri(uri)) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InternalError, `the skill source returned ${skill.uri} for ${uri}`);
		return {
			skill,
			...this.#cacheFields(server)
		};
	}
	async #read(uri, ctx) {
		const result = await this.#source.read(uri.href, ctx);
		if (result === void 0) throw new require_src.ResourceNotFoundError(uri.href);
		return { contents: [toContents(uri.href, result)] };
	}
	async #readDirectory(server, uri, cursor, ctx) {
		const page = await this.#source.readDirectory(uri, cursor === void 0 ? {} : { cursor }, ctx);
		if (page === void 0) throw new require_src.ProtocolError(require_src.ProtocolErrorCode.InvalidParams, `${uri} is not a directory resource`);
		return {
			resources: page.resources,
			...page.nextCursor === void 0 ? {} : { nextCursor: page.nextCursor },
			...this.#cacheFields(server)
		};
	}
	async #listResources(ctx) {
		const resources = await this.#source.listResources(ctx);
		const kept = [];
		for (const resource of resources) if (canonicalUri(resource.uri)?.startsWith(this.#baseRoot)) kept.push(resource);
		else this.#warn({
			path: resource.uri,
			message: `listResources returned a URI outside ${this.#baseRoot}; dropped from resources/list`
		});
		return { resources: kept };
	}
};
const PRUNE_THRESHOLD = 1024;
function resolveLimits(limits) {
	const resolved = {
		files: limits?.files ?? _modelcontextprotocol_core_ext_skills.SKILL_LIMITS.files,
		bytes: limits?.bytes ?? _modelcontextprotocol_core_ext_skills.SKILL_LIMITS.bytes
	};
	for (const [name, value] of Object.entries(resolved)) if (value !== Number.POSITIVE_INFINITY && !(Number.isSafeInteger(value) && value > 0)) throw new RangeError(`limits.${name} must be a positive integer or Infinity (got ${value})`);
	return resolved;
}
function listingKey(snapshot) {
	return JSON.stringify(snapshot.listed.map((resource) => [
		resource.uri,
		resource.name,
		resource.description
	]));
}
function diffSnapshots(previous, next) {
	const same = (uri) => JSON.stringify(previous.skills.get(uri)) === JSON.stringify(next.skills.get(uri));
	return {
		added: [...next.skills.keys()].filter((uri) => !previous.skills.has(uri)),
		removed: [...previous.skills.keys()].filter((uri) => !next.skills.has(uri)),
		changed: [...next.skills.keys()].filter((uri) => previous.skills.has(uri) && !same(uri))
	};
}
/**
* A catalog the SDK built from storage. It holds metadata only: every file
* read goes through the adapter and is checked against the published entry.
*/
var SkillCatalog = class SkillCatalog extends SkillsExtension {
	#state;
	#files;
	#build;
	#servers = /* @__PURE__ */ new Set();
	#pruneAt = PRUNE_THRESHOLD;
	#queue = Promise.resolve();
	constructor(init) {
		super(init.sourceOptions);
		this.#state = init.state;
		this.#files = init.files;
		this.#build = init.build;
		afterAttach.set(this, (mcp) => this.#track(mcp));
	}
	static async load(files, options = {}) {
		const pageSize = resolvePageSize(options.pageSize);
		const build = {
			prefix: options.prefix === void 0 ? [] : splitRelativePath(options.prefix, "prefix"),
			limits: resolveLimits(options.limits),
			strict: options.strict ?? false,
			warn: options.onWarning ?? defaultWarn
		};
		const state = { current: await buildCatalogSnapshot(files, build) };
		return new SkillCatalog({
			state,
			files,
			build,
			sourceOptions: {
				source: catalogSource(state, files, pageSize, build.warn),
				baseUri: build.prefix.length === 0 ? "skill://" : joinUri("skill://", build.prefix),
				cacheHint: options.cacheHint,
				strict: options.strict,
				onWarning: build.warn
			}
		});
	}
	/** The skills this catalog serves, sorted by URI. Frozen (deeply): they are exactly what clients receive. */
	get entries() {
		return this.#state.current.ordered;
	}
	/**
	* Scans the storage again and swaps the new catalog in at once. All or
	* nothing: on failure the old catalog keeps serving. Overlapping calls run
	* one after another.
	*
	* When skills are added or removed, or a `SKILL.md`'s name or description
	* changes, the result has `listChanged: true` and `resources/list_changed`
	* goes out through every attached server that is still connected (stdio,
	* stateful 2025-11-25 HTTP sessions). Servers that `createMcpHandler` builds per
	* request are closed by then, so publish the change on the handler:
	* `if (changes.listChanged) handler.notify.resourcesChanged()`. Where the
	* runtime has no `WeakRef` (Cloudflare Workers with a compatibility date
	* before 2025-05-05), attached servers are not tracked and nothing is sent.
	*/
	reload() {
		const run = this.#queue.then(() => this.#reloadNow());
		this.#queue = run.then(() => {}, () => {});
		return run;
	}
	#track(mcp) {
		if (typeof WeakRef !== "function") return;
		if (this.#servers.size >= this.#pruneAt) {
			for (const reference of this.#servers) if (reference.deref() === void 0) this.#servers.delete(reference);
			this.#pruneAt = Math.max(PRUNE_THRESHOLD, 2 * this.#servers.size);
		}
		this.#servers.add(new WeakRef(mcp));
	}
	async #reloadNow() {
		const previous = this.#state.current;
		const next = await buildCatalogSnapshot(this.#files, this.#build);
		this.#state.current = next;
		const listChanged = listingKey(previous) !== listingKey(next);
		if (listChanged) this.#notify();
		return {
			...diffSnapshots(previous, next),
			listChanged
		};
	}
	#notify() {
		for (const reference of this.#servers) {
			const mcp = reference.deref();
			if (mcp === void 0) {
				this.#servers.delete(reference);
				continue;
			}
			if (!mcp.isConnected()) continue;
			const sessionId = mcp.server.transport?.sessionId;
			try {
				Promise.resolve(mcp.server.sendResourceListChanged()).catch((error) => this.#notifyFailed(sessionId, error));
			} catch (error) {
				this.#notifyFailed(sessionId, error);
			}
		}
	}
	#notifyFailed(sessionId, error) {
		const to = sessionId === void 0 ? "" : ` to session ${sessionId}`;
		const reason = error instanceof Error ? error.message : String(error);
		try {
			this.#build.warn({
				path: "resources/list_changed",
				message: `could not be sent${to}: ${reason}`
			});
		} catch {}
	}
};

//#endregion
Object.defineProperty(exports, 'SkillCatalog', {
  enumerable: true,
  get: function () {
    return SkillCatalog;
  }
});
Object.defineProperty(exports, 'SkillCatalogError', {
  enumerable: true,
  get: function () {
    return SkillCatalogError;
  }
});
Object.defineProperty(exports, 'SkillsExtension', {
  enumerable: true,
  get: function () {
    return SkillsExtension;
  }
});
Object.defineProperty(exports, 'buildSkillEntry', {
  enumerable: true,
  get: function () {
    return buildSkillEntry;
  }
});
Object.defineProperty(exports, 'encodeUtf8', {
  enumerable: true,
  get: function () {
    return encodeUtf8;
  }
});
Object.defineProperty(exports, 'joinUri', {
  enumerable: true,
  get: function () {
    return joinUri;
  }
});
Object.defineProperty(exports, 'memorySkillFiles', {
  enumerable: true,
  get: function () {
    return memorySkillFiles;
  }
});
Object.defineProperty(exports, 'splitRelativePath', {
  enumerable: true,
  get: function () {
    return splitRelativePath;
  }
});
//# sourceMappingURL=extension-Co9uP6Ds.cjs.map