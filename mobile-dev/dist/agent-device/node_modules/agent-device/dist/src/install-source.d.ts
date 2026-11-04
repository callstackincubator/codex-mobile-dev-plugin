import { p as LocalInstallSource } from "./sdk-contracts.js";
//#region packages/provision-kit/src/install-source.d.ts
/**
 * @public Archive extensions accepted by install-source resolution.
 */
declare const ARCHIVE_EXTENSIONS: readonly [".zip", ".tar", ".tar.gz", ".tgz"];
declare function validateDownloadSourceUrl(parsedUrl: URL): Promise<void>;
/**
 * @deprecated agent-device does not gate install sources on this check: URL sources from any
 * public host may point at an installable or an archive containing one. This only classifies
 * whether a URL names a GitHub Actions or EAS artifact, which says nothing about who built it.
 */
declare function isTrustedInstallSourceUrl(sourceUrl: string | URL): boolean;
//#endregion
export { ARCHIVE_EXTENSIONS, type LocalInstallSource as MaterializeInstallSource, isTrustedInstallSourceUrl, validateDownloadSourceUrl };