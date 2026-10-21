import { join } from 'node:path'
import type { AppFlowProgressEvent, ManualRecordingEvent } from '../shared/app-flow.ts'
import type { AppFlowDecisionProvider } from './decision-provider.ts'

export type AppFlowHostEvent = AppFlowProgressEvent | ManualRecordingEvent

export interface AppFlowAgentDeviceModule {
  createAgentDeviceClient(config?: Record<string, unknown>): any
}

/** Runtime environment supplied by the MCP server. */
export interface AppFlowHostPorts {
  dataDir: string
  decisions?: AppFlowDecisionProvider
  emit(event: AppFlowHostEvent): void
  loadAgentDevice(): Promise<AppFlowAgentDeviceModule>
  /** Shell-safe executable prefix for the vendored CLI (for example `node '/.../agent-device.mjs'`). */
  agentDeviceCli?: string
  screenshotUri?(projectId: string, slug: string): string
}

let configuredHost: AppFlowHostPorts | null = null

export function configureAppFlowHost(host: AppFlowHostPorts): void {
  configuredHost = host
}

export function getAppFlowHost(): AppFlowHostPorts {
  if (!configuredHost) throw new Error('App Flow host has not been configured.')
  return configuredHost
}

export function appFlowDataDir(): string {
  return getAppFlowHost().dataDir
}

export function appFlowAgentDeviceStateDir(): string {
  return join(appFlowDataDir(), 'agent-device')
}

export function resolveAgentDeviceCommand(command: string): string {
  if (!command.startsWith('agent-device')) return command
  return `${getAppFlowHost().agentDeviceCli ?? 'agent-device'}${command.slice('agent-device'.length)}`
}
