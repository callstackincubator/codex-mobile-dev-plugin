import { t as __exportAll } from "./chunk-15K8U1wQ.mjs";
import { unionWith } from "eslint-visitor-keys";

//#region src/internal-utils/index.ts
/**
* Get the last element from given array
*/
function last(arr) {
	return arr[arr.length - 1] ?? null;
}
/**
* Node to key name
*/
function toKeyName(node) {
	return node.type === "TOMLBare" ? node.name : node.value;
}

//#endregion
//#region src/parser-options.ts
var TOMLVerImpl = class {
	constructor(major, minor) {
		this.major = major;
		this.minor = minor;
	}
	lt(major, minor) {
		return this.major < major || this.major === major && this.minor < minor;
	}
	gte(major, minor) {
		return this.major > major || this.major === major && this.minor >= minor;
	}
};
const TOML_VERSION_1_0 = new TOMLVerImpl(1, 0);
const TOML_VERSION_1_1 = new TOMLVerImpl(1, 1);
const DEFAULT_TOML_VERSION = TOML_VERSION_1_1;
const SUPPORTED_TOML_VERSIONS = {
	"1.0": TOML_VERSION_1_0,
	"1.0.0": TOML_VERSION_1_0,
	"1.1": TOML_VERSION_1_1,
	"1.1.0": TOML_VERSION_1_1,
	latest: TOML_VERSION_1_1,
	next: TOML_VERSION_1_1
};
/**
* Get TOML version object from given TOML version string.
*/
function getTOMLVer(v) {
	return v && SUPPORTED_TOML_VERSIONS[v] || DEFAULT_TOML_VERSION;
}

//#endregion
//#region src/errors.ts
const MESSAGES = {
	"unterminated-string": "Unterminated string constant",
	"unterminated-table-key": "Unterminated table-key",
	"unterminated-array": "Unterminated array",
	"unterminated-inline-table": "Unterminated inline table",
	"missing-key": "Empty bare keys are not allowed",
	"missing-newline": "Must be a newline",
	"missing-equals-sign": "Expected equal (=) token",
	"missing-value": "Unspecified values are invalid",
	"missing-comma": "Expected comma (,) token",
	"dupe-keys": "Defining a key multiple times is invalid",
	"unexpected-char": "Unexpected character",
	"unexpected-token": "Unexpected token",
	"invalid-control-character": "Control characters (codes < 0x1f and 0x7f) are not allowed",
	"invalid-comment-character": "Invalid code point {{cp}} within comments",
	"invalid-key-value-newline": "The key, equals sign, and value must be on the same line",
	"invalid-inline-table-newline": "No newlines are allowed between the curly braces unless they are valid within a value",
	"invalid-underscore": "Underscores are allowed between digits",
	"invalid-space": "Unexpected spaces",
	"invalid-three-quotes": "Three or more quotes are not permitted",
	"invalid-date": "Unexpected invalid date",
	"invalid-time": "Unexpected invalid time",
	"invalid-leading-zero": "Leading zeros are not allowed",
	"invalid-trailing-comma-in-inline-table": "Trailing comma is not permitted in an inline table",
	"invalid-char-in-escape-sequence": "Invalid character in escape sequence",
	"invalid-consecutive-dots-in-key": "Consecutive dots are not permitted in keys",
	"invalid-code-point": "Invalid code point {{cp}}",
	"invalid-trailing-dot-in-key": "Keys cannot end with a dot",
	"invalid-leading-dot-in-key": "Keys cannot start with a dot"
};
/**
* Get message from error code
*/
function getMessage(code, data) {
	if (data) return MESSAGES[code].replace(/\{\{(.*?)\}\}/gu, (_, name$2) => {
		if (name$2 in data) return data[name$2];
		return `{{${name$2}}}`;
	});
	return MESSAGES[code];
}
/**
* TOML parse errors.
*/
var ParseError = class extends SyntaxError {
	/**
	* Initialize this ParseError instance.
	*
	*/
	constructor(code, offset, line, column, data) {
		super(getMessage(code, data));
		this.index = offset;
		this.lineNumber = line;
		this.column = column;
	}
};

//#endregion
//#region src/tokenizer/code-point.ts
const CodePoint = {
	EOF: -1,
	NULL: 0,
	SOH: 1,
	BACKSPACE: 8,
	TABULATION: 9,
	LINE_FEED: 10,
	FORM_FEED: 12,
	CARRIAGE_RETURN: 13,
	ESCAPE: 27,
	SO: 14,
	US: 31,
	SPACE: 32,
	QUOTATION_MARK: 34,
	HASH: 35,
	SINGLE_QUOTE: 39,
	PLUS_SIGN: 43,
	COMMA: 44,
	DASH: 45,
	DOT: 46,
	DIGIT_0: 48,
	DIGIT_1: 49,
	DIGIT_2: 50,
	DIGIT_3: 51,
	DIGIT_7: 55,
	DIGIT_9: 57,
	COLON: 58,
	EQUALS_SIGN: 61,
	LATIN_CAPITAL_A: 65,
	LATIN_CAPITAL_E: 69,
	LATIN_CAPITAL_F: 70,
	LATIN_CAPITAL_T: 84,
	LATIN_CAPITAL_U: 85,
	LATIN_CAPITAL_Z: 90,
	LEFT_BRACKET: 91,
	BACKSLASH: 92,
	RIGHT_BRACKET: 93,
	UNDERSCORE: 95,
	LATIN_SMALL_A: 97,
	LATIN_SMALL_B: 98,
	LATIN_SMALL_E: 101,
	LATIN_SMALL_F: 102,
	LATIN_SMALL_I: 105,
	LATIN_SMALL_L: 108,
	LATIN_SMALL_N: 110,
	LATIN_SMALL_O: 111,
	LATIN_SMALL_R: 114,
	LATIN_SMALL_S: 115,
	LATIN_SMALL_T: 116,
	LATIN_SMALL_U: 117,
	LATIN_SMALL_X: 120,
	LATIN_SMALL_Z: 122,
	LEFT_BRACE: 123,
	RIGHT_BRACE: 125,
	TILDE: 126,
	DELETE: 127,
	PAD: 128,
	SUPERSCRIPT_TWO: 178,
	SUPERSCRIPT_THREE: 179,
	SUPERSCRIPT_ONE: 185,
	VULGAR_FRACTION_ONE_QUARTER: 188,
	VULGAR_FRACTION_THREE_QUARTERS: 190,
	LATIN_CAPITAL_LETTER_A_WITH_GRAVE: 192,
	LATIN_CAPITAL_LETTER_O_WITH_DIAERESIS: 214,
	LATIN_CAPITAL_LETTER_O_WITH_STROKE: 216,
	LATIN_SMALL_LETTER_O_WITH_DIAERESIS: 246,
	LATIN_SMALL_LETTER_O_WITH_STROKE: 248,
	GREEK_SMALL_REVERSED_DOTTED_LUNATE_SIGMA_SYMBOL: 891,
	GREEK_CAPITAL_LETTER_YOT: 895,
	CP_1FFF: 8191,
	ZERO_WIDTH_NON_JOINER: 8204,
	ZERO_WIDTH_JOINER: 8205,
	UNDERTIE: 8255,
	CHARACTER_TIE: 8256,
	SUPERSCRIPT_ZERO: 8304,
	CP_218F: 8591,
	CIRCLED_DIGIT_ONE: 9312,
	NEGATIVE_CIRCLED_DIGIT_ZERO: 9471,
	GLAGOLITIC_CAPITAL_LETTER_AZU: 11264,
	CP_2FEF: 12271,
	IDEOGRAPHIC_COMMA: 12289,
	CP_D7FF: 55295,
	CP_E000: 57344,
	CJK_COMPATIBILITY_IDEOGRAPH_F900: 63744,
	ARABIC_LIGATURE_SALAAMUHU_ALAYNAA: 64975,
	ARABIC_LIGATURE_SALLA_USED_AS_KORANIC_STOP_SIGN_ISOLATED_FORM: 65008,
	REPLACEMENT_CHARACTER: 65533,
	LINEAR_B_SYLLABLE_B008_A: 65536,
	CP_EFFFF: 983039,
	CP_10FFFF: 1114111
};
/**
* Check whether the code point is a control character.
*/
function isControl(cp) {
	return cp >= CodePoint.NULL && cp <= CodePoint.US;
}
/**
* Check whether the code point is a whitespace.
*/
function isWhitespace(cp) {
	return cp === CodePoint.TABULATION || cp === CodePoint.SPACE;
}
/**
* Check whether the code point is a end of line.
*/
function isEOL(cp) {
	return cp === CodePoint.LINE_FEED || cp === CodePoint.CARRIAGE_RETURN;
}
/**
* Check whether the code point is an uppercase letter character.
*/
function isUpperLetter(cp) {
	return cp >= CodePoint.LATIN_CAPITAL_A && cp <= CodePoint.LATIN_CAPITAL_Z;
}
/**
* Check whether the code point is a lowercase letter character.
*/
function isLowerLetter(cp) {
	return cp >= CodePoint.LATIN_SMALL_A && cp <= CodePoint.LATIN_SMALL_Z;
}
/**
* Check whether the code point is a letter character.
*/
function isLetter(cp) {
	return isLowerLetter(cp) || isUpperLetter(cp);
}
/**
* Check whether the code point is a digit character.
*/
function isDigit(cp) {
	return cp >= CodePoint.DIGIT_0 && cp <= CodePoint.DIGIT_9;
}
/**
* Check whether the code point is a hex digit character.
*/
function isHexDig(cp) {
	return isDigit(cp) || cp >= CodePoint.LATIN_SMALL_A && cp <= CodePoint.LATIN_SMALL_F || cp >= CodePoint.LATIN_CAPITAL_A && cp <= CodePoint.LATIN_CAPITAL_F;
}
/**
* Check whether the code point is a octal digit character.
*/
function isOctalDig(cp) {
	return cp >= CodePoint.DIGIT_0 && cp <= CodePoint.DIGIT_7;
}
/**
* Check whether the code point is valid code point.
*
* see
* - https://unicode.org/glossary/#unicode_scalar_value
* - https://toml.io/en/v1.0.0#string
*/
function isUnicodeScalarValue(cp) {
	return cp >= 0 && cp <= 55295 || cp >= 57344 && cp <= 1114111;
}

