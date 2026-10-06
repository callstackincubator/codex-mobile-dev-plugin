const {relative} = require('node:path');
const {createHash} = require('node:crypto');

/** Development-only, exact source locations supplied by the static scanner. */
module.exports = function flowInstrumentation({types: t}) {
  return {name: 'mobile-dev-flow', visitor: {Program(program, state) {
    if (state.opts.enabled !== true) return;
    const manifest = state.opts.manifest;
    const filename = relative(state.opts.projectRoot, state.filename).replaceAll('\\', '/');
    if(filename.startsWith('../') || filename.split('/').some(part=>part==='node_modules'||part.startsWith('.')))return;
    const unit = manifest.files[filename] || {states:[],controls:[]};
    const hash = createHash('sha256').update(state.file.code).digest('hex');
    if (unit.hash && hash !== unit.hash) throw program.buildCodeFrameError('App Flow source changed. Prepare the capture build again.');
    const client = program.scope.generateUidIdentifier('flow');
    const owners = new Map();
    const at = (node, source) => node.loc?.start.line === source.line && node.loc.start.column === source.column;
    const call = (method, args) => t.callExpression(t.memberExpression(client, t.identifier(method)), args);
    function ownerFor(path, self = false) {
      const fn = self ? path : path.getFunctionParent();
      if (!fn) return;
      let parent=fn.parentPath,name=fn.node.id?.name;
      for(let depth=0;!name && parent && depth<4;depth++,parent=parent.parentPath) {
        if(parent.isVariableDeclarator() && t.isIdentifier(parent.node.id))name=parent.node.id.name;
        if(parent.isFunction())break;
      }
      // Never insert hooks in row renderers, event callbacks, or class methods.
      if (!name || !/^(?:[A-Z]|use[A-Z])/.test(name) || fn.node.async || fn.node.generator) return;
      let owner = owners.get(fn);
      if (!owner) {
        owner = {fn, token: fn.scope.generateUidIdentifier('flowOwner'), name, host:unit.hosts?.includes(name)};
        owners.set(fn, owner);
      }
      return owner;
    }
    const wrapped = new WeakSet();
    let effects=0;
    function imported(path, name, module, symbol) {
      const binding=path.scope.getBinding(name)?.path;
      return binding?.isImportSpecifier() && binding.parent.source?.value===module && binding.node.imported.name===symbol;
    }
    function animationEffect(path) {
      const callback=path.node.arguments[0];
      if(!t.isArrowFunctionExpression(callback)&&!t.isFunctionExpression(callback)||callback.async||callback.params.length)return false;
      const statements=t.isBlockStatement(callback.body)?callback.body.body:[t.expressionStatement(callback.body)];
      const literal=node=>t.isNumericLiteral(node)||t.isBooleanLiteral(node)||t.isStringLiteral(node)||t.isUnaryExpression(node)&&node.operator==='-'&&t.isNumericLiteral(node.argument)||t.isObjectExpression(node)&&node.properties.every(prop=>t.isObjectProperty(prop)&&!prop.computed&&literal(prop.value));
      return statements.length>0 && statements.every(statement=>{
        const assignment=t.isExpressionStatement(statement)&&statement.expression;
        if(!t.isAssignmentExpression(assignment)||assignment.operator!=='='||!t.isMemberExpression(assignment.left)||assignment.left.computed||assignment.left.property.name!=='value'||!t.isIdentifier(assignment.left.object))return false;
        const binding=path.scope.getBinding(assignment.left.object.name)?.path,initial=binding?.isVariableDeclarator()&&binding.node.init;
        if(!t.isCallExpression(initial)||!t.isIdentifier(initial.callee)||!imported(path,initial.callee.name,'react-native-reanimated','useSharedValue'))return false;
        const value=assignment.right;
        return t.isCallExpression(value)&&t.isIdentifier(value.callee)&&['withTiming','withSpring'].some(name=>imported(path,value.callee.name,'react-native-reanimated',name))&&value.arguments.length>0&&value.arguments.length<=2&&value.arguments.every(literal);
      });
    }
    function reactHook(path) {
      const callee=path.node.callee;
      if(t.isIdentifier(callee)) {
        const binding=path.scope.getBinding(callee.name)?.path;
        if(binding?.isImportSpecifier() && binding.parent.source?.value==='react')return binding.node.imported.name;
      }else if(t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.object)) {
        const binding=path.scope.getBinding(callee.object.name)?.path;
        if((binding?.isImportDefaultSpecifier()||binding?.isImportNamespaceSpecifier()) && binding.parent.source?.value==='react')return callee.property.name;
      }
    }
    program.traverse({
      Function(path) {
        const name=path.node.id?.name || (path.parentPath.isVariableDeclarator()?path.parentPath.node.id.name:undefined);
        if(unit.hosts?.includes(name)||unit.mounts?.includes(name))ownerFor(path,true);
      },
      CallExpression(path) {
        if (wrapped.has(path.node)) return;
        const hook=reactHook(path);
        if(['useEffect','useLayoutEffect','useInsertionEffect'].includes(hook)) {
          path.replaceWith(call('useFlowEffect',[t.stringLiteral(hook),path.node.arguments[0],path.node.arguments[1]||t.identifier('undefined'),t.booleanLiteral(animationEffect(path))]));effects++;path.skip();return;
        }
        const site = unit.states.find(site => at(path.node, site));
        if (!site) return;
        const owner = ownerFor(path); if (!owner || owner.name !== site.owner) return;
        const node = path.node; wrapped.add(node);
        if(hook==='useState')node.arguments[0]=call('useFlowInitial',[t.stringLiteral(site.id),node.arguments[0] || t.identifier('undefined')]);
        const stateCall=hook==='useReducer'?call('useFlowReducer',[t.stringLiteral(site.id),...node.arguments]):node;
        path.replaceWith(call('state', [owner.token, t.stringLiteral(site.id), stateCall, t.stringLiteral(hook || site.hook || 'useState')]));
        path.skip();
      },
      JSXElement: {exit(element) {
        const path=element.get('openingElement');
        const targets = unit.controls.filter(target => at(path.node, target.source));
        const markers=[];
        for (const target of targets) {
          const owner = ownerFor(path); if (!owner || owner.name !== target.owner) continue;
          if(target.prop) {
            const attribute = path.node.attributes.find(value => t.isJSXAttribute(value) && value.name.name === target.prop);
            if (!t.isJSXExpressionContainer(attribute?.value) || t.isJSXEmptyExpression(attribute.value.expression)) continue;
            attribute.value.expression = call('control', [owner.token, t.stringLiteral(target.id), attribute.value.expression]);
          }
          markers.push({owner,target});
        }
        if(!markers.length)return;
        let result=element.node;
        for(const {owner,target} of markers)result=call('entry',[owner.token,t.stringLiteral(target.id),result]);
        if(element.parentPath.isJSXElement()||element.parentPath.isJSXFragment())element.replaceWith(t.jsxExpressionContainer(result));
        else element.replaceWith(result);
        element.skip();
      }},
    });
    for (const {fn, token, name, host} of owners.values()) {
      if (!t.isBlockStatement(fn.node.body)) fn.node.body = t.blockStatement([t.returnStatement(fn.node.body)]);
      let props=t.objectExpression([]),destructure;
      const first=fn.node.params[0];
      if(t.isIdentifier(first))props=first;
      else if(t.isObjectPattern(first) || t.isAssignmentPattern(first) && t.isObjectPattern(first.left)) {
        props=fn.scope.generateUidIdentifier('flowProps');
        fn.node.params[0]=t.isAssignmentPattern(first)?t.assignmentPattern(props,first.right):props;
        // Parameters are mutable bindings. Preserve reassignment by the app.
        destructure=t.variableDeclaration('let',[t.variableDeclarator(t.isAssignmentPattern(first)?first.left:first,props)]);
      }else if(t.isAssignmentPattern(first) && t.isIdentifier(first.left))props=first.left;
      if (!name.startsWith('use')) fn.traverse({
        Function(path) { path.skip(); },
        ReturnStatement(path) { if (path.node.argument) path.node.argument = call('boundary', [token, path.node.argument]); },
      });
      if(destructure)fn.node.body.body.unshift(destructure);
      fn.node.body.body.unshift(t.variableDeclaration('const', [t.variableDeclarator(token, call('useFlowOwner', [t.stringLiteral(`${filename}#${name}`), t.stringLiteral(manifest.sourceHash || ''), name.startsWith('use')?t.identifier('undefined'):t.identifier(name), props, t.booleanLiteral(!!host)]))]));
    }
    if (owners.size || effects) program.unshiftContainer('body', t.importDeclaration([t.importNamespaceSpecifier(client)], t.stringLiteral(state.opts.client)));
  }}};
};
