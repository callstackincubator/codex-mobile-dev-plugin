import { i as jsonSchemaValidator, n as JsonSchemaValidator, t as JsonSchemaType } from "./types-DqbrgVmG.cjs";

//#region ../core-internal/src/validators/fastUriShim.d.ts

/**
 * dts-bundling shim for `fast-uri`.
 *
 * ajv@8.18.0's published .d.ts does `import { URIComponent } from "fast-uri"`,
 * but fast-uri ships its types as `export = namespace`, which rolldown's dts
 * bundler can't destructure into a named import — it drops the import and
 * leaves a dangling `URIComponent` reference in the bundled .d.mts (TS2304 for
 * downstream consumers with `skipLibCheck: false`).
 *
 * The server/client tsdown configs map `fast-uri` to this file via
 * `dts.compilerOptions.paths` so the type is inlined as a plain named export.
 * Runtime code is unaffected (this is a `.d.ts`; the path mapping is dts-only).
 */
// Field-for-field copy of fast-uri@3.1.8's URIComponent (types/index.d.ts).
// Keep in sync when bumping fast-uri/ajv.
interface URIComponent {
  scheme?: string;
  userinfo?: string;
  host?: string;
  port?: number | string;
  path?: string;
  query?: string;
  fragment?: string;
  reference?: string;
  nid?: string;
  nss?: string;
  resourceName?: string;
  secure?: boolean;
  uuid?: string;
  error?: string;
}
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/compile/codegen/code.d.ts
declare abstract class _CodeOrName {
  abstract readonly str: string;
  abstract readonly names: UsedNames;
  abstract toString(): string;
  abstract emptyStr(): boolean;
}
declare class Name extends _CodeOrName {
  readonly str: string;
  constructor(s: string);
  toString(): string;
  emptyStr(): boolean;
  get names(): UsedNames;
}
declare class _Code extends _CodeOrName {
  readonly _items: readonly CodeItem[];
  private _str?;
  private _names?;
  constructor(code: string | readonly CodeItem[]);
  toString(): string;
  emptyStr(): boolean;
  get str(): string;
  get names(): UsedNames;
}
type CodeItem = Name | string | number | boolean | null;
type UsedNames = Record<string, number | undefined>;
type Code = _Code | Name;
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/compile/codegen/scope.d.ts
interface NameGroup {
  prefix: string;
  index: number;
}
interface NameValue {
  ref: ValueReference;
  key?: unknown;
  code?: Code;
}
type ValueReference = unknown;
interface ScopeOptions {
  prefixes?: Set<string>;
  parent?: Scope;
}
interface ValueScopeOptions extends ScopeOptions {
  scope: ScopeStore;
  es5?: boolean;
  lines?: boolean;
}
type ScopeStore = Record<string, ValueReference[] | undefined>;
type ScopeValues = { [Prefix in string]?: Map<unknown, ValueScopeName> };
type ScopeValueSets = { [Prefix in string]?: Set<ValueScopeName> };
declare enum UsedValueState {
  Started = 0,
  Completed = 1,
}
type UsedScopeValues = { [Prefix in string]?: Map<ValueScopeName, UsedValueState | undefined> };
declare class Scope {
  protected readonly _names: { [Prefix in string]?: NameGroup };
  protected readonly _prefixes?: Set<string>;
  protected readonly _parent?: Scope;
  constructor({
    prefixes,
    parent
  }?: ScopeOptions);
  toName(nameOrPrefix: Name | string): Name;
  name(prefix: string): Name;
  protected _newName(prefix: string): string;
  private _nameGroup;
}
interface ScopePath {
  property: string;
  itemIndex: number;
}
declare class ValueScopeName extends Name {
  readonly prefix: string;
  value?: NameValue;
  scopePath?: Code;
  constructor(prefix: string, nameStr: string);
  setValue(value: NameValue, {
    property,
    itemIndex
  }: ScopePath): void;
}
interface VSOptions extends ValueScopeOptions {
  _n: Code;
}
declare class ValueScope extends Scope {
  protected readonly _values: ScopeValues;
  protected readonly _scope: ScopeStore;
  readonly opts: VSOptions;
  constructor(opts: ValueScopeOptions);
  get(): ScopeStore;
  name(prefix: string): ValueScopeName;
  value(nameOrPrefix: ValueScopeName | string, value: NameValue): ValueScopeName;
  getValue(prefix: string, keyOrRef: unknown): ValueScopeName | undefined;
  scopeRefs(scopeName: Name, values?: ScopeValues | ScopeValueSets): Code;
  scopeCode(values?: ScopeValues | ScopeValueSets, usedValues?: UsedScopeValues, getCode?: (n: ValueScopeName) => Code | undefined): Code;
  private _reduceValues;
}
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/compile/codegen/index.d.ts
type SafeExpr = Code | number | boolean | null;
type Block = Code | (() => void);
interface CodeGenOptions {
  es5?: boolean;
  lines?: boolean;
  ownProperties?: boolean;
}
declare class CodeGen {
  readonly _scope: Scope;
  readonly _extScope: ValueScope;
  readonly _values: ScopeValueSets;
  private readonly _nodes;
  private readonly _blockStarts;
  private readonly _constants;
  private readonly opts;
  constructor(extScope: ValueScope, opts?: CodeGenOptions);
  toString(): string;
  name(prefix: string): Name;
  scopeName(prefix: string): ValueScopeName;
  scopeValue(prefixOrName: ValueScopeName | string, value: NameValue): Name;
  getScopeValue(prefix: string, keyOrRef: unknown): ValueScopeName | undefined;
  scopeRefs(scopeName: Name): Code;
  scopeCode(): Code;
  private _def;
  const(nameOrPrefix: Name | string, rhs: SafeExpr, _constant?: boolean): Name;
  let(nameOrPrefix: Name | string, rhs?: SafeExpr, _constant?: boolean): Name;
  var(nameOrPrefix: Name | string, rhs?: SafeExpr, _constant?: boolean): Name;
  assign(lhs: Code, rhs: SafeExpr, sideEffects?: boolean): CodeGen;
  add(lhs: Code, rhs: SafeExpr): CodeGen;
  code(c: Block | SafeExpr): CodeGen;
  object(...keyValues: [Name | string, SafeExpr | string][]): _Code;
  if(condition: Code | boolean, thenBody?: Block, elseBody?: Block): CodeGen;
  elseIf(condition: Code | boolean): CodeGen;
  else(): CodeGen;
  endIf(): CodeGen;
  private _for;
  for(iteration: Code, forBody?: Block): CodeGen;
  forRange(nameOrPrefix: Name | string, from: SafeExpr, to: SafeExpr, forBody: (index: Name) => void, varKind?: Code): CodeGen;
  forOf(nameOrPrefix: Name | string, iterable: Code, forBody: (item: Name) => void, varKind?: Code): CodeGen;
  forIn(nameOrPrefix: Name | string, obj: Code, forBody: (item: Name) => void, varKind?: Code): CodeGen;
  endFor(): CodeGen;
  label(label: Name): CodeGen;
  break(label?: Code): CodeGen;
  return(value: Block | SafeExpr): CodeGen;
  try(tryBody: Block, catchCode?: (e: Name) => void, finallyCode?: Block): CodeGen;
  throw(error: Code): CodeGen;
  block(body?: Block, nodeCount?: number): CodeGen;
  endBlock(nodeCount?: number): CodeGen;
  func(name: Name, args?: Code, async?: boolean, funcBody?: Block): CodeGen;
  endFunc(): CodeGen;
  optimize(n?: number): void;
  private _leafNode;
  private _blockNode;
  private _endBlockNode;
  private _elseNode;
  private get _root();
  private get _currNode();
  private set _currNode(value);
}
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/compile/rules.d.ts
declare const _jsonTypes: readonly ["string", "number", "integer", "boolean", "null", "object", "array"];
type JSONType$1 = (typeof _jsonTypes)[number];
type ValidationTypes = { [K in JSONType$1]: boolean | RuleGroup | undefined };
interface ValidationRules {
  rules: RuleGroup[];
  post: RuleGroup;
  all: { [Key in string]?: boolean | Rule };
  keywords: { [Key in string]?: boolean };
  types: ValidationTypes;
}
interface RuleGroup {
  type?: JSONType$1;
  rules: Rule[];
}
interface Rule {
  keyword: string;
  definition: AddedKeywordDefinition;
}
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/compile/util.d.ts
declare enum Type {
  Num = 0,
  Str = 1,
}
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/compile/validate/subschema.d.ts
type SubschemaArgs = Partial<{
  keyword: string;
  schemaProp: string | number;
  schema: AnySchema;
  schemaPath: Code;
  errSchemaPath: string;
  topSchemaRef: Code;
  data: Name | Code;
  dataProp: Code | string | number;
  dataTypes: JSONType$1[];
  definedProperties: Set<string>;
  propertyName: Name;
  dataPropType: Type;
  jtdDiscriminator: string;
  jtdMetadata: boolean;
  compositeRule: true;
  createErrors: boolean;
  allErrors: boolean;
}>;
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/compile/errors.d.ts
interface ErrorPaths {
  instancePath?: Code;
  schemaPath?: string;
  parentSchema?: boolean;
}
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/compile/validate/index.d.ts
declare class KeywordCxt implements KeywordErrorCxt {
  readonly gen: CodeGen;
  readonly allErrors?: boolean;
  readonly keyword: string;
  readonly data: Name;
  readonly $data?: string | false;
  schema: any;
  readonly schemaValue: Code | number | boolean;
  readonly schemaCode: Code | number | boolean;
  readonly schemaType: JSONType$1[];
  readonly parentSchema: AnySchemaObject;
  readonly errsCount?: Name;
  params: KeywordCxtParams;
  readonly it: SchemaObjCxt;
  readonly def: AddedKeywordDefinition;
  constructor(it: SchemaObjCxt, def: AddedKeywordDefinition, keyword: string);
  result(condition: Code, successAction?: () => void, failAction?: () => void): void;
  failResult(condition: Code, successAction?: () => void, failAction?: () => void): void;
  pass(condition: Code, failAction?: () => void): void;
  fail(condition?: Code): void;
  fail$data(condition: Code): void;
  error(append?: boolean, errorParams?: KeywordCxtParams, errorPaths?: ErrorPaths): void;
  private _error;
  $dataError(): void;
  reset(): void;
  ok(cond: Code | boolean): void;
  setParams(obj: KeywordCxtParams, assign?: true): void;
  block$data(valid: Name, codeBlock: () => void, $dataValid?: Code): void;
  check$data(valid?: Name, $dataValid?: Code): void;
  invalid$data(): Code;
  subschema(appl: SubschemaArgs, valid: Name): SchemaCxt;
  mergeEvaluated(schemaCxt: SchemaCxt, toName?: typeof Name): void;
  mergeValidEvaluated(schemaCxt: SchemaCxt, valid: Name): boolean | void;
}
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/types/json-schema.d.ts
type StrictNullChecksWrapper<Name$1 extends string, Type$1> = undefined extends null ? `strictNullChecks must be true in tsconfig to use ${Name$1}` : Type$1;
type UnionToIntersection<U> = (U extends any ? (_: U) => void : never) extends ((_: infer I) => void) ? I : never;
type UncheckedPartialSchema<T> = Partial<UncheckedJSONSchemaType<T, true>>;
type JSONType<T extends string, IsPartial extends boolean> = IsPartial extends true ? T | undefined : T;
interface NumberKeywords {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  format?: string;
}
interface StringKeywords {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
}
type UncheckedJSONSchemaType<T, IsPartial extends boolean> = (
// these two unions allow arbitrary unions of types
{
  anyOf: readonly UncheckedJSONSchemaType<T, IsPartial>[];
} | {
  oneOf: readonly UncheckedJSONSchemaType<T, IsPartial>[];
} | ({
  type: readonly (T extends number ? JSONType<"number" | "integer", IsPartial> : T extends string ? JSONType<"string", IsPartial> : T extends boolean ? JSONType<"boolean", IsPartial> : never)[];
} & UnionToIntersection<T extends number ? NumberKeywords : T extends string ? StringKeywords : T extends boolean ? {} : never>) | ((T extends number ? {
  type: JSONType<"number" | "integer", IsPartial>;
} & NumberKeywords : T extends string ? {
  type: JSONType<"string", IsPartial>;
} & StringKeywords : T extends boolean ? {
  type: JSONType<"boolean", IsPartial>;
} : T extends readonly [any, ...any[]] ? {
  type: JSONType<"array", IsPartial>;
  items: { readonly [K in keyof T]-?: UncheckedJSONSchemaType<T[K], false> & Nullable<T[K]> } & {
    length: T["length"];
  };
  minItems: T["length"];
} & ({
  maxItems: T["length"];
} | {
  additionalItems: false;
}) : T extends readonly any[] ? {
  type: JSONType<"array", IsPartial>;
  items: UncheckedJSONSchemaType<T[0], false>;
  contains?: UncheckedPartialSchema<T[0]>;
  minItems?: number;
  maxItems?: number;
  minContains?: number;
  maxContains?: number;
  uniqueItems?: true;
  additionalItems?: never;
} : T extends Record<string, any> ? {
  type: JSONType<"object", IsPartial>;
  additionalProperties?: boolean | UncheckedJSONSchemaType<T[string], false>;
  unevaluatedProperties?: boolean | UncheckedJSONSchemaType<T[string], false>;
  properties?: IsPartial extends true ? Partial<UncheckedPropertiesSchema<T>> : UncheckedPropertiesSchema<T>;
  patternProperties?: Record<string, UncheckedJSONSchemaType<T[string], false>>;
  propertyNames?: Omit<UncheckedJSONSchemaType<string, false>, "type"> & {
    type?: "string";
  };
  dependencies?: { [K in keyof T]?: readonly (keyof T)[] | UncheckedPartialSchema<T> };
  dependentRequired?: { [K in keyof T]?: readonly (keyof T)[] };
  dependentSchemas?: { [K in keyof T]?: UncheckedPartialSchema<T> };
  minProperties?: number;
  maxProperties?: number;
} & (IsPartial extends true ? {
  required: readonly (keyof T)[];
} : [UncheckedRequiredMembers<T>] extends [never] ? {
  required?: readonly UncheckedRequiredMembers<T>[];
} : {
  required: readonly UncheckedRequiredMembers<T>[];
}) : T extends null ? {
  type: JSONType<"null", IsPartial>;
  nullable: true;
} : never) & {
  allOf?: readonly UncheckedPartialSchema<T>[];
  anyOf?: readonly UncheckedPartialSchema<T>[];
  oneOf?: readonly UncheckedPartialSchema<T>[];
  if?: UncheckedPartialSchema<T>;
  then?: UncheckedPartialSchema<T>;
  else?: UncheckedPartialSchema<T>;
  not?: UncheckedPartialSchema<T>;
})) & {
  [keyword: string]: any;
  $id?: string;
  $ref?: string;
  $defs?: Record<string, UncheckedJSONSchemaType<Known, true>>;
  definitions?: Record<string, UncheckedJSONSchemaType<Known, true>>;
};
type JSONSchemaType<T> = StrictNullChecksWrapper<"JSONSchemaType", UncheckedJSONSchemaType<T, false>>;
type Known = {
  [key: string]: Known;
} | [Known, ...Known[]] | Known[] | number | string | boolean | null;
type UncheckedPropertiesSchema<T> = { [K in keyof T]-?: (UncheckedJSONSchemaType<T[K], false> & Nullable<T[K]>) | {
  $ref: string;
} };
type UncheckedRequiredMembers<T> = { [K in keyof T]-?: undefined extends T[K] ? never : K }[keyof T];
type Nullable<T> = undefined extends T ? {
  nullable: true;
  const?: null;
  enum?: readonly (T | null)[];
  default?: T | null;
} : {
  nullable?: false;
  const?: T;
  enum?: readonly T[];
  default?: T;
};
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/types/jtd-schema.d.ts
/** numeric strings */
type NumberType = "float32" | "float64" | "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32";
/** string strings */
type StringType = "string" | "timestamp";
/** Generic JTD Schema without inference of the represented type */
type SomeJTDSchemaType = (
// ref
{
  ref: string;
} | {
  type: NumberType | StringType | "boolean";
} | {
  enum: string[];
} | {
  elements: SomeJTDSchemaType;
} | {
  values: SomeJTDSchemaType;
} | {
  properties: Record<string, SomeJTDSchemaType>;
  optionalProperties?: Record<string, SomeJTDSchemaType>;
  additionalProperties?: boolean;
} | {
  properties?: Record<string, SomeJTDSchemaType>;
  optionalProperties: Record<string, SomeJTDSchemaType>;
  additionalProperties?: boolean;
} | {
  discriminator: string;
  mapping: Record<string, SomeJTDSchemaType>;
} | {}) & {
  nullable?: boolean;
  metadata?: Record<string, unknown>;
  definitions?: Record<string, SomeJTDSchemaType>;
};
/** required keys of an object, not undefined */
type RequiredKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? never : K }[keyof T];
/** optional or undifined-able keys of an object */
type OptionalKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? K : never }[keyof T];
/** type is true if T is a union type */
type IsUnion_<T, U extends T = T> = false extends (T extends unknown ? ([U] extends [T] ? false : true) : never) ? false : true;
type IsUnion<T> = IsUnion_<T>;
/** type is true if T is identically E */
type TypeEquality<T, E$1> = [T] extends [E$1] ? ([E$1] extends [T] ? true : false) : false;
/** type is true if T or null is identically E or null*/
type NullTypeEquality<T, E$1> = TypeEquality<T | null, E$1 | null>;
/** gets only the string literals of a type or null if a type isn't a string literal */
type EnumString<T> = [T] extends [never] ? null : T extends string ? string extends T ? null : T : null;
/** true if type is a union of string literals */
type IsEnum<T> = null extends EnumString<T> ? false : true;
/** true only if all types are array types (not tuples) */
type IsElements<T> = false extends IsUnion<T> ? [T] extends [readonly unknown[]] ? undefined extends T[0.5] ? false : true : false : false;
/** true if the the type is a values type */
type IsValues<T> = false extends IsUnion<T> ? TypeEquality<keyof T, string> : false;
/** true if type is a properties type and Union is false, or type is a discriminator type and Union is true */
type IsRecord<T, Union extends boolean> = Union extends IsUnion<T> ? null extends EnumString<keyof T> ? false : true : false;
/** true if type represents an empty record */
type IsEmptyRecord<T> = [T] extends [Record<string, never>] ? [T] extends [never] ? false : true : false;
/** actual schema */
type JTDSchemaType<T, D extends Record<string, unknown> = Record<string, never>> = (
// refs - where null wasn't specified, must match exactly
(null extends EnumString<keyof D> ? never : ({ [K in keyof D]: [T] extends [D[K]] ? {
  ref: K;
} : never }[keyof D] & {
  nullable?: false;
}) | (null extends T ? { [K in keyof D]: [Exclude<T, null>] extends [Exclude<D[K], null>] ? {
  ref: K;
} : never }[keyof D] & {
  nullable: true;
} : never)) | (unknown extends T ? {
  nullable?: boolean;
} : never) | ((true extends NullTypeEquality<T, number> ? {
  type: NumberType;
} : true extends NullTypeEquality<T, boolean> ? {
  type: "boolean";
} : true extends NullTypeEquality<T, string> ? {
  type: StringType;
} : true extends NullTypeEquality<T, Date> ? {
  type: "timestamp";
} : true extends IsEnum<Exclude<T, null>> ? {
  enum: EnumString<Exclude<T, null>>[];
} : true extends IsElements<Exclude<T, null>> ? T extends readonly (infer E)[] ? {
  elements: JTDSchemaType<E, D>;
} : never : true extends IsEmptyRecord<Exclude<T, null>> ? {
  properties: Record<string, never>;
  optionalProperties?: Record<string, never>;
} | {
  optionalProperties: Record<string, never>;
} : true extends IsValues<Exclude<T, null>> ? T extends Record<string, infer V> ? {
  values: JTDSchemaType<V, D>;
} : never : true extends IsRecord<Exclude<T, null>, false> ? ([RequiredKeys<Exclude<T, null>>] extends [never] ? {
  properties?: Record<string, never>;
} : {
  properties: { [K in RequiredKeys<T>]: JTDSchemaType<T[K], D> };
}) & ([OptionalKeys<Exclude<T, null>>] extends [never] ? {
  optionalProperties?: Record<string, never>;
} : {
  optionalProperties: { [K in OptionalKeys<T>]: JTDSchemaType<Exclude<T[K], undefined>, D> };
}) & {
  additionalProperties?: boolean;
} : true extends IsRecord<Exclude<T, null>, true> ? { [K in keyof Exclude<T, null>]-?: Exclude<T, null>[K] extends string ? {
  discriminator: K;
  mapping: { [M in Exclude<T, null>[K]]: JTDSchemaType<Omit<T extends Record<K, M> ? T : never, K>, D> };
} : never }[keyof Exclude<T, null>] : never) & (null extends T ? {
  nullable: true;
} : {
  nullable?: false;
}))) & {
  metadata?: Record<string, unknown>;
  definitions?: { [K in keyof D]: JTDSchemaType<D[K], D> };
};
type JTDDataDef<S, D extends Record<string, unknown>> =
// ref
(S extends {
  ref: string;
} ? D extends { [K in S["ref"]]: infer V } ? JTDDataDef<V, D> : never : S extends {
  type: NumberType;
} ? number : S extends {
  type: "boolean";
} ? boolean : S extends {
  type: "string";
} ? string : S extends {
  type: "timestamp";
} ? string | Date : S extends {
  enum: readonly (infer E)[];
} ? string extends E ? never : [E] extends [string] ? E : never : S extends {
  elements: infer E;
} ? JTDDataDef<E, D>[] : S extends {
  properties: Record<string, unknown>;
  optionalProperties?: Record<string, unknown>;
  additionalProperties?: boolean;
} ? { -readonly [K in keyof S["properties"]]-?: JTDDataDef<S["properties"][K], D> } & { -readonly [K in keyof S["optionalProperties"]]+?: JTDDataDef<S["optionalProperties"][K], D> } & ([S["additionalProperties"]] extends [true] ? Record<string, unknown> : unknown) : S extends {
  properties?: Record<string, unknown>;
  optionalProperties: Record<string, unknown>;
  additionalProperties?: boolean;
} ? { -readonly [K in keyof S["properties"]]-?: JTDDataDef<S["properties"][K], D> } & { -readonly [K in keyof S["optionalProperties"]]+?: JTDDataDef<S["optionalProperties"][K], D> } & ([S["additionalProperties"]] extends [true] ? Record<string, unknown> : unknown) : S extends {
  values: infer V;
} ? Record<string, JTDDataDef<V, D>> : S extends {
  discriminator: infer M;
  mapping: Record<string, unknown>;
} ? [M] extends [string] ? { [K in keyof S["mapping"]]: JTDDataDef<S["mapping"][K], D> & { [KM in M]: K } }[keyof S["mapping"]] : never : unknown) | (S extends {
  nullable: true;
} ? null : never);
type JTDDataType<S> = S extends {
  definitions: Record<string, unknown>;
} ? JTDDataDef<S, S["definitions"]> : JTDDataDef<S, Record<string, never>>;
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/runtime/validation_error.d.ts
declare class ValidationError extends Error {
  readonly errors: Partial<ErrorObject>[];
  readonly ajv: true;
  readonly validation: true;
  constructor(errors: Partial<ErrorObject>[]);
}
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/compile/ref_error.d.ts
declare class MissingRefError extends Error {
  readonly missingRef: string;
  readonly missingSchema: string;
  constructor(resolver: UriResolver, baseId: string, ref: string, msg?: string);
}
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/core.d.ts
interface Plugin<Opts> {
  (ajv: Ajv$2, options?: Opts): Ajv$2;
  [prop: string]: any;
}
type Options = CurrentOptions & DeprecatedOptions;
interface CurrentOptions {
  strict?: boolean | "log";
  strictSchema?: boolean | "log";
  strictNumbers?: boolean | "log";
  strictTypes?: boolean | "log";
  strictTuples?: boolean | "log";
  strictRequired?: boolean | "log";
  allowMatchingProperties?: boolean;
  allowUnionTypes?: boolean;
  validateFormats?: boolean;
  $data?: boolean;
  allErrors?: boolean;
  verbose?: boolean;
  discriminator?: boolean;
  unicodeRegExp?: boolean;
  timestamp?: "string" | "date";
  parseDate?: boolean;
  allowDate?: boolean;
  specialNumbers?: "fast" | "null";
  $comment?: true | ((comment: string, schemaPath?: string, rootSchema?: AnySchemaObject) => unknown);
  formats?: { [Name in string]?: Format };
  keywords?: Vocabulary;
  schemas?: AnySchema[] | { [Key in string]?: AnySchema };
  logger?: Logger | false;
  loadSchema?: (uri: string) => Promise<AnySchemaObject>;
  removeAdditional?: boolean | "all" | "failing";
  useDefaults?: boolean | "empty";
  coerceTypes?: boolean | "array";
  next?: boolean;
  unevaluated?: boolean;
  dynamicRef?: boolean;
  schemaId?: "id" | "$id";
  jtd?: boolean;
  meta?: SchemaObject | boolean;
  defaultMeta?: string | AnySchemaObject;
  validateSchema?: boolean | "log";
  addUsedSchema?: boolean;
  inlineRefs?: boolean | number;
  passContext?: boolean;
  loopRequired?: number;
  loopEnum?: number;
  ownProperties?: boolean;
  multipleOfPrecision?: number;
  int32range?: boolean;
  messages?: boolean;
  code?: CodeOptions;
  uriResolver?: UriResolver;
}
interface CodeOptions {
  es5?: boolean;
  esm?: boolean;
  lines?: boolean;
  optimize?: boolean | number;
  formats?: Code;
  source?: boolean;
  process?: (code: string, schema?: SchemaEnv) => string;
  regExp?: RegExpEngine;
}
interface InstanceCodeOptions extends CodeOptions {
  regExp: RegExpEngine;
  optimize: number;
}
interface DeprecatedOptions {
  /** @deprecated */
  ignoreKeywordsWithRef?: boolean;
  /** @deprecated */
  jsPropertySyntax?: boolean;
  /** @deprecated */
  unicode?: boolean;
}
type RequiredInstanceOptions = { [K in "strictSchema" | "strictNumbers" | "strictTypes" | "strictTuples" | "strictRequired" | "inlineRefs" | "loopRequired" | "loopEnum" | "meta" | "messages" | "schemaId" | "addUsedSchema" | "validateSchema" | "validateFormats" | "int32range" | "unicodeRegExp" | "uriResolver"]: NonNullable<Options[K]> } & {
  code: InstanceCodeOptions;
};
type InstanceOptions = Options & RequiredInstanceOptions;
interface Logger {
  log(...args: unknown[]): unknown;
  warn(...args: unknown[]): unknown;
  error(...args: unknown[]): unknown;
}
declare class Ajv$2 {
  opts: InstanceOptions;
  errors?: ErrorObject[] | null;
  logger: Logger;
  readonly scope: ValueScope;
  readonly schemas: { [Key in string]?: SchemaEnv };
  readonly refs: { [Ref in string]?: SchemaEnv | string };
  readonly formats: { [Name in string]?: AddedFormat };
  readonly RULES: ValidationRules;
  readonly _compilations: Set<SchemaEnv>;
  private readonly _loading;
  private readonly _cache;
  private readonly _metaOpts;
  static ValidationError: typeof ValidationError;
  static MissingRefError: typeof MissingRefError;
  constructor(opts?: Options);
  _addVocabularies(): void;
  _addDefaultMetaSchema(): void;
  defaultMeta(): string | AnySchemaObject | undefined;
  validate(schema: Schema | string, data: unknown): boolean;
  validate(schemaKeyRef: AnySchema | string, data: unknown): boolean | Promise<unknown>;
  validate<T>(schema: Schema | JSONSchemaType<T> | string, data: unknown): data is T;
  validate<T>(schema: JTDSchemaType<T>, data: unknown): data is T;
  validate<N extends never, T extends SomeJTDSchemaType>(schema: T, data: unknown): data is JTDDataType<T>;
  validate<T>(schema: AsyncSchema, data: unknown | T): Promise<T>;
  validate<T>(schemaKeyRef: AnySchema | string, data: unknown): data is T | Promise<T>;
  compile<T = unknown>(schema: Schema | JSONSchemaType<T>, _meta?: boolean): ValidateFunction<T>;
  compile<T = unknown>(schema: JTDSchemaType<T>, _meta?: boolean): ValidateFunction<T>;
  compile<N extends never, T extends SomeJTDSchemaType>(schema: T, _meta?: boolean): ValidateFunction<JTDDataType<T>>;
  compile<T = unknown>(schema: AsyncSchema, _meta?: boolean): AsyncValidateFunction<T>;
  compile<T = unknown>(schema: AnySchema, _meta?: boolean): AnyValidateFunction<T>;
  compileAsync<T = unknown>(schema: SchemaObject | JSONSchemaType<T>, _meta?: boolean): Promise<ValidateFunction<T>>;
  compileAsync<T = unknown>(schema: JTDSchemaType<T>, _meta?: boolean): Promise<ValidateFunction<T>>;
  compileAsync<T = unknown>(schema: AsyncSchema, meta?: boolean): Promise<AsyncValidateFunction<T>>;
  compileAsync<T = unknown>(schema: AnySchemaObject, meta?: boolean): Promise<AnyValidateFunction<T>>;
  addSchema(schema: AnySchema | AnySchema[],
  // If array is passed, `key` will be ignored
  key?: string,
  // Optional schema key. Can be passed to `validate` method instead of schema object or id/ref. One schema per instance can have empty `id` and `key`.
  _meta?: boolean,
  // true if schema is a meta-schema. Used internally, addMetaSchema should be used instead.
  _validateSchema?: boolean | "log"): Ajv$2;
  addMetaSchema(schema: AnySchemaObject, key?: string,
  // schema key
  _validateSchema?: boolean | "log"): Ajv$2;
  validateSchema(schema: AnySchema, throwOrLogError?: boolean): boolean | Promise<unknown>;
  getSchema<T = unknown>(keyRef: string): AnyValidateFunction<T> | undefined;
  removeSchema(schemaKeyRef?: AnySchema | string | RegExp): Ajv$2;
  addVocabulary(definitions: Vocabulary): Ajv$2;
  addKeyword(kwdOrDef: string | KeywordDefinition, def?: KeywordDefinition): Ajv$2;
  getKeyword(keyword: string): AddedKeywordDefinition | boolean;
  removeKeyword(keyword: string): Ajv$2;
  addFormat(name: string, format: Format): Ajv$2;
  errorsText(errors?: ErrorObject[] | null | undefined,
  // optional array of validation errors
  {
    separator,
    dataVar
  }?: ErrorsTextOptions): string;
  $dataMetaSchema(metaSchema: AnySchemaObject, keywordsJsonPointers: string[]): AnySchemaObject;
  private _removeAllSchemas;
  _addSchema(schema: AnySchema, meta?: boolean, baseId?: string, validateSchema?: boolean | "log", addSchema?: boolean): SchemaEnv;
  private _checkUnique;
  private _compileSchemaEnv;
  private _compileMetaSchema;
}
interface ErrorsTextOptions {
  separator?: string;
  dataVar?: string;
}
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/compile/resolve.d.ts
type LocalRefs = { [Ref in string]?: AnySchemaObject };
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/compile/index.d.ts
type SchemaRefs = { [Ref in string]?: SchemaEnv | AnySchema };
interface SchemaCxt {
  readonly gen: CodeGen;
  readonly allErrors?: boolean;
  readonly data: Name;
  readonly parentData: Name;
  readonly parentDataProperty: Code | number;
  readonly dataNames: Name[];
  readonly dataPathArr: (Code | number)[];
  readonly dataLevel: number;
  dataTypes: JSONType$1[];
  definedProperties: Set<string>;
  readonly topSchemaRef: Code;
  readonly validateName: Name;
  evaluated?: Name;
  readonly ValidationError?: Name;
  readonly schema: AnySchema;
  readonly schemaEnv: SchemaEnv;
  readonly rootId: string;
  baseId: string;
  readonly schemaPath: Code;
  readonly errSchemaPath: string;
  readonly errorPath: Code;
  readonly propertyName?: Name;
  readonly compositeRule?: boolean;
  props?: EvaluatedProperties | Name;
  items?: EvaluatedItems | Name;
  jtdDiscriminator?: string;
  jtdMetadata?: boolean;
  readonly createErrors?: boolean;
  readonly opts: InstanceOptions;
  readonly self: Ajv$2;
}
interface SchemaObjCxt extends SchemaCxt {
  readonly schema: AnySchemaObject;
}
interface SchemaEnvArgs {
  readonly schema: AnySchema;
  readonly schemaId?: "$id" | "id";
  readonly root?: SchemaEnv;
  readonly baseId?: string;
  readonly schemaPath?: string;
  readonly localRefs?: LocalRefs;
  readonly meta?: boolean;
}
declare class SchemaEnv implements SchemaEnvArgs {
  readonly schema: AnySchema;
  readonly schemaId?: "$id" | "id";
  readonly root: SchemaEnv;
  baseId: string;
  schemaPath?: string;
  localRefs?: LocalRefs;
  readonly meta?: boolean;
  readonly $async?: boolean;
  readonly refs: SchemaRefs;
  readonly dynamicAnchors: { [Ref in string]?: true };
  validate?: AnyValidateFunction;
  validateName?: ValueScopeName;
  serialize?: (data: unknown) => string;
  serializeName?: ValueScopeName;
  parse?: (data: string) => unknown;
  parseName?: ValueScopeName;
  constructor(env: SchemaEnvArgs);
}
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/types/index.d.ts
interface _SchemaObject {
  id?: string;
  $id?: string;
  $schema?: string;
  [x: string]: any;
}
interface SchemaObject extends _SchemaObject {
  id?: string;
  $id?: string;
  $schema?: string;
  $async?: false;
  [x: string]: any;
}
interface AsyncSchema extends _SchemaObject {
  $async: true;
}
type AnySchemaObject = SchemaObject | AsyncSchema;
type Schema = SchemaObject | boolean;
type AnySchema = Schema | AsyncSchema;
interface SourceCode {
  validateName: ValueScopeName;
  validateCode: string;
  scopeValues: ScopeValueSets;
  evaluated?: Code;
}
interface DataValidationCxt<T extends string | number = string | number> {
  instancePath: string;
  parentData: { [K in T]: any };
  parentDataProperty: T;
  rootData: Record<string, any> | any[];
  dynamicAnchors: { [Ref in string]?: ValidateFunction };
}
interface ValidateFunction<T = unknown> {
  (this: Ajv$2 | any, data: any, dataCxt?: DataValidationCxt): data is T;
  errors?: null | ErrorObject[];
  evaluated?: Evaluated;
  schema: AnySchema;
  schemaEnv: SchemaEnv;
  source?: SourceCode;
}
type EvaluatedProperties = { [K in string]?: true } | true;
type EvaluatedItems = number | true;
interface Evaluated {
  props?: EvaluatedProperties;
  items?: EvaluatedItems;
  dynamicProps: boolean;
  dynamicItems: boolean;
}
interface AsyncValidateFunction<T = unknown> extends ValidateFunction<T> {
  (...args: Parameters<ValidateFunction<T>>): Promise<T>;
  $async: true;
}
type AnyValidateFunction<T = any> = ValidateFunction<T> | AsyncValidateFunction<T>;
interface ErrorObject<K$1 extends string = string, P = Record<string, any>, S = unknown> {
  keyword: K$1;
  instancePath: string;
  schemaPath: string;
  params: P;
  propertyName?: string;
  message?: string;
  schema?: S;
  parentSchema?: AnySchemaObject;
  data?: unknown;
}
interface _KeywordDef {
  keyword: string | string[];
  type?: JSONType$1 | JSONType$1[];
  schemaType?: JSONType$1 | JSONType$1[];
  allowUndefined?: boolean;
  $data?: boolean;
  implements?: string[];
  before?: string;
  post?: boolean;
  metaSchema?: AnySchemaObject;
  validateSchema?: AnyValidateFunction;
  dependencies?: string[];
  error?: KeywordErrorDefinition;
  $dataError?: KeywordErrorDefinition;
}
interface CodeKeywordDefinition extends _KeywordDef {
  code: (cxt: KeywordCxt, ruleType?: string) => void;
  trackErrors?: boolean;
}
type MacroKeywordFunc = (schema: any, parentSchema: AnySchemaObject, it: SchemaCxt) => AnySchema;
type CompileKeywordFunc = (schema: any, parentSchema: AnySchemaObject, it: SchemaObjCxt) => DataValidateFunction;
interface DataValidateFunction {
  (...args: Parameters<ValidateFunction>): boolean | Promise<any>;
  errors?: Partial<ErrorObject>[];
}
interface SchemaValidateFunction {
  (schema: any, data: any, parentSchema?: AnySchemaObject, dataCxt?: DataValidationCxt): boolean | Promise<any>;
  errors?: Partial<ErrorObject>[];
}
interface FuncKeywordDefinition extends _KeywordDef {
  validate?: SchemaValidateFunction | DataValidateFunction;
  compile?: CompileKeywordFunc;
  schema?: boolean;
  modifying?: boolean;
  async?: boolean;
  valid?: boolean;
  errors?: boolean | "full";
}
interface MacroKeywordDefinition extends FuncKeywordDefinition {
  macro: MacroKeywordFunc;
}
type KeywordDefinition = CodeKeywordDefinition | FuncKeywordDefinition | MacroKeywordDefinition;
type AddedKeywordDefinition = KeywordDefinition & {
  type: JSONType$1[];
  schemaType: JSONType$1[];
};
interface KeywordErrorDefinition {
  message: string | Code | ((cxt: KeywordErrorCxt) => string | Code);
  params?: Code | ((cxt: KeywordErrorCxt) => Code);
}
type Vocabulary = (KeywordDefinition | string)[];
interface KeywordErrorCxt {
  gen: CodeGen;
  keyword: string;
  data: Name;
  $data?: string | false;
  schema: any;
  parentSchema?: AnySchemaObject;
  schemaCode: Code | number | boolean;
  schemaValue: Code | number | boolean;
  schemaType?: JSONType$1[];
  errsCount?: Name;
  params: KeywordCxtParams;
  it: SchemaCxt;
}
type KeywordCxtParams = { [P in string]?: Code | string | number };
type FormatValidator<T extends string | number> = (data: T) => boolean;
type FormatCompare<T extends string | number> = (data1: T, data2: T) => number | undefined;
type AsyncFormatValidator<T extends string | number> = (data: T) => Promise<boolean>;
interface FormatDefinition<T extends string | number> {
  type?: T extends string ? "string" | undefined : "number";
  validate: FormatValidator<T> | (T extends string ? string | RegExp : never);
  async?: false | undefined;
  compare?: FormatCompare<T>;
}
interface AsyncFormatDefinition<T extends string | number> {
  type?: T extends string ? "string" | undefined : "number";
  validate: AsyncFormatValidator<T>;
  async: true;
  compare?: FormatCompare<T>;
}
type AddedFormat = true | RegExp | FormatValidator<string> | FormatDefinition<string> | FormatDefinition<number> | AsyncFormatDefinition<string> | AsyncFormatDefinition<number>;
type Format = AddedFormat | string;
interface RegExpEngine {
  (pattern: string, u: string): RegExpLike;
  code: string;
}
interface RegExpLike {
  test: (s: string) => boolean;
}
interface UriResolver {
  parse(uri: string): URIComponent;
  resolve(base: string, path: string): string;
  serialize(component: URIComponent): string;
}
//#endregion
//#region ../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/ajv.d.ts
declare class Ajv$1 extends Ajv$2 {
  _addVocabularies(): void;
  _addDefaultMetaSchema(): void;
  defaultMeta(): string | AnySchemaObject | undefined;
}
//#endregion
//#region ../../node_modules/.pnpm/ajv-formats@3.0.1_ajv@8.18.0/node_modules/ajv-formats/dist/formats.d.ts
type FormatMode = "fast" | "full";
type FormatName = "date" | "time" | "date-time" | "iso-time" | "iso-date-time" | "duration" | "uri" | "uri-reference" | "uri-template" | "url" | "email" | "hostname" | "ipv4" | "ipv6" | "regex" | "uuid" | "json-pointer" | "json-pointer-uri-fragment" | "relative-json-pointer" | "byte" | "int32" | "int64" | "float" | "double" | "password" | "binary";
//#endregion
//#region ../../node_modules/.pnpm/ajv-formats@3.0.1_ajv@8.18.0/node_modules/ajv-formats/dist/index.d.ts
interface FormatOptions {
  mode?: FormatMode;
  formats?: FormatName[];
  keywords?: boolean;
}
type FormatsPluginOptions = FormatName[] | FormatOptions;
interface FormatsPlugin extends Plugin<FormatsPluginOptions> {
  get: (format: FormatName, mode?: FormatMode) => Format;
}
declare const formatsPlugin: FormatsPlugin;
//#endregion
//#region ../core-internal/src/validators/ajvProvider.d.ts
/** Structural subset of the AJV interface used by {@link AjvJsonSchemaValidator}. */
interface AjvLike {
  compile: (schema: unknown) => AjvValidateFunction;
  getSchema: (keyRef: string) => AjvValidateFunction | undefined;
  errorsText: (errors?: any) => string;
}
interface AjvValidateFunction {
  (input: unknown): boolean;
  errors?: any;
}
/** `ajv-formats` default export, normalised through the CJS/ESM interop wrapper. */
declare const addFormats: typeof formatsPlugin.default;
/**
 * AJV-backed JSON Schema validator. See `@modelcontextprotocol/{client,server}/validators/ajv`
 * for the customisation entry point (re-exports `Ajv` and `addFormats` from the bundled copy).
 *
 * Default dispatches on the schema's declared dialect: no `$schema` or 2020-12 → `Ajv2020`
 * (SEP-1613); 2019-09 → `Ajv2019`; draft-07 or draft-06 → the classic draft-07 `Ajv` class
 * (draft-07's changes over draft-06 are additive, so one engine covers both). Known draft-07 deviation: classic Ajv
 * evaluates keywords adjacent to `$ref` (stricter than draft-07's ignore-siblings rule, matching
 * v1's default engine), while the cfworker provider ignores them per spec.
 * Schemas declaring any other `$schema` are
 * rejected with a plain `Error`; pass a pre-configured Ajv instance to validate
 * other dialects. The SDK bundles ajv internally but does not re-export `Ajv2020` (its type
 * graph tips downstream declaration bundling — see #2339). To construct a custom 2020-12
 * instance, add `ajv` to your own dependencies (matching the SDK's pinned version) and
 * `import { Ajv2020 } from 'ajv/dist/2020.js'` — `new Ajv(...)` is the draft-07 class and would
 * silently downgrade dialect.
 *
 * @example Use with default configuration
 * ```ts source="./ajvProvider.examples.ts#AjvJsonSchemaValidator_default"
 * const validator = new AjvJsonSchemaValidator();
 * ```
 *
 * @example Use with a custom AJV instance
 * ```ts source="./ajvProvider.examples.ts#AjvJsonSchemaValidator_customInstance"
 * // import { Ajv2020 } from 'ajv/dist/2020.js';
 * const ajv = new Ajv2020({ strict: false, validateSchema: false, allErrors: true });
 * const validator = new AjvJsonSchemaValidator(ajv);
 * ```
 *
 * @example Register ajv-formats
 * ```ts source="./ajvProvider.examples.ts#AjvJsonSchemaValidator_withFormats"
 * // import { Ajv2020 } from 'ajv/dist/2020.js';
 * const ajv = new Ajv2020({ strict: false, validateSchema: false, allErrors: true });
 * addFormats(ajv);
 * const validator = new AjvJsonSchemaValidator(ajv);
 * ```
 */
