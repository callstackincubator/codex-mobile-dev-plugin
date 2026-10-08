import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {addRenderConditions, elementAt, renderConditions, resolveOpenerComponents} from '../src/server/app-flow/render-conditions.ts';
import type {FlowPresentationAction} from '../src/shared/app-flow.ts';

const parse = (file: string, text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const at = (file: ts.SourceFile, needle: string) => {
  const position = file.getLineAndCharacterOfPosition(file.text.indexOf(needle));
  return {line: position.line + 1, column: position.character};
};

const settings = `export function Settings({accounts, isGroup, ready, role}) {
  if (!ready) return null
  if (role === 'guest') {
    return <Guest />
  }
  return (
    <View>
      {isGroup && <Button onPress={() => leave.open()} />}
      {accounts.map(account => <AccountRow key={account.id} account={account} />)}
      {canEdit || !signedIn ? <Edit /> : <Report onPress={() => report.open()} />}
      <List data={words} renderItem={({item}) => <Word onPress={() => remove.open()} />} />
    </View>
  )
}
function AccountRow({account}) {
  return account.isCurrent ? null : <Item onPress={() => removeAccount.open()} />
}
`;

test('conditions around an opener are read as written, outermost first', () => {
  const file = parse('src/Settings.tsx', settings);
  const conditions = (needle: string) => renderConditions(file, elementAt(file, at(file, needle))!, 'src/Settings.tsx').map(item => `${item.kind} ${item.text} @${item.line}`);
  assert.deepEqual(conditions('<Button'), ['when ready @2', "unless role === 'guest' @3", 'when isGroup @8']);
  assert.deepEqual(conditions('<AccountRow'), ['when ready @2', "unless role === 'guest' @3", 'each accounts @9']);
  assert.deepEqual(conditions('<Report'), ['when ready @2', "unless role === 'guest' @3", 'unless canEdit @10', 'when signedIn @10'], 'Not (a or b) reads as not a and not b');
  assert.deepEqual(conditions('<Word'), ['when ready @2', "unless role === 'guest' @3", 'each words @11']);
  assert.deepEqual(conditions('<Item'), ['unless account.isCurrent @16'], 'A component stops at its own boundary');
});

test("an owner's single render site adds its own conditions; several sites add none", () => {
  const screen = parse('/app/src/Screen.tsx', `import {Row} from './Row'\nexport function Screen({items, open}) {\n  return open && items.map(item => <Row item={item} />)\n}\n`);
  const row = parse('/app/src/Row.tsx', `export function Row({item}) {\n  return item.mine && <Button onPress={() => control.open()} />\n}\nexport function Shared() { return <Dialog onPress={() => other.open()} /> }\n`);
  const other = parse('/app/src/Other.tsx', `import {Shared} from './Row'\nexport const A = () => <Shared />\nexport const B = () => cond && <Shared />\n`);
  const units = new Map([[screen.fileName, screen], [row.fileName, row], [other.fileName, other]].map(([name, ast]) => {
    const imports = new Map<string, {module: string; name: string}>();
    for (const statement of (ast as ts.SourceFile).statements) if (ts.isImportDeclaration(statement)) for (const element of (statement.importClause?.namedBindings as ts.NamedImports).elements) imports.set(element.name.text, {module: (statement.moduleSpecifier as ts.StringLiteral).text, name: element.name.text});
    return [name as string, {file: name as string, ast: ast as ts.SourceFile, imports}];
  }));
  const symbol = (unit: {file: string; imports: Map<string, {module: string; name: string}>}, name: string) => unit.imports.has(name) ? `/app/src/Row.tsx#${name}` : `${unit.file}#${name}`;
  const action = (owner: string, needle: string): FlowPresentationAction => ({id: owner, file: 'src/Row.tsx', line: 1, owner, component: 'Button', prop: 'onPress', name: 'Button', source: at(row, needle) as any,
    effect: {kind: 'control', component: 'Dialog', prop: 'control', method: 'open', close: 'close'}});
  const opener = action('Row', '<Button'), shared = action('Shared', '<Dialog');
  addRenderConditions([opener, shared], units, '/app', symbol);
  assert.deepEqual(opener.when?.map(item => [item.kind, item.text, item.file, item.line]), [
    ['when', 'open', 'src/Screen.tsx', 3], ['each', 'items', 'src/Screen.tsx', 3], ['when', 'item.mine', 'src/Row.tsx', 2]]);
  assert.equal(shared.when, undefined, 'Two render sites with different conditions name neither');
});

test('an opener tag re-exported under another name matches its declared component', () => {
  const screen = parse('/app/src/Screen.tsx', `import {FAB} from './fab'\nexport function Screen() {\n  return <FAB onPress={() => control.open()} />\n}\n`);
  const units = new Map([[screen.fileName, {file: screen.fileName, ast: screen, imports: new Map([['FAB', {module: './fab', name: 'FAB'}]])}],
    ['/app/src/FABInner.tsx', {file: '/app/src/FABInner.tsx', ast: parse('/app/src/FABInner.tsx', 'export function FABInner() { return null }'), imports: new Map()}]]);
  // The scanner's resolver follows `export {FABInner as FAB}` to its declaration.
  const symbol = (_unit: unknown, name: string) => name === 'FAB' ? '/app/src/FABInner.tsx#FABInner' : `/app/src/Screen.tsx#${name}`;
  const opener: FlowPresentationAction = {id: 'fab', file: 'src/Screen.tsx', line: 3, owner: 'Screen', component: 'FAB', prop: 'onPress', name: 'Sheet', source: {...at(screen, '<FAB'), endLine: 3, endColumn: 46},
    effect: {kind: 'control', component: 'Sheet', prop: 'control', method: 'open', close: 'close'}};
  const unknown = {...opener, id: 'other', component: 'FAB'};
  resolveOpenerComponents([opener], units, '/app', symbol);
  assert.equal(opener.component, 'FABInner');
  resolveOpenerComponents([unknown], units, '/app', () => '/app/src/Missing.tsx#Other');
  assert.equal(unknown.component, 'FAB', 'A name that resolves outside the project stays as written');
});
