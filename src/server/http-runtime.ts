import { Agent, setGlobalDispatcher } from "undici";

// Codex's Node runtime can bundle Undici without the macOS setTypeOfService fix.
const dispatcher = new Agent();
setGlobalDispatcher(dispatcher);

export function closeHttpRuntime() {
  return dispatcher.destroy();
}
