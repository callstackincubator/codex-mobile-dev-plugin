import { n as DaemonArtifactType } from "./sdk-contracts.js";
//#region packages/contracts/src/artifact-adapter.d.ts
type FileInputRef = {
  kind: 'path';
  path: string;
} | {
  kind: 'uploadedArtifact';
  id: string;
};
type FileOutputRef = {
  kind: 'path';
  path: string;
} | {
  kind: 'downloadableArtifact';
  clientPath?: string;
  fileName?: string;
};
type ArtifactDescriptor = {
  kind: 'localPath';
  field: string;
  artifactType: DaemonArtifactType | undefined;
  path: string;
  fileName?: string;
  metadata?: Record<string, unknown>;
} | {
  kind: 'artifact';
  field: string;
  artifactType: DaemonArtifactType | undefined;
  artifactId: string;
  fileName?: string;
  url?: string;
  clientPath?: string;
  metadata?: Record<string, unknown>;
};
type OutputVisibility = 'client-visible' | 'internal';
type ResolvedInputFile = {
  path: string;
  cleanup?: () => Promise<void>;
};
type ReservedOutputFile = {
  path: string;
  visibility: OutputVisibility;
  publish: () => Promise<ArtifactDescriptor | undefined>;
  cleanup?: () => Promise<void>;
};
type TemporaryFile = {
  path: string;
  visibility: 'internal';
  cleanup: () => Promise<void>;
};
type ResolveInputOptions = {
  usage: string;
  field?: string;
};
type ReserveOutputOptions = {
  field: string;
  ext: string;
  artifactType: DaemonArtifactType | undefined;
  requestedClientPath?: string;
  visibility?: OutputVisibility;
};
type CreateTempFileOptions = {
  prefix: string;
  ext: string;
};
type ArtifactAdapter = {
  resolveInput(ref: FileInputRef, options: ResolveInputOptions): Promise<ResolvedInputFile>;
  reserveOutput(ref: FileOutputRef | undefined, options: ReserveOutputOptions): Promise<ReservedOutputFile>;
  createTempFile(options: CreateTempFileOptions): Promise<TemporaryFile>;
};
type LocalArtifactAdapterOptions = {
  cwd?: string;
  tempDir?: string;
  rootDir?: string;
};
//#endregion
//#region src/io.d.ts
declare function createLocalArtifactAdapter(options?: LocalArtifactAdapterOptions): ArtifactAdapter;
//#endregion
export { FileInputRef as a, OutputVisibility as c, ResolveInputOptions as d, ResolvedInputFile as f, CreateTempFileOptions as i, ReserveOutputOptions as l, ArtifactAdapter as n, FileOutputRef as o, TemporaryFile as p, ArtifactDescriptor as r, LocalArtifactAdapterOptions as s, createLocalArtifactAdapter as t, ReservedOutputFile as u };