//#endregion
//#region src/tokenizer/locs.ts
/**
* Find the last index of the array that is less than or equal to the value.
*/
function sortedLastIndex(array, value) {
	let low = 0;
	let high = array.length;
	while (low < high) {
		const mid = low + high >>> 1;
		const val = array[mid];
		if (val === value) return mid + 1;
		if (val < value) low = mid + 1;
		else high = mid;
	}
	return low;
}
/**
* A class for getting lines and columns location.
*/
var Locations = class {
	constructor() {
		this.offsets = [];
	}
	addOffset(offset) {
		for (let i = this.offsets.length - 1; i >= 0; i--) {
			const element = this.offsets[i];
			if (element === offset) return;
			if (element < offset) break;
		}
		this.offsets.push(offset);
	}
	/**
	* Calculate the location of the given index.
	* @param index The index to calculate their location.
	* @returns The location of the index.
	*/
	getLocFromIndex(offset) {
		const line = sortedLastIndex(this.offsets, offset) + 1;
		return {
			line,
			column: offset - (line === 1 ? 0 : this.offsets[line - 2])
		};
	}
};

//#endregion
//#region src/tokenizer/code-point-iterator.ts
var CodePointIterator = class {
	/**
	* Initialize this char iterator.
	*/
	constructor(text) {
		this.locs = new Locations();
		this.lastCodePoint = CodePoint.NULL;
		this.start = -1;
		this.end = 0;
		this.text = text;
	}
	next() {
		if (this.lastCodePoint === CodePoint.EOF) return CodePoint.EOF;
		return this.lastCodePoint = this.moveAt(this.end);
	}
	getLocFromIndex(index) {
		return this.locs.getLocFromIndex(index);
	}
	eat(cp) {
		if (this.text.codePointAt(this.end) === cp) {
			this.next();
			return true;
		}
		return false;
	}
	moveAt(offset) {
		this.start = this.end = offset;
		const cp = this.text.codePointAt(this.start) ?? CodePoint.EOF;
		if (cp === CodePoint.EOF) {
			this.end = this.start;
			return cp;
		}
		this.end += cp >= 65536 ? 2 : 1;
		if (cp === CodePoint.LINE_FEED) this.locs.addOffset(this.end);
		else if (cp === CodePoint.CARRIAGE_RETURN) {
			if (this.text.codePointAt(this.end) === CodePoint.LINE_FEED) {
				this.end++;
				this.locs.addOffset(this.end);
			}
			return CodePoint.LINE_FEED;
		}
		return cp;
	}
};

