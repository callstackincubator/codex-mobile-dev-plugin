import * as Sentry from '@sentry/node';
import {MeasurementWindow} from '../../shared/telemetry.ts';

const operations:Record<string,string>={
  install:'installing the inspector', binding:'connecting the inspector', heartbeat:'checking the connection',
  inspect:'reading navigation', resume:'resuming the inspector', recover:'restoring navigation', restore:'closing the inspector',
  open:'opening a route', verify:'checking a screenshot', observe:'observing the app',
  'presentation-collect':'collecting presentation bindings', 'presentation-bindings':'reading presentation bindings',
  'presentation-configure':'binding presentation source', 'presentation-active':'reading presentation state',
  'presentation-symbolicate':'resolving presentation source',
  presentations:'finding presentation entries', 'presentation-view':'checking presentation readiness',
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
/** Fixed operation names and bounded samples. Never retain commands or app data. */
export class FlowRuntimeMetrics {
  private windows=new Map<string,{timings:MeasurementWindow;timeouts:number}>();
  private platform?:'ios'|'android';
  constructor(platform?:'ios'|'android'){this.platform=platform;}
  record(operation:string,ms:number,timedOut:boolean){
    const key=runtimeOperation(operation),window=this.windows.get(key)??{timings:new MeasurementWindow(),timeouts:0};
    window.timings.record(ms);if(timedOut)window.timeouts++;this.windows.set(key,window);
  }
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
