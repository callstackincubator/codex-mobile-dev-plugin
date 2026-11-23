import { createServer } from 'node:net'

const METRO_PORT_MIN = 8082
const METRO_PORT_MAX = 9999
const RANDOM_PORT_ATTEMPTS = 20

export function isReactNativeCliScript(script: string): boolean {
  return /\breact-native\s+run-/.test(script) || /\brun-ios\b|\brun-android\b/.test(script)
}

/** True when the platform launch script builds a Release binary instead of Debug. */
export function isReleaseLaunchScript(script: string): boolean {
  return (
    /(?:--configuration|-c)\s+Release\b/.test(script) ||
    /--mode\s+release\b/i.test(script) ||
    /--variant\s+release\b/i.test(script)
  )
}

export function isExpoProject(pkg: {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}): boolean {
  return Boolean(
    pkg.dependencies?.expo ||
    pkg.devDependencies?.expo ||
    (pkg.scripts?.start && /\bexpo\b/.test(pkg.scripts.start))
  )
}

export function metroStatusUrl(port: number): string {
  return `http://127.0.0.1:${port}/status`
}

export async function isMetroReady(port: number): Promise<boolean> {
  try {
    const response = await fetch(metroStatusUrl(port), { signal: AbortSignal.timeout(2000) })
    const body = await response.text()
    return response.ok && body.includes('packager-status:running')
  } catch {
    return false
  }
}

export function parseMetroPortFromOutput(output: string): number | null {
  const patterns = [
    /(?:exp|http|https):\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/gi,
    /exp:\/\/[^/\s]+:(\d+)/gi,
    /Metro waiting on \S+:(\d+)/gi,
    /\b(?:on )?port (\d{4,5})\b/gi
  ]
  let found: number | null = null
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(output))) {
      const port = Number(match[1] || '80')
      if (Number.isInteger(port) && port >= 1 && port <= 65535 && port !== 80 && port !== 443) {
        found = port
      }
    }
  }
  return found
}

export function bundlerCliArgs(options: {
  reactNativeCli: boolean
  startBundler: boolean
  port: number
}): string[] {
  if (!options.startBundler) {
    // Expo CLI rejects combining --port with --no-bundler. RN CLI uses --port as
    // the packager the app should connect to even when it does not start one.
    if (options.reactNativeCli) {
      return ['--no-packager', '--port', String(options.port)]
    }
    return ['--no-bundler']
  }
  return ['--port', String(options.port)]
}

export async function findAvailablePort(): Promise<number> {
  for (let i = 0; i < RANDOM_PORT_ATTEMPTS; i++) {
    const candidate =
      METRO_PORT_MIN + Math.floor(Math.random() * (METRO_PORT_MAX - METRO_PORT_MIN + 1))
    if (await isPortFree(candidate)) return candidate
  }
  return bindEphemeralPort()
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => resolve(!error))
    })
  })
}

function bindEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not allocate a TCP port for Metro.'))
        return
      }
      const port = address.port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}
