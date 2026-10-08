import type {FlowNode, FlowRun} from '../../shared/app-flow.ts';
import type {FlowBackend} from './runs.ts';
import {captureManifest, type CaptureJob} from './capture-manifest.ts';
import {FlowPresentationDiscovery} from './presentations.ts';
import type {FlowEvidence, FlowReachability} from './reachability.ts';
import {FlowAppFailure} from './runtime-metrics.ts';

// Waits that time can end: native motion, paint, settling, the screen beneath
// and slow runtime replies. A presentation already had its longest wait while
// loading, and one whose target never mounted, that stayed empty, went idle,
// has no content slot or whose screenshot kept changing fails the same way
// again.
const transientWait=/^(?:paint$|settling$|transition$|native$|changed$)|still loading|(?:Screen|presentation|view) did not settle|Native transition|timed out while|stopped responding|navigator is remounting/;
/** One more attempt for a timed-out view, only when another can end differently. */
export function retryableCapture(node:FlowNode) {
  if(node.status!=='timed-out' || (node.captureAttempts??0)>=2)return false;
  return node.presentation ? transientWait.test(node.reason??'') : !/did not mount/.test(node.reason??'');
}

/** Chooses work only. The in-app queue owns all opening, capture and cleanup. */
export class CapturePlanner {
  readonly presentations: FlowPresentationDiscovery;
  private discoveries = new Map<string,number>();
  private discoveredAtFrame = new Set<string>();
  private run:FlowRun; private signal:AbortSignal; private reachability?:FlowReachability; private initialPath?:string[];
  constructor(run:FlowRun, root:string, directory:string, signal:AbortSignal,
    save:()=>Promise<void>, reachability?:FlowReachability, initialPath?:string[]) {
    this.run=run;this.signal=signal;this.reachability=reachability;this.initialPath=initialPath;
    this.presentations = new FlowPresentationDiscovery(run,root,directory,signal,save);
  }
  manifest(current?:FlowNode) {
    const selected = this.run.nodes.filter(node=>node.kind==='screen' && node.capture!=='observed' &&
      (node.status==='pending' && (node.captureAttempts??0)<2 || node.status==='captured' && this.presentations.enabled &&
        !this.presentations.hasVisited(node.id) && (this.discoveries.get(node.id)??0)<3));
    const manifest = captureManifest(this.run,selected);
    const currentJob = current?.status==='captured' && captureManifest(this.run,[current]).jobs[0];
    const key = (job:CaptureJob)=>JSON.stringify([job.path,job.params??{},!!job.expo]);
    const proximity = (job:CaptureJob)=>{
      if(!currentJob || key(job)!==key(currentJob))return 0;
      let depth=1;
      while(depth<=Math.min(job.actions.length,currentJob.actions.length) && job.actions[depth-1].id===currentJob.actions[depth-1].id)depth++;
      return depth;
    };
    for(const job of manifest.jobs){
      const node=selected.find(node=>node.id===job.id)!;
      job.discoverOnly=node.status==='captured';
      job.attempt=node.captureAttempts??0;
    }
    // Untouched views precede retries. Children retain their parent's live
    // checkpoints before another route replaces it.
    manifest.jobs.sort((a,b)=>(a.attempt??0)-(b.attempt??0) || proximity(b)-proximity(a) ||
      Number(JSON.stringify(b.path)===JSON.stringify(this.initialPath))-Number(JSON.stringify(a.path)===JSON.stringify(this.initialPath)) ||
      selected.findIndex(node=>node.id===a.id)-selected.findIndex(node=>node.id===b.id));
    return manifest;
  }
  /** Discovery of a ready view while the device captures its screenshot.
   * after() does not repeat it for this job; a failed one reopens the view
   * later, like a failed discovery after the capture. */
  async discover(backend:FlowBackend,node:FlowNode) {
    if(!this.presentations.enabled||this.presentations.hasVisited(node.id)||this.discoveredAtFrame.has(node.id))return;
    this.discoveredAtFrame.add(node.id);
    await this.presentations.explore(backend,node);
  }
  async after(backend:FlowBackend,node:FlowNode,result:{ready?:boolean;evidence?:FlowEvidence}) {
    this.signal.throwIfAborted();
    const discovered=this.discoveredAtFrame.delete(node.id);
    if(!node.presentation && result.evidence)this.reachability?.reveal(node,result.evidence);
    // A presentation reveals only links inside its own body, with their real
    // params; the screen beneath it already reported its links.
    else if(node.presentation && result.ready && result.evidence?.bodyLinks?.length)this.reachability?.reveal(node,{links:result.evidence.bodyLinks,components:[]});
    if(result.ready && this.presentations.enabled){
      this.discoveries.set(node.id,(this.discoveries.get(node.id)??0)+1);
      if(!discovered)try { await this.presentations.explore(backend,node); }
      catch(error) { if(this.signal.aborted || error instanceof FlowAppFailure)throw error; }
    } else if(node.status==='captured' && this.presentations.enabled) {
      this.presentations.failures.set(node.id,{nodeId:node.id,operation:'open',message:'The saved view could not be reopened for discovery.'});
      this.discoveries.set(node.id,(this.discoveries.get(node.id)??0)+1);
    }
    if(retryableCapture(node))node.status='pending';
    this.run.revision++;
    return this.manifest(node);
  }
}
