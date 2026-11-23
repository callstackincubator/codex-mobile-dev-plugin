const require_schemas = require('../../schemas-lGLjBX8n.cjs');
let zod_v4 = require("zod/v4");
zod_v4 = require_schemas.__toESM(zod_v4);

//#region src/ext/skills/constants.ts
/**
* Wire constants for the MCP Skills extension (SEP-2640).
*
* Runtime-neutral: this module imports nothing.
*/
/** The identifier a server advertises in `ServerCapabilities.extensions`. */
const SKILLS_EXTENSION_ID = "io.modelcontextprotocol/skills";
/** Enumerates the skills a server serves. */
const SKILLS_LIST_METHOD = "skills/list";
/** Returns one skill's entry by its `SKILL.md` URI, listed or not. */
const SKILLS_GET_METHOD = "skills/get";
/** Lists the direct children of a directory resource (gated by `directoryRead`). */
const RESOURCES_DIRECTORY_READ_METHOD = "resources/directory/read";
/** The `mimeType` of a directory resource. */
const DIRECTORY_MIME_TYPE = "inode/directory";
/**
* Per-skill interoperability limits. Hosts MUST accept skills up to these;
* servers SHOULD NOT publish skills over them.
*/
const SKILL_LIMITS = Object.freeze({
	files: 512,
	bytes: 16777216
});
/** `sha256:` followed by 64 lowercase hexadecimal characters. */
const SKILL_DIGEST_PATTERN = /^sha256:[\da-f]{64}$/;

//#endregion
//#region src/ext/skills/schemas.ts
const SkillDigestSchema = zod_v4.string().regex(SKILL_DIGEST_PATTERN, "digest must be \"sha256:\" followed by 64 lowercase hexadecimal characters");
const SkillResourceEntrySchema = zod_v4.looseObject({
	uri: zod_v4.string(),
	digest: SkillDigestSchema,
	size: zod_v4.number().int().nonnegative()
});
const SkillFrontmatterSchema = zod_v4.looseObject({
	name: zod_v4.string(),
	description: zod_v4.string()
}).refine((frontmatter) => Object.getPrototypeOf(frontmatter) === Object.prototype, "frontmatter must not have a \"__proto__\" field");
const SkillResourcesSchema = zod_v4.union([zod_v4.array(SkillResourceEntrySchema), zod_v4.literal("dynamic")]);
const SkillSchema = zod_v4.looseObject({
	uri: zod_v4.string(),
	frontmatter: SkillFrontmatterSchema,
	resources: SkillResourcesSchema,
	_meta: zod_v4.record(zod_v4.string(), zod_v4.unknown()).optional()
});
const SkillCacheScopeSchema = zod_v4.enum(["public", "private"]);
const cacheFields = {
	ttlMs: zod_v4.number().int().nonnegative(),
	cacheScope: SkillCacheScopeSchema
};
const ListSkillsResultSchema = zod_v4.looseObject({
	...require_schemas.PaginatedResultSchema.shape,
	skills: zod_v4.array(SkillSchema),
	...cacheFields
});
const GetSkillRequestParamsSchema = require_schemas.BaseRequestParamsSchema.extend({ uri: zod_v4.string() });
const GetSkillResultSchema = zod_v4.looseObject({
	...require_schemas.ResultSchema.shape,
	skill: SkillSchema,
	...cacheFields
});
const DirectoryResourceSchema = zod_v4.looseObject(require_schemas.ResourceSchema.shape);
const ReadResourceDirectoryRequestParamsSchema = require_schemas.PaginatedRequestParamsSchema.extend({ uri: zod_v4.string() });
const ReadResourceDirectoryResultSchema = zod_v4.looseObject({
	...require_schemas.PaginatedResultSchema.shape,
	resources: zod_v4.array(DirectoryResourceSchema),
	...cacheFields
});
const SkillsCapabilitySchema = zod_v4.looseObject({ directoryRead: zod_v4.boolean().optional() });

//#endregion
//#region src/ext/skills/capability.ts
/**
* Reads the Skills extension capability out of a peer's advertised
* capabilities, returning `undefined` when the peer does not advertise the
* extension or advertises a malformed value.
*
* Shared by both roles: servers use it to check what they published, clients
* to gate `skills/list` / `skills/get` on negotiation.
*/
function skillsCapabilityOf(capabilities) {
	const declared = capabilities?.extensions?.[SKILLS_EXTENSION_ID];
	if (declared === void 0) return;
	const parsed = SkillsCapabilitySchema.safeParse(declared);
	return parsed.success ? parsed.data : void 0;
}

//#endregion
exports.DIRECTORY_MIME_TYPE = DIRECTORY_MIME_TYPE;
exports.DirectoryResourceSchema = DirectoryResourceSchema;
exports.GetSkillRequestParamsSchema = GetSkillRequestParamsSchema;
exports.GetSkillResultSchema = GetSkillResultSchema;
exports.ListSkillsRequestParamsSchema = require_schemas.PaginatedRequestParamsSchema;
exports.ListSkillsResultSchema = ListSkillsResultSchema;
exports.RESOURCES_DIRECTORY_READ_METHOD = RESOURCES_DIRECTORY_READ_METHOD;
exports.ReadResourceDirectoryRequestParamsSchema = ReadResourceDirectoryRequestParamsSchema;
exports.ReadResourceDirectoryResultSchema = ReadResourceDirectoryResultSchema;
exports.SKILLS_EXTENSION_ID = SKILLS_EXTENSION_ID;
exports.SKILLS_GET_METHOD = SKILLS_GET_METHOD;
exports.SKILLS_LIST_METHOD = SKILLS_LIST_METHOD;
exports.SKILL_DIGEST_PATTERN = SKILL_DIGEST_PATTERN;
exports.SKILL_LIMITS = SKILL_LIMITS;
exports.SkillCacheScopeSchema = SkillCacheScopeSchema;
exports.SkillDigestSchema = SkillDigestSchema;
exports.SkillFrontmatterSchema = SkillFrontmatterSchema;
exports.SkillResourceEntrySchema = SkillResourceEntrySchema;
exports.SkillResourcesSchema = SkillResourcesSchema;
exports.SkillSchema = SkillSchema;
exports.SkillsCapabilitySchema = SkillsCapabilitySchema;
exports.skillsCapabilityOf = skillsCapabilityOf;
//# sourceMappingURL=index.cjs.map