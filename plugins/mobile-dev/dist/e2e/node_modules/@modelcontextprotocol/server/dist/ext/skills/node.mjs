import "../../mcp-oHn3ureC.mjs";
import "../../src-DdvbAHrR.mjs";
import { i as splitRelativePath, n as SkillsExtension } from "../../extension-Pm4HwRE6.mjs";
import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import path from "node:path";

//#region src/ext/skills/fsPath.ts
const escapes = (relative) => /* @__PURE__ */ new TypeError(`path must be a relative path that stays inside the skills folder (got ${JSON.stringify(relative)})`);
function fsPathWithin(rules, base, relative) {
	if (relative === "") return base;
	const segments = splitRelativePath(relative, "path");
	if (segments.some((segment) => segment.split(rules.sep).includes(".."))) throw escapes(relative);
	const full = rules.join(base, ...segments);
	const inside = rules.relative(base, full);
	if (inside === ".." || inside.startsWith(`..${rules.sep}`) || rules.isAbsolute(inside)) throw escapes(relative);
	return full;
}

//#endregion
//#region src/ext/skills/node.ts
function kindOf(entry) {
	if (entry.isFile()) return "file";
	if (entry.isDirectory()) return "directory";
	return "unsupported";
}
/**
* A {@linkcode SkillFiles} adapter over a folder. `list` reports symlinks and
* other special files as `unsupported`, so a catalog skips the skill that
* contains one. `read` refuses anything that is not a regular file, and a
* symlink as the final path component where the platform has `O_NOFOLLOW`;
* symlinked folders earlier in a path passed to it directly are not checked.
* Both throw a `TypeError` for a path that could leave `root` (a `..`
* segment, also `..\` on Windows).
*/
function nodeSkillFiles(root) {
	const base = path.resolve(root);
	const toFsPath = (relative) => fsPathWithin(path, base, relative);
	return {
		async list(dir) {
			return (await readdir(toFsPath(dir), { withFileTypes: true })).map((entry) => ({
				name: entry.name,
				kind: kindOf(entry)
			}));
		},
		async read(relative) {
			const handle = await open(toFsPath(relative), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
			try {
				if (!(await handle.stat()).isFile()) throw new Error(`${relative} is not a regular file`);
				const buffer = await handle.readFile();
				return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
			} finally {
				await handle.close();
			}
		}
	};
}
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
function loadSkills(root, options) {
	return SkillsExtension.load(nodeSkillFiles(root), options);
}

//#endregion
export { loadSkills, nodeSkillFiles };
//# sourceMappingURL=node.mjs.map