export type StreamFrame = {
  sequence: number;
  data: string;
  receivedAt: number;
  bytes: number;
};

export type FrameRead = {
  frame?: StreamFrame;
  serverWaitMs: number;
  serverStartedAt: number;
  serverPreparedAt: number;
};

export function epochNow(): number { return performance.timeOrigin + performance.now(); }
