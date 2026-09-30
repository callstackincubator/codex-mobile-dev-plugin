import { StopReconnectError } from "./reconnect.ts";

export function assertStreamPolicy(url: string, expectedOrigin: string, approvedDomains?: readonly string[]) {
  const endpoint = new URL(url);
  if (endpoint.origin !== expectedOrigin) {
    throw new StopReconnectError("The simulator service changed. Close this panel and reopen Mobile Dev to reconnect.");
  }
  const approved = approvedDomains?.includes(expectedOrigin) === true;
  if (approved === false) {
    throw new StopReconnectError("This panel has an outdated streaming policy. Close it and reopen Mobile Dev to load the current connection settings.");
  }
}
