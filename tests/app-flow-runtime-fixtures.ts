import {runInThisContext} from 'node:vm';
import ts from 'typescript';
import {installPresentationRuntime} from '../src/server/app-flow/presentations-runtime.js';

/** Model older Hermes loop capture semantics on serialized injection code. */
export function sharedLoopRuntime():typeof installPresentationRuntime {
  // Function parameters keep their scopes; block bindings share function cells.
  const code=ts.transpileModule(`const install=${installPresentationRuntime.toString()};install;`,{
    compilerOptions:{target:ts.ScriptTarget.ESNext},transformers:{before:[context=>root=>{
      const visit=(node:ts.Node):ts.Node=>ts.isVariableDeclarationList(node)
        ?context.factory.createVariableDeclarationList(node.declarations.map(declaration=>ts.visitEachChild(declaration,visit,context)),ts.NodeFlags.None)
        :ts.visitEachChild(node,visit,context);
      return ts.visitNode(root,visit)as ts.SourceFile;
    }]},
  }).outputText;
  return runInThisContext(`(()=>{${code.replace(/install;\s*$/,'return install;')}})()`);
}
