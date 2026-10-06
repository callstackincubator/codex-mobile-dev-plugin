import { readFile, writeFile, open } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { scanAppFlow } from '../src/server/app-flow/scan.ts';
import { compareViewReference } from './lib/compare-app-flow-views.mjs';
import {compareFlowCapture,assertCaptureProvenance} from './lib/compare-app-flow-capture.mjs';

const [project, referenceFile, ...options] = process.argv.slice(2);
if (!project || !referenceFile) throw new Error('Usage: node scripts/compare-app-flow-views.mjs PROJECT REFERENCE [--snapshot GRAPH.json] [--write-snapshot GRAPH.json] [--capture-map MAP.json] [--output REPORT.json] [--strict]');
const option = name => { const index = options.indexOf(name); return index < 0 ? undefined : options[index + 1]; };
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const reference = await json(referenceFile), root = resolve(project);
const pluginVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (reference.revision !== revision) throw new Error(`Reference revision ${reference.revision} differs from checkout ${revision}. Review the reference first.`);
if (execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()) throw new Error('Reference evidence requires an unchanged checkout.');
const graph = option('--snapshot') ? await json(option('--snapshot')) : await scanAppFlow(root, reference.platform);
const provenance = { revision, platform: reference.platform, pluginVersion };
if (option('--snapshot') && JSON.stringify(graph.audit) !== JSON.stringify(provenance)) throw new Error('Snapshot provenance differs from this checkout, platform or plugin version. Rescan before comparing.');
if (option('--write-snapshot')) await writeFile(option('--write-snapshot'), JSON.stringify({ ...graph, audit: provenance }, null, 2) + '\n');

