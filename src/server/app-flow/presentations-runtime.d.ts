import type { FlowPresentations, FlowStateSite, FlowPresentationAction } from '../../shared/app-flow.ts';
export type PresentationBinding = {id: string; owner: string; stack: string; kind?: string; source?: {file: string; line: number; column: number}};
export function installPresentationRuntime(options: {
  hook: any; fibers(callback: (fiber: any) => unknown, subtree?: any): void;
  hidden(props: any): boolean; later(callback: () => void, ms: number): unknown;
  measure?(phase: string, ms: number): void;
}): {
  collect(states: FlowStateSite[], actions?: FlowPresentationAction[], projectRoot?: string, sourceHash?: string, actionId?: string): Promise<{bindings: PresentationBinding[]; next?: number}>;
  records(offset: number): {bindings: PresentationBinding[]; next?: number};
  configure(catalog: FlowPresentations, matches: {binding: string; site: string}[], checked?: string[]): void;
  list(focus?: any): {id: string; canonicalId?: string; aliases?: string[]; instance?: string; name: string; file: string; line: number; views: string[]}[];
  prepare(id: string, focus?: any, instance?: string): {available?: boolean; error?: string; handoff?: boolean};
  prepareCapture(id: string, focus?: any, instance?: string): {available?: boolean; error?: string; handoff?: boolean};
  open(id: string, focus?: any, progress?: unknown, instance?: string): {name?: string; focus?: any; scope?: any; expected?: string | {component:string;entry?:string;scope?:'owner'}; error?: string};
  handoff(id:string,focus?:any,cancelled?:()=>boolean):Promise<{closed?:boolean;focus?:any;error?:string}>;
  portalBindings(focus?:any): (PresentationBinding&{approved:boolean})[];
  previewPortals(ids:string[],focus?:any): {portals?:number;error?:string};
  uiEffectBindings(focus?:any): (PresentationBinding&{approval?:string})[];
  previewEffects(matches:{binding:string;site:string}[],focus?:any): {effects?:number;error?:string};
  activeViews(focus?: any): string[];
  /** Compiled source sites, innermost first, that pass the opened controller. */
  openedSites(): string[];
  nativeFailure(): string | undefined;
  rollback(level?: number, wait?: boolean): Promise<void>;
  cleanup(): void; motion(focus?: any, viewport?: {x: number; y: number; width: number; height: number}, geometry?: WeakMap<object,any>): {pending: boolean; signature: string};
  project(focus: any): {name?: string; focus?: any; error?: string};
  focusFor(name: string, scope?: any): any;
  probeFocus(focus?: any, expected?: string | {component:string;entry?:string;scope?:'owner'}): {focus:any;visualFocus:any;expectedReady:boolean;motion(viewport?: {x:number;y:number;width:number;height:number}, geometry?: WeakMap<object,any>): {pending:boolean;signature:string;error?:string}};
  diagnostics(): Record<string,number>;
  structure(): {all: any[]};
  visualFocus(focus?: any): any; focused(focus: any): void; checkpoint(): number;
};
