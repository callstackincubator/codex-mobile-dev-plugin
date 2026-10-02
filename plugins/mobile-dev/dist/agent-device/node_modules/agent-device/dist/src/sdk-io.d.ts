import { n as DaemonArtifactType } from "./sdk-contracts.js";
//#region src/io.d.ts
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
declare function createLocalArtifactAdapter(options?: LocalArtifactAdapterOptions): ArtifactAdapter;
//#endregion
export { FileOutputRef as a, ReserveOutputOptions as c, ResolvedInputFile as d, TemporaryFile as f, FileInputRef as i, ReservedOutputFile as l, ArtifactDescriptor as n, LocalArtifactAdapterOptions as o, createLocalArtifactAdapter as p, CreateTempFileOptions as r, OutputVisibility as s, ArtifactAdapter as t, ResolveInputOptions as u };