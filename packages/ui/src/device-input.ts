import { inputSchema } from "@mobile-dev/shared/protocol.ts";
import type { TouchInput } from "@mobile-dev/shared/protocol.ts";
import type { ScreenAnnotationsStore } from "./screen-annotations.ts";
import type { StreamMessage } from "./stream-input.ts";

type Size = { width: number; height: number };

/** Which input reaches the device now. Select mode and an open note take precedence over all of it. */
export type InputAllowance = { touch: boolean; keys: boolean; paste: boolean };

export type InputTarget = {
  annotations: ScreenAnnotationsStore;
  allows(): InputAllowance;
  /** The screen size touch coordinates are in. */
  screen(): Size;
  send(message: StreamMessage): void;
  /** Shows a message; an empty one restores the panel's own notice. */
  notice(message: string): void;
};

type Pointer = { id: number; x: number; y: number; edge?: TouchInput["edge"] };

/** Turns pointer, keyboard and paste events on the screen canvas into device input, or into a selection while annotating. */
export class DeviceInput {
  private readonly canvas: HTMLCanvasElement;
  private readonly target: InputTarget;
  private pointer?: Pointer;
  private annotationPointer?: number;
  private readonly listeners: [EventTarget, string, EventListener][];

  constructor(canvas: HTMLCanvasElement, target: InputTarget) {
    this.canvas = canvas;
    this.target = target;
    const gesture = this.endGesture as EventListener;
    this.listeners = [
      [canvas, "pointerdown", this.down as EventListener], [canvas, "pointermove", this.move as EventListener],
      [canvas, "pointerleave", this.leave], [canvas, "pointerup", this.up as EventListener],
      [canvas, "pointercancel", gesture], [canvas, "lostpointercapture", gesture], [window, "blur", gesture],
      [canvas, "keydown", this.key as EventListener], [canvas, "paste", this.paste as EventListener],
    ];
    for (const [element, name, listener] of this.listeners) element.addEventListener(name, listener);
  }

  dispose() { for (const [element, name, listener] of this.listeners) element.removeEventListener(name, listener); }

  /** Lifts a held touch on the device, as when the gesture ends or the stream must stop taking it. */
  release() {
    const pointer = this.pointer;
    if (!pointer) return;
    this.pointer = undefined;
    this.target.send({ type: "touch1-up", x: pointer.x, y: pointer.y, ...this.target.screen(), ...(pointer.edge ? { edge: pointer.edge } : {}) });
    if (this.canvas.hasPointerCapture(pointer.id)) this.canvas.releasePointerCapture(pointer.id);
  }

  /** Forgets a held touch without lifting it, for a device that can no longer take input or lifted it itself. */
  cancel() {
    const pointer = this.pointer;
    this.pointer = undefined;
    if (pointer && this.canvas.hasPointerCapture(pointer.id)) this.canvas.releasePointerCapture(pointer.id);
  }

  private mapped(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const state = this.target.annotations.getSnapshot();
    const dimensions = state.selecting ? state.capture?.screen ?? this.target.screen() : this.target.screen();
    return {
      x: Math.max(0, Math.min(dimensions.width, (event.clientX - rect.left) / rect.width * dimensions.width)),
      y: Math.max(0, Math.min(dimensions.height, (event.clientY - rect.top) / rect.height * dimensions.height)),
    };
  }

  private cancelAnnotation() {
    this.target.annotations.cancelSelection();
    if (this.annotationPointer !== undefined && this.canvas.hasPointerCapture(this.annotationPointer)) this.canvas.releasePointerCapture(this.annotationPointer);
    this.annotationPointer = undefined;
  }

  private readonly endGesture = () => { this.cancelAnnotation(); this.release(); };

  private readonly down = (event: PointerEvent) => {
    const annotations = this.target.annotations;
    const state = annotations.getSnapshot();
    if (state.selecting && event.button === 0) {
      event.preventDefault();
      if (annotations.beginSelection(this.mapped(event))) {
        this.annotationPointer = event.pointerId;
        this.canvas.setPointerCapture(event.pointerId);
        this.canvas.focus();
      }
      return;
    }
    if (state.draft || !this.target.allows().touch || event.button !== 0 || this.pointer) return;
    const position = this.mapped(event);
    const screen = this.target.screen();
    // Touches that start at an edge tell the device to treat them as system gestures.
    const edge = position.y > screen.height - 14 ? "bottom" : position.y < 14 ? "top" : undefined;
    this.pointer = { id: event.pointerId, ...position, edge };
    this.canvas.setPointerCapture(event.pointerId); this.canvas.focus();
    this.target.send({ type: "touch1-down", ...position, ...screen, ...(edge ? { edge } : {}) });
  };

  private readonly move = (event: PointerEvent) => {
    const annotations = this.target.annotations;
    if (annotations.getSnapshot().selecting) {
      if (this.annotationPointer === undefined || this.annotationPointer === event.pointerId) annotations.hover(this.mapped(event));
      return;
    }
    const pointer = this.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    Object.assign(pointer, this.mapped(event));
    this.target.send({ type: "touch1-move", x: pointer.x, y: pointer.y, ...this.target.screen(), ...(pointer.edge ? { edge: pointer.edge } : {}) });
  };

  private readonly leave = () => { if (this.annotationPointer === undefined) this.target.annotations.hover(); };

  private readonly up = (event: PointerEvent) => {
    if (this.annotationPointer === event.pointerId) {
      this.target.annotations.endSelection(this.mapped(event));
      this.cancelAnnotation();
      return;
    }
    if (this.pointer?.id === event.pointerId) this.release();
  };

  private readonly key = (event: KeyboardEvent) => {
    const annotations = this.target.annotations;
    const state = annotations.getSnapshot();
    if (state.selecting || state.draft) {
      if (event.key === "Escape") { event.preventDefault(); this.cancelAnnotation(); annotations.exit(); }
      return;
    }
    if (!this.target.allows().keys || event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^[\x20-\x7e]$/.test(event.key)) {
      event.preventDefault(); this.target.send({ type: "type", text: event.key });
    } else if (/^(Enter|Escape|Backspace|Tab|Arrow(Up|Down|Left|Right))$/.test(event.code)) {
      event.preventDefault(); this.target.send({ type: "key", code: event.code, modifiers: event.shiftKey ? ["shift"] : [] });
    }
  };

  private readonly paste = (event: ClipboardEvent) => {
    const state = this.target.annotations.getSnapshot();
    if (state.selecting || state.draft || !this.target.allows().paste) return;
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text.length === 0) return;
    const message = inputSchema.safeParse({ type: "type", text });
    if (message.success === false) {
      this.target.notice("Paste supports up to 4,096 printable US-ASCII characters. Line breaks and other characters are not supported.");
      return;
    }
    this.target.notice("");
    this.target.send(message.data);
  };
}
