import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FlowResolution, FlowRun } from '../../shared/app-flow.ts';
import {publicFlowRun} from '../../shared/app-flow.ts';
import type { FlowStart, FlowTargetIdentity, RuntimeInfo } from './runs.ts';

export type SavedFlow = { run: FlowRun; input?: FlowStart; info?: RuntimeInfo; target?: FlowTargetIdentity };
export type FlowCommand = { type: 'resolve'; resolutions: FlowResolution[] } | { type: 'retry' } | { type: 'stop' } | { type: 'capture-step'; label?: string };
export type FlowLease = { release(): Promise<void> };
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

/** Shared by panel and model MCP processes. Only the device lease holder captures. */
export class FlowStore {
  readonly directory: string;
  private catalogs = new WeakMap<object,{key:string;value:unknown}>();
  private savedCatalogs = new Map<string,string>();
  constructor(directory: string) { this.directory = directory; }
  private folder(id: string) {
    if (!uuid.test(id)) throw new Error('Invalid App Flow run.');
    return join(this.directory, id);
  }
  private async json(path: string) {
    if ((await stat(path)).size > 16 * 1024 * 1024) throw new Error('Saved App Flow data is too large.');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  private async write(path: string, value: unknown) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(value)); } finally { await file.close(); }
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
  }
  async save(value: SavedFlow) {
    const folder = this.folder(value.run.id);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const views=value.run.presentations?.views;
    const run=publicFlowRun(value.run);
    if(views){
      let catalog=this.catalogs.get(views);
      if(!catalog){const data={views,viewStates:value.run.presentations?.viewStates??[]};catalog={key:createHash('sha256').update(JSON.stringify(data)).digest('hex'),value:data};this.catalogs.set(views,catalog);}
      if(this.savedCatalogs.get(run.id)!==catalog.key){await this.write(join(folder,`source-${catalog.key}.json`),catalog.value);this.savedCatalogs.set(run.id,catalog.key);}
      run.sourceCatalogKey=catalog.key;
    }
    await this.write(join(folder, 'session.json'), {...value,run});
    await this.write(join(folder, 'map.json'), run);
  }
  async load(id: string, includeCatalog = true): Promise<SavedFlow> {
    const folder = this.folder(id);
    let value: SavedFlow;
    try { value = await this.json(join(folder, 'session.json')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try { value = { run: await this.json(join(folder, 'map.json')) }; }
      catch { throw new Error('This saved App Flow map could not be found.'); }
    }
    if (value.run?.id !== id || !Array.isArray(value.run.nodes) || !Array.isArray(value.run.edges)) throw new Error('Invalid saved App Flow map.');
    if(includeCatalog&&value.run.sourceCatalogKey){
      if(!/^[a-f\d]{64}$/.test(value.run.sourceCatalogKey))throw new Error('Invalid saved App Flow source catalog.');
      const catalog=await this.json(join(folder,`source-${value.run.sourceCatalogKey}.json`));
      if(!Array.isArray(catalog.views)||!Array.isArray(catalog.viewStates)||!value.run.presentations)throw new Error('Invalid saved App Flow source catalog.');
      Object.assign(value.run.presentations,catalog);
      this.catalogs.set(catalog.views,{key:value.run.sourceCatalogKey,value:catalog});this.savedCatalogs.set(id,value.run.sourceCatalogKey);
    }
    return value;
  }
  async enqueue(id: string, command: FlowCommand) {
    const folder = join(this.folder(id), 'commands');
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await this.write(join(folder, `${Date.now()}-${randomUUID()}.json`), command);
  }
  async commands(id: string): Promise<{ name: string; command: FlowCommand }[]> {
    const folder = join(this.folder(id), 'commands');
    let names: string[];
    try { names = await readdir(folder); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const result = [];
    for (const name of names.filter(name => /^\d+-[a-f\d-]+\.json$/.test(name)).sort().slice(0, 100)) {
      const command = await this.json(join(folder, name));
      if (!['resolve', 'retry', 'stop', 'capture-step'].includes(command.type) || command.type === 'resolve' && !Array.isArray(command.resolutions) || command.type === 'capture-step' && command.label !== undefined && (typeof command.label !== 'string' || command.label.length > 80)) throw new Error('Invalid saved App Flow request.');
      result.push({ name, command });
    }
    return result;
  }
  async acknowledge(id: string, names: string[]) {
    for (const name of names) await rm(join(this.folder(id), 'commands', name), { force: true });
  }
  async claim(input: FlowStart): Promise<FlowLease | undefined> {
    const folder = join(this.directory, 'locks');
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const path = join(folder, createHash('sha256').update(`${input.platform}:${input.deviceId}`).digest('hex'));
    const owner = { pid: process.pid, token: randomUUID() };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const file = await open(path, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(owner)); } finally { await file.close(); }
        return { release: async () => { try { if ((await this.json(path)).token === owner.token) await rm(path, { force: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } } };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // Serialize stale-owner cleanup, then reread the owner under that guard.
        // Two clients must never both remove a lease that one just replaced.
        let guard;
        try { guard = await open(`${path}.reap`, 'wx', 0o600); } catch { return; }
        try {
          let previous;
          try { previous = await this.json(path); }
          catch {
            let metadata;
            try { metadata = await stat(path); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
            if (Date.now() - metadata.mtimeMs < 10_000) return;
          }
          if (previous) {
            if (!Number.isInteger(previous.pid) || previous.pid <= 0) return;
            try { process.kill(previous.pid, 0); return; }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return; }
          }
          await rm(path, { force: true });
        } finally { await guard.close(); await rm(`${path}.reap`, { force: true }); }
      }
    }
  }
}
