//#region src/platforms/install-source.d.ts
type MaterializeInstallSource = {
  kind: 'url';
  url: string;
  headers?: Record<string, string>;
} | {
  kind: 'path';
  path: string;
};
/**
 * @public Archive extensions accepted by install-source resolution.
 */
declare const ARCHIVE_EXTENSIONS: readonly [".zip", ".tar", ".tar.gz", ".tgz"];
declare function validateDownloadSourceUrl(parsedUrl: URL): Promise<void>;
declare function isTrustedInstallSourceUrl(sourceUrl: string | URL): boolean;
//#endregion
export { ARCHIVE_EXTENSIONS, type MaterializeInstallSource, isTrustedInstallSourceUrl, validateDownloadSourceUrl };