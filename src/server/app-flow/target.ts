import type { FlowTargetIdentity } from './runs.ts';

type Target = FlowTargetIdentity & { id: string };
const normalize = (name: string) => name.toLowerCase().replace(/[^a-z\d]/g, '');

/** Reconnect only to the same app and device, including after Metro changes IDs. */
export function reconnectFlowTarget<T extends Target>(targets: T[], targetId: string, previous?: FlowTargetIdentity): T | undefined {
  if (!previous) return targets.find(target => target.id === targetId);
  const matches = targets.filter(target => (previous.appId ? target.appId === previous.appId : target.id === targetId && !target.appId) &&
    (previous.deviceId && target.deviceId === previous.deviceId || previous.deviceName && target.deviceName && normalize(target.deviceName) === normalize(previous.deviceName)));
  const exact = matches.find(target => target.id === targetId);
  return exact ?? (matches.length === 1 ? matches[0] : undefined);
}
