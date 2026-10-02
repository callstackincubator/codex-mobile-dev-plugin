import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { scanAppFlow } from '../src/server/app-flow/scan.ts';

const [project, referenceFile, ...options] = process.argv.slice(2);
if (!project || !referenceFile) throw new Error('Usage: node scripts/compare-app-flow.mjs PROJECT REFERENCE [--snapshot GRAPH.json] [--observed MAP.json] [--output REPORT.json]');
const option = name => { const index = options.indexOf(name); return index < 0 ? undefined : options[index + 1]; };
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const reference = await json(referenceFile);
const revision = execFileSync('git', ['-C', project, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (reference.revision !== revision) throw new Error(`Reference revision ${reference.revision} does not match checkout ${revision}. Review the reference before comparing.`);
if (execFileSync('git', ['-C', project, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()) throw new Error('The reference requires an unchanged checkout. Review its evidence before comparing modified source.');
const graph = option('--snapshot') ? await json(option('--snapshot')) : await scanAppFlow(project, reference.platform);
const observed = option('--observed') ? await json(option('--observed')) : undefined;
const names = new Map(graph.nodes.map(node => [node.id, node.name]));
const catalog = new Set(graph.nodes.filter(node => node.kind === 'screen').map(node => node.name));
const expected = new Set(reference.routes.map(row => row.name));
const sourceAccess = new Set(['entry', 'ui', 'data', 'feature', 'internal']);
const routes = reference.routes.map(row => {
  const incoming = graph.edges.filter(edge => edge.kind === 'navigation' && names.get(edge.to) === row.name && row.parents.includes(names.get(edge.from)));
  const shared = (graph.links ?? []).filter(link => link.target === row.name && row.sharedOwners?.includes(link.owner));
  const found = row.access === 'entry' ? graph.nodes.some(node => node.name === row.name && node.entry) : incoming.length > 0 || shared.length > 0;
  return { name: row.name, access: row.access, registered: catalog.has(row.name), sourceExpected: sourceAccess.has(row.access), sourceMatched: found,
    incoming: [...new Set(incoming.map(edge => `${names.get(edge.from)} via ${edge.owner}${edge.guarded ? ' (conditional)' : ''}`))],
    shared: [...new Set(shared.map(link => link.owner))], observed: observed?.nodes.find(node => node.name === row.name)?.status ?? (observed ? 'not-observed' : undefined) };
});
const ordinary = new Set(routes.filter(row => row.sourceExpected).map(row => row.name));
const unexpectedSourceRoutes = routes.filter(row => !row.sourceExpected && graph.edges.some(edge => edge.kind === 'navigation' && names.get(edge.to) === row.name && ordinary.has(names.get(edge.from)))).map(row => row.name);
const report = {
  revision, platform: reference.platform,
  meaning: 'Source matches mean a reviewed parent or shared control has a static path to the route. Conditions and real data still need runtime confirmation. Registration counts are not reachability counts.',
  files: graph.files, scanMs: Math.round(graph.scanMs), registrations: catalog.size,
  expectedSourceRoutes: routes.filter(row => row.sourceExpected).length,
  matchedSourceRoutes: routes.filter(row => row.sourceExpected && row.sourceMatched).length,
  missingRegistrations: [...expected].filter(name => !catalog.has(name)), extraRegistrations: [...catalog].filter(name => !expected.has(name)),
  missingSourceRoutes: routes.filter(row => row.sourceExpected && !row.sourceMatched).map(row => row.name),
  unexpectedSourceRoutes,
  byAccess: Object.fromEntries([...new Set(routes.map(row => row.access))].map(access => [access, routes.filter(row => row.access === access).length])), routes,
};
if (option('--output')) await writeFile(option('--output'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, routes: undefined }, null, 2));
if (report.missingRegistrations.length || report.extraRegistrations.length || report.missingSourceRoutes.length || report.unexpectedSourceRoutes.length) process.exitCode = 1;
