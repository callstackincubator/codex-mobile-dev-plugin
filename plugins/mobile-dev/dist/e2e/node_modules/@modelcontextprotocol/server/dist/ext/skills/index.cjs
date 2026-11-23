const require_chunk = require('../../chunk-Bnu9O96Y.cjs');
require('../../mcp-uPg2RfP3.cjs');
require('../../src-BvE2tDzk.cjs');
const require_extension = require('../../extension-Co9uP6Ds.cjs');
let _modelcontextprotocol_core_ext_skills = require("@modelcontextprotocol/core/ext/skills");

//#region src/ext/skills/skillEntry.ts
/**
* Builds a valid entry — digests, sizes, frontmatter, rule checks — from one
* skill's files. Keys are paths under the skill's folder (`SKILL.md`,
* `references/GUIDE.md`). For `SkillSource` authors who publish digests.
*/
async function skillEntry(skillPath, files, options = {}) {
	const segments = require_extension.splitRelativePath(skillPath, "skillPath");
	const baseUri = options.baseUri ?? "skill://";
	const inputs = Object.entries(files).map(([path, content]) => ({
		uri: require_extension.joinUri(baseUri, [...segments, ...require_extension.splitRelativePath(path, "file path")]),
		bytes: typeof content === "string" ? require_extension.encodeUtf8(content) : content
	}));
	const { skill, problems } = await require_extension.buildSkillEntry(require_extension.joinUri(baseUri, [...segments, "SKILL.md"]), inputs);
	if (skill === void 0 || problems.length > 0) throw new require_extension.SkillCatalogError(problems.map((message) => ({
		path: skillPath,
		message
	})));
	return skill;
}

//#endregion
Object.defineProperty(exports, 'DIRECTORY_MIME_TYPE', {
  enumerable: true,
  get: function () {
    return _modelcontextprotocol_core_ext_skills.DIRECTORY_MIME_TYPE;
  }
});
Object.defineProperty(exports, 'RESOURCES_DIRECTORY_READ_METHOD', {
  enumerable: true,
  get: function () {
    return _modelcontextprotocol_core_ext_skills.RESOURCES_DIRECTORY_READ_METHOD;
  }
});
Object.defineProperty(exports, 'SKILLS_EXTENSION_ID', {
  enumerable: true,
  get: function () {
    return _modelcontextprotocol_core_ext_skills.SKILLS_EXTENSION_ID;
  }
});
Object.defineProperty(exports, 'SKILLS_GET_METHOD', {
  enumerable: true,
  get: function () {
    return _modelcontextprotocol_core_ext_skills.SKILLS_GET_METHOD;
  }
});
Object.defineProperty(exports, 'SKILLS_LIST_METHOD', {
  enumerable: true,
  get: function () {
    return _modelcontextprotocol_core_ext_skills.SKILLS_LIST_METHOD;
  }
});
Object.defineProperty(exports, 'SKILL_LIMITS', {
  enumerable: true,
  get: function () {
    return _modelcontextprotocol_core_ext_skills.SKILL_LIMITS;
  }
});
exports.SkillCatalog = require_extension.SkillCatalog;
exports.SkillCatalogError = require_extension.SkillCatalogError;
exports.SkillsExtension = require_extension.SkillsExtension;
exports.memorySkillFiles = require_extension.memorySkillFiles;
exports.skillEntry = skillEntry;
//# sourceMappingURL=index.cjs.map