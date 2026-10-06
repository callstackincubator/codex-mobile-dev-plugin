import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {QueuedAppFlowRuns} from './app-flow-queue-fixture.ts';
import {captureRecipeNodes} from '../src/server/app-flow/capture-manifest.ts';
import {FlowRuntimeTimeout} from '../src/server/app-flow/runtime-metrics.ts';
import {flowRunning, type FlowGraph} from '../src/shared/app-flow.ts';

async function fixture(t:test.TestContext, mode:'discovery'|'prepared', fail?:string) {
  const directory=await mkdtemp(join(tmpdir(),'flow-pipeline-'));
  const actions:any[]=['Compose','Drafts','Language'].map(id=>({id,name:id,file:'App.tsx',owner:'App',line:1,component:id,prop:'onPress',effect:{kind:'control',component:id,prop:'control',method:'open',close:'close'}}));
  const graph:FlowGraph={nodes:[{id:'home',name:'Home',kind:'screen',path:['Home'],required:[],status:'pending',entry:true}],edges:[],warnings:[],files:1,scanMs:0,sourceHash:'source',presentations:{states:[],actions}};
  const stack:string[]=[],events:string[]=[],shots:string[]=[];let discoveryFailed=false;
  const view=()=>({key:stack.join('/')||'Home',signature:stack.join('/')||'Home',motion:'settled',found:true,content:3,ready:true,active:['Home'],routeMatches:true});
  const runs=new QueuedAppFlowRuns({directory,scan:async()=>structuredClone(graph),connect:async()=>({
    runtime:{async close(){assert.equal(stack.length,0,'Native cleanup must finish before closing the connection');},async invoke(c:any){
      events.push(c.type);
      if(c.type==='inspect')return {available:true,active:['Home'],entries:[['Home']]};
      if(c.type==='capture-inventory')return {sourceHashes:['source']};
      if(c.type==='presentation-rollback'){stack.splice((c.level??0)/2);return {};}
      if(c.type==='presentation-checkpoint')return {level:stack.length*2};
      if(c.type==='open'){assert.equal(stack.length,0,'Cannot navigate beneath a sheet');events.push('route:Home');return {...view(),name:'Home'};}
      if(c.type==='presentation-active')return [];
      if(c.type==='presentations'){
        if(fail==='discovery'&&!discoveryFailed){discoveryFailed=true;throw new FlowRuntimeTimeout('presentations');}
        return stack.length===0?[actions[0],actions[0]]:stack.length===1?[actions[1],actions[2]]:[];
      }
      if(c.type==='presentation-prepare')return c.id===fail?{available:false,error:'Missing real context'}:{available:true};
      if(c.type==='presentation-open'){events.push(`open:${c.id}`);stack.push(c.id);return view();}
      if(c.type==='presentation-setup')return {};
      return view();
    }},
    async screenshot(){const body=view().key;shots.push(body);return Buffer.from(body);},
  })});
  t.after(async()=>{await runs.close();await rm(directory,{recursive:true,force:true});});
  const recipes=[{baseNodeId:'home',actions:['Compose']},{baseNodeId:'home',actions:['Compose','Drafts']},{baseNodeId:'home',actions:['Compose','Language']}];
  const include=['home',...captureRecipeNodes(graph,graph.nodes,recipes).map(node=>node.id)];
  const run=runs.start({projectRoot:directory,platform:'ios',deviceId:'phone',targetId:'target',metroUrl:'http://127.0.0.1:8081',useAi:false,...(mode==='prepared'?{capture:{include,recipes}}:{})});
  for(let i=0;i<300&&flowRunning(runs.read(run.id));i++)await delay(10);
  assert.equal(flowRunning(runs.read(run.id)),false,'Queue must finish');
  await runs.close();return {run:runs.read(run.id),shots,events};
}

for(const mode of ['discovery','prepared'] as const)test(`${mode} keeps a sheet open across sibling captures and restores native state`,async t=>{
  const {run,shots,events}=await fixture(t,mode);
  assert.equal(run.phase,'complete',run.error);
  assert.equal(run.nodes.length,4);
  assert.ok(run.nodes.every(node=>node.status==='captured'&&node.image));
  assert.deepEqual(shots,['Home','Compose','Compose/Drafts','Compose/Language']);
  assert.equal(events.filter(event=>event==='route:Home').length,1);
  assert.equal(events.filter(event=>event==='open:Compose').length,1);
});

test('a failed source-bound child keeps its reason and does not prevent sibling capture',async t=>{
  const {run,shots}=await fixture(t,'discovery','Drafts');
  assert.equal(run.phase,'partial');
  assert.equal(run.nodes.find(node=>node.name==='Drafts')?.status,'needs-data');
  assert.equal(run.nodes.find(node=>node.name==='Drafts')?.reason,'Missing real context');
  assert.ok(shots.includes('Compose/Language'));
  assert.equal(run.nodes.find(node=>node.name==='Language')?.status,'captured');
});

test('retrying discovery retains the saved parent image and its capture attempt count',async t=>{
  const {run,shots}=await fixture(t,'discovery','discovery');
  assert.equal(run.phase,'complete');
  assert.equal(shots.filter(shot=>shot==='Home').length,1);
  assert.equal(run.nodes.find(node=>node.name==='Home')?.captureAttempts,1);
  assert.deepEqual(run.discoveryFailures,[]);
  assert.equal(run.nodes.length,4);
});
