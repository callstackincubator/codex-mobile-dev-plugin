import {AppFlowRuns, type FlowBackend, type FlowDependencies} from '../src/server/app-flow/runs.ts';
import {createCaptureDriver} from '../src/server/app-flow/capture-driver.js';
import {createCaptureQueue} from '../src/server/app-flow/capture-queue.js';
import {FlowAppFailure, FlowNativeFailure, FlowRuntimeTimeout} from '../src/server/app-flow/runtime-metrics.ts';

/** Test transport. RN commands are supplied by each fixture; scheduling, source
 * approval, frame acknowledgements and cancellation use the production queue. */
export function queuedBackend(backend:FlowBackend):FlowBackend {
  if(backend.runtime.onCapture)return backend;
  const original=backend.runtime, listeners=new Set<(event:any)=>void>();
  let last:any={},queue:any;
  async function invoke(command:any,timeout?:number){
    let value;
    try {value=await original.invoke(command,timeout);}
    catch(error){if(error instanceof Error && /disconnected|connection (?:lost|stalled)|lost connection/.test(error.message))for(const listener of listeners)listener({type:'connection-error'});throw error;}
    if(command.type==='open')last=value;
    if(['open','verify','presentation-view'].includes(command.type))return {
      key:JSON.stringify(value?.active??[]), content:1, found:true, signature:last?.signature, ...value,
    };
    if(command.type==='presentation-rollback' && value?.error===undefined)return {restored:true};
    if(command.type==='presentation-checkpoint' && value?.level===undefined)return {level:0};
    if(command.type==='presentation-prepare' && value?.available===undefined && !value?.error)return {available:true};
    return value;
  }
  const runtime={
    onCapture(listener:(event:any)=>void){listeners.add(listener);return()=>listeners.delete(listener);},
    async invoke(command:any,timeout?:number):Promise<any>{
      if(command.type==='capture-start'){
        queue=createCaptureQueue(createCaptureDriver({invoke(command:any,reply:any){
          void invoke(command).then(reply,error=>{
            if(error instanceof FlowAppFailure)reply({appFailed:true});
            else if(error instanceof FlowNativeFailure)reply({nativeFailure:true,error:error.message});
            else if(error instanceof FlowRuntimeTimeout)reply({ready:false,status:'timed-out',reason:error.message,error:command.type==='presentation-rollback'?error.message:undefined});
            else {reply({cancelled:true});for(const listener of listeners)listener({type:'connection-error'});}
          });
        }},request=>queue.request(request)),(event:any)=>{for(const listener of listeners)listener(event)});
        return queue.start(command.batch,command.jobs,command.planning);
      }
      if(command.type==='capture-source')return queue.source(command.batch,command.ticket,command.value);
      if(command.type==='capture-ack')return queue.ack(command.batch,command.ticket,command.value);
      if(command.type==='capture-stop'){await queue?.stop();return {stopped:true};}
      return invoke(command,timeout);
    },
    async close(options?:{restore?:boolean}){await queue?.stop();await original.close(options);},
  };
  return {...backend,runtime};
}
export class QueuedAppFlowRuns extends AppFlowRuns {
  constructor(options:FlowDependencies){super({...options,connect:async(...args)=>queuedBackend(await options.connect(...args))});}
}
