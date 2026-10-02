export type FrameDeliveryDecision =
  | "drop-awaiting-keyframe"
  | "send"
  | "close-slow-client"
  | "drop-buffered";

export type SendResultDecision = "backpressure" | "closed" | "sent";

export function frameDeliveryDecision(options: {
  awaitingKeyFrame: boolean;
  isKeyFrame: boolean;
  bufferedBytes: number;
  dropThresholdBytes: number;
  closeThresholdBytes: number;
}): FrameDeliveryDecision {
  if (options.bufferedBytes > options.closeThresholdBytes) {
    return "close-slow-client";
  }
  if (options.awaitingKeyFrame && !options.isKeyFrame) {
    return "drop-awaiting-keyframe";
  }
  if (options.bufferedBytes > options.dropThresholdBytes) {
    return "drop-buffered";
  }
  return "send";
}

export function sendResultDecision(result: number): SendResultDecision {
  if (result === -1) return "backpressure";
  if (result === 0) return "closed";
  return "sent";
}
