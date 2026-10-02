import { n as DaemonArtifactType } from "./sdk-contracts.js";
//#region packages/contracts/src/cloud-artifacts.d.ts
declare const CLOUD_ARTIFACT_KINDS: readonly ['video', 'appium-log', 'device-log', 'automation-log', 'provider-session', 'raw'];
type CloudArtifactKind = (typeof CLOUD_ARTIFACT_KINDS)[number];
type CloudArtifactAvailability = 'ready' | 'pending' | 'unavailable' | 'expired';
type CloudArtifact = {
  provider: string;
  kind: CloudArtifactKind;
  name: string;
  url?: string;
  providerSessionId?: string;
  providerArtifactId?: string;
  contentType?: string;
  extension?: string;
  availability?: CloudArtifactAvailability;
  metadata?: Record<string, unknown>;
};
type CloudArtifactsStatus = 'ready' | 'pending' | 'unavailable';
type CloudArtifactsResult = {
  provider: string;
  status: CloudArtifactsStatus;
  cloudArtifacts: CloudArtifact[];
  providerSessionId?: string;
  message?: string;
};
type DaemonArtifactInventoryEntry = {
  id: string;
  artifactType?: DaemonArtifactType;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
};
type DaemonArtifactsResult = {
  source: 'daemon';
  status: 'ready';
  artifacts: DaemonArtifactInventoryEntry[];
  message?: string;
};
type AgentArtifactsResult = CloudArtifactsResult | DaemonArtifactsResult;
type CloudArtifactsQuery = {
  provider?: string;
  leaseId?: string;
  providerSessionId?: string;
};
type CloudProviderSessionResult = {
  provider?: string;
  providerSessionId?: string;
  cloudArtifacts?: CloudArtifactsResult;
} & Record<string, unknown>;
/**
 * Return undefined only when this provider implementation does not handle the query.
 * Return a CloudArtifactsResult with status "unavailable" when the provider handled the
 * query but artifact retrieval failed, and "pending" when artifacts are not finalized yet.
 */
type CloudArtifactProvider = {
  listCloudArtifacts?: (query: CloudArtifactsQuery) => Promise<CloudArtifactsResult | undefined>;
};
//#endregion
export { CloudArtifactProvider as n, CloudProviderSessionResult as r, AgentArtifactsResult as t };