//#endregion
//#region src/tokenizer/tokenizer.ts
const HAS_BIGINT = typeof BigInt !== "undefined";
const RADIX_PREFIXES = {
	16: "0x",
	10: "",
	8: "0o",
	2: "0b"
};
const ESCAPES_1_0 = {
	[CodePoint.QUOTATION_MARK]: CodePoint.QUOTATION_MARK,
	[CodePoint.BACKSLASH]: CodePoint.BACKSLASH,
	[CodePoint.LATIN_SMALL_B]: CodePoint.BACKSPACE,
	[CodePoint.LATIN_SMALL_F]: CodePoint.FORM_FEED,
	[CodePoint.LATIN_SMALL_N]: CodePoint.LINE_FEED,
	[CodePoint.LATIN_SMALL_R]: CodePoint.CARRIAGE_RETURN,
	[CodePoint.LATIN_SMALL_T]: CodePoint.TABULATION
};
const ESCAPES_LATEST = {
	...ESCAPES_1_0,
	[CodePoint.LATIN_SMALL_E]: CodePoint.ESCAPE
};
/**
* Tokenizer for TOML.
*/
var Tokenizer = class {
	/**
	* Initialize this tokenizer.
	*/
	constructor(text, parserOptions) {
		this.backCode = false;
		this.lastCodePoint = CodePoint.NULL;
		this.state = "DATA";
		this.token = null;
		this.tokenStart = -1;
		this.valuesEnabled = false;
		this.text = text;
		this.parserOptions = parserOptions || {};
		this.codePointIterator = new CodePointIterator(text);
		this.tomlVersion = getTOMLVer(this.parserOptions.tomlVersion);
		this.ESCAPES = this.tomlVersion.gte(1, 1) ? ESCAPES_LATEST : ESCAPES_1_0;
	}
	get start() {
		return this.codePointIterator.start;
	}
	get end() {
		return this.codePointIterator.end;
	}
	getLocFromIndex(index) {
		return this.codePointIterator.getLocFromIndex(index);
	}
	/**
	* Report an invalid character error.
	*/
	reportParseError(code, data) {
		const offset = this.codePointIterator.start;
		const loc = this.codePointIterator.getLocFromIndex(offset);
		throw new ParseError(code, offset, loc.line, loc.column, data);
	}
	/**
	* Get the next token.
	*/
	nextToken() {
		let token = this.token;
		if (token != null) {
			this.token = null;
			return token;
		}
		let cp = this.lastCodePoint;
		while (cp !== CodePoint.EOF && !this.token) {
			cp = this.nextCode();
			const nextState = this[this.state](cp);
			if (!nextState) throw new Error(`Unknown error: pre state=${this.state}`);
			this.state = nextState;
		}
		token = this.token;
		this.token = null;
		return token;
	}
	/**
	* Get the next code point.
	*/
	nextCode() {
		if (this.lastCodePoint === CodePoint.EOF) return CodePoint.EOF;
		if (this.backCode) {
			this.backCode = false;
			return this.lastCodePoint;
		}
		return this.lastCodePoint = this.codePointIterator.next();
	}
	/**
	* Eat the next code point.
	*/
	eatCode(cp) {
		if (this.lastCodePoint === CodePoint.EOF) return false;
		if (this.backCode) {
			if (this.lastCodePoint === cp) {
				this.backCode = false;
				return true;
			}
			return false;
		}
		return this.codePointIterator.eat(cp);
	}
	/**
	* Moves the character position to the given position.
	*/
	moveAt(loc) {
		if (this.backCode) this.backCode = false;
		this.lastCodePoint = this.codePointIterator.moveAt(loc);
	}
	/**
	* Back the current code point as the given state.
	*/
	back(state) {
		this.backCode = true;
		return state;
	}
	punctuatorToken() {
		this.startToken();
		this.endToken("Punctuator", "end");
	}
	startToken() {
		this.tokenStart = this.codePointIterator.start;
	}
	/**
	* Commit the current token.
	*/
	endToken(type, pos, option1, option2) {
		const { tokenStart } = this;
		const end = this.codePointIterator[pos];
		const range = [tokenStart, end];
		const loc = {
			start: this.codePointIterator.getLocFromIndex(tokenStart),
			end: this.codePointIterator.getLocFromIndex(end)
		};
		if (type === "Block") this.token = {
			type,
			value: this.text.slice(tokenStart + 1, end),
			range,
			loc
		};
		else {
			let token;
			const value = this.text.slice(tokenStart, end);
			if (type === "BasicString" || type === "LiteralString" || type === "MultiLineBasicString" || type === "MultiLineLiteralString") token = {
				type,
				value,
				string: option1,
				range,
				loc
			};
			else if (type === "Integer") {
				const text = option1;
				token = {
					type,
					value,
					number: parseInt(text, option2),
					bigint: HAS_BIGINT ? BigInt(RADIX_PREFIXES[option2] + text) : null,
					range,
					loc
				};
			} else if (type === "Float") token = {
				type,
				value,
				number: option1,
				range,
				loc
			};
			else if (type === "Boolean") token = {
				type,
				value,
				boolean: option1,
				range,
				loc
			};
			else if (type === "LocalDate" || type === "LocalTime" || type === "LocalDateTime" || type === "OffsetDateTime") token = {
				type,
				value,
				date: option1,
				range,
				loc
			};
			else token = {
				type,
				value,
				range,
				loc
			};
			this.token = token;
		}
	}
	DATA(cp) {
		while (isWhitespace(cp) || isEOL(cp)) cp = this.nextCode();
		if (cp === CodePoint.HASH) {
			this.startToken();
			return "COMMENT";
		}
		if (cp === CodePoint.QUOTATION_MARK) {
			this.startToken();
			return "BASIC_STRING";
		}
		if (cp === CodePoint.SINGLE_QUOTE) {
			this.startToken();
			return "LITERAL_STRING";
		}
		if (cp === CodePoint.DOT || cp === CodePoint.EQUALS_SIGN || cp === CodePoint.LEFT_BRACKET || cp === CodePoint.RIGHT_BRACKET || cp === CodePoint.LEFT_BRACE || cp === CodePoint.RIGHT_BRACE || cp === CodePoint.COMMA) {
			this.punctuatorToken();
			return "DATA";
		}
		if (this.valuesEnabled) {
			if (cp === CodePoint.DASH || cp === CodePoint.PLUS_SIGN) {
				this.startToken();
				return "SIGN";
			}
			if (cp === CodePoint.LATIN_SMALL_N || cp === CodePoint.LATIN_SMALL_I) {
				this.startToken();
				return this.back("NAN_OR_INF");
			}
			if (isDigit(cp)) {
				this.startToken();
				return this.back("NUMBER");
			}
			if (cp === CodePoint.LATIN_SMALL_T || cp === CodePoint.LATIN_SMALL_F) {
				this.startToken();
				return this.back("BOOLEAN");
			}
		} else if (isUnquotedKeyChar(cp, this.tomlVersion)) {
			this.startToken();
			return "BARE";
		}
		if (cp === CodePoint.EOF) return "DATA";
		return this.reportParseError("unexpected-char");
	}
	COMMENT(cp) {
		const processCommentChar = this.tomlVersion.gte(1, 1) ? (c) => {
			if (!isNonEOL(c)) this.reportParseError("invalid-comment-character", { cp: JSON.stringify(String.fromCodePoint(c)).slice(1, -1) });
		} : (c) => {
			if (isControlOtherThanTab(c)) this.reportParseErrorControlChar();
		};
		while (!isEOL(cp) && cp !== CodePoint.EOF) {
			processCommentChar(cp);
			cp = this.nextCode();
		}
		this.endToken("Block", "start");
		return "DATA";
	}
	BARE(cp) {
		while (isUnquotedKeyChar(cp, this.tomlVersion)) cp = this.nextCode();
		this.endToken("Bare", "start");
		return this.back("DATA");
	}
	BASIC_STRING(cp) {
		if (cp === CodePoint.QUOTATION_MARK) {
			cp = this.nextCode();
			if (cp === CodePoint.QUOTATION_MARK) return "MULTI_LINE_BASIC_STRING";
			this.endToken("BasicString", "start", "");
			return this.back("DATA");
		}
		const out = [];
		while (cp !== CodePoint.QUOTATION_MARK && cp !== CodePoint.EOF && cp !== CodePoint.LINE_FEED) {
			if (isControlOtherThanTab(cp)) return this.reportParseErrorControlChar();
			if (cp === CodePoint.BACKSLASH) {
				cp = this.nextCode();
				const ecp = this.ESCAPES[cp];
				if (ecp) {
					out.push(ecp);
					cp = this.nextCode();
					continue;
				} else if (cp === CodePoint.LATIN_SMALL_U) {
					const code = this.parseUnicode(4);
					out.push(code);
					cp = this.nextCode();
					continue;
				} else if (cp === CodePoint.LATIN_CAPITAL_U) {
					const code = this.parseUnicode(8);
					out.push(code);
					cp = this.nextCode();
					continue;
				} else if (cp === CodePoint.LATIN_SMALL_X && this.tomlVersion.gte(1, 1)) {
					const code = this.parseUnicode(2);
					out.push(code);
					cp = this.nextCode();
					continue;
				}
				return this.reportParseError("invalid-char-in-escape-sequence");
			}
			out.push(cp);
			cp = this.nextCode();
		}
		if (cp !== CodePoint.QUOTATION_MARK) return this.reportParseError("unterminated-string");
		this.endToken("BasicString", "end", String.fromCodePoint(...out));
		return "DATA";
	}
	MULTI_LINE_BASIC_STRING(cp) {
		const out = [];
		if (cp === CodePoint.LINE_FEED) cp = this.nextCode();
		while (cp !== CodePoint.EOF) {
			if (cp !== CodePoint.LINE_FEED && isControlOtherThanTab(cp)) return this.reportParseErrorControlChar();
			if (cp === CodePoint.QUOTATION_MARK) {
				const startPos = this.codePointIterator.start;
				if (this.eatCode(CodePoint.QUOTATION_MARK) && this.eatCode(CodePoint.QUOTATION_MARK)) {
					if (this.eatCode(CodePoint.QUOTATION_MARK)) {
						out.push(CodePoint.QUOTATION_MARK);
						if (this.eatCode(CodePoint.QUOTATION_MARK)) {
							out.push(CodePoint.QUOTATION_MARK);
							if (this.eatCode(CodePoint.QUOTATION_MARK)) {
								this.moveAt(startPos);
								return this.reportParseError("invalid-three-quotes");
							}
						}
					}
					this.endToken("MultiLineBasicString", "end", String.fromCodePoint(...out));
					return "DATA";
				}
				this.moveAt(startPos);
			}
			if (cp === CodePoint.BACKSLASH) {
				cp = this.nextCode();
				const ecp = this.ESCAPES[cp];
				if (ecp) {
					out.push(ecp);
					cp = this.nextCode();
					continue;
				} else if (cp === CodePoint.LATIN_SMALL_U) {
					const code = this.parseUnicode(4);
					out.push(code);
					cp = this.nextCode();
					continue;
				} else if (cp === CodePoint.LATIN_CAPITAL_U) {
					const code = this.parseUnicode(8);
					out.push(code);
					cp = this.nextCode();
					continue;
				} else if (cp === CodePoint.LATIN_SMALL_X && this.tomlVersion.gte(1, 1)) {
					const code = this.parseUnicode(2);
					out.push(code);
					cp = this.nextCode();
					continue;
				} else if (cp === CodePoint.LINE_FEED) {
					cp = this.nextCode();
					while (isWhitespace(cp) || cp === CodePoint.LINE_FEED) cp = this.nextCode();
					continue;
				} else if (isWhitespace(cp)) {
					let valid = true;
					const startPos = this.codePointIterator.start;
					let nextCp;
					while ((nextCp = this.nextCode()) !== CodePoint.EOF) {
						if (nextCp === CodePoint.LINE_FEED) break;
						if (!isWhitespace(nextCp)) {
							this.moveAt(startPos);
							valid = false;
							break;
						}
					}
					if (valid) {
						cp = this.nextCode();
						while (isWhitespace(cp) || cp === CodePoint.LINE_FEED) cp = this.nextCode();
						continue;
					}
				}
				return this.reportParseError("invalid-char-in-escape-sequence");
			}
			out.push(cp);
			cp = this.nextCode();
		}
		return this.reportParseError("unterminated-string");
	}
	LITERAL_STRING(cp) {
		if (cp === CodePoint.SINGLE_QUOTE) {
			cp = this.nextCode();
			if (cp === CodePoint.SINGLE_QUOTE) return "MULTI_LINE_LITERAL_STRING";
			this.endToken("LiteralString", "start", "");
			return this.back("DATA");
		}
		const out = [];
		while (cp !== CodePoint.SINGLE_QUOTE && cp !== CodePoint.EOF && cp !== CodePoint.LINE_FEED) {
			if (isControlOtherThanTab(cp)) return this.reportParseErrorControlChar();
			out.push(cp);
			cp = this.nextCode();
		}
		if (cp !== CodePoint.SINGLE_QUOTE) return this.reportParseError("unterminated-string");
		this.endToken("LiteralString", "end", String.fromCodePoint(...out));
		return "DATA";
	}
	MULTI_LINE_LITERAL_STRING(cp) {
		const out = [];
		if (cp === CodePoint.LINE_FEED) cp = this.nextCode();
		while (cp !== CodePoint.EOF) {
			if (cp !== CodePoint.LINE_FEED && isControlOtherThanTab(cp)) return this.reportParseErrorControlChar();
			if (cp === CodePoint.SINGLE_QUOTE) {
				const startPos = this.codePointIterator.start;
				if (this.eatCode(CodePoint.SINGLE_QUOTE) && this.eatCode(CodePoint.SINGLE_QUOTE)) {
					if (this.eatCode(CodePoint.SINGLE_QUOTE)) {
						out.push(CodePoint.SINGLE_QUOTE);
						if (this.eatCode(CodePoint.SINGLE_QUOTE)) {
							out.push(CodePoint.SINGLE_QUOTE);
							if (this.eatCode(CodePoint.SINGLE_QUOTE)) {
								this.moveAt(startPos);
								return this.reportParseError("invalid-three-quotes");
							}
						}
					}
					this.endToken("MultiLineLiteralString", "end", String.fromCodePoint(...out));
					return "DATA";
				}
				this.moveAt(startPos);
			}
			out.push(cp);
			cp = this.nextCode();
		}
		return this.reportParseError("unterminated-string");
	}
	SIGN(cp) {
		if (cp === CodePoint.LATIN_SMALL_N || cp === CodePoint.LATIN_SMALL_I) return this.back("NAN_OR_INF");
		if (isDigit(cp)) return this.back("NUMBER");
		return this.reportParseError("unexpected-char");
	}
	NAN_OR_INF(cp) {
		if (cp === CodePoint.LATIN_SMALL_N) {
			const startPos = this.codePointIterator.start;
			if (this.eatCode(CodePoint.LATIN_SMALL_A) && this.eatCode(CodePoint.LATIN_SMALL_N)) {
				this.endToken("Float", "end", NaN);
				return "DATA";
			}
			this.moveAt(startPos);
		} else if (cp === CodePoint.LATIN_SMALL_I) {
			const startPos = this.codePointIterator.start;
			if (this.eatCode(CodePoint.LATIN_SMALL_N) && this.eatCode(CodePoint.LATIN_SMALL_F)) {
				this.endToken("Float", "end", this.text[this.tokenStart] === "-" ? -Infinity : Infinity);
				return "DATA";
			}
			this.moveAt(startPos);
		}
		return this.reportParseError("unexpected-char");
	}
	NUMBER(cp) {
		const start = this.text[this.tokenStart];
		const sign = start === "+" ? CodePoint.PLUS_SIGN : start === "-" ? CodePoint.DASH : CodePoint.NULL;
		if (cp === CodePoint.DIGIT_0) {
			if (sign === CodePoint.NULL) {
				const startPos = this.codePointIterator.start;
				const nextCp$1 = this.nextCode();
				if (isDigit(nextCp$1)) {
					const nextNextCp = this.nextCode();
					if (nextNextCp === CodePoint.COLON) {
						this.data = {
							hasDate: false,
							year: 0,
							month: 0,
							day: 0,
							hour: Number(String.fromCodePoint(CodePoint.DIGIT_0, nextCp$1)),
							minute: 0,
							second: 0
						};
						return "TIME_MINUTE";
					}
					if (isDigit(nextNextCp)) {
						const nextNextNextCp = this.nextCode();
						if (isDigit(nextNextNextCp) && this.eatCode(CodePoint.DASH)) {
							this.data = {
								hasDate: true,
								year: Number(String.fromCodePoint(CodePoint.DIGIT_0, nextCp$1, nextNextCp, nextNextNextCp)),
								month: 0,
								day: 0,
								hour: 0,
								minute: 0,
								second: 0
							};
							return "DATE_MONTH";
						}
					}
					this.moveAt(startPos);
					return this.reportParseError("invalid-leading-zero");
				}
				this.moveAt(startPos);
			}
			cp = this.nextCode();
			if (cp === CodePoint.LATIN_SMALL_X || cp === CodePoint.LATIN_SMALL_O || cp === CodePoint.LATIN_SMALL_B) {
				if (sign !== CodePoint.NULL) return this.reportParseError("unexpected-char");
				return cp === CodePoint.LATIN_SMALL_X ? "HEX" : cp === CodePoint.LATIN_SMALL_O ? "OCTAL" : "BINARY";
			}
			if (cp === CodePoint.LATIN_SMALL_E || cp === CodePoint.LATIN_CAPITAL_E) {
				this.data = {
					minus: sign === CodePoint.DASH,
					left: [CodePoint.DIGIT_0]
				};
				return "EXPONENT_RIGHT";
			}
			if (cp === CodePoint.DOT) {
				this.data = {
					minus: sign === CodePoint.DASH,
					absInt: [CodePoint.DIGIT_0]
				};
				return "FRACTIONAL_RIGHT";
			}
			this.endToken("Integer", "start", "0", 10);
			return this.back("DATA");
		}
		const { out, nextCp, hasUnderscore } = this.parseDigits(cp, isDigit);
		if (nextCp === CodePoint.DASH && sign === CodePoint.NULL && !hasUnderscore && out.length === 4) {
			this.data = {
				hasDate: true,
				year: Number(String.fromCodePoint(...out)),
				month: 0,
				day: 0,
				hour: 0,
				minute: 0,
				second: 0
			};
			return "DATE_MONTH";
		}
		if (nextCp === CodePoint.COLON && sign === CodePoint.NULL && !hasUnderscore && out.length === 2) {
			this.data = {
				hasDate: false,
				year: 0,
				month: 0,
				day: 0,
				hour: Number(String.fromCodePoint(...out)),
				minute: 0,
				second: 0
			};
			return "TIME_MINUTE";
		}
		if (nextCp === CodePoint.LATIN_SMALL_E || nextCp === CodePoint.LATIN_CAPITAL_E) {
			this.data = {
				minus: sign === CodePoint.DASH,
				left: out
			};
			return "EXPONENT_RIGHT";
		}
		if (nextCp === CodePoint.DOT) {
			this.data = {
				minus: sign === CodePoint.DASH,
				absInt: out
			};
			return "FRACTIONAL_RIGHT";
		}
		this.endToken("Integer", "start", sign === CodePoint.DASH ? String.fromCodePoint(CodePoint.DASH, ...out) : String.fromCodePoint(...out), 10);
		return this.back("DATA");
	}
	HEX(cp) {
		const { out } = this.parseDigits(cp, isHexDig);
		this.endToken("Integer", "start", String.fromCodePoint(...out), 16);
		return this.back("DATA");
	}
	OCTAL(cp) {
		const { out } = this.parseDigits(cp, isOctalDig);
		this.endToken("Integer", "start", String.fromCodePoint(...out), 8);
		return this.back("DATA");
	}
	BINARY(cp) {
		const { out } = this.parseDigits(cp, (c) => c === CodePoint.DIGIT_0 || c === CodePoint.DIGIT_1);
		this.endToken("Integer", "start", String.fromCodePoint(...out), 2);
		return this.back("DATA");
	}
	FRACTIONAL_RIGHT(cp) {
		const { minus, absInt } = this.data;
		const { out, nextCp } = this.parseDigits(cp, isDigit);
		const absNum = [
			...absInt,
			CodePoint.DOT,
			...out
		];
		if (nextCp === CodePoint.LATIN_SMALL_E || nextCp === CodePoint.LATIN_CAPITAL_E) {
			this.data = {
				minus,
				left: absNum
			};
			return "EXPONENT_RIGHT";
		}
		const value = Number(minus ? String.fromCodePoint(CodePoint.DASH, ...absNum) : String.fromCodePoint(...absNum));
		this.endToken("Float", "start", value);
		return this.back("DATA");
	}
	EXPONENT_RIGHT(cp) {
		const { left, minus: leftMinus } = this.data;
		let minus = false;
		if (cp === CodePoint.DASH || cp === CodePoint.PLUS_SIGN) {
			minus = cp === CodePoint.DASH;
			cp = this.nextCode();
		}
		const { out } = this.parseDigits(cp, isDigit);
		const right = out;
		if (minus) right.unshift(CodePoint.DASH);
		const value = Number(leftMinus ? String.fromCodePoint(CodePoint.DASH, ...left, CodePoint.LATIN_SMALL_E, ...right) : String.fromCodePoint(...left, CodePoint.LATIN_SMALL_E, ...right));
		this.endToken("Float", "start", value);
		return this.back("DATA");
	}
	BOOLEAN(cp) {
		if (cp === CodePoint.LATIN_SMALL_T) {
			const startPos = this.codePointIterator.start;
			if (this.eatCode(CodePoint.LATIN_SMALL_R) && this.eatCode(CodePoint.LATIN_SMALL_U) && this.eatCode(CodePoint.LATIN_SMALL_E)) {
				this.endToken("Boolean", "end", true);
				return "DATA";
			}
			this.moveAt(startPos);
		} else if (cp === CodePoint.LATIN_SMALL_F) {
			const startPos = this.codePointIterator.start;
			if (this.eatCode(CodePoint.LATIN_SMALL_A) && this.eatCode(CodePoint.LATIN_SMALL_L) && this.eatCode(CodePoint.LATIN_SMALL_S) && this.eatCode(CodePoint.LATIN_SMALL_E)) {
				this.endToken("Boolean", "end", false);
				return "DATA";
			}
			this.moveAt(startPos);
		}
		return this.reportParseError("unexpected-char");
	}
	DATE_MONTH(cp) {
		const start = this.codePointIterator.start;
		if (!isDigit(cp)) return this.reportParseError("unexpected-char");
		cp = this.nextCode();
		if (!isDigit(cp)) return this.reportParseError("unexpected-char");
		cp = this.nextCode();
		if (cp !== CodePoint.DASH) return this.reportParseError("unexpected-char");
		const end = this.codePointIterator.start;
		const data = this.data;
		data.month = Number(this.text.slice(start, end));
		return "DATE_DAY";
	}
	DATE_DAY(cp) {
		const start = this.codePointIterator.start;
		if (!isDigit(cp)) return this.reportParseError("unexpected-char");
		cp = this.nextCode();
		if (!isDigit(cp)) return this.reportParseError("unexpected-char");
		const end = this.codePointIterator.end;
		const data = this.data;
		data.day = Number(this.text.slice(start, end));
		if (!isValidDate(data.year, data.month, data.day)) return this.reportParseError("invalid-date");
		cp = this.nextCode();
		if (cp === CodePoint.LATIN_CAPITAL_T || cp === CodePoint.LATIN_SMALL_T) return "TIME_HOUR";
		if (cp === CodePoint.SPACE) {
			const startPos = this.codePointIterator.start;
			if (isDigit(this.nextCode()) && isDigit(this.nextCode())) {
				this.moveAt(startPos);
				return "TIME_HOUR";
			}
			this.moveAt(startPos);
		}
		const dateValue = getDateFromDateTimeData(data, "");
		this.endToken("LocalDate", "start", dateValue);
		return this.back("DATA");
	}
	TIME_HOUR(cp) {
		const start = this.codePointIterator.start;
		if (!isDigit(cp)) return this.reportParseError("unexpected-char");
		cp = this.nextCode();
		if (!isDigit(cp)) return this.reportParseError("unexpected-char");
		cp = this.nextCode();
		if (cp !== CodePoint.COLON) return this.reportParseError("unexpected-char");
		const end = this.codePointIterator.start;
		const data = this.data;
		data.hour = Number(this.text.slice(start, end));
		return "TIME_MINUTE";
	}
	TIME_MINUTE(cp) {
		const start = this.codePointIterator.start;
		if (!isDigit(cp)) return this.reportParseError("unexpected-char");
		cp = this.nextCode();
		if (!isDigit(cp)) return this.reportParseError("unexpected-char");
		const end = this.codePointIterator.end;
		const data = this.data;
		data.minute = Number(this.text.slice(start, end));
		cp = this.nextCode();
		if (cp === CodePoint.COLON) return "TIME_SECOND";
		if (this.tomlVersion.lt(1, 1)) return this.reportParseError("unexpected-char");
		if (!isValidTime(data.hour, data.minute, data.second)) return this.reportParseError("invalid-time");
		return this.processTimeEnd(cp, data);
	}
	TIME_SECOND(cp) {
		const start = this.codePointIterator.start;
		if (!isDigit(cp)) return this.reportParseError("unexpected-char");
		cp = this.nextCode();
		if (!isDigit(cp)) return this.reportParseError("unexpected-char");
		const end = this.codePointIterator.end;
		const data = this.data;
		data.second = Number(this.text.slice(start, end));
		if (!isValidTime(data.hour, data.minute, data.second)) return this.reportParseError("invalid-time");
		cp = this.nextCode();
		if (cp === CodePoint.DOT) return "TIME_SEC_FRAC";
		return this.processTimeEnd(cp, data);
	}
	TIME_SEC_FRAC(cp) {
		if (!isDigit(cp)) return this.reportParseError("unexpected-char");
		const start = this.codePointIterator.start;
		while (isDigit(cp)) cp = this.nextCode();
		const end = this.codePointIterator.start;
		const data = this.data;
		data.frac = this.text.slice(start, end);
		return this.processTimeEnd(cp, data);
	}
	processTimeEnd(cp, data) {
		if (data.hasDate) {
			if (cp === CodePoint.DASH || cp === CodePoint.PLUS_SIGN) {
				data.offsetSign = cp;
				return "TIME_OFFSET";
			}
			if (cp === CodePoint.LATIN_CAPITAL_Z || cp === CodePoint.LATIN_SMALL_Z) {
				const dateValue$2 = getDateFromDateTimeData(data, "Z");
				this.endToken("OffsetDateTime", "end", dateValue$2);
				return "DATA";
			}
			const dateValue$1 = getDateFromDateTimeData(data, "");
			this.endToken("LocalDateTime", "start", dateValue$1);
			return this.back("DATA");
		}
		const dateValue = getDateFromDateTimeData(data, "");
		this.endToken("LocalTime", "start", dateValue);
		return this.back("DATA");
	}
	TIME_OFFSET(cp) {
		if (!isDigit(cp)) return this.reportParseError("unexpected-char");
		const hourStart = this.codePointIterator.start;
		cp = this.nextCode();
		if (!isDigit(cp)) return this.reportParseError("unexpected-char");
		cp = this.nextCode();
		if (cp !== CodePoint.COLON) return this.reportParseError("unexpected-char");
		const hourEnd = this.codePointIterator.start;
		cp = this.nextCode();
		const minuteStart = this.codePointIterator.start;
		if (!isDigit(cp)) return this.reportParseError("unexpected-char");
		cp = this.nextCode();
		if (!isDigit(cp)) return this.reportParseError("unexpected-char");
		const minuteEnd = this.codePointIterator.end;
		const hour = Number(this.text.slice(hourStart, hourEnd));
		const minute = Number(this.text.slice(minuteStart, minuteEnd));
		if (!isValidTime(hour, minute, 0)) return this.reportParseError("invalid-time");
		const data = this.data;
		const dateValue = getDateFromDateTimeData(data, `${String.fromCodePoint(data.offsetSign)}${padStart(hour, 2)}:${padStart(minute, 2)}`);
		this.endToken("OffsetDateTime", "end", dateValue);
		return "DATA";
	}
	parseDigits(cp, checkDigit) {
		if (cp === CodePoint.UNDERSCORE) return this.reportParseError("invalid-underscore");
		if (!checkDigit(cp)) return this.reportParseError("unexpected-char");
		const out = [];
		let before = CodePoint.NULL;
		let hasUnderscore = false;
		while (checkDigit(cp) || cp === CodePoint.UNDERSCORE) {
			if (cp === CodePoint.UNDERSCORE) {
				hasUnderscore = true;
				if (before === CodePoint.UNDERSCORE) return this.reportParseError("invalid-underscore");
			} else out.push(cp);
			before = cp;
			cp = this.nextCode();
		}
		if (before === CodePoint.UNDERSCORE) return this.reportParseError("invalid-underscore");
		return {
			out,
			nextCp: cp,
			hasUnderscore
		};
	}
	parseUnicode(count) {
		const startLoc = this.codePointIterator.start;
		const start = this.codePointIterator.end;
		let charCount = 0;
		let cp;
		while ((cp = this.nextCode()) !== CodePoint.EOF) {
			if (!isHexDig(cp)) {
				this.moveAt(startLoc);
				return this.reportParseError("invalid-char-in-escape-sequence");
			}
			charCount++;
			if (charCount >= count) break;
		}
		const end = this.codePointIterator.end;
		const code = this.text.slice(start, end);
		const codePoint = parseInt(code, 16);
		if (!isUnicodeScalarValue(codePoint)) return this.reportParseError("invalid-code-point", { cp: code });
		return codePoint;
	}
	reportParseErrorControlChar() {
		return this.reportParseError("invalid-control-character");
	}
};
/**
* Check whether the code point is unquoted-key-char
*/
function isUnquotedKeyChar(cp, tomlVersion) {
	if (isLetter(cp) || isDigit(cp) || cp === CodePoint.UNDERSCORE || cp === CodePoint.DASH) return true;
	if (tomlVersion.lt(1, 1)) return false;
	return false;
}
/**
* Check whether the code point is control character other than tab
*/
function isControlOtherThanTab(cp) {
	return isControl(cp) && cp !== CodePoint.TABULATION || cp === CodePoint.DELETE;
}
/**
* Check whether the code point is non-eol for TOML 1.1
*/
function isNonEOL(cp) {
	return cp === CodePoint.TABULATION || CodePoint.SPACE <= cp && cp <= CodePoint.TILDE || isNonAscii(cp);
}
/**
* Check whether the code point is a non-ascii character.
*/
function isNonAscii(cp) {
	return CodePoint.PAD <= cp && cp <= CodePoint.CP_D7FF || CodePoint.CP_E000 <= cp && cp <= CodePoint.CP_10FFFF;
}
/**
* Check whether the given values is valid date
*/
function isValidDate(y, m, d) {
	if (y >= 0 && m <= 12 && m >= 1 && d >= 1) return d <= (m === 2 ? y & 3 || !(y % 25) && y & 15 ? 28 : 29 : 30 + (m + (m >> 3) & 1));
	return false;
}
/**
* Check whether the given values is valid time
*/
function isValidTime(h, m, s) {
	if (h >= 24 || h < 0 || m > 59 || m < 0 || s > 60 || s < 0) return false;
	return true;
}
/**
* Get date from DateTimeData
*/
function getDateFromDateTimeData(data, timeZone) {
	const year = padStart(data.year, 4);
	const month = data.month ? padStart(data.month, 2) : "01";
	const day = data.day ? padStart(data.day, 2) : "01";
	const hour = padStart(data.hour, 2);
	const minute = padStart(data.minute, 2);
	const second = padStart(data.second, 2);
	const textDate = `${year}-${month}-${day}`;
	const frac = data.frac ? `.${data.frac}` : "";
	const dateValue = /* @__PURE__ */ new Date(`${textDate}T${hour}:${minute}:${second}${frac}${timeZone}`);
	if (!isNaN(dateValue.getTime()) || data.second !== 60) return dateValue;
	return /* @__PURE__ */ new Date(`${textDate}T${hour}:${minute}:59${frac}${timeZone}`);
}
/**
* Pad with zeros.
*/
function padStart(num, maxLength) {
	return String(num).padStart(maxLength, "0");
}

