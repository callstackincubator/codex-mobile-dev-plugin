import type { StreamMessage } from "./stream-input.ts";

/** The only messages `mobile_ios_mirror_input` accepts: ordered touch samples. */
export type PhysicalTouchMessage = Extract<StreamMessage, { type: "touch1-down" | "touch1-move" | "touch1-up" }>;

const SWIPE_STEPS = 8;

/**
 * Expresses a panel input message as the touch samples a physical iPhone's mirror takes. The
 * simulator and Android streams take `tap` and `swipe` directly; the physical iOS tool takes only
 * touches, and one message of another type rejects the whole batch. Buttons, keys and text have no
 * touch form and are dropped (the hardware buttons are disabled on a physical iOS mirror).
 */
export function toPhysicalTouches(message: StreamMessage): PhysicalTouchMessage[] {
  switch (message.type) {
    case "touch1-down": case "touch1-move": case "touch1-up": return [message];
    case "tap": {
      const { x, y, width, height } = message;
      return [{ type: "touch1-down", x, y, width, height }, { type: "touch1-up", x, y, width, height }];
    }
    case "swipe": {
      const { startX, startY, endX, endY, width, height } = message;
      const at = (step: number) => ({ x: startX + (endX - startX) * step / SWIPE_STEPS, y: startY + (endY - startY) * step / SWIPE_STEPS, width, height });
      return [
        { type: "touch1-down", ...at(0) },
        ...Array.from({ length: SWIPE_STEPS - 1 }, (_, index) => ({ type: "touch1-move" as const, ...at(index + 1) })),
        { type: "touch1-up", ...at(SWIPE_STEPS) },
      ];
    }
    default: return [];
  }
}
