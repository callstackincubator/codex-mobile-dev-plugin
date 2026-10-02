import ts from 'typescript';

export type SourceUnit = { file: string; ast: ts.SourceFile; constants: Map<string, ts.Expression> };
const unknown = Symbol('unresolved source value');
const segment = ':__flow_unknown__';
type Value = string | number | boolean | null | undefined | typeof unknown | Value[] | { [key: string]: Value };
const limit = 16;
const unwrap = (node: ts.Node): ts.Node => {
  while (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) node = node.expression;
  return node;
};

/** Bounded symbolic reads, never calls or imports app code. Unknown values stay patterns. */
export function sourceLinkReader(units: Map<string, SourceUnit>, symbol: (unit: SourceUnit, name: string) => string) {
  const scopes = new WeakMap<ts.Node, Map<string, ts.Node>>();
  function scope(node: ts.Node) {
    let bindings = scopes.get(node);
    if (bindings) return bindings;
    bindings = new Map(); scopes.set(node, bindings);
    const collect = (child: ts.Node) => {
      if ((ts.isVariableDeclaration(child) || ts.isFunctionDeclaration(child) || ts.isParameter(child)) && child.name && ts.isIdentifier(child.name)) bindings!.set(child.name.text, child);
      if (ts.isFunctionLike(child) || ts.isBlock(child)) return;
      ts.forEachChild(child, collect);
    };
    ts.forEachChild(node, collect);
    return bindings;
  }
  function binding(node: ts.Node, name: string): ts.Node | undefined {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isFunctionLike(parent)) {
        const found = scope(parent).get(name);
        if (found) return found;
      }
    }
  }
  function read(unit: SourceUnit, expression: ts.Node | undefined) {
    let steps = 0;
    const combine = (a: Value[][], b: Value[]) => a.flatMap(left => b.map(right => [...left, right])).slice(0, limit);
    function evaluate(node: ts.Node | undefined, env = new Map<ts.Node, Value>(), depth = 0): Value[] {
      if (!node || depth > 14 || ++steps > 400) return [unknown];
      node = unwrap(node);
      const next = (child: ts.Node | undefined) => evaluate(child, env, depth + 1);
      if (ts.isStringLiteralLike(node)) return [node.text];
      if (ts.isNumericLiteral(node)) return [Number(node.text)];
      if (node.kind === ts.SyntaxKind.TrueKeyword) return [true];
      if (node.kind === ts.SyntaxKind.FalseKeyword) return [false];
      if (node.kind === ts.SyntaxKind.NullKeyword) return [null];
      if (ts.isIdentifier(node)) {
        if (node.text === 'undefined') return [undefined];
        const found = binding(node, node.text);
        if (found && env.has(found)) return [env.get(found)!];
        if (found && (ts.isVariableDeclaration(found) || ts.isParameter(found))) return next(found.initializer);
        return [unknown];
      }
      if (ts.isConditionalExpression(node)) {
        const condition = next(node.condition);
        if (condition.length === 1 && condition[0] !== unknown) return next(condition[0] ? node.whenTrue : node.whenFalse);
        return [...next(node.whenTrue), ...next(node.whenFalse)].slice(0, limit);
      }
      if (ts.isTemplateExpression(node)) {
        let strings: Value[] = [node.head.text];
        for (const span of node.templateSpans) strings = strings.flatMap(left => next(span.expression).map(value => `${left}${value === unknown ? segment : value}${span.literal.text}`)).slice(0, limit);
        return strings;
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        return next(node.left).flatMap(left => next(node.right).map(right => `${left === unknown ? segment : left}${right === unknown ? segment : right}`)).slice(0, limit);
      }
      if (ts.isArrayLiteralExpression(node)) {
        let rows: Value[][] = [[]];
        for (const child of node.elements) {
          if (ts.isSpreadElement(child)) rows = rows.flatMap(row => next(child.expression).map(value => [...row, ...(Array.isArray(value) ? value : [unknown])])).slice(0, limit);
          else rows = combine(rows, next(child));
        }
        return rows;
      }
      if (ts.isObjectLiteralExpression(node)) {
        const value: Record<string, Value> = {};
        for (const prop of node.properties) {
          if (ts.isPropertyAssignment(prop) && !ts.isComputedPropertyName(prop.name)) value[prop.name.getText().replace(/^['"]|['"]$/g, '')] = next(prop.initializer)[0];
        }
        return [value];
      }
      if (ts.isPropertyAccessExpression(node)) return next(node.expression).map(value => value && typeof value === 'object' && !Array.isArray(value) ? value[node.name.text] ?? unknown : unknown);
      if (ts.isCallExpression(node)) {
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'join') {
          const separator = next(node.arguments[0])[0];
          if (typeof separator !== 'string') return [unknown];
          return next(node.expression.expression).map(value => Array.isArray(value) ? value.map(part => part === unknown ? segment : part).join(separator) : unknown);
        }
        const method = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '';
        if (['useMemo', 'useCallback'].includes(method) && node.arguments[0] && ts.isArrowFunction(node.arguments[0])) return returns(node.arguments[0], env, depth + 1, true);
        if (['encodeURIComponent', 'decodeURIComponent'].includes(method)) return next(node.arguments[0]).map(value => typeof value === 'string' ? value : unknown);
        const local = ts.isIdentifier(node.expression) ? binding(node.expression, node.expression.text) : undefined;
        let fn: ts.Node | undefined = local;
        if (!fn) {
          const context = units.get(node.getSourceFile().fileName) ?? unit;
          const key = symbol(context, node.expression.getText());
          const split = key.lastIndexOf('#'), target = units.get(key.slice(0, split));
          if (target) fn = scope(target.ast).get(key.slice(split + 1));
        }
        if (fn && ts.isVariableDeclaration(fn)) fn = fn.initializer;
        if (fn && (ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
          const args = node.arguments.map(argument => next(argument)[0]);
          const bound = new Map(env);
          fn.parameters.forEach((parameter, index) => bound.set(parameter, parameter.dotDotDotToken ? args.slice(index) : args[index] ?? (parameter.initializer ? next(parameter.initializer)[0] : unknown)));
          return returns(fn, bound, depth + 1);
        }
      }
      return [unknown];
    }
    function returns(fn: ts.FunctionLikeDeclaration, env: Map<ts.Node, Value>, depth: number, branches = false): Value[] {
      if (!fn.body) return [unknown];
      if (!ts.isBlock(fn.body)) return evaluate(fn.body, env, depth + 1);
      const results: Value[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isFunctionLike(node)) return;
        // A URL normalizer can accept arbitrary external links. Its guarded
        // outputs do not prove that the caller offers those destinations.
        // A memo declared at the link site can describe data-dependent links.
        if (!branches && (ts.isIfStatement(node) || ts.isSwitchStatement(node) || ts.isTryStatement(node))) return;
        if (ts.isReturnStatement(node)) results.push(...evaluate(node.expression, env, depth + 1));
        else ts.forEachChild(node, visit);
      };
      ts.forEachChild(fn.body, visit);
      return results.length ? results.slice(0, limit) : [unknown];
    }
    return evaluate(expression).flatMap(value => {
      const target = value && typeof value === 'object' && !Array.isArray(value) ? value.screen ?? value.name ?? value.pathname : value;
      return typeof target === 'string' && target !== segment ? [target] : [];
    });
  }
  return read;
}

/** A symbolic segment only matches a declared dynamic segment, never a literal route name. */
export function sourceLinkMatches(pattern: string, target: string): boolean {
  const parts = (value: string) => value.split(/[?#]/)[0].split('/').filter(Boolean);
  const a = parts(pattern), b = parts(target);
  return a.length === b.length && a.every((part, index) => part === b[index] || /^:|^\[/.test(part) && (b[index] === segment || !b[index].includes(segment)));
}