//#endregion
//#region src/toml-parser/keys-resolver.ts
const VALUE_KIND_VALUE = Symbol("VALUE_KIND_VALUE");
const VALUE_KIND_INTERMEDIATE = Symbol("VALUE_KIND_INTERMEDIATE");
var KeysResolver = class {
	constructor(ctx) {
		this.rootKeys = /* @__PURE__ */ new Map();
		this.tables = [];
		this.ctx = ctx;
	}
	applyResolveKeyForTable(node) {
		let keys = this.rootKeys;
		const peekKeyIndex = node.key.keys.length - 1;
		for (let index = 0; index < peekKeyIndex; index++) {
			const keyNode = node.key.keys[index];
			const keyName = toKeyName(keyNode);
			node.resolvedKey.push(keyName);
			let keyStore = keys.get(keyName);
			if (!keyStore) {
				keyStore = {
					node: keyNode,
					keys: /* @__PURE__ */ new Map()
				};
				keys.set(keyName, keyStore);
			} else if (keyStore.table === "array") {
				const peekIndex = keyStore.peekIndex;
				node.resolvedKey.push(peekIndex);
				keyStore = keyStore.keys.get(peekIndex);
			}
			keys = keyStore.keys;
		}
		const lastKeyNode = node.key.keys[peekKeyIndex];
		const lastKeyName = toKeyName(lastKeyNode);
		node.resolvedKey.push(lastKeyName);
		const lastKeyStore = keys.get(lastKeyName);
		if (!lastKeyStore) if (node.kind === "array") {
			node.resolvedKey.push(0);
			const newKeyStore = {
				node: lastKeyNode,
				keys: /* @__PURE__ */ new Map()
			};
			keys.set(lastKeyName, {
				table: node.kind,
				node: lastKeyNode,
				keys: new Map([[0, newKeyStore]]),
				peekIndex: 0
			});
			this.tables.push({
				node,
				keys: newKeyStore.keys
			});
		} else {
			const newKeyStore = {
				table: node.kind,
				node: lastKeyNode,
				keys: /* @__PURE__ */ new Map()
			};
			keys.set(lastKeyName, newKeyStore);
			this.tables.push({
				node,
				keys: newKeyStore.keys
			});
		}
		else if (!lastKeyStore.table) if (node.kind === "array") this.ctx.reportParseError("dupe-keys", lastKeyNode);
		else {
			const transformKey = {
				table: node.kind,
				node: lastKeyNode,
				keys: lastKeyStore.keys
			};
			keys.set(lastKeyName, transformKey);
			this.tables.push({
				node,
				keys: transformKey.keys
			});
		}
		else if (lastKeyStore.table === "array") if (node.kind === "array") {
			const newKeyStore = {
				node: lastKeyNode,
				keys: /* @__PURE__ */ new Map()
			};
			const newIndex = lastKeyStore.peekIndex + 1;
			node.resolvedKey.push(newIndex);
			lastKeyStore.keys.set(newIndex, newKeyStore);
			lastKeyStore.peekIndex = newIndex;
			this.tables.push({
				node,
				keys: newKeyStore.keys
			});
		} else this.ctx.reportParseError("dupe-keys", lastKeyNode);
		else this.ctx.reportParseError("dupe-keys", lastKeyNode);
	}
	verifyDuplicateKeys(node) {
		for (const body of node.body) if (body.type === "TOMLKeyValue") verifyDuplicateKeysForKeyValue(this.ctx, this.rootKeys, body);
		for (const { node: tableNode, keys } of this.tables) for (const body of tableNode.body) verifyDuplicateKeysForKeyValue(this.ctx, keys, body);
	}
};
/**
* Verify duplicate keys from TOMLKeyValue
*/
function verifyDuplicateKeysForKeyValue(ctx, defineKeys, node) {
	let keys = defineKeys;
	const lastKey = last(node.key.keys);
	for (const keyNode of node.key.keys) {
		const key = toKeyName(keyNode);
		let defineKey = keys.get(key);
		if (defineKey) {
			if (defineKey.value === VALUE_KIND_VALUE) ctx.reportParseError("dupe-keys", getAfterNode(keyNode, defineKey.node));
			else if (lastKey === keyNode) ctx.reportParseError("dupe-keys", getAfterNode(keyNode, defineKey.node));
			else if (defineKey.table) ctx.reportParseError("dupe-keys", getAfterNode(keyNode, defineKey.node));
			defineKey.value = VALUE_KIND_INTERMEDIATE;
		} else {
			if (lastKey === keyNode) defineKey = {
				value: VALUE_KIND_VALUE,
				node: keyNode,
				keys: /* @__PURE__ */ new Map()
			};
			else defineKey = {
				value: VALUE_KIND_INTERMEDIATE,
				node: keyNode,
				keys: /* @__PURE__ */ new Map()
			};
			keys.set(key, defineKey);
		}
		keys = defineKey.keys;
	}
	if (node.value.type === "TOMLInlineTable") verifyDuplicateKeysForInlineTable(ctx, keys, node.value);
	else if (node.value.type === "TOMLArray") verifyDuplicateKeysForArray(ctx, keys, node.value);
}
/**
* Verify duplicate keys from TOMLInlineTable
*/
function verifyDuplicateKeysForInlineTable(ctx, defineKeys, node) {
	for (const body of node.body) verifyDuplicateKeysForKeyValue(ctx, defineKeys, body);
}
/**
* Verify duplicate keys from TOMLArray
*/
function verifyDuplicateKeysForArray(ctx, defineKeys, node) {
	const keys = defineKeys;
	for (let index = 0; index < node.elements.length; index++) {
		const element = node.elements[index];
		let defineKey = keys.get(index);
		if (defineKey) ctx.reportParseError("dupe-keys", getAfterNode(element, defineKey.node));
		else {
			defineKey = {
				value: VALUE_KIND_VALUE,
				node: element,
				keys: /* @__PURE__ */ new Map()
			};
			defineKeys.set(index, defineKey);
			if (element.type === "TOMLInlineTable") verifyDuplicateKeysForInlineTable(ctx, defineKey.keys, element);
			else if (element.type === "TOMLArray") verifyDuplicateKeysForArray(ctx, defineKey.keys, element);
		}
	}
}
/**
* Get the after node
*/
function getAfterNode(a, b) {
	return a.range[0] <= b.range[0] ? b : a;
}

