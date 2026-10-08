import {relative, resolve} from 'node:path';
import ts from 'typescript';
import type {FlowPresentationAction, FlowRenderCondition} from '../../shared/app-flow.ts';

type Position = {line: number; column: number};
const limit = (text: string) => { const flat = text.replace(/\s+(?=\??\.[A-Za-z_$])/g, '').replace(/\s+/g, ' ').trim(); return flat.length > 100 ? `${flat.slice(0, 99)}…` : flat; };

/** The component name a function declares, including memo/forwardRef wrappers. */
export function componentName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) return node.name?.text;
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return;
  let current: ts.Node = node;
  while (ts.isCallExpression(current.parent) || ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent)) current = current.parent;
  return ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name) ? current.parent.name.text : undefined;
}

/** The JSX element whose opening tag starts at a scanned source position. */
export function elementAt(file: ts.SourceFile, position: Position) {
  let offset: number;
  try { offset = file.getPositionOfLineAndCharacter(position.line - 1, position.column); }
  catch { return; }
  let node: ts.Node = file;
  for (;;) {
    const child = node.getChildren(file).find(item => item.getStart(file) <= offset && offset < item.getEnd());
    if (!child) break;
    node = child;
  }
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isJsxSelfClosingElement(current) || ts.isJsxElement(current)) return current;
    if (ts.isJsxOpeningElement(current)) return current.parent;
  }
}

const returns = (statement: ts.Statement): boolean => ts.isReturnStatement(statement) || ts.isThrowStatement(statement) ||
  ts.isBlock(statement) && !!statement.statements.length && returns(statement.statements[statement.statements.length - 1]);

/** Conditions written around a JSX element up to its enclosing component:
 * `&&`, `||`, ternaries, `.map` rows, list `renderItem` rows, `if`/`case`
 * branches and earlier guard returns. Outermost first, as source text. */
export function renderConditions(file: ts.SourceFile, element: ts.Node, path: string, stop = (node: ts.Node) => !!componentName(node) && /^[A-Z]/.test(componentName(node)!)): FlowRenderCondition[] {
  const found: FlowRenderCondition[] = [];
  const add = (kind: FlowRenderCondition['kind'], expression: ts.Node) => {
    while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
    // `unless (a || b)` reads as `unless a` and `unless b`; this walk runs
    // inside out, so the right side goes first.
    if (kind === 'unless' && ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) { add('unless', expression.right); add('unless', expression.left); return; }
    // `unless !x` reads as `when x`.
    if (kind === 'unless' && ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) { kind = 'when'; expression = expression.operand; }
    found.push({kind, text: limit(expression.getText(file)), file: path, line: file.getLineAndCharacterOfPosition(expression.getStart(file)).line + 1});
  };
  let node: ts.Node = element;
  while (node.parent && !ts.isSourceFile(node.parent)) {
    const parent: ts.Node = node.parent;
    if (ts.isBinaryExpression(parent) && node === parent.right) {
      const operator = parent.operatorToken.kind;
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) add('when', parent.left);
      else if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) add('unless', parent.left);
    } else if (ts.isConditionalExpression(parent) && node !== parent.condition) add(node === parent.whenTrue ? 'when' : 'unless', parent.condition);
    else if (ts.isCallExpression(parent) && parent.arguments.includes(node as ts.Expression) && ts.isPropertyAccessExpression(parent.expression) && /^(map|flatMap)$/.test(parent.expression.name.text)) add('each', parent.expression.expression);
    else if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent) && /^render(Section)?Item$/.test(parent.parent.name.getText(file))) {
      const data = parent.parent.parent.properties.find(item => ts.isJsxAttribute(item) && /^(data|sections)$/.test(item.name.getText(file))) as ts.JsxAttribute | undefined;
      const value = data?.initializer && ts.isJsxExpression(data.initializer) ? data.initializer.expression : undefined;
      if (value) add('each', value);
    } else if (ts.isIfStatement(parent) && node !== parent.expression) add(node === parent.thenStatement ? 'when' : 'unless', parent.expression);
    else if (ts.isCaseClause(parent) && ts.isCaseBlock(parent.parent) && ts.isSwitchStatement(parent.parent.parent)) {
      const subject = parent.parent.parent.expression;
      found.push({kind: 'when', text: limit(`${subject.getText(file)} === ${parent.expression.getText(file)}`), file: path, line: file.getLineAndCharacterOfPosition(parent.expression.getStart(file)).line + 1});
    } else if (ts.isBlock(parent)) {
      // A guard that returns earlier in the same block hides what follows.
      // Nearest first, like every other step of this inside-out walk.
      for (let index = parent.statements.indexOf(node as ts.Statement) - 1; index >= 0; index--) {
        const statement = parent.statements[index];
        if (ts.isIfStatement(statement) && !statement.elseStatement && returns(statement.thenStatement)) add('unless', statement.expression);
      }
    }
    if (ts.isFunctionLike(parent) && stop(parent)) break;
    node = parent;
  }
  return found.reverse();
}

