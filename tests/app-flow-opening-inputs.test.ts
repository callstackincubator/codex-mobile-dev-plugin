import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {addOpeningInputs} from '../src/server/app-flow/opening-inputs.ts';
import type {FlowPresentationAction} from '../src/shared/app-flow.ts';

const source = `
export function GlobalWarning() {
  const ctl = useWarningControl()
  return (
    <Outer control={ctl.control}>
      <Inner link={ctl.value} />
      <Consent href={ctl.value} />
    </Outer>
  )
}
function Inner({link}) { return <Text>{link.href}</Text> }
function Consent({href}) {
  const onPress = useCallback(() => open(href), [href])
  return <Button onPress={onPress} />
}
export function Login() {
  const [pending, setPending] = useState(null)
  const [error, setError] = useState(undefined)
  const confirm = useDialogControl()
  const next = () => {
    setError(undefined)
    setPending({service, ident})
    confirm.open()
  }
  return <Confirm control={confirm} host={pending?.service ?? ''} message={error} onConfirm={() => login(pending)} />
}
function Confirm({host, message, onConfirm}) { return <View><Text>{host}</Text><Text>{message}</Text></View> }
`;

test('a body that renders data its opener supplies names that input', () => {
  const ast = ts.createSourceFile('/app/src/Dialogs.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const at = (needle: string) => { const position = ast.getLineAndCharacterOfPosition(ast.text.indexOf(needle)); return {line: position.line + 1, column: position.character, endLine: position.line + 1, endColumn: position.character + needle.length}; };
  const action = (id: string, owner: string, component: string, needle: string, controller: string): FlowPresentationAction => ({id, file: 'src/Dialogs.tsx', line: at(needle).line, owner, component, prop: '', name: component, preview: true, controller,
    effect: {kind: 'control', component, prop: 'control', method: 'auto', close: 'close', target: {file: 'src/Dialogs.tsx', owner, line: at(needle).line, source: at(needle)}}});
  const warning = action('warning', 'GlobalWarning', 'Outer', '<Outer control', 'ctl.control');
  const confirm = action('confirm', 'Login', 'Confirm', '<Confirm control', 'confirm');
  const units = new Map([[ast.fileName, {file: ast.fileName, ast, imports: new Map()}]]);
  addOpeningInputs([warning, confirm], units, '/app', (unit, name) => `${unit.file}#${name}`);
  assert.deepEqual(warning.inputs?.map(input => `${input.component}.${input.prop}`), ['Inner.link'], 'A value used only by a callback does not change the screenshot');
  assert.deepEqual(confirm.inputs?.map(input => `${input.component}.${input.prop} = ${input.text}`), ["Confirm.host = pending?.service ?? ''"],
    'State the opening handler sets counts; a reset such as setError(undefined) and event handlers do not');
});