//#endregion
//#region src/toml-parser/context.ts
var Context = class {
	constructor(data) {
		this.tokens = [];
		this.comments = [];
		this.back = null;
		this.stateStack = [];
		this.needNewLine = false;
		this.needSameLine = false;
		this.currToken = null;
		this.prevToken = null;
		this.valueContainerStack = [];
		this.tokenizer = new Tokenizer(data.text, data.parserOptions);
		this.topLevelTable = data.topLevelTable;
		this.table = data.topLevelTable;
		this.keysResolver = new KeysResolver(this);
	}
	/**
	* Get the next token.
	*/
	nextToken(option) {
		this.prevToken = this.currToken;
		if (this.back) {
			this.currToken = this.back;
			this.back = null;
		} else this.currToken = this._nextTokenFromTokenizer(option);
		if ((this.needNewLine || this.needSameLine || option?.needSameLine) && this.prevToken && this.currToken) if (this.prevToken.loc.end.line === this.currToken.loc.start.line) {
			if (this.needNewLine) return this.reportParseError("missing-newline", this.currToken);
		} else {
			const needSameLine = this.needSameLine || option?.needSameLine;
			if (needSameLine) return this.reportParseError(needSameLine, this.currToken);
		}
		this.needNewLine = false;
		this.needSameLine = false;
		return this.currToken;
	}
	_nextTokenFromTokenizer(option) {
		const valuesEnabled = this.tokenizer.valuesEnabled;
		if (option?.valuesEnabled) this.tokenizer.valuesEnabled = option.valuesEnabled;
		let token = this.tokenizer.nextToken();
		while (token && token.type === "Block") {
			this.comments.push(token);
			token = this.tokenizer.nextToken();
		}
		if (token) this.tokens.push(token);
		this.tokenizer.valuesEnabled = valuesEnabled;
		return token;
	}
	backToken() {
		if (this.back) throw new Error("Illegal state");
		this.back = this.currToken;
		this.currToken = this.prevToken;
	}
	addValueContainer(valueContainer) {
		this.valueContainerStack.push(valueContainer);
		this.tokenizer.valuesEnabled = true;
	}
	consumeValueContainer() {
		const valueContainer = this.valueContainerStack.pop();
		this.tokenizer.valuesEnabled = this.valueContainerStack.length > 0;
		return valueContainer;
	}
	applyResolveKeyForTable(node) {
		this.keysResolver.applyResolveKeyForTable(node);
	}
	verifyDuplicateKeys() {
		this.keysResolver.verifyDuplicateKeys(this.topLevelTable);
	}
	/**
	* Report an invalid token error.
	*/
	reportParseError(code, token) {
		let offset, line, column;
		if (token) {
			offset = token.range[0];
			line = token.loc.start.line;
			column = token.loc.start.column;
		} else {
			offset = this.tokenizer.start;
			const startPos = this.tokenizer.getLocFromIndex(offset);
			line = startPos.line;
			column = startPos.column;
		}
		throw new ParseError(code, offset, line, column);
	}
};

