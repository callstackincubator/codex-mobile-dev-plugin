const require_cfWorkerProvider = require('./cfWorkerProvider-QxAbCgU1.cjs');

//#region src/shimsBrowser.ts
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
//# sourceMappingURL=shimsBrowser.cjs.map