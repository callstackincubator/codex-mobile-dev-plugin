import { createNativeBuildStore, type NativeBuildStore } from './native-build.ts'
export function createAppFlowNativeBuildStore(dataDir: string): NativeBuildStore {
  return createNativeBuildStore(dataDir)
}
