import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {installFlowRuntime} from '../src/server/app-flow/runtime.js';
import {installPresentationRuntime} from '../src/server/app-flow/presentations-runtime.js';
import {createCaptureQueue} from '../src/server/app-flow/capture-queue.js';
import {createCaptureDriver} from '../src/server/app-flow/capture-driver.js';

export async function buildFlowRuntime(directory = 'dist/app-flow') {
  await mkdir(directory,{recursive:true});
  await copyFile('src/server/app-flow/instrumentation-plugin.cjs',`${directory}/instrumentation-plugin.cjs`);
  await build({entryPoints:['src/server/app-flow/instrumentation-client.js'],outfile:`${directory}/instrumentation-client.cjs`,bundle:true,format:'cjs',platform:'neutral',target:'es2022',external:['react','react-native'],minify:false});
  await writeFile(`${directory}/runtime.json`,JSON.stringify({version:1,functions:[installFlowRuntime,installPresentationRuntime,createCaptureQueue,createCaptureDriver].map(fn=>fn.toString())}));
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) await buildFlowRuntime();
