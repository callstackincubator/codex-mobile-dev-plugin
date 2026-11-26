import { relative, sep } from 'node:path'

/** Source references and their stable IDs use the same path on every host. */
export function relativeSourcePath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/')
}
