import { n as preloadSchemas } from "./src-DdvbAHrR.mjs";
import { t as CfWorkerJsonSchemaValidator } from "./cfWorkerProvider-hgYAfIZf.mjs";

//#region src/shimsWorkerd.ts
/**
* Cloudflare Workers runtime shims for server package
*
* This file is selected via package.json export conditions when running in workerd.
*/
preloadSchemas();
/**
* Stub process object for non-Node.js environments.
* StdioServerTransport is not supported in Cloudflare Workers/browser environments.
*/
function notSupported() {
	throw new Error("StdioServerTransport is not supported in this environment. Use StreamableHTTPServerTransport instead.");
}
const process = {
	get stdin() {
		return notSupported();
	},
	get stdout() {
		return notSupported();
	}
};

//#endregion
export { CfWorkerJsonSchemaValidator as DefaultJsonSchemaValidator, process };
//# sourceMappingURL=shimsWorkerd.mjs.map