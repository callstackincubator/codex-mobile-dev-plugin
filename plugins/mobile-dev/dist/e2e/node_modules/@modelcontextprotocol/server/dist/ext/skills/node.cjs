const require_chunk = require('../../chunk-Bnu9O96Y.cjs');
require('../../mcp-uPg2RfP3.cjs');
require('../../src-BvE2tDzk.cjs');
const require_extension = require('../../extension-Co9uP6Ds.cjs');
let node_fs = require("node:fs");
let node_fs_promises = require("node:fs/promises");
let node_path = require("node:path");
node_path = require_chunk.__toESM(node_path);

//#region src/ext/skills/fsPath.ts
const escapes = (relative) => /* @__PURE__ */ new TypeError(`path must be a relative path that stays inside the skills folder (got ${JSON.stringify(relative)})`);
function fsPathWithin(rules, base, relative) {
	if (relative === "") return base;
	const segments = require_extension.splitRelativePath(relative, "path");
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
	const base = node_path.default.resolve(root);
	const toFsPath = (relative) => fsPathWithin(node_path.default, base, relative);
	return {
		async list(dir) {
			return (await (0, node_fs_promises.readdir)(toFsPath(dir), { withFileTypes: true })).map((entry) => ({
				name: entry.name,
				kind: kindOf(entry)
			}));
		},
		async read(relative) {
			const handle = await (0, node_fs_promises.open)(toFsPath(relative), node_fs.constants.O_RDONLY | (node_fs.constants.O_NOFOLLOW ?? 0));
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
	return require_extension.SkillsExtension.load(nodeSkillFiles(root), options);
}

//#endregion
exports.loadSkills = loadSkills;
exports.nodeSkillFiles = nodeSkillFiles;
//# sourceMappingURL=node.cjs.map