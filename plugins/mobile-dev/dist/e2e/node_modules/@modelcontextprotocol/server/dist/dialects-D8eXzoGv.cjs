
//#region ../core-internal/src/validators/dialects.ts
/**
* Canonical `$schema` URIs per supported dialect (http + https variants, trailing-`#` stripped).
*/
const DRAFT_2020_12_URIS = new Set(["https://json-schema.org/draft/2020-12/schema", "http://json-schema.org/draft/2020-12/schema"]);
const DRAFT_2019_09_URIS = new Set(["https://json-schema.org/draft/2019-09/schema", "http://json-schema.org/draft/2019-09/schema"]);
const DRAFT_07_URIS = new Set(["https://json-schema.org/draft-07/schema", "http://json-schema.org/draft-07/schema"]);
const DRAFT_06_URIS = new Set(["https://json-schema.org/draft-06/schema", "http://json-schema.org/draft-06/schema"]);
/**
* Whether a `$schema` value declares the 2019-09 dialect — the only supported dialect with
* `$recursiveRef`/`$recursiveAnchor`. Non-throwing (unlike {@linkcode declaredDialect}) so
* wire-layer callers can consult it for documents whose dialect may be unsupported.
*/
function declares2019Dialect($schema) {
	return typeof $schema === "string" && DRAFT_2019_09_URIS.has($schema.replace(/#$/, ""));
}
/**
* Classify a schema's declared `$schema` dialect. No `$schema` (or a non-string one) means
* 2020-12. Any other dialect throws a plain `Error` with a clear message rather than letting the
* engine crash on an opaque internal error or silently mis-validate; `remedy` names the calling
* provider's escape hatch in that message.
*/
function declaredDialect(schema, remedy) {
	if (!("$schema" in schema) || typeof schema.$schema !== "string") return "2020-12";
	const declared = schema.$schema.replace(/#$/, "");
	if (DRAFT_2020_12_URIS.has(declared)) return "2020-12";
	if (DRAFT_2019_09_URIS.has(declared)) return "2019-09";
	if (DRAFT_07_URIS.has(declared) || DRAFT_06_URIS.has(declared)) return "draft-7";
	throw new Error(`JSON Schema declares an unsupported dialect ("$schema": "${schema.$schema.slice(0, 200)}"). The default validator supports JSON Schema 2020-12, 2019-09, draft-07, and draft-06; ${remedy}`);
}

//#endregion
Object.defineProperty(exports, 'declaredDialect', {
  enumerable: true,
  get: function () {
    return declaredDialect;
  }
});
Object.defineProperty(exports, 'declares2019Dialect', {
  enumerable: true,
  get: function () {
    return declares2019Dialect;
  }
});
//# sourceMappingURL=dialects-D8eXzoGv.cjs.map