//#region src/utils/screenshot-diff-pixels.d.ts
type ScreenshotDiffPixelsResult = {
  diffData: Buffer;
  diffMask: Uint8Array;
  differentPixels: number;
};
//#endregion
//#region src/utils/png-rgb-difference.d.ts
type PngRgbComparisonMetadata = {
  readonly first: {
    readonly width: number;
    readonly height: number;
    readonly dataLength: number;
  };
  readonly second: {
    readonly width: number;
    readonly height: number;
    readonly dataLength: number;
  };
};
type PngRgbDifferenceResult = PngRgbComparisonMetadata & ({
  readonly status: 'compared';
  readonly differencePercent: number;
} | {
  readonly status: 'dimension_mismatch' | 'data_length_mismatch';
});
//#endregion
//#region src/utils/png-worker-contract.d.ts
type PngWorkerJobResult = {
  kind: 'decode';
  width: number;
  height: number;
  data: Uint8Array;
} | {
  kind: 'encode';
  png: Uint8Array;
} | ({
  kind: 'rgb-difference';
} & PngRgbDifferenceResult) | ({
  kind: 'diff-pixels';
} & ScreenshotDiffPixelsResult);
//#endregion
//#region src/utils/png-worker.d.ts
/**
 * Transfers result buffers instead of structured-cloning them, but only when a
 * view fully owns its ArrayBuffer. Exported for direct unit coverage; the
 * worker itself is the only runtime caller.
 */
declare function resultTransferList(result: PngWorkerJobResult): ArrayBuffer[];
//#endregion
export { resultTransferList };