//#endregion
//#region src/toml-parser/index.ts
const STATE_FOR_ERROR = { VALUE: "missing-value" };
const STRING_VALUE_STYLE_MAP = {
	BasicString: "basic",
	MultiLineBasicString: "basic",
	LiteralString: "literal",
	MultiLineLiteralString: "literal"
};
const STRING_KEY_STYLE_MAP = {
	BasicString: "basic",
	LiteralString: "literal"
};
const DATETIME_VALUE_KIND_MAP = {
	OffsetDateTime: "offset-date-time",
	LocalDateTime: "local-date-time",
	LocalDate: "local-date",
	LocalTime: "local-time"
};
var TOMLParser = class {
	/**
	* Initialize this parser.
	*/
	constructor(text, parserOptions) {
		this.text = text;
		this.parserOptions = parserOptions || {};
		this.tomlVersion = getTOMLVer(this.parserOptions.tomlVersion);
	}
	/**
	* Parse TOML
	*/
	parse() {
		const ast = {
			type: "Program",
			body: [],
			sourceType: "module",
			tokens: [],
			comments: [],
			parent: null,
			range: [0, 0],
			loc: {
				start: {
					line: 1,
					column: 0
				},
				end: {
					line: 1,
					column: 0
				}
			}
		};
		const node = {
			type: "TOMLTopLevelTable",
			body: [],
			parent: ast,
			range: cloneRange(ast.range),
			loc: cloneLoc(ast.loc)
		};
		ast.body = [node];
		const ctx = new Context({
			text: this.text,
			parserOptions: this.parserOptions,
			topLevelTable: node
		});
		let token = ctx.nextToken();
		if (token) {
			node.range[0] = token.range[0];
			node.loc.start = clonePos(token.loc.start);
			while (token) {
				const state$1 = ctx.stateStack.pop() || "TABLE";
				ctx.stateStack.push(...this[state$1](token, ctx));
				token = ctx.nextToken();
			}
			const state = ctx.stateStack.pop() || "TABLE";
			if (state in STATE_FOR_ERROR) return ctx.reportParseError(STATE_FOR_ERROR[state], null);
			if (ctx.table.type === "TOMLTable") applyEndLoc(ctx.table, last(ctx.table.body));
			applyEndLoc(node, last(node.body));
		}
		ctx.verifyDuplicateKeys();
		ast.tokens = ctx.tokens;
		ast.comments = ctx.comments;
		const endOffset = ctx.tokenizer.end;
		const endPos = ctx.tokenizer.getLocFromIndex(endOffset);
		ast.range[1] = endOffset;
		ast.loc.end = {
			line: endPos.line,
			column: endPos.column
		};
		return ast;
	}
	TABLE(token, ctx) {
		if (isBare(token) || isString(token)) return this.processKeyValue(token, ctx.table, ctx);
		if (isLeftBracket(token)) return this.processTable(token, ctx.topLevelTable, ctx);
		return ctx.reportParseError("unexpected-token", token);
	}
	VALUE(token, ctx) {
		if (isString(token) || isMultiLineString(token)) return this.processStringValue(token, ctx);
		if (isNumber(token)) return this.processNumberValue(token, ctx);
		if (isBoolean(token)) return this.processBooleanValue(token, ctx);
		if (isDateTime(token)) return this.processDateTimeValue(token, ctx);
		if (isLeftBracket(token)) return this.processArray(token, ctx);
		if (isLeftBrace(token)) return this.processInlineTable(token, ctx);
		return ctx.reportParseError("unexpected-token", token);
	}
	processTable(token, topLevelTableNode, ctx) {
		const tableNode = {
			type: "TOMLTable",
			kind: "standard",
			key: null,
			resolvedKey: [],
			body: [],
			parent: topLevelTableNode,
			range: cloneRange(token.range),
			loc: cloneLoc(token.loc)
		};
		if (ctx.table.type === "TOMLTable") applyEndLoc(ctx.table, last(ctx.table.body));
		topLevelTableNode.body.push(tableNode);
		ctx.table = tableNode;
		let targetToken = ctx.nextToken({ needSameLine: "invalid-key-value-newline" });
		if (isLeftBracket(targetToken)) {
			if (token.range[1] < targetToken.range[0]) return ctx.reportParseError("invalid-space", targetToken);
			tableNode.kind = "array";
			targetToken = ctx.nextToken({ needSameLine: "invalid-key-value-newline" });
		}
		if (isRightBracket(targetToken)) return ctx.reportParseError("missing-key", targetToken);
		if (!targetToken) return ctx.reportParseError("unterminated-table-key", null);
		targetToken = this.processKeyNode(targetToken, tableNode, ctx).nextToken;
		if (!isRightBracket(targetToken)) return ctx.reportParseError("unterminated-table-key", targetToken);
		if (tableNode.kind === "array") {
			const rightBracket = targetToken;
			targetToken = ctx.nextToken({ needSameLine: "invalid-key-value-newline" });
			if (!isRightBracket(targetToken)) return ctx.reportParseError("unterminated-table-key", targetToken);
			if (rightBracket.range[1] < targetToken.range[0]) return ctx.reportParseError("invalid-space", targetToken);
		}
		applyEndLoc(tableNode, targetToken);
		ctx.applyResolveKeyForTable(tableNode);
		ctx.needNewLine = true;
		return [];
	}
	processKeyValue(token, tableNode, ctx) {
		const keyValueNode = {
			type: "TOMLKeyValue",
			key: null,
			value: null,
			parent: tableNode,
			range: cloneRange(token.range),
			loc: cloneLoc(token.loc)
		};
		tableNode.body.push(keyValueNode);
		const { nextToken: targetToken } = this.processKeyNode(token, keyValueNode, ctx);
		if (!isEq(targetToken)) return ctx.reportParseError("missing-equals-sign", targetToken);
		ctx.addValueContainer({
			parent: keyValueNode,
			set: (valNode) => {
				keyValueNode.value = valNode;
				applyEndLoc(keyValueNode, valNode);
				ctx.needNewLine = true;
				return [];
			}
		});
		ctx.needSameLine = "invalid-key-value-newline";
		return ["VALUE"];
	}
	processKeyNode(token, parent, ctx) {
		if (isDot(token)) ctx.reportParseError("invalid-leading-dot-in-key", token);
		const keyNode = {
			type: "TOMLKey",
			keys: [],
			parent,
			range: cloneRange(token.range),
			loc: cloneLoc(token.loc)
		};
		parent.key = keyNode;
		let targetToken = token;
		let dotToken = null;
		do {
			if (isBare(targetToken)) this.processBareKey(targetToken, keyNode);
			else if (isString(targetToken)) this.processStringKey(targetToken, keyNode);
			else break;
			dotToken = null;
			targetToken = ctx.nextToken({ needSameLine: "invalid-key-value-newline" });
			if (!isDot(targetToken)) break;
			dotToken = targetToken;
			targetToken = ctx.nextToken({ needSameLine: "invalid-key-value-newline" });
		} while (targetToken);
		if (dotToken) ctx.reportParseError(isDot(targetToken) ? "invalid-consecutive-dots-in-key" : "invalid-trailing-dot-in-key", dotToken);
		applyEndLoc(keyNode, last(keyNode.keys));
		return {
			keyNode,
			nextToken: targetToken
		};
	}
	processBareKey(token, keyNode) {
		const node = {
			type: "TOMLBare",
			name: token.value,
			parent: keyNode,
			range: cloneRange(token.range),
			loc: cloneLoc(token.loc)
		};
		keyNode.keys.push(node);
	}
	processStringKey(token, keyNode) {
		const node = {
			type: "TOMLQuoted",
			kind: "string",
			value: token.string,
			style: STRING_KEY_STYLE_MAP[token.type],
			multiline: false,
			parent: keyNode,
			range: cloneRange(token.range),
			loc: cloneLoc(token.loc)
		};
		keyNode.keys.push(node);
	}
	processStringValue(token, ctx) {
		const valueContainer = ctx.consumeValueContainer();
		const node = {
			type: "TOMLValue",
			kind: "string",
			value: token.string,
			style: STRING_VALUE_STYLE_MAP[token.type],
			multiline: isMultiLineString(token),
			parent: valueContainer.parent,
			range: cloneRange(token.range),
			loc: cloneLoc(token.loc)
		};
		return valueContainer.set(node);
	}
	processNumberValue(token, ctx) {
		const valueContainer = ctx.consumeValueContainer();
		const text = this.text;
		const [startRange, endRange] = token.range;
		let numberString = null;
		/**
		* Get the text of number
		*/
		const getNumberText = () => {
			return numberString ?? (numberString = text.slice(startRange, endRange).replace(/_/g, ""));
		};
		let node;
		if (token.type === "Integer") node = {
			type: "TOMLValue",
			kind: "integer",
			value: token.number,
			bigint: token.bigint,
			get number() {
				return getNumberText();
			},
			parent: valueContainer.parent,
			range: cloneRange(token.range),
			loc: cloneLoc(token.loc)
		};
		else node = {
			type: "TOMLValue",
			kind: "float",
			value: token.number,
			get number() {
				return getNumberText();
			},
			parent: valueContainer.parent,
			range: cloneRange(token.range),
			loc: cloneLoc(token.loc)
		};
		return valueContainer.set(node);
	}
	processBooleanValue(token, ctx) {
		const valueContainer = ctx.consumeValueContainer();
		const node = {
			type: "TOMLValue",
			kind: "boolean",
			value: token.boolean,
			parent: valueContainer.parent,
			range: cloneRange(token.range),
			loc: cloneLoc(token.loc)
		};
		return valueContainer.set(node);
	}
	processDateTimeValue(token, ctx) {
		const valueContainer = ctx.consumeValueContainer();
		const node = {
			type: "TOMLValue",
			kind: DATETIME_VALUE_KIND_MAP[token.type],
			value: token.date,
			datetime: token.value,
			parent: valueContainer.parent,
			range: cloneRange(token.range),
			loc: cloneLoc(token.loc)
		};
		return valueContainer.set(node);
	}
	processArray(token, ctx) {
		const valueContainer = ctx.consumeValueContainer();
		const node = {
			type: "TOMLArray",
			elements: [],
			parent: valueContainer.parent,
			range: cloneRange(token.range),
			loc: cloneLoc(token.loc)
		};
		const nextToken = ctx.nextToken({ valuesEnabled: true });
		if (isRightBracket(nextToken)) {
			applyEndLoc(node, nextToken);
			return valueContainer.set(node);
		}
		ctx.backToken();
		return this.processArrayValue(node, valueContainer, ctx);
	}
	processArrayValue(node, valueContainer, ctx) {
		ctx.addValueContainer({
			parent: node,
			set: (valNode) => {
				node.elements.push(valNode);
				let nextToken = ctx.nextToken({ valuesEnabled: true });
				const hasComma = isComma(nextToken);
				if (hasComma) nextToken = ctx.nextToken({ valuesEnabled: true });
				if (isRightBracket(nextToken)) {
					applyEndLoc(node, nextToken);
					return valueContainer.set(node);
				}
				if (hasComma) {
					ctx.backToken();
					return this.processArrayValue(node, valueContainer, ctx);
				}
				return ctx.reportParseError(nextToken ? "missing-comma" : "unterminated-array", nextToken);
			}
		});
		return ["VALUE"];
	}
	processInlineTable(token, ctx) {
		const valueContainer = ctx.consumeValueContainer();
		const node = {
			type: "TOMLInlineTable",
			body: [],
			parent: valueContainer.parent,
			range: cloneRange(token.range),
			loc: cloneLoc(token.loc)
		};
		const needSameLine = this.tomlVersion.gte(1, 1) ? void 0 : "invalid-inline-table-newline";
		const nextToken = ctx.nextToken({ needSameLine });
		if (nextToken) {
			if (isBare(nextToken) || isString(nextToken)) return this.processInlineTableKeyValue(nextToken, node, valueContainer, ctx);
			if (isRightBrace(nextToken)) {
				applyEndLoc(node, nextToken);
				return valueContainer.set(node);
			}
		}
		return ctx.reportParseError("unexpected-token", nextToken);
	}
	processInlineTableKeyValue(token, inlineTableNode, valueContainer, ctx) {
		const keyValueNode = {
			type: "TOMLKeyValue",
			key: null,
			value: null,
			parent: inlineTableNode,
			range: cloneRange(token.range),
			loc: cloneLoc(token.loc)
		};
		inlineTableNode.body.push(keyValueNode);
		const { nextToken: targetToken } = this.processKeyNode(token, keyValueNode, ctx);
		if (!isEq(targetToken)) return ctx.reportParseError("missing-equals-sign", targetToken);
		const needSameLine = this.tomlVersion.gte(1, 1) ? void 0 : "invalid-inline-table-newline";
		ctx.addValueContainer({
			parent: keyValueNode,
			set: (valNode) => {
				keyValueNode.value = valNode;
				applyEndLoc(keyValueNode, valNode);
				let nextToken = ctx.nextToken({ needSameLine });
				if (isComma(nextToken)) {
					nextToken = ctx.nextToken({ needSameLine });
					if (nextToken && (isBare(nextToken) || isString(nextToken))) return this.processInlineTableKeyValue(nextToken, inlineTableNode, valueContainer, ctx);
					if (isRightBrace(nextToken)) {
						if (this.tomlVersion.lt(1, 1)) return ctx.reportParseError("invalid-trailing-comma-in-inline-table", nextToken);
					} else return ctx.reportParseError(nextToken ? "unexpected-token" : "unterminated-inline-table", nextToken);
				}
				if (isRightBrace(nextToken)) {
					applyEndLoc(inlineTableNode, nextToken);
					return valueContainer.set(inlineTableNode);
				}
				return ctx.reportParseError(nextToken ? "missing-comma" : "unterminated-inline-table", nextToken);
			}
		});
		ctx.needSameLine = "invalid-key-value-newline";
		return ["VALUE"];
	}
};
/**
* Check whether the given token is a dot.
*/
function isDot(token) {
	return isPunctuator(token) && token.value === ".";
}
/**
* Check whether the given token is an equal sign.
*/
function isEq(token) {
	return isPunctuator(token) && token.value === "=";
}
/**
* Check whether the given token is a left bracket.
*/
function isLeftBracket(token) {
	return isPunctuator(token) && token.value === "[";
}
/**
* Check whether the given token is a right bracket.
*/
function isRightBracket(token) {
	return isPunctuator(token) && token.value === "]";
}
/**
* Check whether the given token is a left brace.
*/
function isLeftBrace(token) {
	return isPunctuator(token) && token.value === "{";
}
/**
* Check whether the given token is a right brace.
*/
function isRightBrace(token) {
	return isPunctuator(token) && token.value === "}";
}
/**
* Check whether the given token is a comma.
*/
function isComma(token) {
	return isPunctuator(token) && token.value === ",";
}
/**
* Check whether the given token is a punctuator.
*/
function isPunctuator(token) {
	return Boolean(token && token.type === "Punctuator");
}
/**
* Check whether the given token is a bare token.
*/
function isBare(token) {
	return token.type === "Bare";
}
/**
* Check whether the given token is a string.
*/
function isString(token) {
	return token.type === "BasicString" || token.type === "LiteralString";
}
/**
* Check whether the given token is a multi-line string.
*/
function isMultiLineString(token) {
	return token.type === "MultiLineBasicString" || token.type === "MultiLineLiteralString";
}
/**
* Check whether the given token is a number.
*/
function isNumber(token) {
	return token.type === "Integer" || token.type === "Float";
}
/**
* Check whether the given token is a boolean.
*/
function isBoolean(token) {
	return token.type === "Boolean";
}
/**
* Check whether the given token is a date time.
*/
function isDateTime(token) {
	return token.type === "OffsetDateTime" || token.type === "LocalDateTime" || token.type === "LocalDate" || token.type === "LocalTime";
}
/**
* Apply end locations
*/
function applyEndLoc(node, child) {
	if (child) {
		node.range[1] = child.range[1];
		node.loc.end = clonePos(child.loc.end);
	}
}
/**
* clone the location.
*/
function cloneRange(range) {
	return [range[0], range[1]];
}
/**
* clone the location.
*/
function cloneLoc(loc) {
	return {
		start: clonePos(loc.start),
		end: clonePos(loc.end)
	};
}
/**
* clone the location.
*/
function clonePos(pos) {
	return {
		line: pos.line,
		column: pos.column
	};
}

