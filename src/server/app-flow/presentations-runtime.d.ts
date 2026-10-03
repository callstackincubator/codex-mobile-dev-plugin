import type { FlowPresentations, FlowStateSite } from '../../shared/app-flow.ts';
export function installPresentationRuntime(options: {
  hook: any; fibers(callback: (fiber: any) => unknown, subtree?: any): void;
  hidden(props: any): boolean; later(callback: () => void, ms: number): unknown;
}): {
  collect(states: FlowStateSite[]): Promise<{bindings: {id: string; owner: string; stack: string}[]; next?: number}>;
  records(offset: number): {bindings: {id: string; owner: string; stack: string}[]; next?: number};
  configure(catalog: FlowPresentations, matches: {binding: string; site: string}[], checked?: string[]): void;
  list(focus?: any): {id: string; name: string; file: string; line: number}[];
  open(id: string, focus?: any): {name?: string; focus?: any; scope?: any; error?: string};
  rollback(level?: number, wait?: boolean): Promise<void>;
  cleanup(): void; motion(focus?: any, viewport?: {x: number; y: number; width: number; height: number}): {pending: boolean; signature: string};
  project(focus: any): {name?: string; focus?: any; error?: string};
  focusFor(name: string, scope?: any): any;
  visualFocus(focus?: any): any; focused(focus: any): void; checkpoint(): number;
};
