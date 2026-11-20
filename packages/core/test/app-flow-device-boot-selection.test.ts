import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  agentDeviceBootCommand,
  bootPreferredDevice,
  selectCaptureSimulator,
  type CaptureContext,
  type CaptureSimulatorCandidate
} from '../src/app-flow/capture.ts'
import { configureAppFlowHost } from '../src/app-flow/host.ts'

const stoppedFirst: CaptureSimulatorCandidate = {
  id: 'ios-stopped-first',
  name: 'iPhone 17',
  kind: 'simulator'
}
const bootedSecond: CaptureSimulatorCandidate = {
  id: 'ios-booted-second',
  name: 'iPhone 17 Pro',
  kind: 'simulator',
  booted: true
}

const ctx: CaptureContext = {
  projectPath: '/tmp/project',
  projectId: 'project',
  scheme: 'example',
  appName: 'Example',
  bundleId: 'com.example.app',
  slug: 'example',
  platform: 'ios',
  sessionName: 'session'
}

test('App Flow reuses a booted simulator instead of leaving device selection ambiguous', () => {
  assert.equal(
    selectCaptureSimulator([
      { id: 'physical', name: 'iPhone', kind: 'device', booted: true },
      stoppedFirst,
      bootedSecond
    ])?.id,
    bootedSecond.id
  )
})

test('App Flow chooses the first listed simulator when none is booted', () => {
  assert.equal(
    selectCaptureSimulator([
      { id: 'physical', name: 'iPhone', kind: 'device' },
      stoppedFirst,
      { id: 'ios-stopped-second', name: 'iPhone 17 Pro', kind: 'simulator' }
    ])?.id,
    stoppedFirst.id
  )
})

test('App Flow boots its selected simulator by UDID', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'mobile-dev-app-flow-device-selection-'))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  configureAppFlowHost({ dataDir, emit() {}, loadAgentDevice: async () => ({}) as never })

  const calls: Array<{ command: string; options: Record<string, unknown> }> = []
  const client = {
    devices: {
      list: async (options: Record<string, unknown>) => {
        calls.push({ command: 'devices.list', options })
        return [stoppedFirst, { ...bootedSecond, booted: false }]
      },
      boot: async (options: Record<string, unknown>) => {
        calls.push({ command: 'devices.boot', options })
        return { device: stoppedFirst.name, id: stoppedFirst.id }
      }
    }
  }

  assert.deepEqual(await bootPreferredDevice(client as never, ctx), {
    device: stoppedFirst.name,
    id: stoppedFirst.id
  })
  assert.deepEqual(calls, [
    {
      command: 'devices.list',
      options: { platform: 'ios', target: 'mobile' }
    },
    {
      command: 'devices.boot',
      options: { platform: 'ios', target: 'mobile', udid: stoppedFirst.id }
    }
  ])
})

test('regenerated paths boot the simulator selected by App Flow', () => {
  assert.equal(
    agentDeviceBootCommand('ios selected'),
    "agent-device boot --platform ios --target mobile --udid 'ios selected'"
  )
})

test('App Flow skips a remembered simulator after its explicit boot fails', () => {
  assert.equal(selectCaptureSimulator([stoppedFirst, bootedSecond], bootedSecond.id)?.id, stoppedFirst.id)
})
