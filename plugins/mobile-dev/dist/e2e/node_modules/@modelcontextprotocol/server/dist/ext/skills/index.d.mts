import "../../mcp-BCJHyo7l.mjs";
import { a as SkillFileEntry, c as SkillSource, d as SkillsOptions, i as SkillCatalogOptions, l as SkillSourceOptions, n as SkillsExtension, o as SkillFiles, r as SkillCatalogChanges, s as SkillReadResult, t as SkillCatalog, u as SkillWarning } from "../../extension-B1GvIBnG.mjs";
import { DIRECTORY_MIME_TYPE, DirectoryResource, GetSkillResult, ListSkillsResult, RESOURCES_DIRECTORY_READ_METHOD, ReadResourceDirectoryResult, SKILLS_EXTENSION_ID, SKILLS_GET_METHOD, SKILLS_LIST_METHOD, SKILL_LIMITS, Skill, Skill as Skill$1, SkillCacheScope, SkillFrontmatter, SkillResourceEntry, SkillResources, SkillsCapability } from "@modelcontextprotocol/core/ext/skills";

//#region src/ext/skills/errors.d.ts
/**
 * Thrown when a skill catalog cannot be built: storage failures always, skill problems under `strict`.
 * Branded, so `instanceof` also matches an instance from another bundled copy of the SDK.
 */
declare class SkillCatalogError extends Error {
  static [Symbol.hasInstance](value: unknown): boolean;
  /**
   * Brand-based type guard: equivalent to `value instanceof this`, as an
   * explicit static predicate (the axios/AWS-SDK `isInstance` style). Must be
   * invoked on the class — in callback position write
   * `v => SkillCatalogError.isInstance(v)`, not `.filter(SkillCatalogError.isInstance)`.
   */
  static isInstance<T extends abstract new (...args: never[]) => unknown>(this: T, value: unknown): value is InstanceType<T>;
  readonly problems: readonly SkillWarning[];
  constructor(problems: readonly SkillWarning[]);
}
//#endregion
//#region src/ext/skills/files.d.ts
/**
 * An in-memory adapter. The record is re-read whenever a walk starts — `list('')` — so `reload()` sees later changes.
 * Other calls use the index from that read (built on first use if no walk has started), so their cost does not grow
 * with the record. File contents are always read live.
 */
declare function memorySkillFiles(files: Record<string, string | Uint8Array>): SkillFiles;
//#endregion
//#region src/ext/skills/skillEntry.d.ts
/**
 * Builds a valid entry — digests, sizes, frontmatter, rule checks — from one
 * skill's files. Keys are paths under the skill's folder (`SKILL.md`,
 * `references/GUIDE.md`). For `SkillSource` authors who publish digests.
 */
declare function skillEntry(skillPath: string, files: Record<string, string | Uint8Array>, options?: {
  baseUri?: string;
}): Promise<Skill$1>;
//#endregion
export { DIRECTORY_MIME_TYPE, type DirectoryResource, type GetSkillResult, type ListSkillsResult, RESOURCES_DIRECTORY_READ_METHOD, type ReadResourceDirectoryResult, SKILLS_EXTENSION_ID, SKILLS_GET_METHOD, SKILLS_LIST_METHOD, SKILL_LIMITS, type Skill, type SkillCacheScope, SkillCatalog, type SkillCatalogChanges, SkillCatalogError, type SkillCatalogOptions, type SkillFileEntry, type SkillFiles, type SkillFrontmatter, type SkillReadResult, type SkillResourceEntry, type SkillResources, type SkillSource, type SkillSourceOptions, type SkillWarning, type SkillsCapability, SkillsExtension, type SkillsOptions, memorySkillFiles, skillEntry };
//# sourceMappingURL=index.d.mts.map