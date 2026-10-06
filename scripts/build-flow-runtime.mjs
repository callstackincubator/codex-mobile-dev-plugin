import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {build,transform} from 'esbuild';
import {installFlowRuntime} from '../src/server/app-flow/runtime.js';
import {installPresentationRuntime} from '../src/server/app-flow/presentations-runtime.js';
import {createCaptureQueue} from '../src/server/app-flow/capture-queue.js';
import {createCaptureDriver} from '../src/server/app-flow/capture-driver.js';
import {createTransitionMode} from '../src/server/app-flow/transitions-runtime.js';

export async function buildFlowRuntime(directory = 'dist/app-flow') {
  await mkdir(directory,{recursive:true});
  await copyFile('src/server/app-flow/instrumentation-plugin.cjs',`${directory}/instrumentation-plugin.cjs`);
  await build({entryPoints:['src/server/app-flow/instrumentation-client.js'],outfile:`${directory}/instrumentation-client.cjs`,bundle:true,format:'cjs',platform:'neutral',target:'es2022',external:['react','react-native'],minify:false});
  // Hermes' debugger evaluator lowers raw async functions differently from
  // bundled app code. Compile closures here so values survive await/loop exits.
  const functions=await Promise.all([installFlowRuntime,installPresentationRuntime,createCaptureQueue,createCaptureDriver,createTransitionMode].map(async fn=>{
    const {code}=await transform(`const factory = ${fn.toString()};`,{target:'es2015',minify:false});
    return `(()=>{${code}\nreturn factory;})()`;
  }));
  await writeFile(`${directory}/runtime.json`,JSON.stringify({version:1,functions}));
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) await buildFlowRuntime();
