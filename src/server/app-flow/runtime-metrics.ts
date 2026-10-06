import * as Sentry from '@sentry/node';
import {MeasurementWindow} from '../../shared/telemetry.ts';

const operations:Record<string,string>={
  'capture-inventory':'reading capture bindings', 'capture-start':'starting the in-app capture queue',
  'capture-ack':'acknowledging a capture', 'capture-stop':'restoring capture state',
  'capture-prepare':'preparing capture recipes', 'capture-source':'acknowledging source binding',
  install:'installing the inspector', binding:'connecting the inspector', heartbeat:'checking the connection',
  inspect:'reading navigation', resume:'resuming the inspector', recover:'restoring navigation', restore:'closing the inspector',
  open:'opening a route', verify:'checking a screenshot', observe:'observing the app',
  diagnostics:'reading inspector diagnostics', screenshot:'taking a device screenshot',
  'context-data':'reading cached app data',
  'presentation-collect':'collecting presentation bindings', 'presentation-bindings':'reading presentation bindings',
  'presentation-configure':'binding presentation source', 'presentation-active':'reading presentation state',
  'presentation-symbolicate':'resolving presentation source',
  'presentation-prepare':'preparing a source view',
  presentations:'finding presentation entries', 'presentation-view':'checking presentation readiness',
  'presentation-portals':'rendering a temporary portal',
  'presentation-effects':'opening a temporary UI control',
  'presentation-handoff':'dismissing a parent presentation',
  'presentation-open':'opening a presentation', 'presentation-project':'projecting a presentation',
  'presentation-rollback':'restoring a presentation', 'presentation-checkpoint':'reading a presentation checkpoint',
};
export const runtimeOperation=(value:unknown)=>typeof value==='string'&&Object.hasOwn(operations,value)?value:'other';
export class FlowRuntimeFailure extends Error {
  readonly operation:string;
  readonly detail?:string;
  constructor(operation:string, reason='failed', detail?:unknown) {
    super(`App Flow runtime ${reason} while ${operations[runtimeOperation(operation)]??'running an inspector command'}.`);
    this.operation=runtimeOperation(operation);
    if(typeof detail==='string')this.detail=detail.slice(0,1000);
  }
}
export class FlowRuntimeTimeout extends FlowRuntimeFailure {
  constructor(operation:string){super(operation,'timed out');}
}
export class FlowAppFailure extends FlowRuntimeFailure {
  constructor(operation:string) {
    super(operation);
    this.message='App Flow stopped because the app reported a fatal JavaScript error. Check the app error screen before retrying.';
  }
}
/** Fixed operation names and bounded samples. Never retain commands or app data. */
export class FlowRuntimeMetrics {
  private windows=new Map<string,{timings:MeasurementWindow;timeouts:number}>();
  private totals=new Map<string,{operation:string;count:number;totalMs:number;maxMs:number;timeouts:number}>();
  private platform?:'ios'|'android';
  constructor(platform?:'ios'|'android'){this.platform=platform;}
  record(operation:string,ms:number,timedOut:boolean){
    if(!Number.isFinite(ms)||ms<0)return;
    const key=runtimeOperation(operation),window=this.windows.get(key)??{timings:new MeasurementWindow(),timeouts:0};
    window.timings.record(ms);if(timedOut)window.timeouts++;this.windows.set(key,window);
    const total=this.totals.get(key)??{operation:key,count:0,totalMs:0,maxMs:0,timeouts:0};
    total.count++;total.totalMs+=ms;total.maxMs=Math.max(total.maxMs,ms);if(timedOut)total.timeouts++;this.totals.set(key,total);
  }
  /** Local diagnostics survive telemetry flushes; no command or app data. */
  snapshot(){return [...this.totals.values()].map(value=>({...value}));}
  flush(){
    if(process.env.MOBILE_DEV_TELEMETRY==='off'){this.windows.clear();return;}
    for(const [runtime_operation,window]of this.windows){
      const attributes={surface:'app-flow',runtime_operation,...(this.platform?{device_platform:this.platform}:{})},values=window.timings.take();
      if(values)for(const statistic of ['mean','p95','max']as const)Sentry.metrics.gauge(`app_flow.runtime.${statistic}`,values[statistic],{unit:'millisecond',attributes});
      if(window.timeouts)Sentry.metrics.count('app_flow.runtime.timeouts',window.timeouts,{attributes});
    }
    this.windows.clear();
  }
}
