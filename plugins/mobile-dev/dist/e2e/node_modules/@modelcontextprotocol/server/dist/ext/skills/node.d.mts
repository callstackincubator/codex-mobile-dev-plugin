import "../../mcp-BCJHyo7l.mjs";
import { i as SkillCatalogOptions, o as SkillFiles, t as SkillCatalog } from "../../extension-B1GvIBnG.mjs";

//#region src/ext/skills/node.d.ts

/**
 * A {@linkcode SkillFiles} adapter over a folder. `list` reports symlinks and
 * other special files as `unsupported`, so a catalog skips the skill that
 * contains one. `read` refuses anything that is not a regular file, and a
 * symlink as the final path component where the platform has `O_NOFOLLOW`;
 * symlinked folders earlier in a path passed to it directly are not checked.
 * Both throw a `TypeError` for a path that could leave `root` (a `..`
 * segment, also `..\` on Windows).
 */
declare function nodeSkillFiles(root: string): SkillFiles;
/**
 * Loads every skill under `root` (a folder of skill folders, each with a
 * `SKILL.md`) into a {@linkcode SkillCatalog}. Same as
 * `SkillsExtension.load(nodeSkillFiles(root), options)`.
 *
 * @example
 * ```ts
 * const skills = await loadSkills('./skills');
 * skills.attach(mcp);
 * ```
 */
declare function loadSkills(root: string, options?: SkillCatalogOptions): Promise<SkillCatalog>;
//#endregion
export { loadSkills, nodeSkillFiles };
//# sourceMappingURL=node.d.mts.map