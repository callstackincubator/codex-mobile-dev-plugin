import type { Bezel } from "@mobile-dev/shared/bezel.ts";
import { frameLayout } from "./device-frame-layout.ts";
import type { FrameLayout } from "./device-frame-layout.ts";
import { DeviceInput } from "./device-input.ts";
import type { InputTarget } from "./device-input.ts";
import type { ScreenViewport } from "./screen-annotations.ts";

type Size = { width: number; height: number };

/** What the screen needs from its panel: where input goes, and where a new layout is published. */
export type ScreenHost = InputTarget & { platform: "ios" | "android"; layoutChanged(layout: FrameLayout): void };

/**
 * The canvas a device's video is drawn on and the stage it is fitted to, the panel's only
 * imperative markup. It draws frames, sizes the frame around them and turns input on the canvas
 * into device input.
 */
export class DeviceScreen {
  private canvas?: HTMLCanvasElement;
  private context?: CanvasRenderingContext2D;
  private stage?: HTMLElement;
  private detachCurrent?: () => void;
  private pointer?: DeviceInput;
  private bezel?: Bezel;
  private showFrame = true;
  private layout: FrameLayout;
  private measuring?: number;
  // The latest frame while Select holds the screen still.
  private held?: HTMLCanvasElement;
  private readonly host: ScreenHost;

  constructor(host: ScreenHost) {
    this.host = host;
    this.layout = frameLayout({ stage: { width: 0, height: 0 }, showFrame: true, platform: host.platform });
  }

  /** The touch held on the canvas, while it is attached. */
  get input() { return this.pointer; }

  /** Connects the canvas and stage the view rendered, and returns how to disconnect them. */
  attach(canvas: HTMLCanvasElement, stage: HTMLElement) {
    this.detachCurrent?.();
    this.canvas = canvas;
    this.context = canvas.getContext("2d") ?? undefined;
    this.stage = stage;
    const input = new DeviceInput(canvas, this.host);
    this.pointer = input;
    const observer = new ResizeObserver(() => this.fit());
    observer.observe(stage);
    observer.observe(canvas);
    const detach = () => {
      if (this.detachCurrent !== detach) return;
      this.detachCurrent = undefined;
      observer.disconnect();
      input.dispose();
      this.pointer = undefined;
      this.canvas = undefined;
      this.context = undefined;
      this.stage = undefined;
    };
    this.detachCurrent = detach;
    this.fit();
    return detach;
  }

  detach() { this.detachCurrent?.(); }

  setBezel(bezel: Bezel | undefined) { this.bezel = bezel; this.fit(); }
  setFrame(visible: boolean) { this.showFrame = visible; this.fit(); }

  /** The video's size, known once a frame was drawn. */
  get video(): Size | undefined {
    const canvas = this.canvas;
    return canvas?.width && canvas.height ? { width: canvas.width, height: canvas.height } : undefined;
  }

  /** Fits the frame to the stage, then tells the annotation overlay where the drawn screen is. */
  fit() {
    const layout = frameLayout({ stage: this.stageSize(), video: this.video, bezel: this.bezel, showFrame: this.showFrame, platform: this.host.platform });
    if (JSON.stringify(layout) !== JSON.stringify(this.layout)) {
      this.layout = layout;
      this.host.layoutChanged(layout);
    }
    // The view applies the layout before the next frame; measure what it drew.
    if (this.measuring !== undefined) cancelAnimationFrame(this.measuring);
    this.measuring = requestAnimationFrame(() => {
      this.measuring = undefined;
      const viewport = this.viewport();
      if (viewport) this.host.annotations.setViewport(viewport);
    });
  }

  private stageSize(): Size {
    const stage = this.stage;
    if (!stage) return { width: 0, height: 0 };
    const style = getComputedStyle(stage);
    return {
      width: stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      height: stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
    };
  }

  private viewport(): ScreenViewport | undefined {
    const { canvas, stage } = this;
    if (!canvas || !stage) return;
    const rect = canvas.getBoundingClientRect();
    const container = stage.getBoundingClientRect();
    return { x: rect.left - container.left, y: rect.top - container.top, width: rect.width, height: rect.height, stageWidth: stage.clientWidth, stageHeight: stage.clientHeight };
  }

  /** Draws a frame, or with `hold` keeps it aside while Select holds the screen still. Returns whether the canvas changed size. */
  draw(image: CanvasImageSource, width: number, height: number, hold: boolean): boolean {
    if (hold) {
      this.held ??= document.createElement("canvas");
      if (this.held.width !== width || this.held.height !== height) { this.held.width = width; this.held.height = height; }
      this.held.getContext("2d")?.drawImage(image, 0, 0);
      return false;
    }
    const canvas = this.canvas;
    if (!canvas) return false;
    const resized = canvas.width !== width || canvas.height !== height;
    if (resized) { canvas.width = width; canvas.height = height; }
    this.context?.drawImage(image, 0, 0);
    return resized;
  }

  /** Takes the frame held during Select, if one arrived. */
  takeHeld(): HTMLCanvasElement | undefined {
    const held = this.held;
    this.held = undefined;
    return held;
  }

  /** The displayed frame as base64 PNG data. */
  capture(): string { return this.canvas!.toDataURL("image/png").split(",")[1]; }
}