declare class AjvJsonSchemaValidator implements jsonSchemaValidator {
  private _ajv;
  /** Lazy classic (draft-07) engine, built on the first draft-07/draft-06-declared schema. */
  private _ajvDraft7;
  /** Lazy 2019-09 engine, built on the first 2019-09-declared schema. */
  private _ajv2019;
  /** True iff the constructor received a caller-supplied engine; the `$schema` dispatch is skipped. */
  private readonly _userAjv;
  /**
   * @param ajv - Optional pre-configured AJV-compatible instance. When supplied, this instance is
   * used for **every** schema regardless of its declared `$schema` (the caller owns dialect
   * choice). When omitted, the provider constructs per-dialect engines (`Ajv2020`, `Ajv2019`,
   * and the classic draft-07 `Ajv` for draft-07/06-declared schemas) with
   * `strict: false`, `validateFormats: true`, `validateSchema: false`, `allErrors: true`, and
   * `ajv-formats` registered — **lazily, on the first {@linkcode getValidator} call needing each**, so
   * constructing the provider (e.g. as the default validator of a `Client`/`Server` that never
   * validates a JSON Schema) does not pay the ajv + ajv-formats instantiation cost. The parameter
   * is typed structurally so consumers who don't pass an instance need not have `ajv` installed.
   */
  constructor(ajv?: AjvLike);
  /** The underlying 2020-12 engine — the default instance is created on first use. */
  private get ajv();
  /**
   * Pick the engine for a schema's declared dialect. A caller-supplied engine is used for
   * every schema — do not second-guess by `$schema` (bring-your-own-validator means
   * bring-your-own-dialect). Otherwise: no `$schema` or 2020-12 → `Ajv2020`; 2019-09 →
   * `Ajv2019`; draft-07 or draft-06 → classic `Ajv`; anything else → `Error`.
   */
  private _engineFor;
  getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T>;
}
/**
 * Draft-07 AJV class, re-exported for consumers who need to opt back to the pre-SEP-1613 default.
 * The full v1-equivalent construction is:
 *
 * ```ts
 * const ajv = new Ajv({ strict: false, validateFormats: true, validateSchema: false, allErrors: true });
 * addFormats(ajv);
 * new AjvJsonSchemaValidator(ajv);
 * ```
 *
 * (omitting `validateSchema: false` makes a 2020-12-stamped `$schema` fail with an opaque
 * "no schema with key or ref …" engine error; omitting `addFormats` silently drops `format`
 * validation that the v1 default had).
 *
 * The SDK bundles ajv internally but does not re-export `Ajv2020` (its type graph tips downstream
 * declaration bundling — see #2339). To construct a custom 2020-12 instance, add `ajv` to your own
 * dependencies (matching the SDK's pinned version) and `import { Ajv2020 } from 'ajv/dist/2020.js'`.
 */
declare const Ajv: typeof Ajv$1;
//#endregion
export { AjvJsonSchemaValidator as n, addFormats as r, Ajv as t };
//# sourceMappingURL=ajvProvider-D4aTKfX2.d.cts.map