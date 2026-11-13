
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="cc741b0c-c786-5440-beb7-50aee1793838")}catch(e){}}();
import { createRequire as mobileDevBundleRequire } from 'node:module'; import { fileURLToPath as mobileDevFileURLToPath } from 'node:url'; import { dirname as mobileDevPathDirname } from 'node:path'; const require = mobileDevBundleRequire(import.meta.url); const __filename = mobileDevFileURLToPath(import.meta.url); const __dirname = mobileDevPathDirname(__filename);
import {
  external_exports
} from "./chunk-BNXJFHSV.mjs";

// packages/shared/src/app-intelligence.ts
var generateAppIntelInput = external_exports.object({ projectPath: external_exports.string().min(1).max(4096).optional() }).strict();
var appIntelQueryInput = external_exports.object({
  operation: external_exports.enum(["search", "screen", "file"]),
  query: external_exports.string().min(1).max(4096),
  projectPath: external_exports.string().min(1).max(4096).optional(),
  direction: external_exports.enum(["incoming", "outgoing", "both"]).default("incoming"),
  depth: external_exports.number().int().min(0).max(3).default(1),
  offset: external_exports.number().int().nonnegative().default(0),
  limit: external_exports.number().int().min(1).max(100).default(30)
}).strict();
var screenRef = (id) => `screen:${id}`;
var fileRef = (path) => `file:${path}`;
var packageRef = (name) => `package:${name}`;

export {
  generateAppIntelInput,
  appIntelQueryInput,
  screenRef,
  fileRef,
  packageRef
};

//# debugId=cc741b0c-c786-5440-beb7-50aee1793838
