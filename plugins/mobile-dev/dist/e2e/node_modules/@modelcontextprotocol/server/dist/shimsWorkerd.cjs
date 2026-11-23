const require_src = require('./src-BvE2tDzk.cjs');
const require_cfWorkerProvider = require('./cfWorkerProvider-QxAbCgU1.cjs');

//#region src/shimsWorkerd.ts
/**
* Cloudflare Workers runtime shims for server package
*
* This file is selected via package.json export conditions when running in workerd.
*/
require_src.preloadSchemas();
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
exports.DefaultJsonSchemaValidator = require_cfWorkerProvider.CfWorkerJsonSchemaValidator;
exports.process = process;
//# sourceMappingURL=shimsWorkerd.cjs.map