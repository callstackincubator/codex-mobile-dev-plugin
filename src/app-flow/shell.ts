import { spawn } from 'node:child_process'
import { resolveAgentDeviceCommand } from './host.ts'

/**
 * Run one short shell command and collect its output.
 *
 * app-flow drives the device through the agent-device *client*, not the CLI, so until now it has
 * never needed a shell. `nav-state.ts` does: `agent-device cdp` is CLI-only, and it is one
 * fire-and-forget command rather than a session the client could hold open.
 *
 * Deliberately not borrowed from `profiling/profilers/cpu-devtool.ts`, which has an equivalent
 * private helper. That one is built around a profiling run — it carries that module's logging and
 * its long-lived-process handling, and exporting it would make a profiling concern a dependency of
 * the sweep for the sake of twenty lines. This is the smaller thing app-flow actually needs: run
 * it, bound it, hand back what it printed.
 *
 * `/bin/zsh -lc` rather than a bare exec because the command is `agent-device …`, resolved from the
 * user's own login PATH exactly as the profiling path resolves it. stdout and stderr are merged
 * because agent-device writes progress to stderr and the useful payload can land on either.
 */
export async function runShellCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) throw new Error('Cancelled')
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('/bin/zsh', ['-lc', resolveAgentDeviceCommand(command)], { cwd })
    let output = ''
    let settled = false
    const finish = (error: Error | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      // Killed rather than left behind: an `agent-device cdp` that has not answered within the
      // caller's bound is a process the sweep is no longer waiting for, and leaving it attached to
      // the Metro inspector would have the next read contend with it.
      if (error) child.kill('SIGKILL')
      if (error) reject(error)
      else resolve(output)
    }
    const timer = setTimeout(
      () => finish(new Error(`Timed out after ${timeoutMs}ms: ${command}`)),
      timeoutMs
    )
    const onAbort = (): void => finish(new Error('Cancelled'))
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      if (code === 0) finish(null)
      else finish(new Error(`Exited ${code ?? 'unknown'}: ${output.trim().slice(0, 400)}`))
    })
  })
}