//#endregion
//#region src/visitor-keys.ts
const tomlKeys = {
	Program: ["body"],
	TOMLTopLevelTable: ["body"],
	TOMLTable: ["key", "body"],
	TOMLKeyValue: ["key", "value"],
	TOMLKey: ["keys"],
	TOMLArray: ["elements"],
	TOMLInlineTable: ["body"],
	TOMLBare: [],
	TOMLQuoted: [],
	TOMLValue: []
};
const KEYS = unionWith(tomlKeys);

//#endregion
//#region src/parser.ts
/**
* Parse source code
*/
function parseForESLint(code, options) {
	return {
		ast: new TOMLParser(code, options).parse(),
		visitorKeys: KEYS,
		services: { isTOML: true }
	};
}

//#endregion
//#region src/traverse.ts
/**
* Check that the given key should be traversed or not.
* @this {Traversable}
* @param key The key to check.
* @returns `true` if the key should be traversed.
*/
function fallbackKeysFilter(key) {
	let value = null;
	return key !== "comments" && key !== "leadingComments" && key !== "loc" && key !== "parent" && key !== "range" && key !== "tokens" && key !== "trailingComments" && (value = this[key]) !== null && typeof value === "object" && (typeof value.type === "string" || Array.isArray(value));
}
/**
* Get the keys of the given node to traverse it.
* @param node The node to get.
* @returns The keys to traverse.
*/
function getFallbackKeys(node) {
	return Object.keys(node).filter(fallbackKeysFilter, node);
}
/**
* Get the keys of the given node to traverse it.
* @param node The node to get.
* @returns The keys to traverse.
*/
function getKeys(node, visitorKeys) {
	return ((visitorKeys || KEYS)[node.type] || getFallbackKeys(node)).filter((key) => !getNodes(node, key).next().done);
}
/**
* Get the nodes of the given node.
* @param node The node to get.
*/
function* getNodes(node, key) {
	const child = node[key];
	if (Array.isArray(child)) {
		for (const c of child) if (isNode(c)) yield c;
	} else if (isNode(child)) yield child;
}
/**
* Check whether a given value is a node.
* @param x The value to check.
* @returns `true` if the value is a node.
*/
function isNode(x) {
	return x !== null && typeof x === "object" && typeof x.type === "string";
}
/**
* Traverse the given node.
* @param node The node to traverse.
* @param parent The parent node.
* @param visitor The node visitor.
*/
function traverse(node, parent, visitor) {
	visitor.enterNode(node, parent);
	const keys = getKeys(node, visitor.visitorKeys);
	for (const key of keys) for (const child of getNodes(node, key)) traverse(child, node, visitor);
	visitor.leaveNode(node, parent);
}
/**
* Traverse the given AST tree.
* @param node Root node to traverse.
* @param visitor Visitor.
*/
function traverseNodes(node, visitor) {
	traverse(node, null, visitor);
}

