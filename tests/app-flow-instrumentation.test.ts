import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareCaptureBuild,restoreCaptureBuild} from '../src/server/app-flow/capture-build.ts';
import {captureManifest,captureRecipeNodes} from '../src/server/app-flow/capture-manifest.ts';
const require=createRequire(import.meta.url);
const {transformSync}=require('@babel/core');
const plugin=require('../src/server/app-flow/instrumentation-plugin.cjs');

test('source transform preserves hook order and binds exact controls without invoking handlers',()=>{
  const source=`import React from 'react';
export function Screen(){
  const [show,setShow]=React.useState(false);
  return <Sheet control={control}><Button onPress={()=>submit()} /></Sheet>;
}`;
  const unit={hash:createHash('sha256').update(source).digest('hex'),states:[{id:'state',owner:'Screen',line:3,column:23}],controls:[{id:'sheet',owner:'Screen',prop:'control',source:{line:4,column:9}}]};
  const output=transformSync(source,{filename:'/app/screen.jsx',configFile:false,babelrc:false,parserOpts:{plugins:['jsx']},plugins:[[plugin,{enabled:true,projectRoot:'/app',client:'flow-client',manifest:{files:{'screen.jsx':unit}}}]]}).code;
  assert.match(output,/useFlowOwner\("screen.jsx#Screen", "", Screen, \{\}, false\)/);
  assert.match(output,/state\(_flowOwner, "state", React.useState\(_flow.useFlowInitial\("state", false\)\), "useState"\)/);
  assert.match(output,/control\(_flowOwner, "sheet", control\)/);
  assert.match(output,/entry\(_flowOwner, "sheet"/);
  assert.match(output,/onPress=\{\(\) => submit\(\)\}/);
  assert.equal((output.match(/useFlowOwner\(/g)??[]).length,1);
  assert.throws(()=>transformSync(source+'\n',{filename:'/app/screen.jsx',configFile:false,babelrc:false,parserOpts:{plugins:['jsx']},plugins:[[plugin,{enabled:true,projectRoot:'/app',manifest:{files:{'screen.jsx':unit}}}]]}),/source changed/);
});

test('prepare and restore preserve the exact Babel config and refuse newer edits',async t=>{
  const root=await mkdtemp(join(tmpdir(),'flow-build-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const original="module.exports = api => ({plugins: ['last-plugin']});\n";
  await writeFile(join(root,'babel.config.js'),original);
  const artifacts=join(root,'artifacts');await mkdir(artifacts);
  await Promise.all(['instrumentation-plugin.cjs','instrumentation-client.cjs'].map(file=>writeFile(join(artifacts,file),'module.exports = {};')));
  const graph:any={nodes:[],edges:[],warnings:[],files:0,scanMs:0};
  const url=pathToFileURL(artifacts+'/');
  await prepareCaptureBuild(root,graph,url);
  const installed=await readFile(join(root,'babel.config.js'),'utf8');
  assert.ok(installed.startsWith(original));
  await prepareCaptureBuild(root,graph,url);
  assert.equal(await readFile(join(root,'babel.config.js'),'utf8'),installed);
  await writeFile(join(root,'babel.config.js'),installed+'// user edit\n');
  await assert.rejects(()=>restoreCaptureBuild(root),/newer edits/);
  await writeFile(join(root,'babel.config.js'),installed);
  await restoreCaptureBuild(root);assert.equal(await readFile(join(root,'babel.config.js'),'utf8'),original);
});

test('manifest fixes selection and reports missing real data before capture',()=>{
  const graph:any={nodes:[{id:'a',kind:'screen',path:['Home'],required:[]},{id:'b',kind:'screen',path:['Profile'],required:['id'],sourceViews:['profile-view']}],edges:[],warnings:[]};
  const plan=captureManifest(graph,graph.nodes,['profile-view']);
  assert.equal(plan.total,1);assert.equal(plan.jobs[0].id,'b');assert.match(plan.jobs[0].blocked!,/Real data/);
  graph.nodes.push({id:'c',kind:'screen',path:['More'],required:[]});assert.equal(plan.total,1);
});

test('recipes join only current scanned steps, preserve real data, and deduplicate stable IDs',()=>{
  const graph:any={nodes:[],presentations:{actions:[{id:'sheet',name:'Sheet',effect:{kind:'control'}}],previews:[{id:'form',name:'Form',views:['form-view'],effect:{kind:'state',value:'details'}}]}};
  const base:any={id:'profile',kind:'screen',path:['Profile'],required:['id'],params:{id:'observed-id'}};
  const recipe={baseNodeId:'profile',actions:['sheet','form']};
  const nodes=captureRecipeNodes(graph,[base],[recipe,{actions:recipe.actions,baseNodeId:recipe.baseNodeId}]);
  assert.equal(nodes.length,1);
  const plan=captureManifest(graph,nodes,[nodes[0].id]);
  assert.equal(plan.total,1);assert.equal(plan.jobs[0].blocked,undefined);
  assert.deepEqual(plan.jobs[0].path,['Profile']);assert.deepEqual(plan.jobs[0].params,base.params);
  assert.deepEqual(plan.jobs[0].actions.map(action=>action.id),['sheet','form']);
  assert.deepEqual(plan.jobs[0].sourceViews,['form-view']);
  assert.throws(()=>captureRecipeNodes(graph,[base],[{actions:['invented']}]),/source-proven/);
  assert.throws(()=>captureRecipeNodes(graph,[base],[{actions:[]}]),/source-proven/);
  assert.throws(()=>captureRecipeNodes(graph,[base],[{baseNodeId:'missing',actions:['form']}]),/base/);
  assert.throws(()=>captureManifest(graph,nodes,['missing-view']),/selection/);
});
