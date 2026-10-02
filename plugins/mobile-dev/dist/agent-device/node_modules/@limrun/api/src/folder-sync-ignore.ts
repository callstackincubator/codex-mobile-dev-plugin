import fs from 'fs';
import path from 'path';
import ignorePkg from 'ignore';

export type IgnoreFn = (relativePath: string) => boolean;

export type IgnoreFnOptions = {
  additional?: IgnoreFn;
  basisCacheDir: string;
};

function normalizeRelativePath(relativePath: string): string {
  return relativePath
    .split(path.sep)
    .join('/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');
}

export async function createIgnoreFn(rootDir: string, options: IgnoreFnOptions): Promise<IgnoreFn> {
  const rootResolved = path.resolve(rootDir);
  const ig = ignorePkg();
  const gitignorePath = path.join(rootResolved, '.gitignore');
  try {
    const content = await fs.promises.readFile(gitignorePath, 'utf-8');
    ig.add(content);
  } catch {
    // No .gitignore file, return empty ignore instance
  }
  const basisCacheRelative = normalizeRelativePath(
    path.relative(rootResolved, options.basisCacheDir),
  ).replace(/\/+$/, '');
  const shouldIgnoreBasisCache =
    basisCacheRelative &&
    basisCacheRelative !== '.' &&
    basisCacheRelative !== '..' &&
    !basisCacheRelative.startsWith('../');

  return (relativePath: string) => {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized) return false;
    const withoutTrailingSlash = normalized.replace(/\/+$/, '');

    if (
      withoutTrailingSlash === '.git' ||
      withoutTrailingSlash.startsWith('.git/') ||
      withoutTrailingSlash.endsWith('/.git') ||
      withoutTrailingSlash.includes('/.git/') ||
      withoutTrailingSlash === '.DS_Store' ||
      withoutTrailingSlash.endsWith('/.DS_Store')
    ) {
      return true;
    }
    if (
      shouldIgnoreBasisCache &&
      (withoutTrailingSlash === basisCacheRelative ||
        withoutTrailingSlash.startsWith(`${basisCacheRelative}/`))
    ) {
      return true;
    }
    if (withoutTrailingSlash.endsWith('.xcconfig')) return false;
    if (ig.ignores(normalized)) return true;
    if (options.additional?.(normalized)) return true;
    return false;
  };
}