//#endregion
//#region src/utils.ts
/**
* Gets the static value for the given node.
*/
const getStaticTOMLValue = generateConvertTOMLValue((node) => node.value);
/** Generates a converter to convert from a node. */
function generateConvertTOMLValue(convertValue) {
	/**
	* Resolve TOML value
	*/
	function resolveValue(node, baseTable) {
		return resolver[node.type](node, baseTable);
	}
	const resolver = {
		Program(node, baseTable = {}) {
			return resolveValue(node.body[0], baseTable);
		},
		TOMLTopLevelTable(node, baseTable = {}) {
			for (const body of node.body) resolveValue(body, baseTable);
			return baseTable;
		},
		TOMLKeyValue(node, baseTable = {}) {
			const value = resolveValue(node.value);
			set(baseTable, resolveValue(node.key), value);
			return baseTable;
		},
		TOMLTable(node, baseTable = {}) {
			const table = getTable(baseTable, resolveValue(node.key), node.kind === "array");
			for (const body of node.body) resolveValue(body, table);
			return baseTable;
		},
		TOMLArray(node) {
			return node.elements.map((e) => resolveValue(e));
		},
		TOMLInlineTable(node) {
			const table = {};
			for (const body of node.body) resolveValue(body, table);
			return table;
		},
		TOMLKey(node) {
			return node.keys.map((key) => resolveValue(key));
		},
		TOMLBare(node) {
			return node.name;
		},
		TOMLQuoted(node) {
			return node.value;
		},
		TOMLValue(node) {
			return convertValue(node);
		}
	};
	return (node) => resolveValue(node);
}
/**
* Get the table from the table.
*/
function getTable(baseTable, keys, array) {
	let target = baseTable;
	for (let index = 0; index < keys.length - 1; index++) {
		const key = keys[index];
		target = getNextTargetFromKey(target, key);
	}
	const lastKey = last(keys);
	const lastTarget = target[lastKey];
	if (lastTarget == null) {
		const tableValue$1 = {};
		target[lastKey] = array ? [tableValue$1] : tableValue$1;
		return tableValue$1;
	}
	if (isValue(lastTarget)) {
		const tableValue$1 = {};
		target[lastKey] = array ? [tableValue$1] : tableValue$1;
		return tableValue$1;
	}
	if (!array) {
		if (Array.isArray(lastTarget)) {
			const tableValue$1 = {};
			target[lastKey] = tableValue$1;
			return tableValue$1;
		}
		return lastTarget;
	}
	if (Array.isArray(lastTarget)) {
		const tableValue$1 = {};
		lastTarget.push(tableValue$1);
		return tableValue$1;
	}
	const tableValue = {};
	target[lastKey] = [tableValue];
	return tableValue;
	/** Get next target from key */
	function getNextTargetFromKey(currTarget, key) {
		const nextTarget = currTarget[key];
		if (nextTarget == null) {
			const val = {};
			currTarget[key] = val;
			return val;
		}
		if (isValue(nextTarget)) {
			const val = {};
			currTarget[key] = val;
			return val;
		}
		let resultTarget = nextTarget;
		while (Array.isArray(resultTarget)) {
			const lastIndex = resultTarget.length - 1;
			const nextElement = resultTarget[lastIndex];
			if (isValue(nextElement)) {
				const val = {};
				resultTarget[lastIndex] = val;
				return val;
			}
			resultTarget = nextElement;
		}
		return resultTarget;
	}
}
/**
* Set the value to the table.
*/
function set(baseTable, keys, value) {
	let target = baseTable;
	for (let index = 0; index < keys.length - 1; index++) {
		const key = keys[index];
		const nextTarget = target[key];
		if (nextTarget == null) {
			const val = {};
			target[key] = val;
			target = val;
		} else if (isValue(nextTarget) || Array.isArray(nextTarget)) {
			const val = {};
			target[key] = val;
			target = val;
		} else target = nextTarget;
	}
	target[last(keys)] = value;
}
/**
* Check whether the given value is a value.
*/
function isValue(value) {
	return typeof value !== "object" || value instanceof Date;
}

//#endregion
//#region package.json
var name$1 = "toml-eslint-parser";
var version$1 = "1.0.3";

//#endregion
//#region src/meta.ts
var meta_exports = /* @__PURE__ */ __exportAll({
	name: () => name,
	version: () => version
});
const name = name$1;
const version = version$1;

//#endregion
//#region src/index.ts
const VisitorKeys = KEYS;
/**
* Parse TOML source code
*/
function parseTOML(code, options) {
	return parseForESLint(code, options).ast;
}

//#endregion
export { ParseError, VisitorKeys, getStaticTOMLValue, meta_exports as meta, name, parseForESLint, parseTOML, traverseNodes };