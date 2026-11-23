//#region packages/platform-android/src/manifest.d.ts
declare function resolveAndroidArchivePackageName$1(archivePath: string, signal?: AbortSignal): Promise<string | undefined>;
//#endregion
//#region src/sdk/artifacts.d.ts
type ResolveAndroidArchivePackageName = typeof resolveAndroidArchivePackageName$1;
declare function resolveAndroidArchivePackageName(...args: Parameters<ResolveAndroidArchivePackageName>): Promise<Awaited<ReturnType<ResolveAndroidArchivePackageName>>>;
//#endregion
export { resolveAndroidArchivePackageName };