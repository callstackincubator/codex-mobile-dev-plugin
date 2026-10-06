import {readFile, writeFile, mkdir, realpath, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {instrumentationManifest} from './capture-manifest.ts';
import type {FlowGraph} from '../../shared/app-flow.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const marker = '// Mobile Dev capture instrumentation';

export async function originalCaptureConfig(projectRoot: string, filename: string, text: string) {
  if (filename !== 'babel.config.js' || !text.includes(marker)) return text;
  const saved = JSON.parse(await readFile(join(projectRoot, '.mobile-dev-flow/config-backup.json'), 'utf8'));
  if (hash(text) !== saved.installedHash) throw new Error('Capture configuration changed. Restore or prepare the build again.');
  return saved.original as string;
}

/** Preserve the exact config and refuse to overwrite edits made after setup. */
export async function prepareCaptureBuild(projectRoot: string, graph: FlowGraph, artifacts = new URL('./app-flow/', import.meta.url)) {
  const root = await realpath(projectRoot), directory = join(root, '.mobile-dev-flow');
  const configPath = join(root, 'babel.config.js');
  const current = await readFile(configPath, 'utf8');
  let original = current;
  if (current.includes(marker)) {
    const saved = JSON.parse(await readFile(join(directory, 'config-backup.json'), 'utf8'));
    if (hash(current) !== saved.installedHash) throw new Error('Babel config changed after App Flow setup. Restore or merge those edits before preparing again.');
    original = saved.original;
  }
  if (!/module\.exports\s*=/.test(original) || /\bexport\s+default\b/.test(original)) throw new Error('Capture setup currently requires a CommonJS babel.config.js. The project was not changed.');
  const manifest = await instrumentationManifest(root, graph);
  const [plugin, client] = await Promise.all(['instrumentation-plugin.cjs', 'instrumentation-client.cjs'].map(file => readFile(new URL(file, artifacts))));
  await mkdir(directory, {recursive: true, mode: 0o700});
  await Promise.all([
    writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest), {mode: 0o600}),
    writeFile(join(directory, 'plugin.cjs'), plugin, {mode: 0o600}),
    writeFile(join(directory, 'client.cjs'), client, {mode: 0o600}),
    writeFile(join(directory, 'bootstrap.js'), `export * from './client.cjs';\nimport {registry} from './client.cjs';\nregistry.registerLoaders([${manifest.mounts.map(mount=>`[${JSON.stringify(mount.source)},()=>require(${JSON.stringify('../'+mount.file)})[${JSON.stringify(mount.export)}]]`).join(',')}]);\n`, {mode:0o600}),
  ]);
  const suffix = `\n${marker}\n;module.exports = ((original) => function(api) {\n  const enabled = !api.env('production') && !api.env('test');\n  const config = typeof original === 'function' ? original(api) : original;\n  if (!enabled) return config;\n  return {...config, plugins: [[require.resolve('./.mobile-dev-flow/plugin.cjs'), {enabled: true, projectRoot: __dirname, client: require.resolve('./.mobile-dev-flow/bootstrap.js'), manifest: require('./.mobile-dev-flow/manifest.json')}], ...(config.plugins || [])]};\n})(module.exports);\n`;
  const installed = original + suffix;
  await writeFile(join(directory, 'config-backup.json'), JSON.stringify({original, installedHash: hash(installed)}), {mode: 0o600});
  await writeFile(`${configPath}.mobile-dev-tmp`, installed);
  await rename(`${configPath}.mobile-dev-tmp`, configPath);
  return {sourceHash: graph.sourceHash, files: Object.keys(manifest.files).length, reloadRequired: true, message: 'Restart the existing Metro process once and reload the app to apply capture instrumentation. Production and test builds remain unchanged.'};
}

export async function restoreCaptureBuild(projectRoot: string) {
  const root = await realpath(projectRoot), configPath = join(root, 'babel.config.js');
  const saved = JSON.parse(await readFile(join(root, '.mobile-dev-flow/config-backup.json'), 'utf8'));
  const current = await readFile(configPath, 'utf8');
  if (current === saved.original) return {restored: true};
  if (hash(current) !== saved.installedHash) throw new Error('Babel config has newer edits. App Flow left it unchanged.');
  await writeFile(`${configPath}.mobile-dev-tmp`, saved.original);
  await rename(`${configPath}.mobile-dev-tmp`, configPath);
  return {restored: true};
}
