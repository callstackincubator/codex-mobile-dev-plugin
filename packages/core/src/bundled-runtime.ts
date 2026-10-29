import { fileURLToPath } from "node:url";

/** Whether this server runs bundled from dist/ rather than from source. */
export const bundled = import.meta.url.endsWith(".mjs");

/**
 * The path of a runtime shipped beside the server, such as `baguette/Baguette`. Bundles, and the chunks
 * they split into, sit in dist/ beside the runtimes; from source they are in packages/native/vendor/.
 */
export function bundledFile(relative: string): string {
  const root = bundled ? "./" : "../../native/vendor/";
  const url = new URL(`${root}${relative}`, import.meta.url);
  return fileURLToPath(url);
}