// Read only source locations already present in the extractor. This resolver adds
// names to its control targets; it does not discover extra actions or execute code.
const units = new Map();
const readUnit = file => {
  if (units.has(file)) return units.get(file);
  if (!existsSync(file)) return;
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = new Map();
  for (const statement of ast.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
    const module = statement.moduleSpecifier.text, clause = statement.importClause;
    if (clause?.name) imports.set(clause.name.text, { module, name: 'default' });
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const item of clause.namedBindings.elements) imports.set(item.name.text, { module, name: item.propertyName?.text ?? item.name.text });
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) imports.set(clause.namedBindings.name.text, { module, name: '*' });
  }
  const unit = { file, ast, imports }; units.set(file, unit); return unit;
};
let paths = {}, baseUrl = root;
try {
  const config = ts.parseConfigFileTextToJson('tsconfig.json', readFileSync(join(root, 'tsconfig.json'), 'utf8')).config;
  paths = config?.compilerOptions?.paths ?? {}; baseUrl = resolve(root, config?.compilerOptions?.baseUrl ?? '.');
} catch { /* Source aliases without config remain unresolved. */ }
const moduleFile = (file, module) => {
  const bases = module.startsWith('.') ? [resolve(dirname(file), module)] : Object.entries(paths).flatMap(([pattern, values]) => {
    const star = pattern.indexOf('*');
    if (star < 0) return module === pattern ? values.map(value => resolve(baseUrl, value)) : [];
    const prefix = pattern.slice(0, star), suffix = pattern.slice(star + 1);
    return module.startsWith(prefix) && module.endsWith(suffix) ? values.map(value => resolve(baseUrl, value.replace('*', module.slice(prefix.length, suffix.length ? -suffix.length : undefined)))) : [];
  });
  for (const base of bases) for (const stem of [base, join(base, 'index')]) {
    if (/\.[jt]sx?$/.test(stem) && existsSync(stem)) return stem;
    for (const suffix of [`.${reference.platform}`, '.native', '']) for (const extension of ['.tsx', '.ts', '.jsx', '.js']) if (existsSync(stem + suffix + extension)) return stem + suffix + extension;
  }
};
const symbol = (file, name, seen = new Set()) => {
  const key = `${file}#${name}`; if (seen.has(key)) return { file: relative(root, file), component: name };
  seen = new Set(seen).add(key);
  const unit = readUnit(file); if (!unit) return { file: relative(root, file), component: name };
  const [head, member] = name.split('.'), imp = unit.imports.get(head);
  if (imp) { const target = moduleFile(file, imp.module); if (target) return symbol(target, imp.name === '*' ? member ?? '*' : imp.name, seen); }
  for (const statement of unit.ast.statements) if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
    const exp = statement.exportClause.elements.find(item => item.name.text === name);
    if (!exp) continue;
    const target = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? moduleFile(file, statement.moduleSpecifier.text) : file;
    if (target) return symbol(target, exp.propertyName?.text ?? name, seen);
  }
  return { file: relative(root, file), component: name };
};
const owner = node => { for (let p = node.parent; p; p = p.parent) if (ts.isFunctionLike(p) && p.body) return p; };
const ownerName = fn => {
  if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
  for (let p = fn, i = 0; p.parent && i < 4; p = p.parent, i++) if (ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) return p.parent.name.text;
  return 'default';
};
const targetCache = new Map();
const targetsForAction = action => {
  const key = JSON.stringify([action.file, action.owner, action.effect]);
  if (targetCache.has(key)) return targetCache.get(key);
  const unit = readUnit(resolve(root, action.file)), targets = [];
  const visit = node => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText().split('.').at(-1) === action.effect.component &&
      node.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText() === action.effect.prop && prop.initializer) &&
      owner(node) && ownerName(owner(node)) === action.owner) {
      const target = action.effect.target;
      if (target && (target.file !== action.file || target.line !== unit.ast.getLineAndCharacterOfPosition(node.getStart()).line + 1)) return;
      const resolved = symbol(unit.file, node.tagName.getText());
      targets.push({ file: action.file, line: unit.ast.getLineAndCharacterOfPosition(node.getStart()).line + 1, prop: action.effect.prop,
        owner: ownerName(owner(node)), generic: node.tagName.getText().includes('.'), definition: resolved });
    }
    ts.forEachChild(node, visit);
  };
  if (unit) visit(unit.ast);
  // A named custom component's identity is its definition; a generic namespace
  // component also retains its source site to distinguish inline forms.
  targetCache.set(key, targets); return targets;
};
// Validate every evidence location and unique reference identity before counting.
if (new Set(reference.views.map(row => row.id)).size !== reference.views.length) throw new Error('Duplicate reference view id.');
for (const row of reference.views) for (const evidence of row.evidence) {
  const lines = readFileSync(resolve(root, evidence.file), 'utf8').split('\n');
  if (evidence.line < 1 || evidence.line > lines.length) throw new Error(`Invalid evidence for ${row.id}.`);
}
const compared = compareViewReference(graph, reference, targetsForAction);
const report = { ...provenance,
  method: reference.method, adjudication: reference.adjudication, exclusions: reference.excluded,
  scope: reference.scope, limits: reference.limits,
  meaning: 'Matched means distinct source evidence covers the reviewed view. Coverage separates route/action paths, temporary UI preview plans, and source-only facts. A plan is not a successful screenshot. Preview plans retain real data and leave account/backend state unchanged. With --capture-map, capture counts require saved automatic PNGs from the same source, and distinguish live views from UI previews. Unclassified source candidates include inline UI and are not flow screens.',
  files: graph.files, scanMs: Math.round(graph.scanMs), registeredRouteNames: new Set(graph.nodes.filter(node => node.kind === 'screen').map(node => node.name)).size,
  ...compared };
if(option('--capture-map')){
  const map=resolve(option('--capture-map')),run=await json(map),verified=new Set();
  assertCaptureProvenance(run,pluginVersion);
  if(!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(run.id))throw new Error('Invalid saved capture run.');
  for(const node of run.nodes??[]){
    if(node.status!=='captured'||node.capture==='observed'||!/^[-a-z\d]{1,64}$/.test(node.id)||node.image!==`mobile-flow://${run.id}/${node.id}`)continue;
    let file;try{file=await open(join(dirname(map),`${node.id}.png`),'r');const header=Buffer.alloc(24);await file.read(header,0,24,0);
      if(header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&header.readUInt32BE(16)>0&&header.readUInt32BE(20)>0)verified.add(node.id);
    }catch{/* Missing image files never count as successful captures. */}finally{await file?.close();}
  }
  report.capture=compareFlowCapture(graph,compared,run,verified);
}
if (option('--output')) await writeFile(option('--output'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, method: undefined, adjudication: undefined, exclusions: report.exclusions.length,
  rows: undefined, capture:report.capture?{...report.capture,rows:undefined}:undefined,unclassifiedDestinations: report.unclassifiedDestinations.length, collisions: report.collisions.length }, null, 2));
if(options.includes('--strict')&&report.matchedViews!==report.manualViews)process.exitCode=1;
