const require_dialects = require('./dialects-D8eXzoGv.cjs');

//#region ../../node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/deep-compare-strict.js
function deepCompareStrict(a, b) {
	const typeofa = typeof a;
	if (typeofa !== typeof b) return false;
	if (Array.isArray(a)) {
		if (!Array.isArray(b)) return false;
		const length = a.length;
		if (length !== b.length) return false;
		for (let i = 0; i < length; i++) if (!deepCompareStrict(a[i], b[i])) return false;
		return true;
	}
	if (typeofa === "object") {
		if (!a || !b) return a === b;
		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b);
		if (aKeys.length !== bKeys.length) return false;
		for (const k of aKeys) if (!deepCompareStrict(a[k], b[k])) return false;
		return true;
	}
	return a === b;
}

//#endregion
//#region ../../node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/pointer.js
function encodePointer(p) {
	return encodeURI(escapePointer(p));
}
function escapePointer(p) {
	return p.replace(/~/g, "~0").replace(/\//g, "~1");
}

//#endregion
//#region ../../node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/dereference.js
const schemaArrayKeyword = {
	prefixItems: true,
	items: true,
	allOf: true,
	anyOf: true,
	oneOf: true
};
const schemaMapKeyword = {
	$defs: true,
	definitions: true,
	properties: true,
	patternProperties: true,
	dependentSchemas: true
};
const ignoredKeyword = {
	id: true,
	$id: true,
	$ref: true,
	$schema: true,
	$anchor: true,
	$vocabulary: true,
	$comment: true,
	default: true,
	enum: true,
	const: true,
	required: true,
	type: true,
	maximum: true,
	minimum: true,
	exclusiveMaximum: true,
	exclusiveMinimum: true,
	multipleOf: true,
	maxLength: true,
	minLength: true,
	pattern: true,
	format: true,
	maxItems: true,
	minItems: true,
	uniqueItems: true,
	maxProperties: true,
	minProperties: true
};
let initialBaseURI = typeof self !== "undefined" && self.location && self.location.origin !== "null" ? new URL(self.location.origin + self.location.pathname + location.search) : new URL("https://github.com/cfworker");
function dereference(schema, lookup = Object.create(null), baseURI = initialBaseURI, basePointer = "") {
	if (schema && typeof schema === "object" && !Array.isArray(schema)) {
		const id = schema.$id || schema.id;
		if (id) {
			const url = new URL(id, baseURI.href);
			if (url.hash.length > 1) lookup[url.href] = schema;
			else {
				url.hash = "";
				if (basePointer === "") baseURI = url;
				else dereference(schema, lookup, baseURI);
			}
		}
	} else if (schema !== true && schema !== false) return lookup;
	const schemaURI = baseURI.href + (basePointer ? "#" + basePointer : "");
	if (lookup[schemaURI] !== void 0) throw new Error(`Duplicate schema URI "${schemaURI}".`);
	lookup[schemaURI] = schema;
	if (schema === true || schema === false) return lookup;
	if (schema.__absolute_uri__ === void 0) Object.defineProperty(schema, "__absolute_uri__", {
		enumerable: false,
		value: schemaURI
	});
	if (schema.$ref && schema.__absolute_ref__ === void 0) {
		const url = new URL(schema.$ref, baseURI.href);
		url.hash = url.hash;
		Object.defineProperty(schema, "__absolute_ref__", {
			enumerable: false,
			value: url.href
		});
	}
	if (schema.$recursiveRef && schema.__absolute_recursive_ref__ === void 0) {
		const url = new URL(schema.$recursiveRef, baseURI.href);
		url.hash = url.hash;
		Object.defineProperty(schema, "__absolute_recursive_ref__", {
			enumerable: false,
			value: url.href
		});
	}
	if (schema.$anchor) {
		const url = new URL("#" + schema.$anchor, baseURI.href);
		lookup[url.href] = schema;
	}
	for (let key in schema) {
		if (ignoredKeyword[key]) continue;
		const keyBase = `${basePointer}/${encodePointer(key)}`;
		const subSchema = schema[key];
		if (Array.isArray(subSchema)) {
			if (schemaArrayKeyword[key]) {
				const length = subSchema.length;
				for (let i = 0; i < length; i++) dereference(subSchema[i], lookup, baseURI, `${keyBase}/${i}`);
			}
		} else if (schemaMapKeyword[key]) for (let subKey in subSchema) dereference(subSchema[subKey], lookup, baseURI, `${keyBase}/${encodePointer(subKey)}`);
		else dereference(subSchema, lookup, baseURI, keyBase);
	}
	return lookup;
}

//#endregion
//#region ../../node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/format.js
const DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
const DAYS = [
	0,
	31,
	28,
	31,
	30,
	31,
	30,
	31,
	31,
	30,
	31,
	30,
	31
];
const TIME = /^(\d\d):(\d\d):(\d\d)(\.\d+)?(z|[+-]\d\d(?::?\d\d)?)?$/i;
const HOSTNAME = /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i;
const URIREF = /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
const URITEMPLATE = /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i;
const URL_ = /^(?:(?:https?|ftp):\/\/)(?:\S+(?::\S*)?@)?(?:(?!10(?:\.\d{1,3}){3})(?!127(?:\.\d{1,3}){3})(?!169\.254(?:\.\d{1,3}){2})(?!192\.168(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u{00a1}-\u{ffff}0-9]+-?)*[a-z\u{00a1}-\u{ffff}0-9]+)(?:\.(?:[a-z\u{00a1}-\u{ffff}0-9]+-?)*[a-z\u{00a1}-\u{ffff}0-9]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu;
const UUID = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const JSON_POINTER = /^(?:\/(?:[^~/]|~0|~1)*)*$/;
const JSON_POINTER_URI_FRAGMENT = /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i;
const RELATIVE_JSON_POINTER = /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/;
const EMAIL = (input) => {
	if (input[0] === "\"") return false;
	const [name, host, ...rest] = input.split("@");
	if (!name || !host || rest.length !== 0 || name.length > 64 || host.length > 253) return false;
	if (name[0] === "." || name.endsWith(".") || name.includes("..")) return false;
	if (!/^[a-z0-9.-]+$/i.test(host) || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(name)) return false;
	return host.split(".").every((part) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(part));
};
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
const IPV6 = /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i;
const DURATION = (input) => input.length > 1 && input.length < 80 && (/^P\d+([.,]\d+)?W$/.test(input) || /^P[\dYMDTHS]*(\d[.,]\d+)?[YMDHS]$/.test(input) && /^P([.,\d]+Y)?([.,\d]+M)?([.,\d]+D)?(T([.,\d]+H)?([.,\d]+M)?([.,\d]+S)?)?$/.test(input));
function bind(r) {
	return r.test.bind(r);
}
const format = {
	date,
	time: time.bind(void 0, false),
	"date-time": date_time,
	duration: DURATION,
	uri,
	"uri-reference": bind(URIREF),
	"uri-template": bind(URITEMPLATE),
	url: bind(URL_),
	email: EMAIL,
	hostname: bind(HOSTNAME),
	ipv4: bind(IPV4),
	ipv6: bind(IPV6),
	regex,
	uuid: bind(UUID),
	"json-pointer": bind(JSON_POINTER),
	"json-pointer-uri-fragment": bind(JSON_POINTER_URI_FRAGMENT),
	"relative-json-pointer": bind(RELATIVE_JSON_POINTER)
};
function isLeapYear(year) {
	return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function date(str) {
	const matches = str.match(DATE);
	if (!matches) return false;
	const year = +matches[1];
	const month = +matches[2];
	const day = +matches[3];
	return month >= 1 && month <= 12 && day >= 1 && day <= (month == 2 && isLeapYear(year) ? 29 : DAYS[month]);
}
function time(full, str) {
	const matches = str.match(TIME);
	if (!matches) return false;
	const hour = +matches[1];
	const minute = +matches[2];
	const second = +matches[3];
	const timeZone = !!matches[5];
	return (hour <= 23 && minute <= 59 && second <= 59 || hour == 23 && minute == 59 && second == 60) && (!full || timeZone);
}
const DATE_TIME_SEPARATOR = /t|\s/i;
function date_time(str) {
	const dateTime = str.split(DATE_TIME_SEPARATOR);
	return dateTime.length == 2 && date(dateTime[0]) && time(true, dateTime[1]);
}
const NOT_URI_FRAGMENT = /\/|:/;
const URI_PATTERN = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
function uri(str) {
	return NOT_URI_FRAGMENT.test(str) && URI_PATTERN.test(str);
}
const Z_ANCHOR = /[^\\]\\Z/;
function regex(str) {
	if (Z_ANCHOR.test(str)) return false;
	try {
		new RegExp(str, "u");
		return true;
	} catch (e) {
		return false;
	}
}

//#endregion
//#region ../../node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/ucs2-length.js
function ucs2length(s) {
	let result = 0;
	let length = s.length;
	let index = 0;
	let charCode;
	while (index < length) {
		result++;
		charCode = s.charCodeAt(index++);
		if (charCode >= 55296 && charCode <= 56319 && index < length) {
			charCode = s.charCodeAt(index);
			if ((charCode & 64512) == 56320) index++;
		}
	}
	return result;
}

//#endregion
//#region ../../node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/validate.js
function validate(instance, schema, draft = "2019-09", lookup = dereference(schema), shortCircuit = true, recursiveAnchor = null, instanceLocation = "#", schemaLocation = "#", evaluated = Object.create(null)) {
	if (schema === true) return {
		valid: true,
		errors: []
	};
	if (schema === false) return {
		valid: false,
		errors: [{
			instanceLocation,
			keyword: "false",
			keywordLocation: instanceLocation,
			error: "False boolean schema."
		}]
	};
	const rawInstanceType = typeof instance;
	let instanceType;
	switch (rawInstanceType) {
		case "boolean":
		case "number":
		case "string":
			instanceType = rawInstanceType;
			break;
		case "object":
			if (instance === null) instanceType = "null";
			else if (Array.isArray(instance)) instanceType = "array";
			else instanceType = "object";
			break;
		default: throw new Error(`Instances of "${rawInstanceType}" type are not supported.`);
	}
	const { $ref, $recursiveRef, $recursiveAnchor, type: $type, const: $const, enum: $enum, required: $required, not: $not, anyOf: $anyOf, allOf: $allOf, oneOf: $oneOf, if: $if, then: $then, else: $else, format: $format, properties: $properties, patternProperties: $patternProperties, additionalProperties: $additionalProperties, unevaluatedProperties: $unevaluatedProperties, minProperties: $minProperties, maxProperties: $maxProperties, propertyNames: $propertyNames, dependentRequired: $dependentRequired, dependentSchemas: $dependentSchemas, dependencies: $dependencies, prefixItems: $prefixItems, items: $items, additionalItems: $additionalItems, unevaluatedItems: $unevaluatedItems, contains: $contains, minContains: $minContains, maxContains: $maxContains, minItems: $minItems, maxItems: $maxItems, uniqueItems: $uniqueItems, minimum: $minimum, maximum: $maximum, exclusiveMinimum: $exclusiveMinimum, exclusiveMaximum: $exclusiveMaximum, multipleOf: $multipleOf, minLength: $minLength, maxLength: $maxLength, pattern: $pattern, __absolute_ref__, __absolute_recursive_ref__ } = schema;
	const errors = [];
	if ($recursiveAnchor === true && recursiveAnchor === null) recursiveAnchor = schema;
	if ($recursiveRef === "#") {
		const refSchema = recursiveAnchor === null ? lookup[__absolute_recursive_ref__] : recursiveAnchor;
		const keywordLocation = `${schemaLocation}/$recursiveRef`;
		const result = validate(instance, recursiveAnchor === null ? schema : recursiveAnchor, draft, lookup, shortCircuit, refSchema, instanceLocation, keywordLocation, evaluated);
		if (!result.valid) errors.push({
			instanceLocation,
			keyword: "$recursiveRef",
			keywordLocation,
			error: "A subschema had errors."
		}, ...result.errors);
	}
	if ($ref !== void 0) {
		const refSchema = lookup[__absolute_ref__ || $ref];
		if (refSchema === void 0) {
			let message = `Unresolved $ref "${$ref}".`;
			if (__absolute_ref__ && __absolute_ref__ !== $ref) message += `  Absolute URI "${__absolute_ref__}".`;
			message += `\nKnown schemas:\n- ${Object.keys(lookup).join("\n- ")}`;
			throw new Error(message);
		}
		const keywordLocation = `${schemaLocation}/$ref`;
		const result = validate(instance, refSchema, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, keywordLocation, evaluated);
		if (!result.valid) errors.push({
			instanceLocation,
			keyword: "$ref",
			keywordLocation,
			error: "A subschema had errors."
		}, ...result.errors);
		if (draft === "4" || draft === "7") return {
			valid: errors.length === 0,
			errors
		};
	}
	if (Array.isArray($type)) {
		let length = $type.length;
		let valid = false;
		for (let i = 0; i < length; i++) if (instanceType === $type[i] || $type[i] === "integer" && instanceType === "number" && instance % 1 === 0 && instance === instance) {
			valid = true;
			break;
		}
		if (!valid) errors.push({
			instanceLocation,
			keyword: "type",
			keywordLocation: `${schemaLocation}/type`,
			error: `Instance type "${instanceType}" is invalid. Expected "${$type.join("\", \"")}".`
		});
	} else if ($type === "integer") {
		if (instanceType !== "number" || instance % 1 || instance !== instance) errors.push({
			instanceLocation,
			keyword: "type",
			keywordLocation: `${schemaLocation}/type`,
			error: `Instance type "${instanceType}" is invalid. Expected "${$type}".`
		});
	} else if ($type !== void 0 && instanceType !== $type) errors.push({
		instanceLocation,
		keyword: "type",
		keywordLocation: `${schemaLocation}/type`,
		error: `Instance type "${instanceType}" is invalid. Expected "${$type}".`
	});
	if ($const !== void 0) {
		if (instanceType === "object" || instanceType === "array") {
			if (!deepCompareStrict(instance, $const)) errors.push({
				instanceLocation,
				keyword: "const",
				keywordLocation: `${schemaLocation}/const`,
				error: `Instance does not match ${JSON.stringify($const)}.`
			});
		} else if (instance !== $const) errors.push({
			instanceLocation,
			keyword: "const",
			keywordLocation: `${schemaLocation}/const`,
			error: `Instance does not match ${JSON.stringify($const)}.`
		});
	}
	if ($enum !== void 0) {
		if (instanceType === "object" || instanceType === "array") {
			if (!$enum.some((value) => deepCompareStrict(instance, value))) errors.push({
				instanceLocation,
				keyword: "enum",
				keywordLocation: `${schemaLocation}/enum`,
				error: `Instance does not match any of ${JSON.stringify($enum)}.`
			});
		} else if (!$enum.some((value) => instance === value)) errors.push({
			instanceLocation,
			keyword: "enum",
			keywordLocation: `${schemaLocation}/enum`,
			error: `Instance does not match any of ${JSON.stringify($enum)}.`
		});
	}
	if ($not !== void 0) {
		const keywordLocation = `${schemaLocation}/not`;
		if (validate(instance, $not, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, keywordLocation).valid) errors.push({
			instanceLocation,
			keyword: "not",
			keywordLocation,
			error: "Instance matched \"not\" schema."
		});
	}
	let subEvaluateds = [];
	if ($anyOf !== void 0) {
		const keywordLocation = `${schemaLocation}/anyOf`;
		const errorsLength = errors.length;
		let anyValid = false;
		for (let i = 0; i < $anyOf.length; i++) {
			const subSchema = $anyOf[i];
			const subEvaluated = Object.create(evaluated);
			const result = validate(instance, subSchema, draft, lookup, shortCircuit, $recursiveAnchor === true ? recursiveAnchor : null, instanceLocation, `${keywordLocation}/${i}`, subEvaluated);
			errors.push(...result.errors);
			anyValid = anyValid || result.valid;
			if (result.valid) subEvaluateds.push(subEvaluated);
		}
		if (anyValid) errors.length = errorsLength;
		else errors.splice(errorsLength, 0, {
			instanceLocation,
			keyword: "anyOf",
			keywordLocation,
			error: "Instance does not match any subschemas."
		});
	}
	if ($allOf !== void 0) {
		const keywordLocation = `${schemaLocation}/allOf`;
		const errorsLength = errors.length;
		let allValid = true;
		for (let i = 0; i < $allOf.length; i++) {
			const subSchema = $allOf[i];
			const subEvaluated = Object.create(evaluated);
			const result = validate(instance, subSchema, draft, lookup, shortCircuit, $recursiveAnchor === true ? recursiveAnchor : null, instanceLocation, `${keywordLocation}/${i}`, subEvaluated);
			errors.push(...result.errors);
			allValid = allValid && result.valid;
			if (result.valid) subEvaluateds.push(subEvaluated);
		}
		if (allValid) errors.length = errorsLength;
		else errors.splice(errorsLength, 0, {
			instanceLocation,
			keyword: "allOf",
			keywordLocation,
			error: `Instance does not match every subschema.`
		});
	}
	if ($oneOf !== void 0) {
		const keywordLocation = `${schemaLocation}/oneOf`;
		const errorsLength = errors.length;
		const matches = $oneOf.filter((subSchema, i) => {
			const subEvaluated = Object.create(evaluated);
			const result = validate(instance, subSchema, draft, lookup, shortCircuit, $recursiveAnchor === true ? recursiveAnchor : null, instanceLocation, `${keywordLocation}/${i}`, subEvaluated);
			errors.push(...result.errors);
			if (result.valid) subEvaluateds.push(subEvaluated);
			return result.valid;
		}).length;
		if (matches === 1) errors.length = errorsLength;
		else errors.splice(errorsLength, 0, {
			instanceLocation,
			keyword: "oneOf",
			keywordLocation,
			error: `Instance does not match exactly one subschema (${matches} matches).`
		});
	}
	if (instanceType === "object" || instanceType === "array") Object.assign(evaluated, ...subEvaluateds);
	if ($if !== void 0) {
		const keywordLocation = `${schemaLocation}/if`;
		if (validate(instance, $if, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, keywordLocation, evaluated).valid) {
			if ($then !== void 0) {
				const thenResult = validate(instance, $then, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${schemaLocation}/then`, evaluated);
				if (!thenResult.valid) errors.push({
					instanceLocation,
					keyword: "if",
					keywordLocation,
					error: `Instance does not match "then" schema.`
				}, ...thenResult.errors);
			}
		} else if ($else !== void 0) {
			const elseResult = validate(instance, $else, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${schemaLocation}/else`, evaluated);
			if (!elseResult.valid) errors.push({
				instanceLocation,
				keyword: "if",
				keywordLocation,
				error: `Instance does not match "else" schema.`
			}, ...elseResult.errors);
		}
	}
	if (instanceType === "object") {
		if ($required !== void 0) {
			for (const key of $required) if (!(key in instance)) errors.push({
				instanceLocation,
				keyword: "required",
				keywordLocation: `${schemaLocation}/required`,
				error: `Instance does not have required property "${key}".`
			});
		}
		const keys = Object.keys(instance);
		if ($minProperties !== void 0 && keys.length < $minProperties) errors.push({
			instanceLocation,
			keyword: "minProperties",
			keywordLocation: `${schemaLocation}/minProperties`,
			error: `Instance does not have at least ${$minProperties} properties.`
		});
		if ($maxProperties !== void 0 && keys.length > $maxProperties) errors.push({
			instanceLocation,
			keyword: "maxProperties",
			keywordLocation: `${schemaLocation}/maxProperties`,
			error: `Instance does not have at least ${$maxProperties} properties.`
		});
		if ($propertyNames !== void 0) {
			const keywordLocation = `${schemaLocation}/propertyNames`;
			for (const key in instance) {
				const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
				const result = validate(key, $propertyNames, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, keywordLocation);
				if (!result.valid) errors.push({
					instanceLocation,
					keyword: "propertyNames",
					keywordLocation,
					error: `Property name "${key}" does not match schema.`
				}, ...result.errors);
			}
		}
		if ($dependentRequired !== void 0) {
			const keywordLocation = `${schemaLocation}/dependantRequired`;
			for (const key in $dependentRequired) if (key in instance) {
				const required = $dependentRequired[key];
				for (const dependantKey of required) if (!(dependantKey in instance)) errors.push({
					instanceLocation,
					keyword: "dependentRequired",
					keywordLocation,
					error: `Instance has "${key}" but does not have "${dependantKey}".`
				});
			}
		}
		if ($dependentSchemas !== void 0) for (const key in $dependentSchemas) {
			const keywordLocation = `${schemaLocation}/dependentSchemas`;
			if (key in instance) {
				const result = validate(instance, $dependentSchemas[key], draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${keywordLocation}/${encodePointer(key)}`, evaluated);
				if (!result.valid) errors.push({
					instanceLocation,
					keyword: "dependentSchemas",
					keywordLocation,
					error: `Instance has "${key}" but does not match dependant schema.`
				}, ...result.errors);
			}
		}
		if ($dependencies !== void 0) {
			const keywordLocation = `${schemaLocation}/dependencies`;
			for (const key in $dependencies) if (key in instance) {
				const propsOrSchema = $dependencies[key];
				if (Array.isArray(propsOrSchema)) {
					for (const dependantKey of propsOrSchema) if (!(dependantKey in instance)) errors.push({
						instanceLocation,
						keyword: "dependencies",
						keywordLocation,
						error: `Instance has "${key}" but does not have "${dependantKey}".`
					});
				} else {
					const result = validate(instance, propsOrSchema, draft, lookup, shortCircuit, recursiveAnchor, instanceLocation, `${keywordLocation}/${encodePointer(key)}`);
					if (!result.valid) errors.push({
						instanceLocation,
						keyword: "dependencies",
						keywordLocation,
						error: `Instance has "${key}" but does not match dependant schema.`
					}, ...result.errors);
				}
			}
		}
		const thisEvaluated = Object.create(null);
		let stop = false;
		if ($properties !== void 0) {
			const keywordLocation = `${schemaLocation}/properties`;
			for (const key in $properties) {
				if (!(key in instance)) continue;
				const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
				const result = validate(instance[key], $properties[key], draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, `${keywordLocation}/${encodePointer(key)}`);
				if (result.valid) evaluated[key] = thisEvaluated[key] = true;
				else {
					stop = shortCircuit;
					errors.push({
						instanceLocation,
						keyword: "properties",
						keywordLocation,
						error: `Property "${key}" does not match schema.`
					}, ...result.errors);
					if (stop) break;
				}
			}
		}
		if (!stop && $patternProperties !== void 0) {
			const keywordLocation = `${schemaLocation}/patternProperties`;
			for (const pattern in $patternProperties) {
				const regex$1 = new RegExp(pattern, "u");
				const subSchema = $patternProperties[pattern];
				for (const key in instance) {
					if (!regex$1.test(key)) continue;
					const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
					const result = validate(instance[key], subSchema, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, `${keywordLocation}/${encodePointer(pattern)}`);
					if (result.valid) evaluated[key] = thisEvaluated[key] = true;
					else {
						stop = shortCircuit;
						errors.push({
							instanceLocation,
							keyword: "patternProperties",
							keywordLocation,
							error: `Property "${key}" matches pattern "${pattern}" but does not match associated schema.`
						}, ...result.errors);
					}
				}
			}
		}
		if (!stop && $additionalProperties !== void 0) {
			const keywordLocation = `${schemaLocation}/additionalProperties`;
			for (const key in instance) {
				if (thisEvaluated[key]) continue;
				const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
				const result = validate(instance[key], $additionalProperties, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, keywordLocation);
				if (result.valid) evaluated[key] = true;
				else {
					stop = shortCircuit;
					errors.push({
						instanceLocation,
						keyword: "additionalProperties",
						keywordLocation,
						error: `Property "${key}" does not match additional properties schema.`
					}, ...result.errors);
				}
			}
		} else if (!stop && $unevaluatedProperties !== void 0) {
			const keywordLocation = `${schemaLocation}/unevaluatedProperties`;
			for (const key in instance) if (!evaluated[key]) {
				const subInstancePointer = `${instanceLocation}/${encodePointer(key)}`;
				const result = validate(instance[key], $unevaluatedProperties, draft, lookup, shortCircuit, recursiveAnchor, subInstancePointer, keywordLocation);
				if (result.valid) evaluated[key] = true;
				else errors.push({
					instanceLocation,
					keyword: "unevaluatedProperties",
					keywordLocation,
					error: `Property "${key}" does not match unevaluated properties schema.`
				}, ...result.errors);
			}
		}
	} else if (instanceType === "array") {
		if ($maxItems !== void 0 && instance.length > $maxItems) errors.push({
			instanceLocation,
			keyword: "maxItems",
			keywordLocation: `${schemaLocation}/maxItems`,
			error: `Array has too many items (${instance.length} > ${$maxItems}).`
		});
		if ($minItems !== void 0 && instance.length < $minItems) errors.push({
			instanceLocation,
			keyword: "minItems",
			keywordLocation: `${schemaLocation}/minItems`,
			error: `Array has too few items (${instance.length} < ${$minItems}).`
		});
		const length = instance.length;
		let i = 0;
		let stop = false;
		if ($prefixItems !== void 0) {
			const keywordLocation = `${schemaLocation}/prefixItems`;
			const length2 = Math.min($prefixItems.length, length);
			for (; i < length2; i++) {
				const result = validate(instance[i], $prefixItems[i], draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, `${keywordLocation}/${i}`);
				evaluated[i] = true;
				if (!result.valid) {
					stop = shortCircuit;
					errors.push({
						instanceLocation,
						keyword: "prefixItems",
						keywordLocation,
						error: `Items did not match schema.`
					}, ...result.errors);
					if (stop) break;
				}
			}
		}
		if ($items !== void 0) {
			const keywordLocation = `${schemaLocation}/items`;
			if (Array.isArray($items)) {
				const length2 = Math.min($items.length, length);
				for (; i < length2; i++) {
					const result = validate(instance[i], $items[i], draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, `${keywordLocation}/${i}`);
					evaluated[i] = true;
					if (!result.valid) {
						stop = shortCircuit;
						errors.push({
							instanceLocation,
							keyword: "items",
							keywordLocation,
							error: `Items did not match schema.`
						}, ...result.errors);
						if (stop) break;
					}
				}
			} else for (; i < length; i++) {
				const result = validate(instance[i], $items, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, keywordLocation);
				evaluated[i] = true;
				if (!result.valid) {
					stop = shortCircuit;
					errors.push({
						instanceLocation,
						keyword: "items",
						keywordLocation,
						error: `Items did not match schema.`
					}, ...result.errors);
					if (stop) break;
				}
			}
			if (!stop && $additionalItems !== void 0) {
				const keywordLocation$1 = `${schemaLocation}/additionalItems`;
				for (; i < length; i++) {
					const result = validate(instance[i], $additionalItems, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, keywordLocation$1);
					evaluated[i] = true;
					if (!result.valid) {
						stop = shortCircuit;
						errors.push({
							instanceLocation,
							keyword: "additionalItems",
							keywordLocation: keywordLocation$1,
							error: `Items did not match additional items schema.`
						}, ...result.errors);
					}
				}
			}
		}
		if ($contains !== void 0) if (length === 0 && $minContains === void 0) errors.push({
			instanceLocation,
			keyword: "contains",
			keywordLocation: `${schemaLocation}/contains`,
			error: `Array is empty. It must contain at least one item matching the schema.`
		});
		else if ($minContains !== void 0 && length < $minContains) errors.push({
			instanceLocation,
			keyword: "minContains",
			keywordLocation: `${schemaLocation}/minContains`,
			error: `Array has less items (${length}) than minContains (${$minContains}).`
		});
		else {
			const keywordLocation = `${schemaLocation}/contains`;
			const errorsLength = errors.length;
			let contained = 0;
			for (let j = 0; j < length; j++) {
				const result = validate(instance[j], $contains, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${j}`, keywordLocation);
				if (result.valid) {
					evaluated[j] = true;
					contained++;
				} else errors.push(...result.errors);
			}
			if (contained >= ($minContains || 0)) errors.length = errorsLength;
			if ($minContains === void 0 && $maxContains === void 0 && contained === 0) errors.splice(errorsLength, 0, {
				instanceLocation,
				keyword: "contains",
				keywordLocation,
				error: `Array does not contain item matching schema.`
			});
			else if ($minContains !== void 0 && contained < $minContains) errors.push({
				instanceLocation,
				keyword: "minContains",
				keywordLocation: `${schemaLocation}/minContains`,
				error: `Array must contain at least ${$minContains} items matching schema. Only ${contained} items were found.`
			});
			else if ($maxContains !== void 0 && contained > $maxContains) errors.push({
				instanceLocation,
				keyword: "maxContains",
				keywordLocation: `${schemaLocation}/maxContains`,
				error: `Array may contain at most ${$maxContains} items matching schema. ${contained} items were found.`
			});
		}
		if (!stop && $unevaluatedItems !== void 0) {
			const keywordLocation = `${schemaLocation}/unevaluatedItems`;
			for (; i < length; i++) {
				if (evaluated[i]) continue;
				const result = validate(instance[i], $unevaluatedItems, draft, lookup, shortCircuit, recursiveAnchor, `${instanceLocation}/${i}`, keywordLocation);
				evaluated[i] = true;
				if (!result.valid) errors.push({
					instanceLocation,
					keyword: "unevaluatedItems",
					keywordLocation,
					error: `Items did not match unevaluated items schema.`
				}, ...result.errors);
			}
		}
		if ($uniqueItems) for (let j = 0; j < length; j++) {
			const a = instance[j];
			const ao = typeof a === "object" && a !== null;
			for (let k = 0; k < length; k++) {
				if (j === k) continue;
				const b = instance[k];
				if (a === b || ao && typeof b === "object" && b !== null && deepCompareStrict(a, b)) {
					errors.push({
						instanceLocation,
						keyword: "uniqueItems",
						keywordLocation: `${schemaLocation}/uniqueItems`,
						error: `Duplicate items at indexes ${j} and ${k}.`
					});
					j = Number.MAX_SAFE_INTEGER;
					k = Number.MAX_SAFE_INTEGER;
				}
			}
		}
	} else if (instanceType === "number") {
		if (draft === "4") {
			if ($minimum !== void 0 && ($exclusiveMinimum === true && instance <= $minimum || instance < $minimum)) errors.push({
				instanceLocation,
				keyword: "minimum",
				keywordLocation: `${schemaLocation}/minimum`,
				error: `${instance} is less than ${$exclusiveMinimum ? "or equal to " : ""} ${$minimum}.`
			});
			if ($maximum !== void 0 && ($exclusiveMaximum === true && instance >= $maximum || instance > $maximum)) errors.push({
				instanceLocation,
				keyword: "maximum",
				keywordLocation: `${schemaLocation}/maximum`,
				error: `${instance} is greater than ${$exclusiveMaximum ? "or equal to " : ""} ${$maximum}.`
			});
		} else {
			if ($minimum !== void 0 && instance < $minimum) errors.push({
				instanceLocation,
				keyword: "minimum",
				keywordLocation: `${schemaLocation}/minimum`,
				error: `${instance} is less than ${$minimum}.`
			});
			if ($maximum !== void 0 && instance > $maximum) errors.push({
				instanceLocation,
				keyword: "maximum",
				keywordLocation: `${schemaLocation}/maximum`,
				error: `${instance} is greater than ${$maximum}.`
			});
			if ($exclusiveMinimum !== void 0 && instance <= $exclusiveMinimum) errors.push({
				instanceLocation,
				keyword: "exclusiveMinimum",
				keywordLocation: `${schemaLocation}/exclusiveMinimum`,
				error: `${instance} is less than ${$exclusiveMinimum}.`
			});
			if ($exclusiveMaximum !== void 0 && instance >= $exclusiveMaximum) errors.push({
				instanceLocation,
				keyword: "exclusiveMaximum",
				keywordLocation: `${schemaLocation}/exclusiveMaximum`,
				error: `${instance} is greater than or equal to ${$exclusiveMaximum}.`
			});
		}
		if ($multipleOf !== void 0) {
			const remainder = instance % $multipleOf;
			if (Math.abs(0 - remainder) >= 1.1920929e-7 && Math.abs($multipleOf - remainder) >= 1.1920929e-7) errors.push({
				instanceLocation,
				keyword: "multipleOf",
				keywordLocation: `${schemaLocation}/multipleOf`,
				error: `${instance} is not a multiple of ${$multipleOf}.`
			});
		}
	} else if (instanceType === "string") {
		const length = $minLength === void 0 && $maxLength === void 0 ? 0 : ucs2length(instance);
		if ($minLength !== void 0 && length < $minLength) errors.push({
			instanceLocation,
			keyword: "minLength",
			keywordLocation: `${schemaLocation}/minLength`,
			error: `String is too short (${length} < ${$minLength}).`
		});
		if ($maxLength !== void 0 && length > $maxLength) errors.push({
			instanceLocation,
			keyword: "maxLength",
			keywordLocation: `${schemaLocation}/maxLength`,
			error: `String is too long (${length} > ${$maxLength}).`
		});
		if ($pattern !== void 0 && !new RegExp($pattern, "u").test(instance)) errors.push({
			instanceLocation,
			keyword: "pattern",
			keywordLocation: `${schemaLocation}/pattern`,
			error: `String does not match pattern.`
		});
		if ($format !== void 0 && format[$format] && !format[$format](instance)) errors.push({
			instanceLocation,
			keyword: "format",
			keywordLocation: `${schemaLocation}/format`,
			error: `String does not match format "${$format}".`
		});
	}
	return {
		valid: errors.length === 0,
		errors
	};
}

//#endregion
//#region ../../node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/validator.js
var Validator = class {
	schema;
	draft;
	shortCircuit;
	lookup;
	constructor(schema, draft = "2019-09", shortCircuit = true) {
		this.schema = schema;
		this.draft = draft;
		this.shortCircuit = shortCircuit;
		this.lookup = dereference(schema);
	}
	validate(instance) {
		return validate(instance, this.schema, this.draft, this.lookup, this.shortCircuit);
	}
	addSchema(schema, id) {
		if (id) schema = {
			...schema,
			$id: id
		};
		dereference(schema, this.lookup);
	}
};

//#endregion
//#region ../core-internal/src/validators/cfWorkerProvider.ts
/**
* Cloudflare Worker-compatible JSON Schema validator provider
*
* This provider uses @cfworker/json-schema for validation without code generation,
* making it compatible with edge runtimes like Cloudflare Workers that restrict
* eval and new Function.
*
* @see {@linkcode AjvJsonSchemaValidator} for the Node.js alternative
*/
/**
* `@cfworker/json-schema`-backed JSON Schema validator. See
* `@modelcontextprotocol/{client,server}/validators/cf-worker` for the customisation entry point.
*
* Default dispatches on the schema's declared dialect: no `$schema` or 2020-12 → `'2020-12'`
* (SEP-1613); 2019-09 → `'2019-09'`; draft-07 or draft-06 → `'7'`. Schemas declaring any other `$schema` are rejected
* with a plain `Error`. Passing an explicit `draft` to the constructor
* overrides this — that draft is used for every schema regardless of `$schema`.
*
* Known draft-07 engine gap: `@cfworker/json-schema` does not treat draft-07 `dependencies` as
* a name→subschema map during `$ref` collection, so a dependency entry whose KEY collides with
* a JSON Schema keyword (`type`, `default`, `format`, `required`, `pattern`, …) and whose
* subschema contains a `$ref` throws `Unresolved $ref` at validation time when the dependency
* triggers — data-dependently, not at compile. The Node (classic Ajv) engine handles the same
* schema correctly. Callers that hit this receive the SDK's typed validation error (the throw
* is captured by the validation paths), and the deviation is pinned by a recorded-contract test.
*
* @example Use with default configuration (2020-12, shortcircuit on)
* ```ts source="./cfWorkerProvider.examples.ts#CfWorkerJsonSchemaValidator_default"
* const validator = new CfWorkerJsonSchemaValidator();
* ```
*
* @example Use with custom configuration
* ```ts source="./cfWorkerProvider.examples.ts#CfWorkerJsonSchemaValidator_customConfig"
* const validator = new CfWorkerJsonSchemaValidator({
*     draft: '2020-12',
*     shortcircuit: false // Report all errors
* });
* ```
*/
var CfWorkerJsonSchemaValidator = class {
	shortcircuit;
	/** Caller-supplied draft; when set, the `$schema` check is skipped (caller owns dialect). */
	draft;
	/**
	* Create a validator
	*
	* @param options - Configuration options
	* @param options.shortcircuit - If `true`, stop validation after first error (default: `true`)
	* @param options.draft - JSON Schema draft version to force for every schema. When set, the
	* `$schema` dispatch is skipped. When omitted, the provider dispatches on each schema's
	* declared `$schema` (2020-12, 2019-09, draft-07, draft-06; absent means 2020-12) and rejects others.
	*/
	constructor(options) {
		this.shortcircuit = options?.shortcircuit ?? true;
		this.draft = options?.draft;
	}
	/**
	* Pick the engine draft for a schema's declared dialect (a caller-forced `{draft}` bypasses
	* this — do not second-guess by `$schema`). No `$schema` or 2020-12 → `'2020-12'`; 2019-09 →
	* `'2019-09'`; draft-07 or draft-06 → `'7'`; anything else → `Error`.
	*/
	_draftFor(schema) {
		const dialect = require_dialects.declaredDialect(schema, "pass an explicit { draft } to CfWorkerJsonSchemaValidator to validate other dialects.");
		return dialect === "draft-7" ? "7" : dialect;
	}
	/**
	* Create a validator for the given JSON Schema
	*
	* Unlike AJV, this validator is not cached internally
	*
	* @param schema - Standard JSON Schema object
	* @returns A validator function that validates input data
	*/
	getValidator(schema) {
		const validator = new Validator(schema, this.draft ?? this._draftFor(schema), this.shortcircuit);
		return (input) => {
			const result = validator.validate(input);
			return result.valid ? {
				valid: true,
				data: input,
				errorMessage: void 0
			} : {
				valid: false,
				data: void 0,
				errorMessage: result.errors.map((err) => `${err.instanceLocation}: ${err.error}`).join("; ")
			};
		};
	}
};

//#endregion
Object.defineProperty(exports, 'CfWorkerJsonSchemaValidator', {
  enumerable: true,
  get: function () {
    return CfWorkerJsonSchemaValidator;
  }
});
//# sourceMappingURL=cfWorkerProvider-QxAbCgU1.cjs.map