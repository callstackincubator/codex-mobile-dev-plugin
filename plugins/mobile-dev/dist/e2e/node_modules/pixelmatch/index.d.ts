/**
 * Compare two equally sized images, pixel by pixel.
 *
 * @param {Uint8Array | Uint8ClampedArray} img1 First image data.
 * @param {Uint8Array | Uint8ClampedArray} img2 Second image data.
 * @param {Uint8Array | Uint8ClampedArray | null | undefined} output Image data to write the diff to, if provided.
 * @param {number} width Input images width.
 * @param {number} height Input images height.
 *
 * @param {Object} [options]
 * @param {number} [options.threshold=0.1] Matching threshold (0 to 1), the maximum OKLab HyAB distance (1 is black vs white) for pixels to be considered equal; smaller is more sensitive.
 * @param {boolean} [options.includeAA=false] Whether to count anti-aliased pixels as differences instead of detecting and ignoring them.
 * @param {number} [options.alpha=0.1] Opacity of original image in diff output.
 * @param {[number, number, number]} [options.aaColor=[255, 255, 0]] Color of anti-aliased pixels in diff output.
 * @param {[number, number, number]} [options.diffColor=[255, 0, 0]] Color of different pixels in diff output.
 * @param {[number, number, number]} [options.diffColorAlt=options.diffColor] Color of differing pixels that are darker in img2 than in img1, to distinguish "added" from "removed" parts.
 * @param {boolean} [options.diffMask=false] Draw the diff over a transparent background (a mask).
 * @param {boolean} [options.checkerboard=true] Whether to blend semi-transparent pixels against a checkerboard pattern (true) or plain white (false) when comparing.
 * @param {number} [options.windowSize=Infinity] If finite, return the maximum number of diff pixels found in any N×N sliding window instead of the total diff count.
 * @param {Uint8Array | Uint8ClampedArray} [options.ignoreMask] One byte per pixel (width × height); pixels with a non-zero value are skipped from comparison.
 *
 * @return {number} The number of mismatched pixels (or the maximum per-window count if windowSize is finite).
 */
export default function pixelmatch(img1: Uint8Array | Uint8ClampedArray, img2: Uint8Array | Uint8ClampedArray, output: Uint8Array | Uint8ClampedArray | null | undefined, width: number, height: number, options?: {
    threshold?: number | undefined;
    includeAA?: boolean | undefined;
    alpha?: number | undefined;
    aaColor?: [number, number, number] | undefined;
    diffColor?: [number, number, number] | undefined;
    diffColorAlt?: [number, number, number] | undefined;
    diffMask?: boolean | undefined;
    checkerboard?: boolean | undefined;
    windowSize?: number | undefined;
    ignoreMask?: Uint8Array<ArrayBufferLike> | Uint8ClampedArray<ArrayBufferLike> | undefined;
}): number;
