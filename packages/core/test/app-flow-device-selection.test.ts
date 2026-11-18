import assert from 'node:assert/strict'
import test from 'node:test'
import {
  listInstalledApps,
  openInstalledApp,
  type CaptureContext
} from '../src/app-flow/capture.ts'

const UDID = 'BCB87837-5051-41B7-9E91-74DDAADA1C0F'

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

/** A daemon with two booted simulators: any request that does not name one is ambiguous. */
function twoBootedSimulators() {
  const calls: Array<{ command: string; options: Record<string, unknown> }> = []
  const requireDevice = (command: string, options: Record<string, unknown>) => {
    calls.push({ command, options })
    if (!options.udid) {
      throw new Error('2 devices match this request equally; select one explicitly.')
    }
  }
  const client = {
    apps: {
      list: async (options: Record<string, unknown> = {}) => {
        requireDevice('apps.list', options)
        return ['Example (com.example.app)']
      },
      open: async (options: Record<string, unknown> = {}) => {
        requireDevice('apps.open', options)
        return {}
      }
    }
  }
  return { client: client as never, calls }
}

test('listInstalledApps scopes the listing to the booted device', async () => {
  const { client, calls } = twoBootedSimulators()
  assert.deepEqual(await listInstalledApps(client, 'ios', UDID), ['Example (com.example.app)'])
  assert.equal(calls[0]?.options.udid, UDID)
})

test('openInstalledApp finds and opens the native build on the booted device when another simulator is booted', async () => {
  const { client, calls } = twoBootedSimulators()
  const result = await openInstalledApp(client, ctx, 'native-run', { udid: UDID, metroPort: 8081 })
  assert.equal(result.launchTarget, 'com.example.app')
  assert.deepEqual(
    calls.map((call) => [call.command, call.options.udid]),
    [
      ['apps.list', UDID],
      ['apps.open', UDID]
    ]
  )
})
