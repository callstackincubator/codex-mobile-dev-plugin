import type { CSSProperties } from "react";
import type { Bezel } from "@mobile-dev/shared/bezel.ts";
import { androidNinePatchSkin as skin } from "./android-nine-patch.ts";
import { androidChromeScale, androidFrameGeometry } from "./android-frame-geometry.ts";

type Size = { width: number; height: number };

/**
 * How the screen is framed: the device's own bezel artwork, the Android nine-patch frame,
 * the plain rounded frame, or the bare screen when the frame is turned off.
 */
export type FrameChrome = "bezel" | "nine-patch" | "plain" | "none";

export type FrameLayout = {
  chrome: FrameChrome;
  /** The frame's size in the stage. Empty until the first frame gives the video's size. */
  frame: CSSProperties;
  /** The screen canvas's place in the frame. */
  screen: CSSProperties;
  /** The bezel artwork, a data URL. */
  bezelImage?: string;
  /** The nine-patch border and its side buttons. */
  ninePatch?: { style: CSSProperties; buttons: CSSProperties[] };
};

export type FrameInput = {
  /** The stage's content box. */
  stage: Size;
  /** The video's size, once a frame arrived. */
  video?: Size;
  bezel?: Bezel;
  showFrame: boolean;
  platform: "ios" | "android";
};

const px = (value: number) => `${value}px`;
const percent = (value: number) => `${value}%`;

export function frameChrome({ showFrame, platform, bezel }: Pick<FrameInput, "showFrame" | "platform" | "bezel">): FrameChrome {
  if (!showFrame) return "none";
  if (bezel) return "bezel";
  return platform === "android" ? "nine-patch" : "plain";
}

/** Places the screen in the bezel's cutout, clipped by its corner radius or mask. */
function bezelScreen({ rect, viewport, clipRadius, mask }: Bezel): CSSProperties {
  const placed = {
    left: percent(rect.x / viewport.width * 100), top: percent(rect.y / viewport.height * 100),
    width: percent(rect.width / viewport.width * 100), height: percent(rect.height / viewport.height * 100),
  };
  if (mask) return { ...placed, maskImage: `url("${mask}")`, maskSize: "100% 100%", maskRepeat: "no-repeat", borderRadius: "0" };
  return { ...placed, borderRadius: `${clipRadius / rect.width * 100}% / ${clipRadius / rect.height * 100}%` };
}

/** Letterboxes the video in the bezel's cutout and scales the bezel to the stage. */
function bezelLayout(bezel: Bezel, stage: Size, video: Size): Pick<FrameLayout, "frame" | "screen"> {
  const { rect, viewport } = bezel;
  const videoScale = Math.min(rect.width / video.width, rect.height / video.height);
  const videoWidth = video.width * videoScale;
  const videoHeight = video.height * videoScale;
  const scale = Math.max(0, Math.min(stage.width / viewport.width, stage.height / viewport.height));
  return {
    frame: { width: px(viewport.width * scale), height: px(viewport.height * scale) },
    screen: {
      ...bezelScreen(bezel),
      left: percent((rect.x + (rect.width - videoWidth) / 2) / viewport.width * 100),
      top: percent((rect.y + (rect.height - videoHeight) / 2) / viewport.height * 100),
      width: percent(videoWidth / viewport.width * 100), height: percent(videoHeight / viewport.height * 100),
    },
  };
}

function ninePatchLayout(stage: Size, video: Size): Pick<FrameLayout, "frame" | "screen" | "ninePatch"> {
  const { scale, screenWidth, screenHeight, frameWidth, frameHeight } = androidFrameGeometry(video.width, video.height, stage.width, stage.height);
  const renderedSlice = skin.slice * androidChromeScale;
  const buttons = skin.buttons.map(button => {
    const buttonHeight = button.height * androidChromeScale;
    const center = renderedSlice + (button.top + button.height / 2 - skin.slice) * (frameHeight - 2 * renderedSlice) / (skin.imageHeight - 2 * skin.slice);
    const top = Math.min(Math.max(center - buttonHeight / 2, renderedSlice), frameHeight - renderedSlice - buttonHeight);
    return { position: "absolute", top: px((top - renderedSlice) * scale), height: px(buttonHeight * scale), width: px(button.depth * androidChromeScale * scale),
      [button.side]: px(-(skin.slice + button.depth) * androidChromeScale * scale), background: "#2b2b2b", borderRadius: "2px" } satisfies CSSProperties;
  });
  return {
    frame: { width: px(frameWidth * scale), height: px(frameHeight * scale) },
    screen: {
      left: px(skin.bezel.left * androidChromeScale * scale), top: px(skin.bezel.top * androidChromeScale * scale),
      width: px(screenWidth * scale), height: px(screenHeight * scale), borderRadius: px(skin.screenCornerRadius * androidChromeScale * scale),
    },
    ninePatch: {
      style: { borderStyle: "solid", borderWidth: px(renderedSlice * scale), borderImage: `url("${skin.image}") ${skin.slice} / ${px(renderedSlice * scale)} stretch` },
      buttons,
    },
  };
}

function plainLayout(stage: Size, video: Size): Pick<FrameLayout, "frame" | "screen"> {
  const ratio = video.width / video.height;
  const screenWidth = Math.max(0, Math.min(stage.width - 14, (stage.height - 14) * ratio));
  return { frame: { width: px(screenWidth + 14), height: px(screenWidth / ratio + 14), "--frame-radius": px(Math.max(16, Math.min(58, screenWidth * .12))) } as CSSProperties, screen: {} };
}

function bareLayout(stage: Size, video: Size): Pick<FrameLayout, "frame" | "screen"> {
  const scale = Math.max(0, Math.min(stage.width / video.width, stage.height / video.height));
  return { frame: { width: px(video.width * scale), height: px(video.height * scale) }, screen: { left: "0", top: "0", width: "100%", height: "100%", borderRadius: "0" } };
}

/** Sizes the frame to fit the stage and places the screen in it. Without a video size only the bezel's cutout is known. */
export function frameLayout(input: FrameInput): FrameLayout {
  const chrome = frameChrome(input);
  const bezel = chrome === "bezel" ? input.bezel : undefined;
  const { stage, video } = input;
  const base = { chrome, ...(bezel ? { bezelImage: bezel.image } : {}) };
  if (!video?.width || !video.height) {
    return { ...base, frame: {}, screen: bezel ? bezelScreen(bezel) : {}, ...(chrome === "nine-patch" ? { ninePatch: { style: {}, buttons: [] } } : {}) };
  }
  if (bezel) return { ...base, ...bezelLayout(bezel, stage, video) };
  if (chrome === "nine-patch") return { ...base, ...ninePatchLayout(stage, video) };
  return { ...base, ...(chrome === "plain" ? plainLayout(stage, video) : bareLayout(stage, video)) };
}
