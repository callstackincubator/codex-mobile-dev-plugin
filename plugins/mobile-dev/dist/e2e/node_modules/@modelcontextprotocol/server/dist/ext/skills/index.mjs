import "../../mcp-oHn3ureC.mjs";
import "../../src-DdvbAHrR.mjs";
import { a as buildSkillEntry, c as SkillCatalogError, i as splitRelativePath, n as SkillsExtension, o as joinUri, r as memorySkillFiles, s as encodeUtf8, t as SkillCatalog } from "../../extension-Pm4HwRE6.mjs";
import { DIRECTORY_MIME_TYPE, RESOURCES_DIRECTORY_READ_METHOD, SKILLS_EXTENSION_ID, SKILLS_GET_METHOD, SKILLS_LIST_METHOD, SKILL_LIMITS } from "@modelcontextprotocol/core/ext/skills";

//#region src/ext/skills/skillEntry.ts
/**
* Builds a valid entry — digests, sizes, frontmatter, rule checks — from one
* skill's files. Keys are paths under the skill's folder (`SKILL.md`,
* `references/GUIDE.md`). For `SkillSource` authors who publish digests.
*/
async function skillEntry(skillPath, files, options = {}) {
	const segments = splitRelativePath(skillPath, "skillPath");
	const baseUri = options.baseUri ?? "skill://";
	const inputs = Object.entries(files).map(([path, content]) => ({
		uri: joinUri(baseUri, [...segments, ...splitRelativePath(path, "file path")]),
		bytes: typeof content === "string" ? encodeUtf8(content) : content
	}));
	const { skill, problems } = await buildSkillEntry(joinUri(baseUri, [...segments, "SKILL.md"]), inputs);
	if (skill === void 0 || problems.length > 0) throw new SkillCatalogError(problems.map((message) => ({
		path: skillPath,
		message
	})));
	return skill;
}

//#endregion
export { DIRECTORY_MIME_TYPE, RESOURCES_DIRECTORY_READ_METHOD, SKILLS_EXTENSION_ID, SKILLS_GET_METHOD, SKILLS_LIST_METHOD, SKILL_LIMITS, SkillCatalog, SkillCatalogError, SkillsExtension, memorySkillFiles, skillEntry };
//# sourceMappingURL=index.mjs.map