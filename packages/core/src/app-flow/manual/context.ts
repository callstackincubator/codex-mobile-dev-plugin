/**
 * The `CaptureContext` every manual-mode device operation runs under — recording and replay alike.
 *
 * Shared so the two cannot drift on the one field that matters: `sessionName`. It is deliberately
 * not the bare `projectId` the sweep uses, because `closeDevice` ends with
 * `sessions.close({ shutdown: true })` and on a shared name that would tear down a runner the sweep
 * is holding.
 */
import type { CaptureContext } from '../capture.ts'
import { readAppConfig } from '../parser.ts'

export async function manualCaptureContext(
  projectPath: string,
  projectId: string
): Promise<CaptureContext> {
  const config = await readAppConfig(projectPath)
  return {
    projectPath,
    projectId,
    scheme: config.scheme,
    appName: config.name,
    bundleId: config.bundleId,
    slug: config.slug,
    platform: 'ios',
    sessionName: `${projectId}-manual`
  }
}
