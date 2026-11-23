const require_chunk = require('./chunk-Bnu9O96Y.cjs');
const require_ajvProvider = require('./ajvProvider-DPYcD0gV.cjs');
let node_process = require("node:process");
node_process = require_chunk.__toESM(node_process);

exports.DefaultJsonSchemaValidator = require_ajvProvider.AjvJsonSchemaValidator;
Object.defineProperty(exports, 'process', {
  enumerable: true,
  get: function () {
    return node_process.default;
  }
});