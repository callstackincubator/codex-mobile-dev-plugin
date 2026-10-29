// Generated from the #[napi] items in packages/native/ios-mirror/src by tooling/napi-types.mjs. Do not edit.

export declare class Capture {
  read(): Promise<VideoBatch>
  requestKeyframe(): void
  touch(samples: Array<TouchSample>, generation: number): Promise<void>
  close(): Promise<void>
}

export declare function openDevice(udid: string): Promise<Capture>

/** Reaches JavaScript as `"down" | "move" | "up"`. */
export type TouchPhase = 'down' | 'move' | 'up'

export interface TouchSample {
  phase: TouchPhase
  x: number
  y: number
  width: number
  height: number
}

export interface VideoBatch {
  generation: number
  frames: Array<VideoFrame>
  configuration?: VideoConfiguration
  dropped: number
}

export interface VideoConfiguration {
  revision: number
  width: number
  height: number
  codec: string
  description: Buffer
}

export interface VideoFrame {
  data: Buffer
  timestamp: number
  key: boolean
}
