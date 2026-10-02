import test from 'node:test';
import assert from 'node:assert/strict';
import { FlowReachability, matchFlowLink } from '../src/server/app-flow/reachability.ts';
import { layoutFlow, visibleFlowNodes, type FlowGraph, type FlowNode } from '../src/shared/app-flow.ts';
const node = (name: string, entry = false): FlowNode => ({ id:name,name,definition:`${name}.tsx#${name}`,kind:'screen',path:[name],required:[],status:'pending',entry,urls:[`/${name.toLowerCase()}`] });

test('only live links and mounted navigation controls reveal registered screens', () => {
  const graph: FlowGraph = {files:1,scanMs:0,warnings:[],nodes:[node('Home',true),node('Settings'),node('Account'),node('Debug'),node('TestOnly')],edges:[
    {from:'Settings',to:'Debug',kind:'navigation',via:'call',owner:'DevOptions'},
  ],links:[{owner:'Drawer',target:'Settings',guarded:false},{owner:'TestControls',target:'TestOnly',guarded:false}]};
  const reach = new FlowReachability(graph,{active:['Home'],entries:[['Home']],components:['Home','Drawer']});
  assert.deepEqual(graph.nodes.map(n=>n.name),['Home','Settings']);
  reach.reveal(graph.nodes[1],{components:['Settings'],links:['/account']});
  reach.finish();
  assert.deepEqual(graph.nodes.map(n=>n.name),['Home','Settings','Account']);
  assert.deepEqual(graph.edges.map(e=>[e.from,e.to]),[['Home','Settings'],['Settings','Account']]);
  assert.match(graph.warnings[0],/2 registered screens/);
});

test('dynamic live URLs supply real params and navigator duplicates use the active tab', () => {
  const profile = {...node('Profile'),entry:false,path:['HomeTab','Profile'],urls:['/profile/:name/post/:rkey'],required:['name','rkey'],status:'needs-data' as const};
  const graph: FlowGraph = {files:1,scanMs:0,warnings:[],nodes:[{...node('Home',true),path:['HomeTab','Home']},profile,{...profile,id:'other',path:['SearchTab','Profile']}],edges:[]};
  const reach = new FlowReachability(graph,{active:['SearchTab','Home'],entries:[]});
  reach.reveal(graph.nodes[0],{links:['/profile/alice.test/post/real-key']});
  assert.equal(reach.nodes.length,2);
  assert.deepEqual(graph.nodes[1].params,{name:'alice.test',rkey:'real-key'});
  assert.deepEqual(graph.nodes[1].path,['SearchTab','Profile']);
  assert.equal(graph.nodes[1].status,'pending');
  assert.equal(matchFlowLink('/profile/:name','/profile/a/post/b'),undefined);
  assert.deepEqual(matchFlowLink('/(tabs)/post/[id]','/post/real'),{id:'real'});
});

test('layout follows navigation depth, wraps broad branches horizontally, and culls offscreen cards', () => {
  const nodes=[node('Home',true),node('Settings'),node('Account'),...Array.from({length:60},(_,i)=>node(`Child${i}`))];
  const edges: FlowGraph['edges']=[{from:'Home',to:'Settings',kind:'navigation'},{from:'Settings',to:'Account',kind:'navigation'},...nodes.slice(3).map(n=>({from:'Account',to:n.id,kind:'navigation' as const})),{from:'Account',to:'Home',kind:'navigation'}];
  const layout=layoutFlow({nodes,edges});
  assert.equal(layout.positions.size,nodes.length);
  assert.ok(layout.positions.get('Account')!.x>layout.positions.get('Settings')!.x);
  assert.ok(layout.positions.get('Settings')!.x>layout.positions.get('Home')!.x);
  assert.ok(layout.width>layout.height);
  assert.ok(layout.height<1600);
  const cards=[...layout.positions.values()];
  for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++)assert.ok(Math.abs(cards[i].x-cards[j].x)>=202||Math.abs(cards[i].y-cards[j].y)>=324,'cards overlap');
  const visible=visibleFlowNodes(layout.positions,{x:0,y:0,width:1000,height:800});
  assert.ok(visible.size<15);
  assert.ok(visible.has('Home'));
});

test('required data excludes optional action flags and exact URLs beat dynamic siblings', () => {
  const graph:FlowGraph={files:1,scanMs:0,warnings:[],nodes:[node('Home',true),node('Messages'),{...node('Inbox'),urls:['/messages/inbox']},{...node('Conversation'),urls:['/messages/:id'],required:['id'],status:'needs-data'}],edges:[]};
  const reach=new FlowReachability(graph,{active:['Home'],entries:[],candidates:[{name:'Messages',params:{openComposer:true}}]});
  reach.reveal(graph.nodes[0],{links:[{screen:'Messages',params:{openComposer:true}},'/messages/inbox']});
  assert.deepEqual(graph.nodes.map(n=>n.name),['Home','Messages','Inbox']);
  assert.equal(graph.nodes[1].params,undefined);
  reach.reveal(graph.nodes[0],{links:[{pathname:'/messages/actual-id',params:{openComposer:true}}]});
  assert.deepEqual(graph.nodes[3].params,{id:'actual-id'});
});
