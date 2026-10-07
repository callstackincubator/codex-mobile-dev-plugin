import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build,transform} from 'esbuild';
import {installFlowRuntime} from '../src/server/app-flow/runtime.js';
import {installPresentationRuntime} from '../src/server/app-flow/presentations-runtime.js';
import {createCaptureQueue} from '../src/server/app-flow/capture-queue.js';
import {createCaptureDriver} from '../src/server/app-flow/capture-driver.js';
import {createTransitionMode} from '../src/server/app-flow/transitions-runtime.js';
import {installPreparedRuntime} from '../src/server/app-flow/prepared-runtime.js';

export async function buildFlowRuntime(directory = 'dist/app-flow') {
  await mkdir(directory,{recursive:true});
  await copyFile('src/server/app-flow/instrumentation-plugin.cjs',`${directory}/instrumentation-plugin.cjs`);
  const factories=[installFlowRuntime,installPresentationRuntime,createCaptureQueue,createCaptureDriver,createTransitionMode];
  const clientSources=await Promise.all(['instrumentation-client.js','instrumentation-registry.js','instrumentation-context.js','state-selections.js','state-expression-runtime.js'].map(file=>readFile(new URL(`../src/server/app-flow/${file}`,import.meta.url),'utf8')));
  const fingerprint=createHash('sha256').update([...factories,installPreparedRuntime].map(fn=>fn.toString()).concat(clientSources).join('\n')).digest('hex');
  await build({define:{__MOBILE_DEV_FLOW_FINGERPRINT__:JSON.stringify(fingerprint)},entryPoints:['src/server/app-flow/instrumentation-client.js'],outfile:`${directory}/instrumentation-client.cjs`,bundle:true,format:'cjs',platform:'neutral',target:'es2022',external:['react','react-native'],minify:false});
  // Hermes' debugger evaluator lowers raw async functions differently from
  // bundled app code. Compile closures here so values survive await/loop exits.
  const functions=await Promise.all(factories.map(async fn=>{
    const {code}=await transform(`const factory = ${fn.toString()};`,{target:'es2015',minify:false});
    return `(()=>{${code}\nreturn factory;})()`;
  }));
  // Use exactly the same checked runtime in the app bundle when available.
  // Old/unprepared builds retain the injected path without changing readiness.
  functions[0]=`(function(key,leaseMs,...factories){const prepared=globalThis.__MOBILE_DEV_FLOW_COMPILED__;if(prepared?.fingerprint===${JSON.stringify(fingerprint)}&&typeof prepared.install==='function')return prepared.install(key,leaseMs);return (${functions[0]})(key,leaseMs,...factories);})`;
  await writeFile(`${directory}/runtime.json`,JSON.stringify({version:1,fingerprint,functions}));
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) await buildFlowRuntime();
