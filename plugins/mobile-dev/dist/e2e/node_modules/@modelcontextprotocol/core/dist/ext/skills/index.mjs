import { Ft as PaginatedRequestParamsSchema, Lt as PaginatedResultSchema, fn as ResultSchema, i as BaseRequestParamsSchema, on as ResourceSchema } from "../../schemas-DscsoNZN.mjs";
import * as z from "zod/v4";

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
const SkillDigestSchema = z.string().regex(SKILL_DIGEST_PATTERN, "digest must be \"sha256:\" followed by 64 lowercase hexadecimal characters");
const SkillResourceEntrySchema = z.looseObject({
	uri: z.string(),
	digest: SkillDigestSchema,
	size: z.number().int().nonnegative()
});
const SkillFrontmatterSchema = z.looseObject({
	name: z.string(),
	description: z.string()
}).refine((frontmatter) => Object.getPrototypeOf(frontmatter) === Object.prototype, "frontmatter must not have a \"__proto__\" field");
const SkillResourcesSchema = z.union([z.array(SkillResourceEntrySchema), z.literal("dynamic")]);
const SkillSchema = z.looseObject({
	uri: z.string(),
	frontmatter: SkillFrontmatterSchema,
	resources: SkillResourcesSchema,
	_meta: z.record(z.string(), z.unknown()).optional()
});
const SkillCacheScopeSchema = z.enum(["public", "private"]);
const cacheFields = {
	ttlMs: z.number().int().nonnegative(),
	cacheScope: SkillCacheScopeSchema
};
const ListSkillsResultSchema = z.looseObject({
	...PaginatedResultSchema.shape,
	skills: z.array(SkillSchema),
	...cacheFields
});
const GetSkillRequestParamsSchema = BaseRequestParamsSchema.extend({ uri: z.string() });
const GetSkillResultSchema = z.looseObject({
	...ResultSchema.shape,
	skill: SkillSchema,
	...cacheFields
});
const DirectoryResourceSchema = z.looseObject(ResourceSchema.shape);
const ReadResourceDirectoryRequestParamsSchema = PaginatedRequestParamsSchema.extend({ uri: z.string() });
const ReadResourceDirectoryResultSchema = z.looseObject({
	...PaginatedResultSchema.shape,
	resources: z.array(DirectoryResourceSchema),
	...cacheFields
});
const SkillsCapabilitySchema = z.looseObject({ directoryRead: z.boolean().optional() });

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
export { DIRECTORY_MIME_TYPE, DirectoryResourceSchema, GetSkillRequestParamsSchema, GetSkillResultSchema, PaginatedRequestParamsSchema as ListSkillsRequestParamsSchema, ListSkillsResultSchema, RESOURCES_DIRECTORY_READ_METHOD, ReadResourceDirectoryRequestParamsSchema, ReadResourceDirectoryResultSchema, SKILLS_EXTENSION_ID, SKILLS_GET_METHOD, SKILLS_LIST_METHOD, SKILL_DIGEST_PATTERN, SKILL_LIMITS, SkillCacheScopeSchema, SkillDigestSchema, SkillFrontmatterSchema, SkillResourceEntrySchema, SkillResourcesSchema, SkillSchema, SkillsCapabilitySchema, skillsCapabilityOf };
//# sourceMappingURL=index.mjs.map