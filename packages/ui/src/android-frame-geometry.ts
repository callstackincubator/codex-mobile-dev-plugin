import { androidNinePatchSkin as skin } from "./android-nine-patch.ts";

// Keep generic emulator status bars clear of the Pixel artwork corners.
export const androidChromeScale = 0.45;

export function androidFrameGeometry(videoWidth: number, videoHeight: number, availableWidth: number, availableHeight: number) {
  const referenceWidth = skin.imageWidth - skin.bezel.left - skin.bezel.right;
  const referenceHeight = skin.imageHeight - skin.bezel.top - skin.bezel.bottom;
  const ratio = videoWidth / videoHeight;
  const screenWidth = Math.min(referenceWidth, referenceHeight * ratio);
  const screenHeight = screenWidth / ratio;
  const frameWidth = screenWidth + (skin.bezel.left + skin.bezel.right) * androidChromeScale;
  const frameHeight = screenHeight + (skin.bezel.top + skin.bezel.bottom) * androidChromeScale;
  return { screenWidth, screenHeight, frameWidth, frameHeight, scale: Math.max(0, Math.min(availableWidth / frameWidth, availableHeight / frameHeight)) };
}
