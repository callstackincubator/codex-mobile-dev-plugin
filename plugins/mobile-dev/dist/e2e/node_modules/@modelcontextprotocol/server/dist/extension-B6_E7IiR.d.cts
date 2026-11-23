import { A as CacheHint, G as ServerContext, a as McpServer, di as Resource } from "./mcp-DbUPMDd5.cjs";
import { Skill } from "@modelcontextprotocol/core/ext/skills";

//#region src/ext/skills/types.d.ts
/** A problem found while building or serving skills. `path` names the file, folder or URI. */
interface SkillWarning {
  path: string;
  message: string;
}
/** A skill file's content: text (sent as `text`) or bytes (sent as a base64 `blob`). */
type SkillReadResult = {
  text: string;
  mimeType?: string;
} | {
  bytes: Uint8Array;
  mimeType?: string;
};
/** A catalog you build yourself: per-user, generated per request, too large to enumerate, or "dynamic". */
interface SkillSource {
  /** One page of entries; an empty or partial listing is allowed. */
  list(params: {
    cursor?: string;
  }, ctx: ServerContext): Promise<{
    skills: Skill[];
    nextCursor?: string;
  }>;
  /** The entry whose `SKILL.md` is at `uri`, listed or not; `undefined` when none is served. */
  get(uri: string, ctx: ServerContext): Promise<Skill | undefined>;
  /** A skill file's content; `undefined` when no such file is served. */
  read(uri: string, ctx: ServerContext): Promise<SkillReadResult | undefined>;
  /** Direct children of a directory resource; `undefined` when `uri` is not one. Implementing it declares `directoryRead`. */
  readDirectory?(uri: string, params: {
    cursor?: string;
  }, ctx: ServerContext): Promise<{
    resources: Resource[];
    nextCursor?: string;
  } | undefined>;
  /** What appears in `resources/list` (a small set; not paged). Absent: nothing is listed. */
  listResources?(ctx: ServerContext): Promise<Resource[]>;
}
interface SkillsOptions {
  /** `ttlMs` / `cacheScope` for skills/list, skills/get, directory reads and skill files (2026-07-28). Default `0` / `private`. */
  cacheHint?: CacheHint;
  /** Turn problems that are otherwise warnings into errors. Default `false`. */
  strict?: boolean;
  /** Where warnings go. Default: `console.warn` (stderr). */
  onWarning?: (warning: SkillWarning) => void;
}
interface SkillSourceOptions extends SkillsOptions {
  source: SkillSource;
  /** Every URI the source serves starts with this. Default `skill://`. */
  baseUri?: string;
}
/** One child of a directory. `unsupported` marks symlinks and other special files; the catalog skips the skill that contains one. */
interface SkillFileEntry {
  name: string;
  kind: 'file' | 'directory' | 'unsupported';
}
/** Storage adapter for catalogs: two operations over relative, `/`-separated paths (`''` is the root). */
interface SkillFiles {
  list(dir: string): Promise<SkillFileEntry[]>;
  read(path: string): Promise<Uint8Array>;
}
interface SkillCatalogOptions extends SkillsOptions {
  /** Organisational prefix: `'acme'` serves `skill://acme/<skill>/…`. */
  prefix?: string;
  /** Entries per `skills/list` and directory page: a positive integer or `Infinity`. Default 100. */
  pageSize?: number;
  /** Publication limits per skill. Default `SKILL_LIMITS` (512 files, 16 MiB). Beyond them: a warning, or an error under `strict`. */
  limits?: {
    files?: number;
    bytes?: number;
  };
}
/** What a `reload()` changed, as `SKILL.md` URIs. */
interface SkillCatalogChanges {
  added: string[];
  removed: string[];
  changed: string[];
  /**
   * Whether what clients list changed: a skill added or removed, or a `SKILL.md`'s name or description. When
   * `true`, tell clients (`resources/list_changed`); behind `createMcpHandler`, call `handler.notify.resourcesChanged()`.
   */
  listChanged: boolean;
}
//#endregion
//#region src/ext/skills/extension.d.ts
/**
 * The MCP Skills extension (SEP-2640) for one catalog of skills. One instance
 * serves any number of servers: call {@linkcode SkillsExtension.attach} on each
 * (before connecting). Build it from a {@linkcode SkillSource}, or with
 * `SkillsExtension.load(files)` from storage.
 */
declare class SkillsExtension {
  #private;
  readonly id = "io.modelcontextprotocol/skills";
  /**
   * Builds a catalog from storage through a {@linkcode SkillFiles} adapter
   * (`memorySkillFiles`, `nodeSkillFiles`, or your own).
   */
  static load(files: SkillFiles, options?: SkillCatalogOptions): Promise<SkillCatalog>;
  constructor(options: SkillSourceOptions);
  /**
   * Serves these skills on `mcp`: registers the skill resource template and
   * the skills methods, then declares the capability. Must run before
   * connecting. Calling it again for the same server does nothing. One
   * skills extension per server: attaching another one throws and leaves the
   * server as it was, as does attaching to a server that already handles one
   * of the skills methods.
   *
   * @experimental How an extension is wired to a server may change in a minor release.
   */
  attach(mcp: McpServer): void;
}
/**
 * A catalog the SDK built from storage. It holds metadata only: every file
 * read goes through the adapter and is checked against the published entry.
 */
declare class SkillCatalog extends SkillsExtension {
  #private;
  private constructor();
  static load(files: SkillFiles, options?: SkillCatalogOptions): Promise<SkillCatalog>;
  /** The skills this catalog serves, sorted by URI. Frozen (deeply): they are exactly what clients receive. */
  get entries(): readonly Skill[];
  /**
   * Scans the storage again and swaps the new catalog in at once. All or
   * nothing: on failure the old catalog keeps serving. Overlapping calls run
   * one after another.
   *
   * When skills are added or removed, or a `SKILL.md`'s name or description
   * changes, the result has `listChanged: true` and `resources/list_changed`
   * goes out through every attached server that is still connected (stdio,
   * stateful 2025-11-25 HTTP sessions). Servers that `createMcpHandler` builds per
   * request are closed by then, so publish the change on the handler:
   * `if (changes.listChanged) handler.notify.resourcesChanged()`. Where the
   * runtime has no `WeakRef` (Cloudflare Workers with a compatibility date
   * before 2025-05-05), attached servers are not tracked and nothing is sent.
   */
  reload(): Promise<SkillCatalogChanges>;
}
//#endregion
export { SkillFileEntry as a, SkillSource as c, SkillsOptions as d, SkillCatalogOptions as i, SkillSourceOptions as l, SkillsExtension as n, SkillFiles as o, SkillCatalogChanges as r, SkillReadResult as s, SkillCatalog as t, SkillWarning as u };
//# sourceMappingURL=extension-B6_E7IiR.d.cts.map