type SourceUnit = {file: string; ast: ts.SourceFile; imports: Map<string, {module: string; name: string}>};
const defaultExport = (unit: SourceUnit) => {
  for (const statement of unit.ast.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.modifiers?.some(item => item.kind === ts.SyntaxKind.DefaultKeyword)) return statement.name?.text;
    if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(statement.expression)) return statement.expression.text;
  }
};

/** Record why each opener may not render: conditions around it inside its
 * owner, and around the owner's render site when it has exactly one. Source
 * text only; nothing is evaluated. At most five, innermost kept. */
export function addRenderConditions(actions: FlowPresentationAction[], units: Map<string, SourceUnit>, root: string, symbol: (unit: SourceUnit, name: string) => string) {
  const owners = new Map<string, FlowPresentationAction[]>();
  for (const action of actions) {
    const unit = units.get(resolve(root, action.file));
    const source = action.effect.kind === 'control' && action.preview ? action.effect.target?.source ?? action.source : action.source;
    if (!unit || !source) continue;
    // An opener's range can begin at the condition around it, such as
    // `isAuthor && (<Item onPress=…`. Its end lies inside the opener itself.
    const element = elementAt(unit.ast, {line: source.endLine, column: Math.max(0, source.endColumn - 1)}) ?? elementAt(unit.ast, source);
    if (!element) continue;
    const own = renderConditions(unit.ast, element, action.file);
    if (own.length) action.when = own.slice(-5);
    // Elements of one owner passing the same controller value open one view.
    if (action.effect.kind === 'control' && action.effect.target) {
      const home = units.get(resolve(root, action.effect.target.file));
      const target = home && action.effect.target.source ? elementAt(home.ast, action.effect.target.source) : undefined;
      const opening = target && (ts.isJsxElement(target) ? target.openingElement : target as ts.JsxSelfClosingElement);
      const attribute = opening?.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(home!.ast) === (action.effect as {prop: string}).prop) as ts.JsxAttribute | undefined;
      const value = attribute?.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
      if (value) action.controller = limit(value.getText(home!.ast));
    }
    const key = `${unit.file}#${action.owner}`;
    owners.set(key, [...owners.get(key) ?? [], action]);
  }
  const wanted = new Map<string, string>();
  for (const key of owners.keys()) {
    wanted.set(key, key);
    const separator = key.lastIndexOf('#'), unit = units.get(key.slice(0, separator));
    if (unit && defaultExport(unit) === key.slice(separator + 1)) wanted.set(`${unit.file}#default`, key);
  }
  const names = new Set([...owners.keys()].map(key => key.slice(key.lastIndexOf('#') + 1)));
  const sites = new Map<string, {unit: SourceUnit; element: ts.Node}[]>();
  for (const unit of units.values()) {
    const tags = new Set([...unit.imports].filter(([local, imported]) => names.has(imported.name) || imported.name === 'default' && names.has(local)).map(([local]) => local));
    for (const name of names) if (owners.has(`${unit.file}#${name}`)) tags.add(name);
    if (!tags.size) continue;
    const visit = (node: ts.Node) => {
      const tag = ts.isJsxSelfClosingElement(node) ? node.tagName : ts.isJsxElement(node) ? node.openingElement.tagName : undefined;
      if (tag && ts.isIdentifier(tag) && tags.has(tag.text)) {
        const owner = wanted.get(symbol(unit, tag.text));
        if (owner) sites.set(owner, [...sites.get(owner) ?? [], {unit, element: node}]);
      }
      ts.forEachChild(node, visit);
    };
    visit(unit.ast);
  }
  for (const [key, list] of owners) {
    const site = sites.get(key);
    // Several render sites have different conditions; none is the one.
    if (site?.length !== 1) continue;
    const outer = renderConditions(site[0].unit.ast, site[0].element, relative(root, site[0].unit.file));
    if (!outer.length) continue;
    for (const action of list) { const own = action.when ?? []; action.when = [...outer.slice(-Math.max(0, 5 - own.length)), ...own].slice(-5); }
  }
}
