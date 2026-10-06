import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import {flowRuntimeSource} from './runtime-source.ts';
import { bindPresentationSites } from './presentations-bindings.ts';
import {FlowAppFailure,FlowRuntimeFailure,FlowRuntimeMetrics,FlowRuntimeTimeout,runtimeOperation} from './runtime-metrics.ts';

/** A reconnect can reuse the runtime lease and original navigation state. */
export class FlowConnection {
  private socket: WebSocket;
  private key: string;
  private binding: string;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; operation:string; started:number }>();
  private closed = false;
  private closing?: Promise<void>;
  private ready: Promise<void>;
  private heartbeat?: NodeJS.Timeout;
  private heartbeatPending = false;
  private heartbeatFailures = 0;
  private metroBase: string;
  private metrics:FlowRuntimeMetrics;
  private presentationRoot?:string;
  private presentationCatalog?:import('../../shared/app-flow.ts').FlowPresentations;
  private captureListeners = new Set<(event: any) => void>();
  onCapture(listener: (event:any) => void) { this.captureListeners.add(listener); return () => this.captureListeners.delete(listener); }

  constructor(url: string, sessionId = randomUUID(), platform?:'ios'|'android', metrics?:FlowRuntimeMetrics) {
    this.metrics=metrics??new FlowRuntimeMetrics(platform);
    this.key = `__mobile_flow_${sessionId.replaceAll("-", "")}`;
    this.binding = `${this.key}_reply_${randomUUID().replaceAll("-", "")}`;
    const origin = new URL(url); origin.protocol = "http:";
    this.metroBase = origin.origin;
    this.socket = new WebSocket(url, { origin: origin.origin, handshakeTimeout: 3000, maxPayload: 2 * 1024 * 1024, followRedirects: false });
    this.ready = new Promise((resolve, reject) => {
      this.socket.once("open", () => { resolve(); });
      this.socket.once("error", () => reject(new Error("Cannot connect to the selected Metro runtime.")));
      this.socket.once("close", () => reject(new Error("Metro closed the debugger connection.")));
    });
    this.socket.on("message", bytes => {
      try {
        const message = JSON.parse(bytes.toString());
        if (message.method === "Runtime.bindingCalled" && message.params?.name === this.binding) {
          const value = JSON.parse(message.params.payload);
          if (value.capture) { for (const listener of this.captureListeners) listener(value.capture); }
          else this.finish(value.id, value.result);
        } else if (message.id) {
          if (message.error || message.result?.exceptionDetails) this.finish(message.id, undefined, new FlowRuntimeFailure(this.pending.get(message.id)?.operation??'other','was rejected',message.result?.exceptionDetails?.exception?.description??message.result?.exceptionDetails?.text??message.error?.message));
          else if (message.id > 0) this.finish(message.id, message.result);
        }
      } catch { this.fail(new Error("Metro returned an invalid App Flow response.")); }
    });
    this.socket.on("error", () => this.fail(new Error("Metro disconnected.")));
    this.socket.on("close", () => this.fail(new Error("Metro disconnected.")));
    this.ready = this.ready.then(async () => {
      await this.send("Runtime.addBinding", { name: this.binding }, 2000,undefined,'binding');
      const [runtimeSource,presentationSource,queueSource,driverSource] = await flowRuntimeSource();
      // esbuild keepNames may introduce __name inside serialized functions.
      await this.send("Runtime.evaluate", { expression: `(()=>{const __name=(value)=>value;for(const name of Object.keys(globalThis))if(name.startsWith(${JSON.stringify(`${this.key}_reply_`)})&&name!==${JSON.stringify(this.binding)})delete globalThis[name];(${runtimeSource})(${JSON.stringify(this.key)},10000,${presentationSource},${queueSource},${driverSource});})()`, silent: true, returnByValue: true, objectGroup: this.key }, 2000,undefined,'install');
      if (!this.closing && !this.closed) {
        this.heartbeat = setInterval(() => {
          if (this.heartbeatPending) return;
          this.heartbeatPending = true;
          void this.invoke({ type: "heartbeat" }, 2500).then(() => { this.heartbeatFailures = 0; }).catch(() => { if (++this.heartbeatFailures >= 3) void this.close(); }).finally(() => { this.heartbeatPending = false; });
        }, 2000);
        this.heartbeat.unref();
      }
    });
    void this.ready.catch(() => {});
  }
  private finish(id: number, value?: unknown, error?: Error) {
    const pending = this.pending.get(id); if (!pending) return;
    this.pending.delete(id); clearTimeout(pending.timer);
    this.metrics.record(pending.operation,performance.now()-pending.started,error instanceof FlowRuntimeTimeout);
    if (error) pending.reject(error); else pending.resolve(value);
  }
  private fail(error: Error) { clearInterval(this.heartbeat); for (const id of this.pending.keys()) this.finish(id, undefined, error); for(const listener of this.captureListeners)listener({type:'connection-error'}); }
  private send(method: string, params: unknown, timeout: number, id = ++this.sequence,operation='other'): Promise<any> {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Metro connection is closed."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.finish(id, undefined, new FlowRuntimeTimeout(operation)), timeout);
      this.pending.set(id, { resolve, reject, timer,operation:runtimeOperation(operation),started:performance.now() });
      this.socket.send(JSON.stringify({ id, method, params }), error => { if (error) this.finish(id, undefined, new Error("Metro disconnected.")); });
    });
  }
  async invoke(command: Record<string, unknown>, timeout = 1500): Promise<any> {
    await this.ready;
    if (command.type === 'capture-start') command = {...command, binding:this.binding};
    if (command.type === 'presentation-setup') {
      this.presentationRoot=command.projectRoot as string;
      const catalog = command.catalog as import('../../shared/app-flow.ts').FlowPresentations;
      let matched=0;
      for(let pass=0;pass<2;pass++){
        let page = await this.invoke({ type: 'presentation-collect', ...(this.presentationCatalog===catalog?{}:{states:catalog.states,actions:catalog.actions,projectRoot:command.projectRoot}) }, 2500);
        const bindings = [];
        for (let i=0;i<30;i++) { bindings.push(...(page.bindings ?? [])); if (page.next === undefined) break; page = await this.invoke({type:'presentation-bindings',offset:page.next},1500); }
        if(!bindings.length){this.presentationCatalog=catalog;break;}
        let matches;
        const sourceStarted=performance.now();
        try { matches = await bindPresentationSites(this.metroBase, command.projectRoot as string, bindings, catalog.states, catalog.actions); }
        catch(error) { throw new FlowRuntimeFailure('presentation-symbolicate','failed',error instanceof Error?error.message:undefined); }
        finally { this.metrics.record('presentation-symbolicate',performance.now()-sourceStarted,false); }
        // Private owners first bind their JSX identity, then collect hooks from
        // only that verified component. The immutable catalog stays installed.
        await this.invoke({ type: 'presentation-configure', matches, checked: bindings.map(binding => binding.id) }, 1000);
        this.presentationCatalog=catalog;matched+=matches.length;
        if(!matches.some(match=>match.site.startsWith('owner:')))break;
      }
      return { bindings: matched };
    }
    const id = -(++this.sequence);
    const expression = `(()=>{const runtime=globalThis[${JSON.stringify(this.key)}],reply=result=>globalThis[${JSON.stringify(this.binding)}]?.(JSON.stringify({id:${id},result}));if(!runtime?.invoke){reply({runtimeUnavailable:true});return;}runtime.invoke(${JSON.stringify(command)},reply);})()`;
    let result=await this.send("Runtime.evaluate", { expression, silent: true, returnByValue: true, objectGroup: this.key }, timeout, id,runtimeOperation(command.type));
    if(result?.runtimeUnavailable)throw new Error('App Flow inspector is no longer installed. Reconnecting.');
    if(result?.appFailed)throw new FlowAppFailure(String(command.type));
    if(['presentation-open','presentation-view'].includes(String(command.type))){
      const attempted=new Set<string>();
      for(let depth=0;depth<8&&(result?.portalBindings?.length||result?.effectBindings?.length);depth++){
        const bindings=[...(result.portalBindings??[]),...(result.effectBindings??[])].filter((binding:any)=>typeof binding.id==='string'&&!attempted.has(binding.id)).slice(0,100);
        if(!bindings.length)break;
        for(const binding of bindings)attempted.add(binding.id);
        const started=performance.now();let matches;
        try{matches=await bindPresentationSites(this.metroBase,this.presentationRoot??'',bindings.filter((binding:any)=>!binding.approved&&!binding.approval),[]);}
        catch(error){throw new FlowRuntimeFailure('presentation-symbolicate','failed',error instanceof Error?error.message:undefined);}
        finally{this.metrics.record('presentation-symbolicate',performance.now()-started,false);}
        const ids=[...bindings.filter((binding:any)=>binding.approved).map((binding:any)=>binding.id),...matches.filter(match=>match.site==='portal').map(match=>match.binding)];
        const effects=[...bindings.filter((binding:any)=>binding.kind==='ui-effect'&&binding.approval).map((binding:any)=>({binding:binding.id,site:binding.approval})),...matches.filter(match=>match.site.startsWith('ui-effect:'))];
        if(!ids.length&&!effects.length)break;
        if(ids.length)result=await this.invoke({type:'presentation-portals',ids},2000);
        if(effects.length)result=await this.invoke({type:'presentation-effects',matches:effects},2000);
      }
    }
    if (command.type==='presentation-open' && !result?.error && this.presentationCatalog?.actions.some(action=>action.id===command.id&&action.expected)) {
      // A hidden branch can create its JSX only after its temporary state is
      // seeded. Bind that new entry before checking its capture readiness.
      await this.invoke({type:'presentation-setup',catalog:this.presentationCatalog,projectRoot:this.presentationRoot},5000);
      result=await this.invoke({type:'presentation-view'},2000);
    }
    if (['presentation-collect','presentation-bindings','presentation-configure','presentation-active','presentations','presentation-rollback','presentation-portals','presentation-effects'].includes(String(command.type))) {
      if(result?.error)throw new FlowRuntimeFailure(String(command.type),'was rejected',result.detail??result.error);
      if(['presentation-active','presentations'].includes(String(command.type))&&!Array.isArray(result))throw new FlowRuntimeFailure(String(command.type),'returned an invalid response');
      if(['presentation-collect','presentation-bindings'].includes(String(command.type))&&!Array.isArray(result?.bindings))throw new FlowRuntimeFailure(String(command.type),'returned an invalid response');
    }
    return result;
  }
  close(options?: { restore?: boolean }): Promise<void> { return this.closing ??= this.dispose(options?.restore !== false); }
  private async dispose(restore: boolean) {
    if (this.closed) return;
    clearInterval(this.heartbeat);
    if (restore) try { await Promise.race([this.invoke({ type: "restore" }, 5000), new Promise<void>(resolve => { const timer = setTimeout(resolve, 5500); timer.unref(); })]); } catch { /* Runtime watchdog also restores after disconnect. */ }
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ id: ++this.sequence, method: "Runtime.removeBinding", params: { name: this.binding } }));
      this.socket.send(JSON.stringify({ id: ++this.sequence, method: "Runtime.evaluate", params: { expression: `delete globalThis[${JSON.stringify(this.binding)}]`, silent: true, returnByValue: true } }));
      this.socket.send(JSON.stringify({ id: ++this.sequence, method: "Runtime.releaseObjectGroup", params: { objectGroup: this.key } }));
    }
    this.closed = true;
    this.fail(new Error("App Flow stopped."));
    this.captureListeners.clear();
    this.metrics.flush();
    this.socket.terminate();
  }
}
