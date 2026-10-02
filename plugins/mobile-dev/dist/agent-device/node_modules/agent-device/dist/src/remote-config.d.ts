import { n as RemoteConfigProfileOptions, r as ResolvedRemoteConfigProfile, t as RemoteConfigProfile } from "./sdk-remote-config.js";
//#region src/remote/remote-config-core.d.ts
declare function resolveRemoteConfigProfile(options: RemoteConfigProfileOptions): ResolvedRemoteConfigProfile;
//#endregion
export { type RemoteConfigProfile, resolveRemoteConfigProfile };