import {resolve} from 'node:path';
import ts from 'typescript';
import type {FlowOpeningInput, FlowPresentationAction} from '../../shared/app-flow.ts';
import {componentName, elementAt} from './render-conditions.ts';

type SourceUnit = {file: string; ast: ts.SourceFile; imports: Map<string, {module: string; name: string}>};
const plain = (text: string) => text.replace(/\?\./g, '.').replace(/\s+/g, '');
const limit = (text: string) => { const flat = text.replace(/\s+/g, ' ').trim(); return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat; };

function elements(node: ts.Node, visit: (element: ts.JsxOpeningLikeElement) => void) {
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) visit(node);
  ts.forEachChild(node, child => elements(child, visit));
}
const references = (node: ts.Node, names: Set<string>) => {
  let found: string | undefined;
  const walk = (child: ts.Node) => {
    if (found) return;
    // A property name such as `x.pendingLogin` is not the local `pendingLogin`.
    if (ts.isIdentifier(child) && names.has(child.text) && !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child)) found = child.text;
    else ts.forEachChild(child, walk);
  };
  walk(node);
  return found;
};

// Hooks whose callbacks run on events or after paint, not while rendering.
const deferred = /(^|\.)(useCallback|useEffect|useLayoutEffect|useInsertionEffect|useImperativeHandle)$/;

/** A dialog that shows data its opener supplies cannot be opened bare. Find
 * the body props fed by such data: `X.value` where `X.control` opens the
 * dialog, or state the opening handler sets right before `control.open()`.
 * Only props the receiving component renders count; a value used only by its
 * callbacks or effects does not change the screenshot. The runtime checks
 * those props once the body mounts. Source facts only. */
export function addOpeningInputs(actions: FlowPresentationAction[], units: Map<string, SourceUnit>, root: string, symbol: (unit: SourceUnit, name: string) => string) {
  const cache = new Map<string, boolean>();
  // Does the component this tag names read `prop` while rendering? Unknown
  // components, such as library ones, count as not rendering it.
  const renders = (unit: SourceUnit, tag: string, prop: string) => {
    const resolved = symbol(unit, tag), key = `${resolved}:${prop}`;
    if (cache.has(key)) return cache.get(key)!;
    const separator = resolved.lastIndexOf('#'), home = units.get(resolved.slice(0, separator)), name = resolved.slice(separator + 1);
    let result = false, component: ts.SignatureDeclaration | undefined;
    const find = (node: ts.Node) => { if (!component && ts.isFunctionLike(node) && componentName(node) === name) component = node; else if (!component) ts.forEachChild(node, find); };
    if (home && name !== 'default') find(home.ast);
    const parameter = component?.parameters[0]?.name;
    let local: string | undefined, object: string | undefined;
    if (parameter && ts.isObjectBindingPattern(parameter)) for (const element of parameter.elements) { if ((element.propertyName ?? element.name).getText(home!.ast) === prop && ts.isIdentifier(element.name)) local = element.name.text; }
    else if (parameter && ts.isIdentifier(parameter)) object = parameter.text;
    const body = component && 'body' in component ? component.body : undefined;
    if (body && (local || object)) {
      const visit = (node: ts.Node, skipped: boolean) => {
        if (result) return;
        // Event handlers and deferred hook callbacks do not render data.
        if (ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText(home!.ast))) return;
        if (ts.isCallExpression(node) && deferred.test(node.expression.getText(home!.ast))) return;
        const read = local ? ts.isIdentifier(node) && node.text === local && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
          : ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === object && node.name.text === prop;
        if (read && !skipped) { result = true; return; }
        ts.forEachChild(node, child => visit(child, skipped));
      };
      visit(body, false);
    }
    cache.set(key, result);
    return result;
  };
  for (const action of actions) {
    if (action.effect.kind !== 'control' || !action.effect.target?.source || !action.controller) continue;
    const unit = units.get(resolve(root, action.effect.target.file));
    const target = unit && elementAt(unit.ast, action.effect.target.source);
    if (!unit || !target) continue;
    let owner: ts.Node | undefined = target;
    while (owner && !(ts.isFunctionLike(owner) && /^[A-Z]/.test(componentName(owner) ?? ''))) owner = owner.parent;
    const controller = plain(action.controller), base = /^(.+)\.control$/.exec(controller)?.[1];
    // State the handlers that open this controller set before opening it.
    const opened = new Set<string>();
    if (owner) {
      const setters = new Map<string, string>();
      const scan = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && ts.isCallExpression(node.initializer) && /(^|\.)useState$/.test(node.initializer.expression.getText(unit.ast))) {
          const [value, setter] = node.name.elements;
          if (value && setter && ts.isBindingElement(value) && ts.isBindingElement(setter) && ts.isIdentifier(value.name) && ts.isIdentifier(setter.name)) setters.set(setter.name.text, value.name.text);
        }
        ts.forEachChild(node, scan);
      };
      scan(owner);
      const handlers = new Set<ts.Node>();
      const calls = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'open' && plain(node.expression.expression.getText(unit.ast)) === (base ?? controller)) {
          let handler: ts.Node | undefined = node.parent;
          while (handler && handler !== owner && !ts.isFunctionLike(handler)) handler = handler.parent;
          if (handler && handler !== owner) handlers.add(handler);
        }
        ts.forEachChild(node, calls);
      };
      calls(owner);
      for (const handler of handlers) {
        // A reset such as `setError(undefined)` or `setBusy(false)` supplies
        // no data; an empty value is that state's normal case.
        const literal = (node?: ts.Expression) => !node || node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword ||
          ts.isIdentifier(node) && node.text === 'undefined' || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) ||
          ts.isArrayLiteralExpression(node) && !node.elements.length || ts.isObjectLiteralExpression(node) && !node.properties.length;
        const sets = (node: ts.Node) => {
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && setters.has(node.expression.text) && !literal(node.arguments[0])) opened.add(setters.get(node.expression.text)!);
          ts.forEachChild(node, sets);
        };
        sets(handler);
      }
    }
    const inputs: FlowOpeningInput[] = [];
    elements(target, element => {
      for (const attribute of element.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || !attribute.initializer || !ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) continue;
        const prop = attribute.name.getText(unit.ast), expression = attribute.initializer.expression, text = plain(expression.getText(unit.ast));
        if (element === (ts.isJsxElement(target) ? target.openingElement : target) && prop === action.effect.prop) continue;
        const fromValue = base && new RegExp(`(^|[^\\w$.])${base.replace(/[.$]/g, match => `\\${match}`)}\\.value\\b`).test(text);
        const fromState = !fromValue && opened.size ? references(expression, opened) : undefined;
        if (!fromValue && !fromState) continue;
        if (!renders(unit, element.tagName.getText(unit.ast), prop)) continue;
        inputs.push({component: element.tagName.getText(unit.ast).split('.').at(-1)!, prop, text: limit(expression.getText(unit.ast)),
          line: unit.ast.getLineAndCharacterOfPosition(attribute.getStart(unit.ast)).line + 1});
      }
    });
    if (inputs.length) action.inputs = inputs.slice(0, 6);
  }
}
