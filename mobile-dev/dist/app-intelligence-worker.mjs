
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="34f690b4-aad2-58e8-8cd6-f0ee9f7e303d")}catch(e){}}();
;(function(){var g=globalThis.__SENTRY_ORCHESTRION__=globalThis.__SENTRY_ORCHESTRION__||{};g.bundler=g.bundler||new Set();})();import { createRequire as mobileDevBundleRequire } from 'node:module'; import { fileURLToPath as mobileDevFileURLToPath } from 'node:url'; import { dirname as mobileDevPathDirname } from 'node:path'; const require = mobileDevBundleRequire(import.meta.url); const __filename = mobileDevFileURLToPath(import.meta.url); const __dirname = mobileDevPathDirname(__filename);
import {
  fileRef,
  packageRef,
  screenRef
} from "./chunk-B3SNIVBX.mjs";
import "./chunk-AV7EIOVC.mjs";
import "./chunk-BNXJFHSV.mjs";
import {
  __commonJS,
  __require,
  __toESM
} from "./chunk-WNUFIJT5.mjs";

// node_modules/enhanced-resolve/lib/util/memoize.js
var require_memoize = __commonJS({
  "node_modules/enhanced-resolve/lib/util/memoize.js"(exports, module) {
    "use strict";
    var memoize = (fn) => {
      let cache = false;
      let result;
      return () => {
        if (cache) {
          return (
            /** @type {T} */
            result
          );
        }
        result = fn();
        cache = true;
        fn = void 0;
        return (
          /** @type {T} */
          result
        );
      };
    };
    module.exports = memoize;
  }
});

// node_modules/enhanced-resolve/lib/CachedInputFileSystem.js
var require_CachedInputFileSystem = __commonJS({
  "node_modules/enhanced-resolve/lib/CachedInputFileSystem.js"(exports, module) {
    "use strict";
    var { nextTick } = __require("process");
    var dirname2 = (path) => {
      let idx = path.length - 1;
      while (idx >= 0) {
        const char = path.charCodeAt(idx);
        if (char === 47 || char === 92) break;
        idx--;
      }
      if (idx < 0) return "";
      return path.slice(0, idx);
    };
    var runCallbacks = (callbacks, err, result) => {
      if (callbacks.length === 1) {
        callbacks[0](err, result);
        callbacks.length = 0;
        return;
      }
      let error;
      for (const callback of callbacks) {
        try {
          callback(err, result);
        } catch (err2) {
          if (!error) error = err2;
        }
      }
      callbacks.length = 0;
      if (error) throw error;
    };
    var firstCallback;
    var firstErr = null;
    var firstResult;
    var dispatchQueue = [];
    var dispatchQueueLength = 0;
    var spareQueue = [];
    var MAX_RETAINED_QUEUE_LENGTH = 1024;
    var runDispatch = () => {
      const callback = (
        /** @type {FileSystemCallback<EXPECTED_ANY>} */
        firstCallback
      );
      const err = firstErr;
      const result = firstResult;
      firstCallback = void 0;
      firstErr = null;
      firstResult = void 0;
      if (dispatchQueueLength === 0) {
        callback(err, result);
        return;
      }
      const queue = dispatchQueue;
      const length = dispatchQueueLength;
      dispatchQueue = spareQueue;
      dispatchQueueLength = 0;
      let i = -3;
      try {
        callback(err, result);
        for (i = 0; i < length; i += 3) {
          queue[i](queue[i + 1], queue[i + 2]);
        }
      } finally {
        i += 3;
        if (i < length) {
          if (firstCallback === void 0) {
            firstCallback = queue[i];
            firstErr = queue[i + 1];
            firstResult = queue[i + 2];
            nextTick(runDispatch);
            for (let j = i + 3; j < length; j++) {
              dispatchQueue[dispatchQueueLength++] = queue[j];
            }
          } else {
            const rest = queue.slice(i, length);
            rest.push(firstCallback, firstErr, firstResult);
            for (let j = 0; j < dispatchQueueLength; j++) {
              rest.push(dispatchQueue[j]);
            }
            [firstCallback, firstErr, firstResult] = rest;
            dispatchQueue = rest.slice(3);
            dispatchQueueLength = dispatchQueue.length;
          }
        }
        for (let j = 0; j < length; j++) queue[j] = void 0;
        if (queue.length > MAX_RETAINED_QUEUE_LENGTH) {
          queue.length = MAX_RETAINED_QUEUE_LENGTH;
        }
        spareQueue = queue;
      }
    };
    var scheduleDispatch = (callback, err, result) => {
      if (firstCallback === void 0) {
        firstCallback = callback;
        firstErr = err;
        firstResult = result;
        nextTick(runDispatch);
      } else {
        const queue = dispatchQueue;
        queue[dispatchQueueLength] = callback;
        queue[dispatchQueueLength + 1] = err;
        queue[dispatchQueueLength + 2] = result;
        dispatchQueueLength += 3;
      }
    };
    var OperationMergerBackend = class {
      /**
       * @param {EXPECTED_FUNCTION | undefined} provider async method in filesystem
       * @param {EXPECTED_FUNCTION | undefined} syncProvider sync method in filesystem
       * @param {BaseFileSystem} providerContext call context for the provider methods
       */
      constructor(provider, syncProvider, providerContext) {
        this._provider = provider;
        this._syncProvider = syncProvider;
        this._providerContext = providerContext;
        this._activeAsyncOperations = /* @__PURE__ */ new Map();
        this.provide = this._provider ? (
          // Comment to align jsdoc
          /**
           * @param {PathLike | PathOrFileDescriptor} path path
           * @param {object | FileSystemCallback<EXPECTED_ANY> | undefined} options options
           * @param {FileSystemCallback<EXPECTED_ANY>=} callback callback
           * @returns {EXPECTED_ANY} result
           */
          (path, options, callback) => {
            if (typeof options === "function") {
              callback = /** @type {FileSystemCallback<EXPECTED_ANY>} */
              options;
              options = void 0;
            }
            if (typeof path !== "string" && !Buffer.isBuffer(path) && !(path instanceof URL) && typeof path !== "number") {
              callback(
                new TypeError("path must be a string, Buffer, URL or number")
              );
              return;
            }
            if (options) {
              return (
                /** @type {EXPECTED_FUNCTION} */
                this._provider.call(
                  this._providerContext,
                  path,
                  options,
                  callback
                )
              );
            }
            let callbacks = this._activeAsyncOperations.get(path);
            if (callbacks) {
              callbacks.push(callback);
              return;
            }
            this._activeAsyncOperations.set(path, callbacks = [callback]);
            provider(
              path,
              /**
               * @param {Error} err error
               * @param {EXPECTED_ANY} result result
               */
              (err, result) => {
                this._activeAsyncOperations.delete(path);
                runCallbacks(callbacks, err, result);
              }
            );
          }
        ) : null;
        this.provideSync = this._syncProvider ? (
          // Comment to align jsdoc
          /**
           * @param {PathLike | PathOrFileDescriptor} path path
           * @param {object=} options options
           * @returns {EXPECTED_ANY} result
           */
          (path, options) => (
            /** @type {EXPECTED_FUNCTION} */
            this._syncProvider.call(
              this._providerContext,
              path,
              options
            )
          )
        ) : null;
      }
      purge() {
      }
      purgeParent() {
      }
    };
    var STORAGE_MODE_IDLE = 0;
    var STORAGE_MODE_SYNC = 1;
    var STORAGE_MODE_ASYNC = 2;
    var CacheBackend = class {
      /**
       * @param {number} duration max cache duration of items
       * @param {EXPECTED_FUNCTION | undefined} provider async method
       * @param {EXPECTED_FUNCTION | undefined} syncProvider sync method
       * @param {BaseFileSystem} providerContext call context for the provider methods
       */
      constructor(duration, provider, syncProvider, providerContext) {
        this._duration = duration;
        this._provider = provider;
        this._syncProvider = syncProvider;
        this._providerContext = providerContext;
        this._activeAsyncOperations = /* @__PURE__ */ new Map();
        this._data = /* @__PURE__ */ new Map();
        this._levels = [];
        for (let i = 0; i < 10; i++) this._levels.push(/* @__PURE__ */ new Set());
        if (duration !== Infinity) {
          for (let i = 5e3; i < duration; i += 500) {
            this._levels.push(/* @__PURE__ */ new Set());
          }
        }
        this._currentLevel = 0;
        this._tickInterval = Math.floor(duration / this._levels.length);
        this._mode = STORAGE_MODE_IDLE;
        this._timeout = void 0;
        this._nextDecay = void 0;
        this.provide = provider ? this.provide.bind(this) : null;
        this.provideSync = syncProvider ? this.provideSync.bind(this) : null;
      }
      /**
       * @param {PathLike | PathOrFileDescriptor} path path
       * @param {EXPECTED_ANY} options options
       * @param {FileSystemCallback<EXPECTED_ANY>} callback callback
       * @returns {void}
       */
      provide(path, options, callback) {
        if (typeof options === "function") {
          callback = options;
          options = void 0;
        }
        if (typeof path !== "string" && !Buffer.isBuffer(path) && !(path instanceof URL) && typeof path !== "number") {
          callback(new TypeError("path must be a string, Buffer, URL or number"));
          return;
        }
        const strPath = typeof path !== "string" ? path.toString() : path;
        if (options) {
          return (
            /** @type {EXPECTED_FUNCTION} */
            this._provider.call(
              this._providerContext,
              path,
              options,
              callback
            )
          );
        }
        if (this._mode === STORAGE_MODE_SYNC) {
          this._enterAsyncMode();
        }
        const cacheEntry = this._data.get(strPath);
        if (cacheEntry !== void 0) {
          if (cacheEntry.err) {
            return scheduleDispatch(callback, cacheEntry.err, void 0);
          }
          return scheduleDispatch(callback, null, cacheEntry.result);
        }
        let callbacks = this._activeAsyncOperations.get(strPath);
        if (callbacks !== void 0) {
          callbacks.push(callback);
          return;
        }
        this._activeAsyncOperations.set(strPath, callbacks = [callback]);
        this._provider.call(
          this._providerContext,
          path,
          /**
           * @param {Error | null} err error
           * @param {EXPECTED_ANY=} result result
           */
          (err, result) => {
            this._activeAsyncOperations.delete(strPath);
            this._storeResult(strPath, err, result);
            this._enterAsyncMode();
            runCallbacks(
              /** @type {FileSystemCallback<EXPECTED_ANY>[]} */
              callbacks,
              err,
              result
            );
          }
        );
      }
      /**
       * @param {PathLike | PathOrFileDescriptor} path path
       * @param {EXPECTED_ANY} options options
       * @returns {EXPECTED_ANY} result
       */
      provideSync(path, options) {
        if (typeof path !== "string" && !Buffer.isBuffer(path) && !(path instanceof URL) && typeof path !== "number") {
          throw new TypeError("path must be a string");
        }
        const strPath = typeof path !== "string" ? path.toString() : path;
        if (options) {
          return (
            /** @type {EXPECTED_FUNCTION} */
            this._syncProvider.call(
              this._providerContext,
              path,
              options
            )
          );
        }
        if (this._mode === STORAGE_MODE_SYNC) {
          this._runDecays();
        }
        const cacheEntry = this._data.get(strPath);
        if (cacheEntry !== void 0) {
          if (cacheEntry.err) throw cacheEntry.err;
          return cacheEntry.result;
        }
        const callbacks = this._activeAsyncOperations.get(strPath);
        this._activeAsyncOperations.delete(strPath);
        let result;
        try {
          result = /** @type {EXPECTED_FUNCTION} */
          this._syncProvider.call(
            this._providerContext,
            path
          );
        } catch (err) {
          this._storeResult(
            strPath,
            /** @type {Error} */
            err,
            void 0
          );
          this._enterSyncModeWhenIdle();
          if (callbacks) {
            runCallbacks(
              callbacks,
              /** @type {Error} */
              err,
              void 0
            );
          }
          throw err;
        }
        this._storeResult(strPath, null, result);
        this._enterSyncModeWhenIdle();
        if (callbacks) {
          runCallbacks(callbacks, null, result);
        }
        return result;
      }
      /**
       * @param {(string | Buffer | URL | number | (string | URL | Buffer | number)[] | Set<string | URL | Buffer | number>)=} what what to purge
       * @param {{ exact?: boolean }=} options options; `exact: true` removes only entries whose key matches `what` exactly instead of any entry whose key starts with `what`
       */
      purge(what, options) {
        if (what === void 0 || what === null) {
          if (this._mode !== STORAGE_MODE_IDLE) {
            this._data.clear();
            for (const level of this._levels) {
              level.clear();
            }
            this._enterIdleMode();
          }
          return;
        }
        const exact = options !== void 0 && options !== null && options.exact === true;
        if (exact) {
          if (typeof what === "string" || Buffer.isBuffer(what) || what instanceof URL || typeof what === "number") {
            const strWhat = typeof what !== "string" ? what.toString() : what;
            const data = this._data.get(strWhat);
            if (data !== void 0) {
              this._data.delete(strWhat);
              data.level.delete(strWhat);
            }
          } else {
            for (const item of what) {
              const strItem = typeof item !== "string" ? item.toString() : item;
              const data = this._data.get(strItem);
              if (data !== void 0) {
                this._data.delete(strItem);
                data.level.delete(strItem);
              }
            }
          }
          if (this._data.size === 0) {
            this._enterIdleMode();
          }
          return;
        }
        if (typeof what === "string" || Buffer.isBuffer(what) || what instanceof URL || typeof what === "number") {
          const strWhat = typeof what !== "string" ? what.toString() : what;
          if (strWhat === "") {
            if (this._mode !== STORAGE_MODE_IDLE) {
              this._data.clear();
              for (const level of this._levels) {
                level.clear();
              }
              this._enterIdleMode();
            }
            return;
          }
          for (const [key, data] of this._data) {
            if (key.startsWith(strWhat)) {
              this._data.delete(key);
              data.level.delete(key);
            }
          }
          if (this._data.size === 0) {
            this._enterIdleMode();
          }
        } else {
          for (const [key, data] of this._data) {
            for (const item of what) {
              const strItem = typeof item !== "string" ? item.toString() : item;
              if (key.startsWith(strItem)) {
                this._data.delete(key);
                data.level.delete(key);
                break;
              }
            }
          }
          if (this._data.size === 0) {
            this._enterIdleMode();
          }
        }
      }
      /**
       * @param {(string | Buffer | URL | number | (string | URL | Buffer | number)[] | Set<string | URL | Buffer | number>)=} what what to purge
       */
      purgeParent(what) {
        if (what === void 0 || what === null) {
          this.purge();
        } else if (typeof what === "string" || Buffer.isBuffer(what) || what instanceof URL || typeof what === "number") {
          const strWhat = typeof what !== "string" ? what.toString() : what;
          this.purge(dirname2(strWhat));
        } else {
          const set = /* @__PURE__ */ new Set();
          for (const item of what) {
            const strItem = typeof item !== "string" ? item.toString() : item;
            set.add(dirname2(strItem));
          }
          this.purge(set);
        }
      }
      /**
       * @param {string} path path
       * @param {Error | null} err error
       * @param {EXPECTED_ANY} result result
       */
      _storeResult(path, err, result) {
        if (this._data.has(path)) return;
        const level = this._levels[this._currentLevel];
        this._data.set(path, { err, result, level });
        level.add(path);
      }
      _decayLevel() {
        const nextLevel = (this._currentLevel + 1) % this._levels.length;
        const decay = this._levels[nextLevel];
        this._currentLevel = nextLevel;
        for (const item of decay) {
          this._data.delete(item);
        }
        decay.clear();
        if (this._data.size === 0) {
          this._enterIdleMode();
        } else {
          this._nextDecay += this._tickInterval;
        }
      }
      _runDecays() {
        while (
          /** @type {number} */
          this._nextDecay <= Date.now() && this._mode !== STORAGE_MODE_IDLE
        ) {
          this._decayLevel();
        }
      }
      _enterAsyncMode() {
        let timeout = 0;
        switch (this._mode) {
          case STORAGE_MODE_ASYNC:
            return;
          case STORAGE_MODE_IDLE:
            this._nextDecay = Date.now() + this._tickInterval;
            timeout = this._tickInterval;
            break;
          case STORAGE_MODE_SYNC:
            this._runDecays();
            if (
              /** @type {STORAGE_MODE_IDLE | STORAGE_MODE_SYNC | STORAGE_MODE_ASYNC} */
              this._mode === STORAGE_MODE_IDLE
            ) {
              return;
            }
            timeout = Math.max(
              0,
              /** @type {number} */
              this._nextDecay - Date.now()
            );
            break;
        }
        this._mode = STORAGE_MODE_ASYNC;
        if (this._duration === Infinity) {
          return;
        }
        const ref = setTimeout(() => {
          this._mode = STORAGE_MODE_SYNC;
          this._runDecays();
        }, timeout);
        if (ref.unref) ref.unref();
        this._timeout = ref;
      }
      _enterSyncModeWhenIdle() {
        if (this._mode === STORAGE_MODE_IDLE) {
          this._mode = STORAGE_MODE_SYNC;
          this._nextDecay = Date.now() + this._tickInterval;
        }
      }
      _enterIdleMode() {
        this._mode = STORAGE_MODE_IDLE;
        this._nextDecay = void 0;
        if (this._timeout) clearTimeout(this._timeout);
      }
    };
    var createBackend = (duration, provider, syncProvider, providerContext) => {
      if (duration > 0) {
        return new CacheBackend(duration, provider, syncProvider, providerContext);
      }
      return new OperationMergerBackend(provider, syncProvider, providerContext);
    };
    module.exports = class CachedInputFileSystem {
      /**
       * @param {BaseFileSystem} fileSystem file system
       * @param {number} duration duration in ms files are cached
       */
      constructor(fileSystem, duration) {
        this.fileSystem = fileSystem;
        this._lstatBackend = createBackend(
          duration,
          this.fileSystem.lstat,
          this.fileSystem.lstatSync,
          this.fileSystem
        );
        const lstat = this._lstatBackend.provide;
        this.lstat = /** @type {FileSystem["lstat"]} */
        lstat;
        const lstatSync = this._lstatBackend.provideSync;
        this.lstatSync = /** @type {SyncFileSystem["lstatSync"]} */
        lstatSync;
        this._statBackend = createBackend(
          duration,
          this.fileSystem.stat,
          this.fileSystem.statSync,
          this.fileSystem
        );
        const stat = this._statBackend.provide;
        this.stat = /** @type {FileSystem["stat"]} */
        stat;
        const statSync = this._statBackend.provideSync;
        this.statSync = /** @type {SyncFileSystem["statSync"]} */
        statSync;
        this._readdirBackend = createBackend(
          duration,
          this.fileSystem.readdir,
          this.fileSystem.readdirSync,
          this.fileSystem
        );
        const readdir2 = this._readdirBackend.provide;
        this.readdir = /** @type {FileSystem["readdir"]} */
        readdir2;
        const readdirSync = this._readdirBackend.provideSync;
        this.readdirSync = /** @type {SyncFileSystem["readdirSync"]} */
        readdirSync;
        this._readFileBackend = createBackend(
          duration,
          this.fileSystem.readFile,
          this.fileSystem.readFileSync,
          this.fileSystem
        );
        const readFile2 = this._readFileBackend.provide;
        this.readFile = /** @type {FileSystem["readFile"]} */
        readFile2;
        const readFileSync = this._readFileBackend.provideSync;
        this.readFileSync = /** @type {SyncFileSystem["readFileSync"]} */
        readFileSync;
        this._readJsonBackend = createBackend(
          duration,
          // prettier-ignore
          this.fileSystem.readJson || this.readFile && /**
           * @param {string} path path
           * @param {FileSystemCallback<EXPECTED_ANY>} callback callback
           */
          ((path, callback) => {
            this.readFile(path, (err, buffer) => {
              if (err) return callback(err);
              if (!buffer || buffer.length === 0) {
                return callback(new Error("No file content"));
              }
              let data;
              try {
                data = JSON.parse(buffer.toString("utf8"));
              } catch (err_) {
                return callback(
                  /** @type {Error} */
                  err_
                );
              }
              callback(null, data);
            });
          }),
          // prettier-ignore
          this.fileSystem.readJsonSync || this.readFileSync && /**
           * @param {string} path path
           * @returns {EXPECTED_ANY} result
           */
          ((path) => {
            const buffer = this.readFileSync(path);
            const data = JSON.parse(buffer.toString("utf8"));
            return data;
          }),
          this.fileSystem
        );
        const readJson = this._readJsonBackend.provide;
        this.readJson = /** @type {FileSystem["readJson"]} */
        readJson;
        const readJsonSync = this._readJsonBackend.provideSync;
        this.readJsonSync = /** @type {SyncFileSystem["readJsonSync"]} */
        readJsonSync;
        this._readlinkBackend = createBackend(
          duration,
          this.fileSystem.readlink,
          this.fileSystem.readlinkSync,
          this.fileSystem
        );
        const readlink = this._readlinkBackend.provide;
        this.readlink = /** @type {FileSystem["readlink"]} */
        readlink;
        const readlinkSync = this._readlinkBackend.provideSync;
        this.readlinkSync = /** @type {SyncFileSystem["readlinkSync"]} */
        readlinkSync;
        this._realpathBackend = createBackend(
          duration,
          this.fileSystem.realpath,
          this.fileSystem.realpathSync,
          this.fileSystem
        );
        const realpath2 = this._realpathBackend.provide;
        this.realpath = /** @type {FileSystem["realpath"]} */
        realpath2;
        const realpathSync = this._realpathBackend.provideSync;
        this.realpathSync = /** @type {SyncFileSystem["realpathSync"]} */
        realpathSync;
      }
      /**
       * @param {(string | Buffer | URL | number | (string | URL | Buffer | number)[] | Set<string | URL | Buffer | number>)=} what what to purge
       * @param {{ exact?: boolean }=} options options; `exact: true` removes only cache entries whose key matches `what` exactly instead of any entry whose key starts with `what`
       */
      purge(what, options) {
        this._statBackend.purge(what, options);
        this._lstatBackend.purge(what, options);
        if (options !== void 0 && options !== null && options.exact === true) {
          this._readdirBackend.purge(what, options);
        } else {
          this._readdirBackend.purgeParent(what);
        }
        this._readFileBackend.purge(what, options);
        this._readlinkBackend.purge(what, options);
        this._readJsonBackend.purge(what, options);
        this._realpathBackend.purge(what, options);
      }
    };
  }
});

// node_modules/graceful-fs/polyfills.js
var require_polyfills = __commonJS({
  "node_modules/graceful-fs/polyfills.js"(exports, module) {
    var constants = __require("constants");
    var origCwd = process.cwd;
    var cwd = null;
    var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform;
    process.cwd = function() {
      if (!cwd)
        cwd = origCwd.call(process);
      return cwd;
    };
    try {
      process.cwd();
    } catch (er) {
    }
    if (typeof process.chdir === "function") {
      chdir = process.chdir;
      process.chdir = function(d) {
        cwd = null;
        chdir.call(process, d);
      };
      if (Object.setPrototypeOf) Object.setPrototypeOf(process.chdir, chdir);
    }
    var chdir;
    module.exports = patch;
    function patch(fs) {
      if (constants.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
        patchLchmod(fs);
      }
      if (!fs.lutimes) {
        patchLutimes(fs);
      }
      fs.chown = chownFix(fs.chown);
      fs.fchown = chownFix(fs.fchown);
      fs.lchown = chownFix(fs.lchown);
      fs.chmod = chmodFix(fs.chmod);
      fs.fchmod = chmodFix(fs.fchmod);
      fs.lchmod = chmodFix(fs.lchmod);
      fs.chownSync = chownFixSync(fs.chownSync);
      fs.fchownSync = chownFixSync(fs.fchownSync);
      fs.lchownSync = chownFixSync(fs.lchownSync);
      fs.chmodSync = chmodFixSync(fs.chmodSync);
      fs.fchmodSync = chmodFixSync(fs.fchmodSync);
      fs.lchmodSync = chmodFixSync(fs.lchmodSync);
      fs.stat = statFix(fs.stat);
      fs.fstat = statFix(fs.fstat);
      fs.lstat = statFix(fs.lstat);
      fs.statSync = statFixSync(fs.statSync);
      fs.fstatSync = statFixSync(fs.fstatSync);
      fs.lstatSync = statFixSync(fs.lstatSync);
      if (fs.chmod && !fs.lchmod) {
        fs.lchmod = function(path, mode, cb) {
          if (cb) process.nextTick(cb);
        };
        fs.lchmodSync = function() {
        };
      }
      if (fs.chown && !fs.lchown) {
        fs.lchown = function(path, uid, gid, cb) {
          if (cb) process.nextTick(cb);
        };
        fs.lchownSync = function() {
        };
      }
      if (platform === "win32") {
        fs.rename = typeof fs.rename !== "function" ? fs.rename : (function(fs$rename) {
          function rename(from, to, cb) {
            var start = Date.now();
            var backoff = 0;
            fs$rename(from, to, function CB(er) {
              if (er && (er.code === "EACCES" || er.code === "EPERM" || er.code === "EBUSY") && Date.now() - start < 6e4) {
                setTimeout(function() {
                  fs.stat(to, function(stater, st) {
                    if (stater && stater.code === "ENOENT")
                      fs$rename(from, to, CB);
                    else
                      cb(er);
                  });
                }, backoff);
                if (backoff < 100)
                  backoff += 10;
                return;
              }
              if (cb) cb(er);
            });
          }
          if (Object.setPrototypeOf) Object.setPrototypeOf(rename, fs$rename);
          return rename;
        })(fs.rename);
      }
      fs.read = typeof fs.read !== "function" ? fs.read : (function(fs$read) {
        function read(fd, buffer, offset, length, position, callback_) {
          var callback;
          if (callback_ && typeof callback_ === "function") {
            var eagCounter = 0;
            callback = function(er, _, __) {
              if (er && er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                return fs$read.call(fs, fd, buffer, offset, length, position, callback);
              }
              callback_.apply(this, arguments);
            };
          }
          return fs$read.call(fs, fd, buffer, offset, length, position, callback);
        }
        if (Object.setPrototypeOf) Object.setPrototypeOf(read, fs$read);
        return read;
      })(fs.read);
      fs.readSync = typeof fs.readSync !== "function" ? fs.readSync : /* @__PURE__ */ (function(fs$readSync) {
        return function(fd, buffer, offset, length, position) {
          var eagCounter = 0;
          while (true) {
            try {
              return fs$readSync.call(fs, fd, buffer, offset, length, position);
            } catch (er) {
              if (er.code === "EAGAIN" && eagCounter < 10) {
                eagCounter++;
                continue;
              }
              throw er;
            }
          }
        };
      })(fs.readSync);
      function patchLchmod(fs2) {
        fs2.lchmod = function(path, mode, callback) {
          fs2.open(
            path,
            constants.O_WRONLY | constants.O_SYMLINK,
            mode,
            function(err, fd) {
              if (err) {
                if (callback) callback(err);
                return;
              }
              fs2.fchmod(fd, mode, function(err2) {
                fs2.close(fd, function(err22) {
                  if (callback) callback(err2 || err22);
                });
              });
            }
          );
        };
        fs2.lchmodSync = function(path, mode) {
          var fd = fs2.openSync(path, constants.O_WRONLY | constants.O_SYMLINK, mode);
          var threw = true;
          var ret;
          try {
            ret = fs2.fchmodSync(fd, mode);
            threw = false;
          } finally {
            if (threw) {
              try {
                fs2.closeSync(fd);
              } catch (er) {
              }
            } else {
              fs2.closeSync(fd);
            }
          }
          return ret;
        };
      }
      function patchLutimes(fs2) {
        if (constants.hasOwnProperty("O_SYMLINK") && fs2.futimes) {
          fs2.lutimes = function(path, at, mt, cb) {
            fs2.open(path, constants.O_SYMLINK, function(er, fd) {
              if (er) {
                if (cb) cb(er);
                return;
              }
              fs2.futimes(fd, at, mt, function(er2) {
                fs2.close(fd, function(er22) {
                  if (cb) cb(er2 || er22);
                });
              });
            });
          };
          fs2.lutimesSync = function(path, at, mt) {
            var fd = fs2.openSync(path, constants.O_SYMLINK);
            var ret;
            var threw = true;
            try {
              ret = fs2.futimesSync(fd, at, mt);
              threw = false;
            } finally {
              if (threw) {
                try {
                  fs2.closeSync(fd);
                } catch (er) {
                }
              } else {
                fs2.closeSync(fd);
              }
            }
            return ret;
          };
        } else if (fs2.futimes) {
          fs2.lutimes = function(_a, _b, _c, cb) {
            if (cb) process.nextTick(cb);
          };
          fs2.lutimesSync = function() {
          };
        }
      }
      function chmodFix(orig) {
        if (!orig) return orig;
        return function(target, mode, cb) {
          return orig.call(fs, target, mode, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chmodFixSync(orig) {
        if (!orig) return orig;
        return function(target, mode) {
          try {
            return orig.call(fs, target, mode);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function chownFix(orig) {
        if (!orig) return orig;
        return function(target, uid, gid, cb) {
          return orig.call(fs, target, uid, gid, function(er) {
            if (chownErOk(er)) er = null;
            if (cb) cb.apply(this, arguments);
          });
        };
      }
      function chownFixSync(orig) {
        if (!orig) return orig;
        return function(target, uid, gid) {
          try {
            return orig.call(fs, target, uid, gid);
          } catch (er) {
            if (!chownErOk(er)) throw er;
          }
        };
      }
      function statFix(orig) {
        if (!orig) return orig;
        return function(target, options, cb) {
          if (typeof options === "function") {
            cb = options;
            options = null;
          }
          function callback(er, stats) {
            if (stats) {
              if (stats.uid < 0) stats.uid += 4294967296;
              if (stats.gid < 0) stats.gid += 4294967296;
            }
            if (cb) cb.apply(this, arguments);
          }
          return options ? orig.call(fs, target, options, callback) : orig.call(fs, target, callback);
        };
      }
      function statFixSync(orig) {
        if (!orig) return orig;
        return function(target, options) {
          var stats = options ? orig.call(fs, target, options) : orig.call(fs, target);
          if (stats) {
            if (stats.uid < 0) stats.uid += 4294967296;
            if (stats.gid < 0) stats.gid += 4294967296;
          }
          return stats;
        };
      }
      function chownErOk(er) {
        if (!er)
          return true;
        if (er.code === "ENOSYS")
          return true;
        var nonroot = !process.getuid || process.getuid() !== 0;
        if (nonroot) {
          if (er.code === "EINVAL" || er.code === "EPERM")
            return true;
        }
        return false;
      }
    }
  }
});

// node_modules/graceful-fs/legacy-streams.js
var require_legacy_streams = __commonJS({
  "node_modules/graceful-fs/legacy-streams.js"(exports, module) {
    var Stream = __require("stream").Stream;
    module.exports = legacy;
    function legacy(fs) {
      return {
        ReadStream,
        WriteStream
      };
      function ReadStream(path, options) {
        if (!(this instanceof ReadStream)) return new ReadStream(path, options);
        Stream.call(this);
        var self = this;
        this.path = path;
        this.fd = null;
        this.readable = true;
        this.paused = false;
        this.flags = "r";
        this.mode = 438;
        this.bufferSize = 64 * 1024;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.encoding) this.setEncoding(this.encoding);
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.end === void 0) {
            this.end = Infinity;
          } else if ("number" !== typeof this.end) {
            throw TypeError("end must be a Number");
          }
          if (this.start > this.end) {
            throw new Error("start must be <= end");
          }
          this.pos = this.start;
        }
        if (this.fd !== null) {
          process.nextTick(function() {
            self._read();
          });
          return;
        }
        fs.open(this.path, this.flags, this.mode, function(err, fd) {
          if (err) {
            self.emit("error", err);
            self.readable = false;
            return;
          }
          self.fd = fd;
          self.emit("open", fd);
          self._read();
        });
      }
      function WriteStream(path, options) {
        if (!(this instanceof WriteStream)) return new WriteStream(path, options);
        Stream.call(this);
        this.path = path;
        this.fd = null;
        this.writable = true;
        this.flags = "w";
        this.encoding = "binary";
        this.mode = 438;
        this.bytesWritten = 0;
        options = options || {};
        var keys = Object.keys(options);
        for (var index = 0, length = keys.length; index < length; index++) {
          var key = keys[index];
          this[key] = options[key];
        }
        if (this.start !== void 0) {
          if ("number" !== typeof this.start) {
            throw TypeError("start must be a Number");
          }
          if (this.start < 0) {
            throw new Error("start must be >= zero");
          }
          this.pos = this.start;
        }
        this.busy = false;
        this._queue = [];
        if (this.fd === null) {
          this._open = fs.open;
          this._queue.push([this._open, this.path, this.flags, this.mode, void 0]);
          this.flush();
        }
      }
    }
  }
});

// node_modules/graceful-fs/clone.js
var require_clone = __commonJS({
  "node_modules/graceful-fs/clone.js"(exports, module) {
    "use strict";
    module.exports = clone;
    var getPrototypeOf = Object.getPrototypeOf || function(obj) {
      return obj.__proto__;
    };
    function clone(obj) {
      if (obj === null || typeof obj !== "object")
        return obj;
      if (obj instanceof Object)
        var copy = { __proto__: getPrototypeOf(obj) };
      else
        var copy = /* @__PURE__ */ Object.create(null);
      Object.getOwnPropertyNames(obj).forEach(function(key) {
        Object.defineProperty(copy, key, Object.getOwnPropertyDescriptor(obj, key));
      });
      return copy;
    }
  }
});

// node_modules/graceful-fs/graceful-fs.js
var require_graceful_fs = __commonJS({
  "node_modules/graceful-fs/graceful-fs.js"(exports, module) {
    var fs = __require("fs");
    var polyfills = require_polyfills();
    var legacy = require_legacy_streams();
    var clone = require_clone();
    var util = __require("util");
    var gracefulQueue;
    var previousSymbol;
    if (typeof Symbol === "function" && typeof Symbol.for === "function") {
      gracefulQueue = /* @__PURE__ */ Symbol.for("graceful-fs.queue");
      previousSymbol = /* @__PURE__ */ Symbol.for("graceful-fs.previous");
    } else {
      gracefulQueue = "___graceful-fs.queue";
      previousSymbol = "___graceful-fs.previous";
    }
    function noop() {
    }
    function publishQueue(context, queue2) {
      Object.defineProperty(context, gracefulQueue, {
        get: function() {
          return queue2;
        }
      });
    }
    var debug = noop;
    if (util.debuglog)
      debug = util.debuglog("gfs4");
    else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ""))
      debug = function() {
        var m = util.format.apply(util, arguments);
        m = "GFS4: " + m.split(/\n/).join("\nGFS4: ");
        console.error(m);
      };
    if (!fs[gracefulQueue]) {
      queue = global[gracefulQueue] || [];
      publishQueue(fs, queue);
      fs.close = (function(fs$close) {
        function close(fd, cb) {
          return fs$close.call(fs, fd, function(err) {
            if (!err) {
              resetQueue();
            }
            if (typeof cb === "function")
              cb.apply(this, arguments);
          });
        }
        Object.defineProperty(close, previousSymbol, {
          value: fs$close
        });
        return close;
      })(fs.close);
      fs.closeSync = (function(fs$closeSync) {
        function closeSync(fd) {
          fs$closeSync.apply(fs, arguments);
          resetQueue();
        }
        Object.defineProperty(closeSync, previousSymbol, {
          value: fs$closeSync
        });
        return closeSync;
      })(fs.closeSync);
      if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) {
        process.on("exit", function() {
          debug(fs[gracefulQueue]);
          __require("assert").equal(fs[gracefulQueue].length, 0);
        });
      }
    }
    var queue;
    if (!global[gracefulQueue]) {
      publishQueue(global, fs[gracefulQueue]);
    }
    module.exports = patch(clone(fs));
    if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs.__patched) {
      module.exports = patch(fs);
      fs.__patched = true;
    }
    function patch(fs2) {
      polyfills(fs2);
      fs2.gracefulify = patch;
      fs2.createReadStream = createReadStream;
      fs2.createWriteStream = createWriteStream;
      var fs$readFile = fs2.readFile;
      fs2.readFile = readFile2;
      function readFile2(path, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$readFile(path, options, cb);
        function go$readFile(path2, options2, cb2, startTime) {
          return fs$readFile(path2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$readFile, [path2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$writeFile = fs2.writeFile;
      fs2.writeFile = writeFile;
      function writeFile(path, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$writeFile(path, data, options, cb);
        function go$writeFile(path2, data2, options2, cb2, startTime) {
          return fs$writeFile(path2, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$writeFile, [path2, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$appendFile = fs2.appendFile;
      if (fs$appendFile)
        fs2.appendFile = appendFile;
      function appendFile(path, data, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        return go$appendFile(path, data, options, cb);
        function go$appendFile(path2, data2, options2, cb2, startTime) {
          return fs$appendFile(path2, data2, options2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$appendFile, [path2, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$copyFile = fs2.copyFile;
      if (fs$copyFile)
        fs2.copyFile = copyFile;
      function copyFile(src, dest, flags, cb) {
        if (typeof flags === "function") {
          cb = flags;
          flags = 0;
        }
        return go$copyFile(src, dest, flags, cb);
        function go$copyFile(src2, dest2, flags2, cb2, startTime) {
          return fs$copyFile(src2, dest2, flags2, function(err) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$copyFile, [src2, dest2, flags2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      var fs$readdir = fs2.readdir;
      fs2.readdir = readdir2;
      var noReaddirOptionVersions = /^v[0-5]\./;
      function readdir2(path, options, cb) {
        if (typeof options === "function")
          cb = options, options = null;
        var go$readdir = noReaddirOptionVersions.test(process.version) ? function go$readdir2(path2, options2, cb2, startTime) {
          return fs$readdir(path2, fs$readdirCallback(
            path2,
            options2,
            cb2,
            startTime
          ));
        } : function go$readdir2(path2, options2, cb2, startTime) {
          return fs$readdir(path2, options2, fs$readdirCallback(
            path2,
            options2,
            cb2,
            startTime
          ));
        };
        return go$readdir(path, options, cb);
        function fs$readdirCallback(path2, options2, cb2, startTime) {
          return function(err, files) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([
                go$readdir,
                [path2, options2, cb2],
                err,
                startTime || Date.now(),
                Date.now()
              ]);
            else {
              if (files && files.sort)
                files.sort();
              if (typeof cb2 === "function")
                cb2.call(this, err, files);
            }
          };
        }
      }
      if (process.version.substr(0, 4) === "v0.8") {
        var legStreams = legacy(fs2);
        ReadStream = legStreams.ReadStream;
        WriteStream = legStreams.WriteStream;
      }
      var fs$ReadStream = fs2.ReadStream;
      if (fs$ReadStream) {
        ReadStream.prototype = Object.create(fs$ReadStream.prototype);
        ReadStream.prototype.open = ReadStream$open;
      }
      var fs$WriteStream = fs2.WriteStream;
      if (fs$WriteStream) {
        WriteStream.prototype = Object.create(fs$WriteStream.prototype);
        WriteStream.prototype.open = WriteStream$open;
      }
      Object.defineProperty(fs2, "ReadStream", {
        get: function() {
          return ReadStream;
        },
        set: function(val) {
          ReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      Object.defineProperty(fs2, "WriteStream", {
        get: function() {
          return WriteStream;
        },
        set: function(val) {
          WriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileReadStream = ReadStream;
      Object.defineProperty(fs2, "FileReadStream", {
        get: function() {
          return FileReadStream;
        },
        set: function(val) {
          FileReadStream = val;
        },
        enumerable: true,
        configurable: true
      });
      var FileWriteStream = WriteStream;
      Object.defineProperty(fs2, "FileWriteStream", {
        get: function() {
          return FileWriteStream;
        },
        set: function(val) {
          FileWriteStream = val;
        },
        enumerable: true,
        configurable: true
      });
      function ReadStream(path, options) {
        if (this instanceof ReadStream)
          return fs$ReadStream.apply(this, arguments), this;
        else
          return ReadStream.apply(Object.create(ReadStream.prototype), arguments);
      }
      function ReadStream$open() {
        var that = this;
        open(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            if (that.autoClose)
              that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
            that.read();
          }
        });
      }
      function WriteStream(path, options) {
        if (this instanceof WriteStream)
          return fs$WriteStream.apply(this, arguments), this;
        else
          return WriteStream.apply(Object.create(WriteStream.prototype), arguments);
      }
      function WriteStream$open() {
        var that = this;
        open(that.path, that.flags, that.mode, function(err, fd) {
          if (err) {
            that.destroy();
            that.emit("error", err);
          } else {
            that.fd = fd;
            that.emit("open", fd);
          }
        });
      }
      function createReadStream(path, options) {
        return new fs2.ReadStream(path, options);
      }
      function createWriteStream(path, options) {
        return new fs2.WriteStream(path, options);
      }
      var fs$open = fs2.open;
      fs2.open = open;
      function open(path, flags, mode, cb) {
        if (typeof mode === "function")
          cb = mode, mode = null;
        return go$open(path, flags, mode, cb);
        function go$open(path2, flags2, mode2, cb2, startTime) {
          return fs$open(path2, flags2, mode2, function(err, fd) {
            if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
              enqueue([go$open, [path2, flags2, mode2, cb2], err, startTime || Date.now(), Date.now()]);
            else {
              if (typeof cb2 === "function")
                cb2.apply(this, arguments);
            }
          });
        }
      }
      return fs2;
    }
    function enqueue(elem) {
      debug("ENQUEUE", elem[0].name, elem[1]);
      fs[gracefulQueue].push(elem);
      retry();
    }
    var retryTimer;
    function resetQueue() {
      var now = Date.now();
      for (var i = 0; i < fs[gracefulQueue].length; ++i) {
        if (fs[gracefulQueue][i].length > 2) {
          fs[gracefulQueue][i][3] = now;
          fs[gracefulQueue][i][4] = now;
        }
      }
      retry();
    }
    function retry() {
      clearTimeout(retryTimer);
      retryTimer = void 0;
      if (fs[gracefulQueue].length === 0)
        return;
      var elem = fs[gracefulQueue].shift();
      var fn = elem[0];
      var args = elem[1];
      var err = elem[2];
      var startTime = elem[3];
      var lastTime = elem[4];
      if (startTime === void 0) {
        debug("RETRY", fn.name, args);
        fn.apply(null, args);
      } else if (Date.now() - startTime >= 6e4) {
        debug("TIMEOUT", fn.name, args);
        var cb = args.pop();
        if (typeof cb === "function")
          cb.call(null, err);
      } else {
        var sinceAttempt = Date.now() - lastTime;
        var sinceStart = Math.max(lastTime - startTime, 1);
        var desiredDelay = Math.min(sinceStart * 1.2, 100);
        if (sinceAttempt >= desiredDelay) {
          debug("RETRY", fn.name, args);
          fn.apply(null, args.concat([startTime]));
        } else {
          fs[gracefulQueue].push(elem);
        }
      }
      if (retryTimer === void 0) {
        retryTimer = setTimeout(retry, 0);
      }
    }
  }
});

// node_modules/enhanced-resolve/lib/forEachBail.js
var require_forEachBail = __commonJS({
  "node_modules/enhanced-resolve/lib/forEachBail.js"(exports, module) {
    "use strict";
    module.exports = function forEachBail(array, iterator, callback) {
      if (array.length === 0) return callback();
      let i = 0;
      const next = () => {
        let loop;
        iterator(
          array[i++],
          (err, result) => {
            if (err || result !== void 0 || i >= array.length) {
              return callback(err, result, i);
            }
            if (loop === false) while (next()) ;
            loop = true;
          },
          i
        );
        if (!loop) loop = false;
        return loop;
      };
      while (next()) ;
    };
  }
});

// node_modules/enhanced-resolve/lib/util/strip-json-comments.js
var require_strip_json_comments = __commonJS({
  "node_modules/enhanced-resolve/lib/util/strip-json-comments.js"(exports, module) {
    "use strict";
    var singleComment = /* @__PURE__ */ Symbol("singleComment");
    var multiComment = /* @__PURE__ */ Symbol("multiComment");
    var stripWithoutWhitespace = (_string, _start, _end) => "";
    var stripWithWhitespace = (string, start, end) => string.slice(start, end).replace(/[^ \t\r\n]/g, " ");
    var isEscaped = (jsonString, quotePosition) => {
      let index = quotePosition - 1;
      let backslashCount = 0;
      while (jsonString[index] === "\\") {
        index -= 1;
        backslashCount += 1;
      }
      return Boolean(backslashCount % 2);
    };
    function stripJsonComments(jsonString, { whitespace = true, trailingCommas = false } = {}) {
      if (typeof jsonString !== "string") {
        throw new TypeError(
          `Expected argument \`jsonString\` to be a \`string\`, got \`${typeof jsonString}\``
        );
      }
      const strip = whitespace ? stripWithWhitespace : stripWithoutWhitespace;
      let isInsideString = false;
      let isInsideComment = false;
      let offset = 0;
      let buffer = "";
      let result = "";
      let commaIndex = -1;
      for (let index = 0; index < jsonString.length; index++) {
        const currentCharacter = jsonString[index];
        const nextCharacter = jsonString[index + 1];
        if (!isInsideComment && currentCharacter === '"') {
          const escaped = isEscaped(jsonString, index);
          if (!escaped) {
            isInsideString = !isInsideString;
          }
        }
        if (isInsideString) {
          continue;
        }
        if (!isInsideComment && currentCharacter + nextCharacter === "//") {
          buffer += jsonString.slice(offset, index);
          offset = index;
          isInsideComment = singleComment;
          index++;
        } else if (isInsideComment === singleComment && currentCharacter + nextCharacter === "\r\n") {
          index++;
          isInsideComment = false;
          buffer += strip(jsonString, offset, index);
          offset = index;
          continue;
        } else if (isInsideComment === singleComment && currentCharacter === "\n") {
          isInsideComment = false;
          buffer += strip(jsonString, offset, index);
          offset = index;
        } else if (!isInsideComment && currentCharacter + nextCharacter === "/*") {
          buffer += jsonString.slice(offset, index);
          offset = index;
          isInsideComment = multiComment;
          index++;
          continue;
        } else if (isInsideComment === multiComment && currentCharacter + nextCharacter === "*/") {
          index++;
          isInsideComment = false;
          buffer += strip(jsonString, offset, index + 1);
          offset = index + 1;
          continue;
        } else if (trailingCommas && !isInsideComment) {
          if (commaIndex !== -1) {
            if (currentCharacter === "}" || currentCharacter === "]") {
              buffer += jsonString.slice(offset, index);
              result += strip(buffer, 0, 1) + buffer.slice(1);
              buffer = "";
              offset = index;
              commaIndex = -1;
            } else if (currentCharacter !== " " && currentCharacter !== "	" && currentCharacter !== "\r" && currentCharacter !== "\n") {
              buffer += jsonString.slice(offset, index);
              offset = index;
              commaIndex = -1;
            }
          } else if (currentCharacter === ",") {
            result += buffer + jsonString.slice(offset, index);
            buffer = "";
            offset = index;
            commaIndex = index;
          }
        }
      }
      const remaining = isInsideComment === singleComment ? strip(jsonString, offset, jsonString.length) : jsonString.slice(offset);
      return result + buffer + remaining;
    }
    module.exports = stripJsonComments;
  }
});

// node_modules/enhanced-resolve/lib/util/fs.js
var require_fs = __commonJS({
  "node_modules/enhanced-resolve/lib/util/fs.js"(exports, module) {
    "use strict";
    var memoize = require_memoize();
    var stripJsonComments = require_strip_json_comments();
    var _stripCommentsCache = /* @__PURE__ */ new WeakMap();
    var getDecoder = memoize(() => new TextDecoder("utf-8", { ignoreBOM: true }));
    var decodeText = (data) => {
      if (typeof data === "string") return data;
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
        return data.toString("utf8");
      }
      return getDecoder().decode(data);
    };
    function readJson(fileSystem, jsonFilePath, options, callback) {
      const { stripComments = false } = options;
      const { readJson: fsReadJson } = fileSystem;
      if (fsReadJson && !stripComments) {
        fsReadJson(jsonFilePath, (err, content) => {
          if (err) return callback(err);
          callback(
            null,
            /** @type {JsonObject} */
            content
          );
        });
        return;
      }
      fileSystem.readFile(jsonFilePath, (err, data) => {
        if (err) return callback(err);
        const buf = (
          /** @type {Buffer | Uint8Array | string} */
          data
        );
        const cacheable = stripComments && typeof buf === "object";
        if (cacheable) {
          const cached = _stripCommentsCache.get(buf);
          if (cached !== void 0) return callback(null, cached);
        }
        let result;
        try {
          const jsonText = decodeText(buf);
          const jsonWithoutComments = stripComments ? stripJsonComments(jsonText, {
            trailingCommas: true,
            whitespace: true
          }) : jsonText;
          result = JSON.parse(jsonWithoutComments);
        } catch (parseErr) {
          return callback(
            /** @type {Error} */
            parseErr
          );
        }
        if (cacheable) {
          _stripCommentsCache.set(buf, result);
        }
        callback(null, result);
      });
    }
    module.exports.decodeText = decodeText;
    module.exports.readJson = readJson;
  }
});

// node_modules/enhanced-resolve/lib/DescriptionFileUtils.js
var require_DescriptionFileUtils = __commonJS({
  "node_modules/enhanced-resolve/lib/DescriptionFileUtils.js"(exports, module) {
    "use strict";
    var forEachBail = require_forEachBail();
    var { decodeText } = require_fs();
    var CHAR_SLASH = 47;
    var CHAR_BACKSLASH = 92;
    function cdUp(directory) {
      if (directory.length <= 1) return null;
      for (let i = directory.length - 1; i >= 0; i--) {
        const code2 = directory.charCodeAt(i);
        if (code2 === CHAR_SLASH || code2 === CHAR_BACKSLASH) {
          return directory.slice(0, i || 1);
        }
      }
      return null;
    }
    function loadDescriptionFile(resolver, directory, filenames, oldInfo, resolveContext, callback) {
      const iterFilename = (filename, iterCallback) => {
        const descriptionFilePath = resolver.join(directory, filename);
        function onJson(err, resolvedContent) {
          if (err) {
            if (resolveContext.log) {
              resolveContext.log(
                `${descriptionFilePath} (directory description file): ${err}`
              );
            } else {
              err.message = `${descriptionFilePath} (directory description file): ${err}`;
            }
            return iterCallback(err);
          }
          iterCallback(null, {
            content: (
              /** @type {JsonObject} */
              resolvedContent
            ),
            directory,
            path: descriptionFilePath
          });
        }
        if (resolver.fileSystem.readJson) {
          resolver.fileSystem.readJson(descriptionFilePath, (err, content) => {
            if (err) {
              if (typeof /** @type {NodeJS.ErrnoException} */
              err.code !== "undefined") {
                if (resolveContext.missingDependencies) {
                  resolveContext.missingDependencies.add(descriptionFilePath);
                }
                return iterCallback();
              }
              if (resolveContext.fileDependencies) {
                resolveContext.fileDependencies.add(descriptionFilePath);
              }
              return onJson(err);
            }
            if (resolveContext.fileDependencies) {
              resolveContext.fileDependencies.add(descriptionFilePath);
            }
            onJson(null, content);
          });
        } else {
          resolver.fileSystem.readFile(descriptionFilePath, (err, content) => {
            if (err) {
              if (resolveContext.missingDependencies) {
                resolveContext.missingDependencies.add(descriptionFilePath);
              }
              return iterCallback();
            }
            if (resolveContext.fileDependencies) {
              resolveContext.fileDependencies.add(descriptionFilePath);
            }
            let json;
            if (content) {
              try {
                json = JSON.parse(decodeText(content));
              } catch (err_) {
                return onJson(
                  /** @type {Error} */
                  err_
                );
              }
            } else {
              return onJson(new Error("No content in file"));
            }
            onJson(null, json);
          });
        }
      };
      let findDescriptionFile;
      const onLevelDone = (err, result) => {
        if (err) return callback(err);
        if (result) return callback(null, result);
        const dir = cdUp(directory);
        if (!dir) {
          return callback();
        }
        directory = dir;
        return findDescriptionFile();
      };
      findDescriptionFile = () => {
        if (oldInfo && oldInfo.directory === directory) {
          return callback(null, oldInfo);
        }
        forEachBail(filenames, iterFilename, onLevelDone);
      };
      findDescriptionFile();
    }
    function getField(content, field) {
      if (!content) return void 0;
      if (Array.isArray(field)) {
        let current = content;
        for (let j = 0; j < field.length; j++) {
          if (current === null || typeof current !== "object") {
            current = null;
            break;
          }
          current = /** @type {JsonValue} */
          /** @type {JsonObject} */
          current[field[j]];
        }
        return current;
      }
      return content[field];
    }
    module.exports.cdUp = cdUp;
    module.exports.getField = getField;
    module.exports.loadDescriptionFile = loadDescriptionFile;
  }
});

// node_modules/enhanced-resolve/lib/util/path.js
var require_path = __commonJS({
  "node_modules/enhanced-resolve/lib/util/path.js"(exports, module) {
    "use strict";
    var path = __require("path");
    var { fileURLToPath } = __require("url");
    var CHAR_HASH = "#".charCodeAt(0);
    var CHAR_SLASH = "/".charCodeAt(0);
    var CHAR_BACKSLASH = "\\".charCodeAt(0);
    var CHAR_A = "A".charCodeAt(0);
    var CHAR_Z = "Z".charCodeAt(0);
    var CHAR_LOWER_A = "a".charCodeAt(0);
    var CHAR_LOWER_Z = "z".charCodeAt(0);
    var CHAR_DOT = ".".charCodeAt(0);
    var CHAR_COLON = ":".charCodeAt(0);
    var CHAR_F = "F".charCodeAt(0);
    var CHAR_LOWER_F = "f".charCodeAt(0);
    var FILE_URL_REGEXP = /^file:\//i;
    var posixNormalize = path.posix.normalize;
    var winNormalize = path.win32.normalize;
    var PathType = Object.freeze({
      Empty: 0,
      Normal: 1,
      Relative: 2,
      AbsoluteWin: 3,
      AbsolutePosix: 4,
      Internal: 5
    });
    var deprecatedInvalidSegmentRegEx = /(^|\\|\/)((\.|%2e)(\.|%2e)?|(n|%6e|%4e)(o|%6f|%4f)(d|%64|%44)(e|%65|%45)(_|%5f)(m|%6d|%4d)(o|%6f|%4f)(d|%64|%44)(u|%75|%55)(l|%6c|%4c)(e|%65|%45)(s|%73|%53))(\\|\/|$)/i;
    var invalidSegmentRegEx = /(^|\\|\/)((\.|%2e)(\.|%2e)?|(n|%6e|%4e)(o|%6f|%4f)(d|%64|%44)(e|%65|%45)(_|%5f)(m|%6d|%4d)(o|%6f|%4f)(d|%64|%44)(u|%75|%55)(l|%6c|%4c)(e|%65|%45)(s|%73|%53))?(\\|\/|$)/i;
    var getType = (maybePath) => {
      switch (maybePath.length) {
        case 0:
          return PathType.Empty;
        case 1: {
          const c02 = maybePath.charCodeAt(0);
          switch (c02) {
            case CHAR_DOT:
              return PathType.Relative;
            case CHAR_SLASH:
              return PathType.AbsolutePosix;
            case CHAR_HASH:
              return PathType.Internal;
          }
          return PathType.Normal;
        }
        case 2: {
          const c02 = maybePath.charCodeAt(0);
          switch (c02) {
            case CHAR_DOT: {
              const c13 = maybePath.charCodeAt(1);
              switch (c13) {
                case CHAR_DOT:
                case CHAR_SLASH:
                  return PathType.Relative;
              }
              return PathType.Normal;
            }
            case CHAR_SLASH:
              return PathType.AbsolutePosix;
            case CHAR_HASH:
              return PathType.Internal;
          }
          const c12 = maybePath.charCodeAt(1);
          if (c12 === CHAR_COLON && (c02 >= CHAR_A && c02 <= CHAR_Z || c02 >= CHAR_LOWER_A && c02 <= CHAR_LOWER_Z)) {
            return PathType.AbsoluteWin;
          }
          if (c02 === CHAR_BACKSLASH && c12 === CHAR_BACKSLASH) {
            return PathType.AbsoluteWin;
          }
          return PathType.Normal;
        }
      }
      const c0 = maybePath.charCodeAt(0);
      switch (c0) {
        case CHAR_DOT: {
          const c12 = maybePath.charCodeAt(1);
          switch (c12) {
            case CHAR_SLASH:
              return PathType.Relative;
            case CHAR_DOT: {
              const c2 = maybePath.charCodeAt(2);
              if (c2 === CHAR_SLASH) return PathType.Relative;
              return PathType.Normal;
            }
          }
          return PathType.Normal;
        }
        case CHAR_SLASH:
          return PathType.AbsolutePosix;
        case CHAR_HASH:
          return PathType.Internal;
      }
      const c1 = maybePath.charCodeAt(1);
      if (c1 === CHAR_COLON) {
        const c2 = maybePath.charCodeAt(2);
        if ((c2 === CHAR_BACKSLASH || c2 === CHAR_SLASH) && (c0 >= CHAR_A && c0 <= CHAR_Z || c0 >= CHAR_LOWER_A && c0 <= CHAR_LOWER_Z)) {
          return PathType.AbsoluteWin;
        }
      }
      if (c0 === CHAR_BACKSLASH && c1 === CHAR_BACKSLASH) {
        return PathType.AbsoluteWin;
      }
      return PathType.Normal;
    };
    var normalize = (maybePath) => {
      switch (getType(maybePath)) {
        case PathType.Empty:
          return maybePath;
        case PathType.AbsoluteWin:
          return winNormalize(maybePath);
        case PathType.Relative: {
          const r = posixNormalize(maybePath);
          return getType(r) === PathType.Relative ? r : `./${r}`;
        }
      }
      return posixNormalize(maybePath);
    };
    var join2 = (rootPath, request) => {
      if (!request) return normalize(rootPath);
      const requestType = getType(request);
      switch (requestType) {
        case PathType.AbsolutePosix:
          return posixNormalize(request);
        case PathType.AbsoluteWin:
          return winNormalize(request);
      }
      switch (getType(rootPath)) {
        case PathType.Normal:
        case PathType.Relative:
        case PathType.AbsolutePosix:
          return posixNormalize(`${rootPath}/${request}`);
        case PathType.AbsoluteWin:
          return winNormalize(`${rootPath}\\${request}`);
      }
      switch (requestType) {
        case PathType.Empty:
          return rootPath;
        case PathType.Relative: {
          const r = posixNormalize(rootPath);
          return getType(r) === PathType.Relative ? r : `./${r}`;
        }
      }
      return posixNormalize(rootPath);
    };
    var dirname2 = (maybePath) => {
      switch (getType(maybePath)) {
        case PathType.AbsoluteWin:
          return path.win32.dirname(maybePath);
      }
      return path.posix.dirname(maybePath);
    };
    var createCachedJoin = () => {
      const cache = /* @__PURE__ */ new Map();
      const fn = (rootPath, request) => {
        let cacheEntry;
        let inner = cache.get(rootPath);
        if (inner === void 0) {
          cache.set(rootPath, inner = /* @__PURE__ */ new Map());
        } else {
          cacheEntry = inner.get(request);
          if (cacheEntry !== void 0) return cacheEntry;
        }
        cacheEntry = join2(rootPath, request);
        inner.set(request, cacheEntry);
        return cacheEntry;
      };
      return { fn, cache };
    };
    var createCachedDirname = () => {
      const cache = /* @__PURE__ */ new Map();
      const fn = (maybePath) => {
        const cacheEntry = cache.get(maybePath);
        if (cacheEntry !== void 0) return cacheEntry;
        const result = dirname2(maybePath);
        cache.set(maybePath, result);
        return result;
      };
      return { fn, cache };
    };
    var createCachedBasename = () => {
      const cache = /* @__PURE__ */ new Map();
      const fn = (maybePath, suffix) => {
        let cacheEntry;
        let inner = cache.get(maybePath);
        if (inner === void 0) {
          cache.set(maybePath, inner = /* @__PURE__ */ new Map());
        } else {
          cacheEntry = inner.get(suffix);
          if (cacheEntry !== void 0) return cacheEntry;
        }
        cacheEntry = path.basename(maybePath, suffix);
        inner.set(suffix, cacheEntry);
        return cacheEntry;
      };
      return { fn, cache };
    };
    var isRelativeRequest = (request) => {
      const len = request.length;
      if (len === 0 || request.charCodeAt(0) !== CHAR_DOT) return false;
      if (len === 1) return true;
      const c1 = request.charCodeAt(1);
      if (c1 === CHAR_SLASH) return true;
      if (c1 !== CHAR_DOT) return false;
      if (len === 2) return true;
      return request.charCodeAt(2) === CHAR_SLASH;
    };
    var isWindowsPath = (maybePath) => {
      const c0 = maybePath.charCodeAt(0);
      if (c0 === CHAR_BACKSLASH) return true;
      if (maybePath.charCodeAt(1) !== CHAR_COLON) return false;
      return c0 >= CHAR_A && c0 <= CHAR_Z || c0 >= CHAR_LOWER_A && c0 <= CHAR_LOWER_Z;
    };
    var isSeparator = (charCode, windowsPath) => charCode === CHAR_SLASH || windowsPath && charCode === CHAR_BACKSLASH;
    var parentPathLength = (parentPath, windowsPath) => {
      let end = parentPath.length;
      while (end > 0 && isSeparator(parentPath.charCodeAt(end - 1), windowsPath)) {
        end--;
      }
      return end;
    };
    var equalsWindowsPrefix = (parentPath, length, childPath) => childPath.slice(0, length).replace(/\//g, "\\").toLowerCase() === parentPath.slice(0, length).replace(/\//g, "\\").toLowerCase();
    var startsWithPath = (parentPath, length, childPath, windowsPath) => {
      if (childPath.length < length) return false;
      if (length === parentPath.length) {
        if (childPath.startsWith(parentPath)) return true;
        if (!windowsPath) return false;
      }
      for (let i = 0; i < length; i++) {
        const childCharCode = childPath.charCodeAt(i);
        const parentCharCode = parentPath.charCodeAt(i);
        if (childCharCode === parentCharCode) continue;
        if (!windowsPath) return false;
        if (isSeparator(childCharCode, true) && isSeparator(parentCharCode, true)) {
          continue;
        }
        if (childCharCode > 127 || parentCharCode > 127) {
          return equalsWindowsPrefix(parentPath, length, childPath);
        }
        const childLower = childCharCode >= CHAR_A && childCharCode <= CHAR_Z ? childCharCode + 32 : childCharCode;
        const parentLower = parentCharCode >= CHAR_A && parentCharCode <= CHAR_Z ? parentCharCode + 32 : parentCharCode;
        if (childLower !== parentLower) return false;
      }
      return true;
    };
    var isInside = (parentPath, childPath) => {
      const windowsPath = isWindowsPath(parentPath);
      const length = parentPathLength(parentPath, windowsPath);
      if (!startsWithPath(parentPath, length, childPath, windowsPath)) return false;
      return childPath.length === length || isSeparator(childPath.charCodeAt(length), windowsPath);
    };
    var isSubPath = (parentPath, childPath) => {
      const windowsPath = isWindowsPath(parentPath);
      const length = parentPathLength(parentPath, windowsPath);
      if (childPath.length <= length) return false;
      if (!startsWithPath(parentPath, length, childPath, windowsPath)) return false;
      return isSeparator(childPath.charCodeAt(length), windowsPath);
    };
    var isFileURL = (maybePath) => {
      const c0 = maybePath.charCodeAt(0);
      return (c0 === CHAR_LOWER_F || c0 === CHAR_F) && FILE_URL_REGEXP.test(maybePath);
    };
    var toPath = (maybeURL) => {
      if (maybeURL instanceof URL) return fileURLToPath(maybeURL);
      return isFileURL(maybeURL) ? fileURLToPath(maybeURL) : maybeURL;
    };
    module.exports.PathType = PathType;
    module.exports.createCachedBasename = createCachedBasename;
    module.exports.createCachedDirname = createCachedDirname;
    module.exports.createCachedJoin = createCachedJoin;
    module.exports.deprecatedInvalidSegmentRegEx = deprecatedInvalidSegmentRegEx;
    module.exports.dirname = dirname2;
    module.exports.getType = getType;
    module.exports.invalidSegmentRegEx = invalidSegmentRegEx;
    module.exports.isFileURL = isFileURL;
    module.exports.isInside = isInside;
    module.exports.isRelativeRequest = isRelativeRequest;
    module.exports.isSubPath = isSubPath;
    module.exports.isWindowsPath = isWindowsPath;
    module.exports.join = join2;
    module.exports.normalize = normalize;
    module.exports.toPath = toPath;
  }
});

// node_modules/enhanced-resolve/lib/getInnerRequest.js
var require_getInnerRequest = __commonJS({
  "node_modules/enhanced-resolve/lib/getInnerRequest.js"(exports, module) {
    "use strict";
    var { isRelativeRequest } = require_path();
    module.exports = function getInnerRequest(resolver, request) {
      if (typeof request.__innerRequest === "string" && request.__innerRequest_request === request.request && request.__innerRequest_relativePath === request.relativePath) {
        return request.__innerRequest;
      }
      let innerRequest;
      if (request.request) {
        innerRequest = request.request;
        if (request.relativePath && isRelativeRequest(innerRequest)) {
          innerRequest = resolver.join(request.relativePath, innerRequest);
        }
      } else {
        innerRequest = request.relativePath;
      }
      request.__innerRequest_request = request.request;
      request.__innerRequest_relativePath = request.relativePath;
      return request.__innerRequest = /** @type {string} */
      innerRequest;
    };
  }
});

// node_modules/enhanced-resolve/lib/AliasFieldPlugin.js
var require_AliasFieldPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/AliasFieldPlugin.js"(exports, module) {
    "use strict";
    var DescriptionFileUtils = require_DescriptionFileUtils();
    var getInnerRequest = require_getInnerRequest();
    var NO_FIELD_OBJECT = /* @__PURE__ */ Symbol("NoFieldObject");
    module.exports = class AliasFieldPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {string | string[]} field field
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, field, target) {
        this.source = source;
        this.field = field;
        this.target = target;
        this._fieldDataCache = /* @__PURE__ */ new WeakMap();
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync("AliasFieldPlugin", (request, resolveContext, callback) => {
          if (!request.descriptionFileData) return callback();
          const innerRequest = getInnerRequest(resolver, request);
          if (!innerRequest) return callback();
          const { descriptionFileData } = request;
          let fieldData = this._fieldDataCache.get(descriptionFileData);
          if (fieldData === void 0) {
            const raw = DescriptionFileUtils.getField(
              descriptionFileData,
              this.field
            );
            fieldData = raw === null || typeof raw !== "object" ? NO_FIELD_OBJECT : (
              /** @type {{ [k: string]: JsonPrimitive }} */
              raw
            );
            this._fieldDataCache.set(descriptionFileData, fieldData);
          }
          if (fieldData === NO_FIELD_OBJECT) {
            if (resolveContext.log) {
              resolveContext.log(
                `Field '${this.field}' doesn't contain a valid alias configuration`
              );
            }
            return callback();
          }
          const data = Object.prototype.hasOwnProperty.call(
            fieldData,
            innerRequest
          ) ? (
            /** @type {{ [Key in string]: JsonPrimitive }} */
            fieldData[innerRequest]
          ) : innerRequest.startsWith("./") ? (
            /** @type {{ [Key in string]: JsonPrimitive }} */
            fieldData[innerRequest.slice(2)]
          ) : void 0;
          if (data === innerRequest) return callback();
          if (data === void 0) return callback();
          if (data === false) {
            const ignoreObj = {
              ...request,
              path: false
            };
            if (typeof resolveContext.yield === "function") {
              resolveContext.yield(ignoreObj);
              return callback(null, null);
            }
            return callback(null, ignoreObj);
          }
          const obj = {
            ...request,
            path: (
              /** @type {string} */
              request.descriptionFileRoot
            ),
            request: (
              /** @type {string} */
              data
            ),
            fullySpecified: false
          };
          resolver.doResolve(
            target,
            obj,
            `aliased from description file ${request.descriptionFilePath} with mapping '${innerRequest}' to '${/** @type {string} */
            data}'`,
            resolveContext,
            (err, result) => {
              if (err) return callback(err);
              if (result === void 0) return callback(null, null);
              callback(null, result);
            }
          );
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/AliasUtils.js
var require_AliasUtils = __commonJS({
  "node_modules/enhanced-resolve/lib/AliasUtils.js"(exports, module) {
    "use strict";
    var forEachBail = require_forEachBail();
    var { PathType, getType } = require_path();
    var EMPTY_LIST = (
      /** @type {CompiledAliasOption[]} */
      []
    );
    var EMPTY_COMPILED_OPTIONS = (
      /** @type {CompiledAliasOptions} */
      {
        all: EMPTY_LIST,
        byFirstChar: /* @__PURE__ */ new Map(),
        hasAnyFirstChar: false,
        useBuckets: false
      }
    );
    function compileAliasOptions(resolver, options) {
      if (options.length === 0) return EMPTY_COMPILED_OPTIONS;
      const all = (
        /** @type {CompiledAliasOption[]} */
        Array.from({ length: options.length })
      );
      const byFirstChar = /* @__PURE__ */ new Map();
      let hasAnyFirstChar = false;
      for (let i = 0; i < options.length; i++) {
        const item = options[i];
        const { name } = item;
        let absolutePath = null;
        const type = getType(name);
        if (type === PathType.AbsolutePosix || type === PathType.AbsoluteWin) {
          absolutePath = resolver.join(name, "_").slice(0, -1);
        }
        const firstStar = name.indexOf("*");
        let wildcardPrefix = null;
        let wildcardSuffix = null;
        if (firstStar !== -1 && !name.includes("*", firstStar + 1)) {
          wildcardPrefix = name.slice(0, firstStar);
          wildcardSuffix = name.slice(firstStar + 1);
        }
        let firstCharCode;
        if (wildcardPrefix !== null && wildcardPrefix.length === 0) {
          firstCharCode = -1;
        } else {
          firstCharCode = name.length > 0 ? name.charCodeAt(0) : -1;
        }
        const compiled = {
          name,
          nameWithSlash: `${name}/`,
          alias: item.alias,
          onlyModule: Boolean(item.onlyModule),
          absolutePath,
          wildcardPrefix,
          wildcardSuffix,
          firstCharCode,
          arrayAlias: Array.isArray(item.alias)
        };
        all[i] = compiled;
        if (firstCharCode === -1) {
          hasAnyFirstChar = true;
        } else {
          let bucket = byFirstChar.get(firstCharCode);
          if (bucket === void 0) {
            bucket = [];
            byFirstChar.set(firstCharCode, bucket);
          }
          bucket.push(compiled);
        }
      }
      const useBuckets = !hasAnyFirstChar && byFirstChar.size >= 2;
      return { all, byFirstChar, hasAnyFirstChar, useBuckets };
    }
    function aliasResolveHandler(resolver, options, target, request, resolveContext, callback) {
      if (options.all.length === 0) return callback();
      const innerRequest = request.request || request.path;
      if (!innerRequest) return callback();
      const innerFirstCharCode = innerRequest.charCodeAt(0);
      const hasRequestString = Boolean(request.request);
      let scan;
      if (options.useBuckets) {
        const bucket = options.byFirstChar.get(innerFirstCharCode);
        if (bucket === void 0) return callback();
        scan = bucket;
      } else {
        scan = options.all;
      }
      forEachBail(
        scan,
        (item, callback2) => {
          const { firstCharCode } = item;
          if (firstCharCode !== -1 && firstCharCode !== innerFirstCharCode) {
            return callback2();
          }
          let shouldStop = false;
          const { absolutePath } = item;
          const matchRequest = innerRequest === item.name || !item.onlyModule && (hasRequestString && innerRequest.startsWith(item.nameWithSlash) || absolutePath !== null && innerRequest.startsWith(absolutePath));
          const matchWildcard = !item.onlyModule && item.wildcardPrefix !== null;
          if (matchRequest || matchWildcard) {
            const resolveWithAlias = (alias, callback3) => {
              if (alias === false) {
                const ignoreObj = {
                  ...request,
                  path: false
                };
                if (typeof resolveContext.yield === "function") {
                  resolveContext.yield(ignoreObj);
                  return callback3(null, null);
                }
                return callback3(null, ignoreObj);
              }
              let newRequestStr;
              if (matchWildcard && innerRequest.startsWith(
                /** @type {string} */
                item.wildcardPrefix
              ) && innerRequest.endsWith(
                /** @type {string} */
                item.wildcardSuffix
              )) {
                const match = innerRequest.slice(
                  /** @type {string} */
                  item.wildcardPrefix.length,
                  innerRequest.length - /** @type {string} */
                  item.wildcardSuffix.length
                );
                newRequestStr = alias.toString().replace("*", match);
              }
              if (matchRequest && innerRequest !== alias && !innerRequest.startsWith(`${alias}/`)) {
                const remainingRequest = innerRequest.slice(item.name.length);
                newRequestStr = alias + remainingRequest;
              }
              if (newRequestStr !== void 0) {
                shouldStop = true;
                const obj = {
                  ...request,
                  request: newRequestStr,
                  fullySpecified: false
                };
                return resolver.doResolve(
                  target,
                  obj,
                  `aliased with mapping '${item.name}': '${alias}' to '${newRequestStr}'`,
                  resolveContext,
                  (err, result) => {
                    if (err) return callback3(err);
                    if (result) return callback3(null, result);
                    return callback3();
                  }
                );
              }
              return callback3();
            };
            const stoppingCallback = (err, result) => {
              if (err) return callback2(err);
              if (result) return callback2(null, result);
              if (shouldStop) return callback2(null, null);
              return callback2();
            };
            if (item.arrayAlias) {
              return forEachBail(
                /** @type {string[]} */
                item.alias,
                resolveWithAlias,
                stoppingCallback
              );
            }
            return resolveWithAlias(item.alias, stoppingCallback);
          }
          return callback2();
        },
        callback
      );
    }
    module.exports.aliasResolveHandler = aliasResolveHandler;
    module.exports.compileAliasOptions = compileAliasOptions;
  }
});

// node_modules/enhanced-resolve/lib/AliasPlugin.js
var require_AliasPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/AliasPlugin.js"(exports, module) {
    "use strict";
    var { aliasResolveHandler, compileAliasOptions } = require_AliasUtils();
    module.exports = class AliasPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {AliasOption | AliasOption[]} options options
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, options, target) {
        this.source = source;
        this.options = Array.isArray(options) ? options : [options];
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        const compiled = compileAliasOptions(resolver, this.options);
        resolver.getHook(this.source).tapAsync("AliasPlugin", (request, resolveContext, callback) => {
          aliasResolveHandler(
            resolver,
            compiled,
            target,
            request,
            resolveContext,
            callback
          );
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/AppendPlugin.js
var require_AppendPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/AppendPlugin.js"(exports, module) {
    "use strict";
    module.exports = class AppendPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {string} appending appending
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, appending, target) {
        this.source = source;
        this.appending = appending;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync("AppendPlugin", (request, resolveContext, callback) => {
          const obj = {
            ...request,
            path: request.path + this.appending,
            relativePath: request.relativePath && request.relativePath + this.appending
          };
          resolver.doResolve(
            target,
            obj,
            this.appending,
            resolveContext,
            callback
          );
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/ConditionalPlugin.js
var require_ConditionalPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/ConditionalPlugin.js"(exports, module) {
    "use strict";
    module.exports = class ConditionalPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {Partial<ResolveRequest>} test compare object
       * @param {string | null} message log message
       * @param {boolean} allowAlternatives when false, do not continue with the current step when "test" matches
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, test, message, allowAlternatives, target) {
        this.source = source;
        this.test = test;
        this.message = message;
        this.allowAlternatives = allowAlternatives;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        const { test, message, allowAlternatives } = this;
        const keys = (
          /** @type {(keyof ResolveRequest)[]} */
          Object.keys(test)
        );
        resolver.getHook(this.source).tapAsync("ConditionalPlugin", (request, resolveContext, callback) => {
          for (const prop of keys) {
            if (request[prop] !== test[prop]) return callback();
          }
          resolver.doResolve(
            target,
            request,
            message,
            resolveContext,
            allowAlternatives ? callback : (err, result) => {
              if (err) return callback(err);
              if (result === void 0) return callback(null, null);
              callback(null, result);
            }
          );
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/DescriptionFilePlugin.js
var require_DescriptionFilePlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/DescriptionFilePlugin.js"(exports, module) {
    "use strict";
    var DescriptionFileUtils = require_DescriptionFileUtils();
    var BACKSLASH_G = /\\/g;
    module.exports = class DescriptionFilePlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {string[]} filenames filenames
       * @param {boolean} pathIsFile pathIsFile
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, filenames, pathIsFile, target) {
        this.source = source;
        this.filenames = filenames;
        this.pathIsFile = pathIsFile;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync(
          "DescriptionFilePlugin",
          (request, resolveContext, callback) => {
            const { path } = request;
            if (!path) return callback();
            const directory = this.pathIsFile ? DescriptionFileUtils.cdUp(path) : path;
            if (!directory) return callback();
            DescriptionFileUtils.loadDescriptionFile(
              resolver,
              directory,
              this.filenames,
              request.descriptionFilePath ? {
                path: request.descriptionFilePath,
                content: request.descriptionFileData,
                directory: (
                  /** @type {string} */
                  request.descriptionFileRoot
                )
              } : void 0,
              resolveContext,
              (err, result) => {
                if (err) return callback(err);
                if (!result) {
                  if (resolveContext.log) {
                    resolveContext.log(
                      `No description file found in ${directory} or above`
                    );
                  }
                  return callback();
                }
                const rawRelative = path.slice(result.directory.length);
                const relativePath = `.${rawRelative.includes("\\") ? rawRelative.replace(BACKSLASH_G, "/") : rawRelative}`;
                const obj = {
                  ...request,
                  descriptionFilePath: result.path,
                  descriptionFileData: result.content,
                  descriptionFileRoot: result.directory,
                  relativePath
                };
                resolver.doResolve(
                  target,
                  obj,
                  `using description file: ${result.path} (relative path: ${relativePath})`,
                  resolveContext,
                  (err2, result2) => {
                    if (err2) return callback(err2);
                    if (result2 === void 0) return callback(null, null);
                    callback(null, result2);
                  }
                );
              }
            );
          }
        );
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/DirectoryExistsPlugin.js
var require_DirectoryExistsPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/DirectoryExistsPlugin.js"(exports, module) {
    "use strict";
    module.exports = class DirectoryExistsPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, target) {
        this.source = source;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync(
          "DirectoryExistsPlugin",
          (request, resolveContext, callback) => {
            const fs = resolver.fileSystem;
            const directory = request.path;
            if (!directory) return callback();
            fs.stat(directory, (err, stat) => {
              if (err || !stat || !stat.isDirectory()) {
                if (resolveContext.missingDependencies) {
                  resolveContext.missingDependencies.add(directory);
                }
                if (resolveContext.log) {
                  resolveContext.log(
                    err || !stat ? `${directory} doesn't exist` : `${directory} is not a directory`
                  );
                }
                return callback();
              }
              if (resolveContext.fileDependencies) {
                resolveContext.fileDependencies.add(directory);
              }
              resolver.doResolve(
                target,
                request,
                `existing directory ${directory}`,
                resolveContext,
                callback
              );
            });
          }
        );
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/util/identifier.js
var require_identifier = __commonJS({
  "node_modules/enhanced-resolve/lib/util/identifier.js"(exports, module) {
    "use strict";
    var { fileURLToPath } = __require("url");
    var { isFileURL } = require_path();
    var PATH_QUERY_FRAGMENT_REGEXP = /^(#?(?:\0.|[^?#\0])*)(\?(?:\0.|[^#\0])*)?(#.*)?$/;
    var ZERO_ESCAPE_REGEXP = /\0(.)/g;
    function dosPrefixEnd(identifier) {
      if (identifier.length >= 4 && identifier.charCodeAt(1) === 92 && identifier.charCodeAt(3) === 92) {
        const c2 = identifier.charCodeAt(2);
        if (c2 === 63 || c2 === 46) return 4;
      }
      return 0;
    }
    function parseIdentifier(identifier) {
      if (!identifier) {
        return null;
      }
      if (isFileURL(identifier)) {
        identifier = fileURLToPath(identifier);
      }
      const firstEscape = identifier.indexOf("\0");
      if (firstEscape !== -1) {
        const match = PATH_QUERY_FRAGMENT_REGEXP.exec(identifier);
        if (!match) return null;
        return [
          match[1].replace(ZERO_ESCAPE_REGEXP, "$1"),
          match[2] ? match[2].replace(ZERO_ESCAPE_REGEXP, "$1") : "",
          match[3] || ""
        ];
      }
      const scanStart = identifier.charCodeAt(0) === 92 ? dosPrefixEnd(identifier) : 0;
      const queryStart = identifier.indexOf("?", scanStart);
      const fragmentStart = identifier.indexOf("#", scanStart || 1);
      if (fragmentStart < 0) {
        if (queryStart < 0) {
          return [identifier, "", ""];
        }
        return [identifier.slice(0, queryStart), identifier.slice(queryStart), ""];
      }
      if (queryStart < 0 || fragmentStart < queryStart) {
        return [
          identifier.slice(0, fragmentStart),
          "",
          identifier.slice(fragmentStart)
        ];
      }
      return [
        identifier.slice(0, queryStart),
        identifier.slice(queryStart, fragmentStart),
        identifier.slice(fragmentStart)
      ];
    }
    module.exports.parseIdentifier = parseIdentifier;
  }
});

// node_modules/enhanced-resolve/lib/util/entrypoints.js
var require_entrypoints = __commonJS({
  "node_modules/enhanced-resolve/lib/util/entrypoints.js"(exports, module) {
    "use strict";
    var { parseIdentifier } = require_identifier();
    var slashCode = "/".charCodeAt(0);
    var dotCode = ".".charCodeAt(0);
    var hashCode = "#".charCodeAt(0);
    var patternRegEx = /\*/g;
    var DOLLAR_ESCAPE_RE = /\$/g;
    var _keysCache = /* @__PURE__ */ new WeakMap();
    function cachedKeys(obj) {
      let keys = _keysCache.get(obj);
      if (keys === void 0) {
        keys = Object.keys(obj);
        _keysCache.set(obj, keys);
      }
      return keys;
    }
    var _fieldKeyInfoCache = /* @__PURE__ */ new WeakMap();
    function getFieldKeyInfos(field) {
      const fieldKey = (
        /** @type {RecordMapping} */
        field
      );
      let infos = _fieldKeyInfoCache.get(fieldKey);
      if (infos !== void 0) return infos;
      const keys = Object.getOwnPropertyNames(field);
      infos = Array.from({ length: keys.length });
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const patternIndex = key.indexOf("*");
        const isValidPattern = patternIndex === -1 || !key.includes("*", patternIndex + 1);
        const keyLen = key.length;
        const endsWithSlash = keyLen > 0 && key.charCodeAt(keyLen - 1) === slashCode;
        infos[i] = {
          key,
          patternIndex,
          wildcardPrefix: patternIndex === -1 ? "" : key.slice(0, patternIndex),
          wildcardSuffix: patternIndex === -1 ? "" : key.slice(patternIndex + 1),
          isLegacySubpath: patternIndex === -1 && endsWithSlash,
          isPattern: patternIndex !== -1,
          isSubpathMapping: endsWithSlash,
          isValidPattern
        };
      }
      _fieldKeyInfoCache.set(fieldKey, infos);
      return infos;
    }
    function patternKeyCompare(a, b) {
      const aPatternIndex = a.indexOf("*");
      const bPatternIndex = b.indexOf("*");
      const baseLenA = aPatternIndex === -1 ? a.length : aPatternIndex + 1;
      const baseLenB = bPatternIndex === -1 ? b.length : bPatternIndex + 1;
      if (baseLenA > baseLenB) return -1;
      if (baseLenB > baseLenA) return 1;
      if (aPatternIndex === -1) return 1;
      if (bPatternIndex === -1) return -1;
      if (a.length > b.length) return -1;
      if (b.length > a.length) return 1;
      return 0;
    }
    var _findMatchCache = /* @__PURE__ */ new WeakMap();
    function computeFindMatch(request, field) {
      const requestLen = request.length;
      const requestEndsWithSlash = requestLen > 0 && request.charCodeAt(requestLen - 1) === slashCode;
      const requestHasStar = request.includes("*");
      if (!requestHasStar && !requestEndsWithSlash && Object.prototype.hasOwnProperty.call(field, request)) {
        const target2 = (
          /** @type {{ [k: string]: MappingValue }} */
          field[request]
        );
        return [target2, "", false, false, request];
      }
      let bestMatch = "";
      let bestMatchInfo = null;
      let bestMatchSubpath;
      const infos = getFieldKeyInfos(field);
      for (let i = 0; i < infos.length; i++) {
        const info = infos[i];
        const { key, patternIndex } = info;
        if (patternIndex !== -1) {
          if (!info.isValidPattern || !request.startsWith(info.wildcardPrefix) || requestLen < key.length || !request.endsWith(info.wildcardSuffix) || patternKeyCompare(bestMatch, key) !== 1) {
            continue;
          }
          bestMatch = key;
          bestMatchInfo = info;
          bestMatchSubpath = request.slice(
            patternIndex,
            requestLen - info.wildcardSuffix.length
          );
        } else if (info.isLegacySubpath && request.startsWith(key) && patternKeyCompare(bestMatch, key) === 1) {
          bestMatch = key;
          bestMatchInfo = info;
          bestMatchSubpath = request.slice(key.length);
        }
      }
      if (bestMatch === "") return null;
      const target = (
        /** @type {{ [k: string]: MappingValue }} */
        field[bestMatch]
      );
      return [
        target,
        /** @type {string} */
        bestMatchSubpath,
        /** @type {FieldKeyInfo} */
        bestMatchInfo.isSubpathMapping,
        /** @type {FieldKeyInfo} */
        bestMatchInfo.isPattern,
        bestMatch
      ];
    }
    function findMatch(request, field) {
      const fieldKey = (
        /** @type {RecordMapping} */
        field
      );
      let perRequest = _findMatchCache.get(fieldKey);
      if (perRequest === void 0) {
        perRequest = /* @__PURE__ */ new Map();
        _findMatchCache.set(fieldKey, perRequest);
      } else {
        const cached = perRequest.get(request);
        if (cached !== void 0) return cached;
      }
      const result = computeFindMatch(request, field);
      perRequest.set(request, result);
      return result;
    }
    var NULL_RESULT = /* @__PURE__ */ Symbol("NULL_RESULT");
    var _conditionalMappingCache = /* @__PURE__ */ new WeakMap();
    function computeConditionalMapping(conditionalMapping_, conditionNames) {
      const lookup = [[conditionalMapping_, cachedKeys(conditionalMapping_), 0]];
      loop: while (lookup.length > 0) {
        const top = lookup[lookup.length - 1];
        const [mapping, conditions, j] = top;
        for (let i = j; i < conditions.length; i++) {
          const condition = conditions[i];
          if (condition === "default" || conditionNames.has(condition)) {
            const innerMapping = mapping[condition];
            if (innerMapping !== null && typeof innerMapping === "object" && !Array.isArray(innerMapping)) {
              const nested = (
                /** @type {ConditionalMapping} */
                innerMapping
              );
              top[2] = i + 1;
              lookup.push([nested, cachedKeys(nested), 0]);
              continue loop;
            }
            return (
              /** @type {DirectMapping} */
              innerMapping
            );
          }
        }
        lookup.pop();
      }
      return null;
    }
    function conditionalMapping(conditionalMapping_, conditionNames) {
      let perSet = _conditionalMappingCache.get(conditionalMapping_);
      if (perSet !== void 0) {
        const cached = perSet.get(conditionNames);
        if (cached !== void 0) {
          return cached === NULL_RESULT ? null : (
            /** @type {DirectMapping} */
            cached
          );
        }
      } else {
        perSet = /* @__PURE__ */ new WeakMap();
        _conditionalMappingCache.set(conditionalMapping_, perSet);
      }
      const result = computeConditionalMapping(conditionalMapping_, conditionNames);
      perSet.set(conditionNames, result === null ? NULL_RESULT : result);
      return result;
    }
    function targetMapping(remainingRequest, isPattern, isSubpathMapping, mappingTarget, assert2) {
      if (remainingRequest === void 0) {
        assert2(mappingTarget, false);
        return mappingTarget;
      }
      if (isSubpathMapping) {
        assert2(mappingTarget, true);
        return mappingTarget + remainingRequest;
      }
      assert2(mappingTarget, false);
      let result = mappingTarget;
      if (isPattern) {
        const escapedRemainder = remainingRequest.includes("$") ? remainingRequest.replace(DOLLAR_ESCAPE_RE, "$$") : remainingRequest;
        result = result.replace(patternRegEx, escapedRemainder);
      }
      return result;
    }
    function directMapping(remainingRequest, isPattern, isSubpathMapping, mappingTarget, conditionNames, assert2) {
      if (mappingTarget === null) return [];
      if (typeof mappingTarget === "string") {
        return [
          targetMapping(
            remainingRequest,
            isPattern,
            isSubpathMapping,
            mappingTarget,
            assert2
          )
        ];
      }
      const targets = [];
      for (let i = 0, len = mappingTarget.length; i < len; i++) {
        const exp = mappingTarget[i];
        if (typeof exp === "string") {
          targets.push(
            targetMapping(
              remainingRequest,
              isPattern,
              isSubpathMapping,
              exp,
              assert2
            )
          );
          continue;
        }
        const mapping = conditionalMapping(exp, conditionNames);
        if (!mapping) continue;
        const innerExports = directMapping(
          remainingRequest,
          isPattern,
          isSubpathMapping,
          mapping,
          conditionNames,
          assert2
        );
        for (let j = 0, innerLen = innerExports.length; j < innerLen; j++) {
          targets.push(innerExports[j]);
        }
      }
      return targets;
    }
    var EMPTY_NO_MATCH = (
      /** @type {[string[], null]} */
      [[], null]
    );
    function createFieldProcessor(field, normalizeRequest, assertRequest, assertTarget) {
      return function fieldProcessor(request, conditionNames) {
        const match = findMatch(normalizeRequest(assertRequest(request)), field);
        if (match === null) return EMPTY_NO_MATCH;
        const [mapping, remainingRequest, isSubpathMapping, isPattern, usedField] = match;
        let direct;
        if (mapping !== null && typeof mapping === "object" && !Array.isArray(mapping)) {
          direct = conditionalMapping(
            /** @type {ConditionalMapping} */
            mapping,
            conditionNames
          );
          if (direct === null) return EMPTY_NO_MATCH;
        } else {
          direct = /** @type {DirectMapping} */
          mapping;
        }
        return [
          directMapping(
            remainingRequest,
            isPattern,
            isSubpathMapping,
            direct,
            conditionNames,
            assertTarget
          ),
          usedField
        ];
      };
    }
    function assertExportsFieldRequest(request) {
      if (request.charCodeAt(0) !== dotCode) {
        throw new Error('Request should be relative path and start with "."');
      }
      if (request.length === 1) return "";
      if (request.charCodeAt(1) !== slashCode) {
        throw new Error('Request should be relative path and start with "./"');
      }
      if (request.charCodeAt(request.length - 1) === slashCode) {
        throw new Error("Only requesting file allowed");
      }
      return request.slice(2);
    }
    function findSubpathsInConditions(mapping, subpathCode, trail) {
      if (mapping === null || typeof mapping !== "object") return null;
      if (Array.isArray(mapping)) {
        for (let i = 0; i < mapping.length; i++) {
          const found = findSubpathsInConditions(mapping[i], subpathCode, trail);
          if (found) return found;
        }
        return null;
      }
      const keys = Object.keys(mapping);
      for (let i = 0; i < keys.length; i++) {
        if (keys[i].charCodeAt(0) === subpathCode) {
          return { trail: [...trail], keys };
        }
      }
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        trail.push(key);
        const found = findSubpathsInConditions(mapping[key], subpathCode, trail);
        if (found) return found;
        trail.pop();
      }
      return null;
    }
    module.exports.explainSubpathsInConditions = function explainSubpathsInConditions(field, isExports) {
      if (field === null || typeof field !== "object" || Array.isArray(field)) {
        return null;
      }
      const subpathCode = isExports ? dotCode : hashCode;
      const keys = Object.keys(field);
      const trail = [];
      let found = null;
      for (let i = 0; i < keys.length && !found; i++) {
        trail.push(keys[i]);
        found = findSubpathsInConditions(
          /** @type {Record<string, MappingValue>} */
          field[keys[i]],
          subpathCode,
          trail
        );
        trail.pop();
      }
      if (!found) return null;
      const quote = (key) => JSON.stringify(key);
      const subpathKeys = found.keys.filter(
        (key) => key.charCodeAt(0) === subpathCode
      );
      const condition = found.trail[found.trail.length - 1];
      const example = subpathKeys.map((key) => `${quote(key)}: { ${quote(condition)}: ... }`).join(", ");
      return `the value at ${found.trail.map(quote).join(" -> ")} is an object with subpath keys (${subpathKeys.map(quote).join(
        ", "
      )}), which is not supported - a condition can only map to a target or to further conditions, so those subpaths never match. Put the subpaths at the top level and nest the conditions inside them instead, e.g. { ${example} }.`;
    };
    function buildExportsField(field) {
      if (typeof field === "string" || Array.isArray(field)) {
        return { ".": field };
      }
      const keys = Object.keys(field);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key.charCodeAt(0) !== dotCode) {
          if (i === 0) {
            while (i < keys.length) {
              const charCode = keys[i].charCodeAt(0);
              if (charCode === dotCode || charCode === slashCode) {
                throw new Error(
                  `Exports field key should be relative path and start with "." (key: ${JSON.stringify(
                    key
                  )})`
                );
              }
              i++;
            }
            return { ".": field };
          }
          throw new Error(
            `Exports field key should be relative path and start with "." (key: ${JSON.stringify(
              key
            )})`
          );
        }
        if (key.length === 1) {
          continue;
        }
        if (key.charCodeAt(1) !== slashCode) {
          throw new Error(
            `Exports field key should be relative path and start with "./" (key: ${JSON.stringify(
              key
            )})`
          );
        }
      }
      return field;
    }
    function assertExportTarget(exp, expectFolder) {
      const parsedIdentifier = parseIdentifier(exp);
      if (!parsedIdentifier) {
        return;
      }
      const [relativePath] = parsedIdentifier;
      const isFolder = relativePath.charCodeAt(relativePath.length - 1) === slashCode;
      if (isFolder !== expectFolder) {
        throw new Error(
          expectFolder ? `Expecting folder to folder mapping. ${JSON.stringify(
            exp
          )} should end with "/"` : `Expecting file to file mapping. ${JSON.stringify(
            exp
          )} should not end with "/"`
        );
      }
    }
    module.exports.processExportsField = function processExportsField(exportsField) {
      return createFieldProcessor(
        buildExportsField(exportsField),
        (request) => request.length === 0 ? "." : `./${request}`,
        assertExportsFieldRequest,
        assertExportTarget
      );
    };
    function assertImportsFieldRequest(request) {
      if (request.charCodeAt(0) !== hashCode) {
        throw new Error('Request should start with "#"');
      }
      if (request.length === 1) {
        throw new Error("Request should have at least 2 characters");
      }
      if (request.charCodeAt(request.length - 1) === slashCode) {
        throw new Error("Only requesting file allowed");
      }
      return request.slice(1);
    }
    function assertImportTarget(imp, expectFolder) {
      const parsedIdentifier = parseIdentifier(imp);
      if (!parsedIdentifier) {
        return;
      }
      const [relativePath] = parsedIdentifier;
      const isFolder = relativePath.charCodeAt(relativePath.length - 1) === slashCode;
      if (isFolder !== expectFolder) {
        throw new Error(
          expectFolder ? `Expecting folder to folder mapping. ${JSON.stringify(
            imp
          )} should end with "/"` : `Expecting file to file mapping. ${JSON.stringify(
            imp
          )} should not end with "/"`
        );
      }
    }
    module.exports.processImportsField = function processImportsField(importsField) {
      return createFieldProcessor(
        importsField,
        (request) => `#${request}`,
        assertImportsFieldRequest,
        assertImportTarget
      );
    };
  }
});

// node_modules/enhanced-resolve/lib/ExportsFieldPlugin.js
var require_ExportsFieldPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/ExportsFieldPlugin.js"(exports, module) {
    "use strict";
    var DescriptionFileUtils = require_DescriptionFileUtils();
    var forEachBail = require_forEachBail();
    var {
      explainSubpathsInConditions,
      processExportsField
    } = require_entrypoints();
    var { parseIdentifier } = require_identifier();
    var {
      deprecatedInvalidSegmentRegEx,
      invalidSegmentRegEx
    } = require_path();
    module.exports = class ExportsFieldPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {Set<string>} conditionNames condition names
       * @param {string | string[]} fieldNamePath name path
       * @param {string | ResolveStepHook} target target
       * @param {boolean=} restrictions whether `restrictions` are configured (enables exports-target fallback when a target is filtered out)
       */
      constructor(source, conditionNames, fieldNamePath, target, restrictions) {
        this.source = source;
        this.target = target;
        this.conditionNames = conditionNames;
        this.fieldName = fieldNamePath;
        this.restrictions = Boolean(restrictions);
        this._fieldProcessorCache = /* @__PURE__ */ new WeakMap();
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync("ExportsFieldPlugin", (request, resolveContext, callback) => {
          if (!request.descriptionFileData) return callback();
          if (
            // When the description file is inherited from parent, abort
            // (There is no description file inside of this package)
            request.relativePath !== "." || request.request === void 0
          ) {
            return callback();
          }
          const { descriptionFileData } = request;
          const remainingRequest = request.query || request.fragment ? (request.request === "." ? "./" : request.request) + request.query + request.fragment : request.request;
          let paths;
          let usedField;
          try {
            let fieldProcessor = this._fieldProcessorCache.get(descriptionFileData);
            if (fieldProcessor === void 0 && !this._fieldProcessorCache.has(descriptionFileData)) {
              const exportsField = (
                /** @type {ExportsField | null | undefined} */
                DescriptionFileUtils.getField(
                  descriptionFileData,
                  this.fieldName
                )
              );
              fieldProcessor = exportsField ? processExportsField(exportsField) : null;
              this._fieldProcessorCache.set(descriptionFileData, fieldProcessor);
            }
            if (!fieldProcessor) return callback();
            if (request.directory) {
              return callback(
                new Error(
                  `Resolving to directories is not possible with the exports field (request was ${remainingRequest}/)`
                )
              );
            }
            [paths, usedField] = fieldProcessor(
              remainingRequest,
              this.conditionNames
            );
          } catch (err) {
            const error = new Error(
              `${/** @type {Error} */
              err.message} (see exports field in ${request.descriptionFilePath})`
            );
            if (resolveContext.log) {
              resolveContext.log(error.message);
            }
            return callback(error);
          }
          if (paths.length === 0) {
            const conditions = [...this.conditionNames];
            const conditionsStr = conditions.length === 1 ? `the condition "${conditions[0]}"` : `the conditions ${JSON.stringify(conditions)}`;
            const explanation = explainSubpathsInConditions(
              /** @type {ExportsField | null | undefined} */
              DescriptionFileUtils.getField(descriptionFileData, this.fieldName),
              true
            );
            return callback(
              new Error(
                `"${remainingRequest}" is not exported under ${conditionsStr} from package ${request.descriptionFileRoot} (see exports field in ${request.descriptionFilePath})${explanation ? `. In that exports field, ${explanation}` : ""}`
              )
            );
          }
          const restrictionsMarker = this.restrictions ? { blocked: false } : void 0;
          forEachBail(
            paths,
            /**
             * @param {string} path path
             * @param {(err?: null | Error, result?: null | ResolveRequest) => void} callback callback
             * @param {number} i index
             * @returns {void}
             */
            (path, callback2, i) => {
              const parsedIdentifier = parseIdentifier(path);
              if (!parsedIdentifier) return callback2();
              const [relativePath, query, fragment] = parsedIdentifier;
              if (!relativePath.startsWith("./")) {
                if (paths.length === i) {
                  return callback2(
                    new Error(
                      `Invalid "exports" target "${path}" defined for "${usedField}" in the package config ${request.descriptionFilePath}, targets must start with "./"`
                    )
                  );
                }
                return callback2();
              }
              const withoutDotSlash = relativePath.slice(2);
              if (invalidSegmentRegEx.test(withoutDotSlash) && deprecatedInvalidSegmentRegEx.test(withoutDotSlash)) {
                if (paths.length === i) {
                  return callback2(
                    new Error(
                      `Invalid "exports" target "${path}" defined for "${usedField}" in the package config ${request.descriptionFilePath}, targets must start with "./"`
                    )
                  );
                }
                return callback2();
              }
              const obj = {
                ...request,
                request: void 0,
                path: resolver.join(
                  /** @type {string} */
                  request.descriptionFileRoot,
                  relativePath
                ),
                relativePath,
                query,
                fragment
              };
              if (restrictionsMarker) {
                obj.__restrictionsMarker = restrictionsMarker;
              }
              resolver.doResolve(
                target,
                obj,
                `using exports field: ${path}`,
                resolveContext,
                (err, result) => {
                  if (err) return callback2(err);
                  if (result === void 0) return callback2(null, null);
                  callback2(null, result);
                }
              );
            },
            /**
             * @param {(null | Error)=} err error
             * @param {(null | ResolveRequest)=} result result
             * @returns {void}
             */
            (err, result) => {
              if (err) return callback(err);
              if (!result) {
                if (restrictionsMarker && restrictionsMarker.blocked) {
                  return callback(null, null);
                }
                return callback(
                  new Error(
                    `Package path ${remainingRequest} is exported from package ${request.descriptionFileRoot}, but no valid target file was found (see exports field in ${request.descriptionFilePath})`
                  )
                );
              }
              if (restrictionsMarker) delete result.__restrictionsMarker;
              callback(null, result);
            }
          );
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/ExtensionAliasPlugin.js
var require_ExtensionAliasPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/ExtensionAliasPlugin.js"(exports, module) {
    "use strict";
    var forEachBail = require_forEachBail();
    module.exports = class ExtensionAliasPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {ExtensionAliasOption} options options
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, options, target) {
        this.source = source;
        this.options = options;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        const { extension, alias } = this.options;
        resolver.getHook(this.source).tapAsync("ExtensionAliasPlugin", (request, resolveContext, callback) => {
          const useRequest = request.request !== void 0;
          const source = useRequest ? (
            /** @type {string} */
            request.request
          ) : request.path;
          if (!source || !source.endsWith(extension)) return callback();
          const isAliasString = typeof alias === "string";
          const sourceBase = source.slice(0, -extension.length);
          const relativePathBase = !useRequest && request.relativePath && request.relativePath.endsWith(extension) ? request.relativePath.slice(0, -extension.length) : null;
          const resolve2 = (alias2, callback2, index) => {
            const newValue = `${sourceBase}${alias2}`;
            const nextRequest = useRequest ? {
              ...request,
              request: newValue,
              fullySpecified: true
            } : {
              ...request,
              path: newValue,
              relativePath: relativePathBase !== null ? `${relativePathBase}${alias2}` : request.relativePath,
              fullySpecified: true
            };
            return resolver.doResolve(
              target,
              nextRequest,
              `aliased from extension alias with mapping '${extension}' to '${alias2}'`,
              resolveContext,
              (err, result) => {
                if (!isAliasString && index) {
                  if (index !== this.options.alias.length) {
                    if (resolveContext.log) {
                      resolveContext.log(
                        `Failed to alias from extension alias with mapping '${extension}' to '${alias2}' for '${newValue}': ${err}`
                      );
                    }
                    return callback2(null, result);
                  }
                  return callback2(err, result);
                }
                callback2(err, result);
              }
            );
          };
          const stoppingCallback = (err, result) => {
            if (err) return callback(err);
            if (result) return callback(null, result);
            if (isAliasString ? alias === extension : alias.includes(extension)) {
              return callback();
            }
            return callback(null, null);
          };
          if (isAliasString) {
            resolve2(alias, stoppingCallback);
          } else if (alias.length > 1) {
            forEachBail(alias, resolve2, stoppingCallback);
          } else {
            resolve2(alias[0], stoppingCallback);
          }
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/FileExistsPlugin.js
var require_FileExistsPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/FileExistsPlugin.js"(exports, module) {
    "use strict";
    module.exports = class FileExistsPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, target) {
        this.source = source;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        const fs = resolver.fileSystem;
        resolver.getHook(this.source).tapAsync("FileExistsPlugin", (request, resolveContext, callback) => {
          const file = request.path;
          if (!file) return callback();
          fs.stat(file, (err, stat) => {
            if (err || !stat || !stat.isFile()) {
              if (resolveContext.missingDependencies) {
                resolveContext.missingDependencies.add(file);
              }
              if (resolveContext.log) {
                resolveContext.log(
                  err || !stat ? `${file} doesn't exist` : `${file} is not a file`
                );
              }
              return callback();
            }
            if (resolveContext.fileDependencies) {
              resolveContext.fileDependencies.add(file);
            }
            resolver.doResolve(
              target,
              request,
              `existing file: ${file}`,
              resolveContext,
              callback
            );
          });
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/ImportsFieldPlugin.js
var require_ImportsFieldPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/ImportsFieldPlugin.js"(exports, module) {
    "use strict";
    var DescriptionFileUtils = require_DescriptionFileUtils();
    var forEachBail = require_forEachBail();
    var {
      explainSubpathsInConditions,
      processImportsField
    } = require_entrypoints();
    var { parseIdentifier } = require_identifier();
    var { invalidSegmentRegEx } = require_path();
    var dotCode = ".".charCodeAt(0);
    module.exports = class ImportsFieldPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {Set<string>} conditionNames condition names
       * @param {string | string[]} fieldNamePath name path
       * @param {string | ResolveStepHook} targetFile target file
       * @param {string | ResolveStepHook} targetPackage target package
       */
      constructor(source, conditionNames, fieldNamePath, targetFile, targetPackage) {
        this.source = source;
        this.targetFile = targetFile;
        this.targetPackage = targetPackage;
        this.conditionNames = conditionNames;
        this.fieldName = fieldNamePath;
        this._fieldProcessorCache = /* @__PURE__ */ new WeakMap();
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const targetFile = resolver.ensureHook(this.targetFile);
        const targetPackage = resolver.ensureHook(this.targetPackage);
        resolver.getHook(this.source).tapAsync("ImportsFieldPlugin", (request, resolveContext, callback) => {
          if (!request.descriptionFileData || request.request === void 0) {
            return callback();
          }
          const { descriptionFileData } = request;
          const remainingRequest = request.query || request.fragment ? request.request + request.query + request.fragment : request.request;
          let paths;
          let usedField;
          try {
            let fieldProcessor = this._fieldProcessorCache.get(descriptionFileData);
            if (fieldProcessor === void 0 && !this._fieldProcessorCache.has(descriptionFileData)) {
              const importsField = (
                /** @type {ImportsField | null | undefined} */
                DescriptionFileUtils.getField(
                  descriptionFileData,
                  this.fieldName
                )
              );
              fieldProcessor = importsField ? processImportsField(importsField) : null;
              this._fieldProcessorCache.set(descriptionFileData, fieldProcessor);
            }
            if (!fieldProcessor) return callback();
            if (request.directory) {
              return callback(
                new Error(
                  `Resolving to directories is not possible with the imports field (request was ${remainingRequest}/)`
                )
              );
            }
            [paths, usedField] = fieldProcessor(
              remainingRequest,
              this.conditionNames
            );
          } catch (err) {
            const error = new Error(
              `${/** @type {Error} */
              err.message} (see imports field in ${request.descriptionFilePath})`
            );
            if (resolveContext.log) {
              resolveContext.log(error.message);
            }
            return callback(error);
          }
          if (paths.length === 0) {
            const explanation = explainSubpathsInConditions(
              /** @type {ImportsField | null | undefined} */
              DescriptionFileUtils.getField(descriptionFileData, this.fieldName),
              false
            );
            return callback(
              new Error(
                `Package import ${remainingRequest} is not imported from package ${request.descriptionFileRoot} (see imports field in ${request.descriptionFilePath})${explanation ? `. In that imports field, ${explanation}` : ""}`
              )
            );
          }
          forEachBail(
            paths,
            /**
             * @param {string} path path
             * @param {(err?: null | Error, result?: null | ResolveRequest) => void} callback callback
             * @param {number} i index
             * @returns {void}
             */
            (path, callback2, i) => {
              const parsedIdentifier = parseIdentifier(path);
              if (!parsedIdentifier) return callback2();
              const [path_, query, fragment] = parsedIdentifier;
              switch (path_.charCodeAt(0)) {
                // should be relative
                case dotCode: {
                  const withoutDotSlash = path_.slice(2);
                  if (invalidSegmentRegEx.test(withoutDotSlash)) {
                    if (paths.length === i) {
                      return callback2(
                        new Error(
                          `Invalid "imports" target "${path}" defined for "${usedField}" in the package config ${request.descriptionFilePath}, targets must start with "./"`
                        )
                      );
                    }
                    return callback2();
                  }
                  const obj = {
                    ...request,
                    request: void 0,
                    path: resolver.join(
                      /** @type {string} */
                      request.descriptionFileRoot,
                      path_
                    ),
                    relativePath: path_,
                    query,
                    fragment
                  };
                  resolver.doResolve(
                    targetFile,
                    obj,
                    `using imports field: ${path}`,
                    resolveContext,
                    (err, result) => {
                      if (err) return callback2(err);
                      if (result === void 0) return callback2(null, null);
                      callback2(null, result);
                    }
                  );
                  break;
                }
                // package resolving
                default: {
                  const obj = {
                    ...request,
                    request: path_,
                    relativePath: path_,
                    fullySpecified: true,
                    query,
                    fragment
                  };
                  resolver.doResolve(
                    targetPackage,
                    obj,
                    `using imports field: ${path}`,
                    resolveContext,
                    (err, result) => {
                      if (err) return callback2(err);
                      if (result === void 0) return callback2(null, null);
                      callback2(null, result);
                    }
                  );
                }
              }
            },
            /**
             * @param {null | Error=} err error
             * @param {null | ResolveRequest=} result result
             * @returns {void}
             */
            (err, result) => callback(err, result || null)
          );
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/JoinRequestPartPlugin.js
var require_JoinRequestPartPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/JoinRequestPartPlugin.js"(exports, module) {
    "use strict";
    var namespaceStartCharCode = "@".charCodeAt(0);
    module.exports = class JoinRequestPartPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, target) {
        this.source = source;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync(
          "JoinRequestPartPlugin",
          (request, resolveContext, callback) => {
            const req = request.request || "";
            let i = req.indexOf("/", 3);
            if (i >= 0 && req.charCodeAt(2) === namespaceStartCharCode) {
              i = req.indexOf("/", i + 1);
            }
            let moduleName;
            let remainingRequest;
            let fullySpecified;
            if (i < 0) {
              moduleName = req;
              remainingRequest = ".";
              fullySpecified = false;
            } else {
              moduleName = req.slice(0, i);
              remainingRequest = `.${req.slice(i)}`;
              fullySpecified = /** @type {boolean} */
              request.fullySpecified;
            }
            const obj = {
              ...request,
              path: resolver.join(
                /** @type {string} */
                request.path,
                moduleName
              ),
              relativePath: request.relativePath && resolver.join(request.relativePath, moduleName),
              request: remainingRequest,
              fullySpecified
            };
            resolver.doResolve(target, obj, null, resolveContext, callback);
          }
        );
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/JoinRequestPlugin.js
var require_JoinRequestPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/JoinRequestPlugin.js"(exports, module) {
    "use strict";
    module.exports = class JoinRequestPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, target) {
        this.source = source;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync("JoinRequestPlugin", (request, resolveContext, callback) => {
          const requestPath = (
            /** @type {string} */
            request.path
          );
          const requestRequest = (
            /** @type {string} */
            request.request
          );
          const obj = {
            ...request,
            path: resolver.join(requestPath, requestRequest),
            relativePath: request.relativePath && resolver.join(request.relativePath, requestRequest),
            request: void 0
          };
          resolver.doResolve(target, obj, null, resolveContext, callback);
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/MainFieldPlugin.js
var require_MainFieldPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/MainFieldPlugin.js"(exports, module) {
    "use strict";
    var DescriptionFileUtils = require_DescriptionFileUtils();
    var alreadyTriedMainField = /* @__PURE__ */ Symbol("alreadyTriedMainField");
    var NO_MAIN = /* @__PURE__ */ Symbol("NoMain");
    module.exports = class MainFieldPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {MainFieldOptions} options options
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, options, target) {
        this.source = source;
        this.options = options;
        this.target = target;
        this._mainModuleCache = /* @__PURE__ */ new WeakMap();
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync("MainFieldPlugin", (request, resolveContext, callback) => {
          if (request.path !== request.descriptionFileRoot || /** @type {ResolveRequest & { [alreadyTriedMainField]?: string }} */
          request[alreadyTriedMainField] === request.descriptionFilePath || !request.descriptionFilePath) {
            return callback();
          }
          const descFileData = (
            /** @type {JsonObject} */
            request.descriptionFileData
          );
          let mainModule = this._mainModuleCache.get(descFileData);
          if (mainModule === void 0) {
            let raw = (
              /** @type {string | null | undefined} */
              DescriptionFileUtils.getField(descFileData, this.options.name)
            );
            if (!raw || typeof raw !== "string" || raw === "." || raw === "./") {
              this._mainModuleCache.set(descFileData, NO_MAIN);
              return callback();
            }
            if (this.options.forceRelative && !/^\.\.?\//.test(raw)) {
              raw = `./${raw}`;
            }
            mainModule = raw;
            this._mainModuleCache.set(descFileData, mainModule);
          } else if (mainModule === NO_MAIN) {
            return callback();
          }
          const filename = resolver.basename(request.descriptionFilePath);
          const obj = {
            ...request,
            request: mainModule,
            module: false,
            directory: mainModule.endsWith("/"),
            [alreadyTriedMainField]: request.descriptionFilePath
          };
          return resolver.doResolve(
            target,
            obj,
            `use ${mainModule} from ${this.options.name} in ${filename}`,
            resolveContext,
            callback
          );
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/getPaths.js
var require_getPaths = __commonJS({
  "node_modules/enhanced-resolve/lib/getPaths.js"(exports, module) {
    "use strict";
    function getPaths(path) {
      if (path === "/") return { paths: ["/"], segments: [""] };
      const parts = path.split(/(.*?[\\/]+)/);
      const paths = [path];
      const segments = [parts[parts.length - 1]];
      let part = parts[parts.length - 1];
      path = path.slice(0, Math.max(0, path.length - part.length - 1));
      for (let i = parts.length - 2; i > 2; i -= 2) {
        paths.push(path);
        part = parts[i];
        path = path.slice(0, Math.max(0, path.length - part.length)) || "/";
        segments.push(part.slice(0, -1));
      }
      [, part] = parts;
      segments.push(part);
      paths.push(part);
      return {
        paths,
        segments
      };
    }
    var _getPathsCacheByFs = /* @__PURE__ */ new WeakMap();
    function getPathsCached(fileSystem, path) {
      let cache = _getPathsCacheByFs.get(fileSystem);
      if (cache === void 0) {
        cache = /* @__PURE__ */ new Map();
        _getPathsCacheByFs.set(fileSystem, cache);
      } else {
        const cached = cache.get(path);
        if (cached !== void 0) return cached;
      }
      const { paths, segments } = getPaths(path);
      const result = { paths: [...paths], segments: [...segments] };
      cache.set(path, result);
      return result;
    }
    module.exports = getPaths;
    module.exports.getPathsCached = getPathsCached;
  }
});

// node_modules/enhanced-resolve/lib/ModulesUtils.js
var require_ModulesUtils = __commonJS({
  "node_modules/enhanced-resolve/lib/ModulesUtils.js"(exports, module) {
    "use strict";
    var forEachBail = require_forEachBail();
    var { getPathsCached } = require_getPaths();
    var _addrsCacheByDirs = /* @__PURE__ */ new WeakMap();
    function modulesResolveHandler(resolver, directories, target, request, resolveContext, callback) {
      const fs = resolver.fileSystem;
      const requestPath = (
        /** @type {string} */
        request.path
      );
      let addrs;
      let perPath = _addrsCacheByDirs.get(directories);
      if (perPath === void 0) {
        perPath = /* @__PURE__ */ new Map();
        _addrsCacheByDirs.set(directories, perPath);
      } else {
        addrs = perPath.get(requestPath);
      }
      if (addrs === void 0) {
        const { paths } = getPathsCached(fs, requestPath);
        const pathsLen = paths.length;
        const dirsLen = directories.length;
        addrs = new Array(pathsLen * dirsLen);
        let idx = 0;
        const joinFn = resolver.pathCache.join.fn;
        for (let pi = 0; pi < pathsLen; pi++) {
          const pathItem = paths[pi];
          for (let di = 0; di < dirsLen; di++) {
            addrs[idx++] = joinFn(pathItem, directories[di]);
          }
        }
        perPath.set(requestPath, addrs);
      }
      const relRequest = `./${request.request}`;
      forEachBail(
        addrs,
        /**
         * @param {string} addr addr
         * @param {(err?: null | Error, result?: null | ResolveRequest) => void} callback callback
         * @returns {void}
         */
        (addr, callback2) => {
          fs.stat(addr, (err, stat) => {
            if (!err && stat && stat.isDirectory()) {
              const obj = {
                ...request,
                path: addr,
                request: relRequest,
                module: false
              };
              const message = `looking for modules in ${addr}`;
              return resolver.doResolve(
                target,
                obj,
                message,
                resolveContext,
                callback2
              );
            }
            if (resolveContext.log) {
              resolveContext.log(`${addr} doesn't exist or is not a directory`);
            }
            if (resolveContext.missingDependencies) {
              resolveContext.missingDependencies.add(addr);
            }
            return callback2();
          });
        },
        callback
      );
    }
    module.exports = {
      modulesResolveHandler
    };
  }
});

// node_modules/enhanced-resolve/lib/ModulesInHierarchicalDirectoriesPlugin.js
var require_ModulesInHierarchicalDirectoriesPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/ModulesInHierarchicalDirectoriesPlugin.js"(exports, module) {
    "use strict";
    var { modulesResolveHandler } = require_ModulesUtils();
    module.exports = class ModulesInHierarchicalDirectoriesPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {string | string[]} directories directories
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, directories, target) {
        this.source = source;
        this.directories = /** @type {string[]} */
        [...directories];
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync(
          "ModulesInHierarchicalDirectoriesPlugin",
          (request, resolveContext, callback) => {
            modulesResolveHandler(
              resolver,
              this.directories,
              target,
              request,
              resolveContext,
              callback
            );
          }
        );
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/ModulesInRootPlugin.js
var require_ModulesInRootPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/ModulesInRootPlugin.js"(exports, module) {
    "use strict";
    module.exports = class ModulesInRootPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {string} path path
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, path, target) {
        this.source = source;
        this.path = path;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync("ModulesInRootPlugin", (request, resolveContext, callback) => {
          const obj = {
            ...request,
            path: this.path,
            request: `./${request.request}`,
            module: false
          };
          resolver.doResolve(
            target,
            obj,
            `looking for modules in ${this.path}`,
            resolveContext,
            callback
          );
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/NextPlugin.js
var require_NextPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/NextPlugin.js"(exports, module) {
    "use strict";
    module.exports = class NextPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, target) {
        this.source = source;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync("NextPlugin", (request, resolveContext, callback) => {
          resolver.doResolve(target, request, null, resolveContext, callback);
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/util/fileURLToPath.js
var require_fileURLToPath = __commonJS({
  "node_modules/enhanced-resolve/lib/util/fileURLToPath.js"(exports, module) {
    "use strict";
    var CHAR_LOWERCASE_A = 97;
    var CHAR_LOWERCASE_Z = 122;
    var isWindows = typeof process !== "undefined" && process.platform === "win32";
    var forwardSlashRegEx = /\//g;
    function getPathFromURLWin32(url) {
      const { hostname } = url;
      let { pathname } = url;
      for (let n = 0; n < pathname.length; n++) {
        if (pathname[n] === "%") {
          const third = (pathname.codePointAt(n + 2) || 0) | 32;
          if (pathname[n + 1] === "2" && third === 102 || // 2f 2F (/)
          pathname[n + 1] === "5" && third === 99) {
            throw new TypeError(
              "File URL path must not include encoded \\ or / characters"
            );
          }
        }
      }
      pathname = pathname.replace(forwardSlashRegEx, "\\");
      pathname = decodeURIComponent(pathname);
      if (hostname !== "") {
        return `\\\\${hostname}${pathname}`;
      }
      const letter = (pathname.codePointAt(1) || 0) | 32;
      const sep2 = pathname.charAt(2);
      if (letter < CHAR_LOWERCASE_A || letter > CHAR_LOWERCASE_Z || sep2 !== ":") {
        throw new TypeError("File URL path must be absolute");
      }
      return pathname.slice(1);
    }
    function getPathFromURLPosix(url) {
      if (url.hostname !== "") {
        throw new TypeError('File URL host must be "localhost" or empty');
      }
      const { pathname } = url;
      for (let n = 0; n < pathname.length; n++) {
        if (pathname[n] === "%") {
          const third = (pathname.codePointAt(n + 2) || 0) | 32;
          if (pathname[n + 1] === "2" && third === 102) {
            throw new TypeError(
              "File URL path must not include encoded / characters"
            );
          }
        }
      }
      return decodeURIComponent(pathname);
    }
    function fileURLToPath(path, options) {
      const url = typeof path === "string" ? new URL(path) : path;
      if (url.protocol !== "file:") {
        throw new TypeError("The URL must be of scheme file");
      }
      const windows = options && options.windows !== void 0 ? options.windows : isWindows;
      return windows ? getPathFromURLWin32(url) : getPathFromURLPosix(url);
    }
    module.exports = fileURLToPath;
  }
});

// node_modules/enhanced-resolve/lib/util/pathToFileURL.js
var require_pathToFileURL = __commonJS({
  "node_modules/enhanced-resolve/lib/util/pathToFileURL.js"(exports, module) {
    "use strict";
    var percentRegEx = /%/g;
    var backslashRegEx = /\\/g;
    var newlineRegEx = /\n/g;
    var carriageReturnRegEx = /\r/g;
    var tabRegEx = /\t/g;
    var isWindows = typeof process !== "undefined" && process.platform === "win32";
    function encodePathChars(filepath, windows) {
      if (filepath.includes("%")) {
        filepath = filepath.replace(percentRegEx, "%25");
      }
      if (!windows && filepath.includes("\\")) {
        filepath = filepath.replace(backslashRegEx, "%5C");
      }
      if (filepath.includes("\n")) {
        filepath = filepath.replace(newlineRegEx, "%0A");
      }
      if (filepath.includes("\r")) {
        filepath = filepath.replace(carriageReturnRegEx, "%0D");
      }
      if (filepath.includes("	")) {
        filepath = filepath.replace(tabRegEx, "%09");
      }
      return filepath;
    }
    function pathToFileURL(filepath, options) {
      const windows = options && options.windows !== void 0 ? options.windows : isWindows;
      if (windows && filepath.startsWith("\\\\")) {
        const hostnameEndIndex = filepath.indexOf("\\", 2);
        if (hostnameEndIndex === -1) {
          throw new TypeError(
            `Missing UNC resource path in file path '${filepath}'`
          );
        }
        if (hostnameEndIndex === 2) {
          throw new TypeError(`Empty UNC servername in file path '${filepath}'`);
        }
        const url2 = new URL("file://");
        url2.hostname = filepath.slice(2, hostnameEndIndex);
        url2.pathname = encodePathChars(
          filepath.slice(hostnameEndIndex).replace(backslashRegEx, "/"),
          windows
        );
        return url2;
      }
      const url = new URL("file://");
      url.pathname = encodePathChars(filepath, windows);
      return url;
    }
    module.exports = pathToFileURL;
  }
});

// node_modules/enhanced-resolve/lib/util/packageMap.js
var require_packageMap = __commonJS({
  "node_modules/enhanced-resolve/lib/util/packageMap.js"(exports, module) {
    "use strict";
    var fileURLToPath = require_fileURLToPath();
    var { isInside, normalize } = require_path();
    var pathToFileURL = require_pathToFileURL();
    function createError(message, code2) {
      const error = (
        /** @type {Error & { code: string }} */
        new Error(message)
      );
      error.code = code2;
      return error;
    }
    function toPackagePath(url, base, id) {
      let parsed;
      try {
        parsed = new URL(url, base);
      } catch (_err) {
        throw createError(
          `Package map entry "${id}" has an invalid "url": ${url}`,
          "ERR_INVALID_PACKAGE_MAP"
        );
      }
      if (parsed.protocol !== "file:") {
        throw createError(
          `Package map entry "${id}" must use a "file:" url, received: ${url}`,
          "ERR_INVALID_PACKAGE_MAP"
        );
      }
      return normalize(fileURLToPath(parsed));
    }
    function parsePackageMap(data, configFilePath) {
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw createError(
          `Package map "${configFilePath}" must contain a JSON object`,
          "ERR_INVALID_PACKAGE_MAP"
        );
      }
      const rawPackages = data.packages;
      if (!rawPackages || typeof rawPackages !== "object" || Array.isArray(rawPackages)) {
        throw createError(
          `Package map "${configFilePath}" must contain a "packages" object`,
          "ERR_INVALID_PACKAGE_MAP"
        );
      }
      const base = pathToFileURL(configFilePath);
      const packages = /* @__PURE__ */ new Map();
      const idsByPath = /* @__PURE__ */ new Map();
      for (const id of Object.keys(rawPackages)) {
        const rawEntry = (
          /** @type {JsonObject} */
          rawPackages[id]
        );
        if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
          throw createError(
            `Package map entry "${id}" must be an object`,
            "ERR_INVALID_PACKAGE_MAP"
          );
        }
        if (typeof rawEntry.url !== "string" || rawEntry.url === "") {
          throw createError(
            `Package map entry "${id}" must have a non-empty string "url"`,
            "ERR_INVALID_PACKAGE_MAP"
          );
        }
        const packagePath = toPackagePath(rawEntry.url, base, id);
        const dependencies = /* @__PURE__ */ new Map();
        const rawDependencies = rawEntry.dependencies;
        if (rawDependencies !== void 0) {
          if (!rawDependencies || typeof rawDependencies !== "object" || Array.isArray(rawDependencies)) {
            throw createError(
              `Package map entry "${id}" has a non-object "dependencies"`,
              "ERR_INVALID_PACKAGE_MAP"
            );
          }
          for (const specifier of Object.keys(rawDependencies)) {
            const target = rawDependencies[specifier];
            if (typeof target !== "string") {
              throw createError(
                `Package map entry "${id}" maps "${specifier}" to a non-string package id`,
                "ERR_INVALID_PACKAGE_MAP"
              );
            }
            dependencies.set(specifier, target);
          }
        }
        packages.set(id, { id, path: packagePath, dependencies });
        const ids = idsByPath.get(packagePath);
        if (ids) {
          ids.push(id);
        } else {
          idsByPath.set(packagePath, [id]);
        }
      }
      for (const entry of packages.values()) {
        for (const [specifier, target] of entry.dependencies) {
          if (!packages.has(target)) {
            throw createError(
              `Package map entry "${entry.id}" maps "${specifier}" to unknown package id "${target}"`,
              "ERR_INVALID_PACKAGE_MAP"
            );
          }
        }
      }
      const locations = [...idsByPath].map(([path, ids]) => ({ path, ids })).sort((a, b) => b.path.length - a.path.length);
      return { packages, locations };
    }
    function findPackageIds(packageMap, filePath) {
      for (const location of packageMap.locations) {
        if (isInside(location.path, filePath)) return location.ids;
      }
      return [];
    }
    module.exports.createError = createError;
    module.exports.findPackageIds = findPackageIds;
    module.exports.parsePackageMap = parsePackageMap;
  }
});

// node_modules/enhanced-resolve/lib/PackageMapPlugin.js
var require_PackageMapPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/PackageMapPlugin.js"(exports, module) {
    "use strict";
    var { readJson } = require_fs();
    var {
      createError,
      findPackageIds,
      parsePackageMap
    } = require_packageMap();
    var PACKAGE_NAME_REGEXP = /^(@[^/]+\/)?[^/]+/;
    module.exports = class PackageMapPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {PackageMapOptions} options package map options
       * @param {boolean} symlinks whether the resolver resolves symlinks
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, options, symlinks, target) {
        this.source = source;
        this.options = options;
        this.symlinks = symlinks;
        this.target = target;
        this._packageMap = void 0;
        this._pending = void 0;
      }
      /**
       * Read and parse the configuration file once, queueing every request that
       * arrives while the read is in flight so a cold start does not re-read the
       * same file for each of them.
       * @param {Resolver} resolver the resolver
       * @param {ResolveContext} resolveContext resolve context
       * @param {PackageMapCallback} callback callback
       * @returns {void}
       */
      _getPackageMap(resolver, resolveContext, callback) {
        const { configFile, packages } = this.options;
        if (configFile && resolveContext.fileDependencies) {
          resolveContext.fileDependencies.add(configFile);
        }
        if (this._packageMap !== void 0) {
          return callback(null, this._packageMap);
        }
        if (this._pending) {
          this._pending.push(callback);
          return;
        }
        this._pending = [callback];
        const finish = (error, packageMap) => {
          const pending = (
            /** @type {PackageMapCallback[]} */
            this._pending
          );
          this._pending = void 0;
          for (const pendingCallback of pending) {
            pendingCallback(error, packageMap);
          }
        };
        this._resolveConfigFile(resolver, (realConfigFile) => {
          if (packages) {
            let packageMap;
            try {
              packageMap = parsePackageMap({ packages }, realConfigFile);
            } catch (err) {
              return finish(
                /** @type {Error} */
                err
              );
            }
            this._packageMap = packageMap;
            return finish(null, packageMap);
          }
          readJson(
            resolver.fileSystem,
            realConfigFile,
            { stripComments: false },
            (err, content) => {
              let error = err || null;
              let packageMap;
              if (!error) {
                try {
                  packageMap = parsePackageMap(
                    /** @type {import("./Resolver").JsonObject} */
                    content,
                    realConfigFile
                  );
                  this._packageMap = packageMap;
                } catch (parseErr) {
                  error = /** @type {Error} */
                  parseErr;
                }
              }
              finish(error, packageMap);
            }
          );
        });
      }
      /**
       * Hand back the configuration file path package locations resolve against:
       * its real path when the resolver follows symlinks, and the path as given
       * otherwise. A configuration file whose real path cannot be read (it may not
       * exist, or the file system may not implement it) is used as-is, so the
       * read below reports the problem.
       * @param {Resolver} resolver the resolver
       * @param {(configFile: string) => void} callback callback
       * @returns {void}
       */
      _resolveConfigFile(resolver, callback) {
        const { configFile } = this.options;
        const { realpath: realpath2 } = resolver.fileSystem;
        if (!this.symlinks || !realpath2) return callback(configFile);
        realpath2(configFile, (err, result) => {
          callback(err || !result ? configFile : String(result));
        });
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync("PackageMapPlugin", (request, resolveContext, callback) => {
          const req = request.request;
          if (!req) return callback();
          if (req.startsWith("node:")) return callback();
          const packageMatch = PACKAGE_NAME_REGEXP.exec(req);
          if (!packageMatch) return callback();
          const [packageName2] = packageMatch;
          const innerRequest = `.${req.slice(packageName2.length)}`;
          this._getPackageMap(resolver, resolveContext, (err, packageMap) => {
            if (err) return callback(err);
            const { packages } = (
              /** @type {PackageMap} */
              packageMap
            );
            const issuerPath = request.path;
            const contextId = request.context && /** @type {string | undefined} */
            request.context.packageId;
            const explicitId = request.packageId !== void 0 ? request.packageId : contextId;
            let issuerId;
            if (explicitId !== void 0 && explicitId !== null) {
              if (!packages.has(explicitId)) {
                return callback(
                  createError(
                    `Unknown package id "${explicitId}" for request "${req}"`,
                    "ERR_PACKAGE_MAP_UNKNOWN_PACKAGE"
                  )
                );
              }
              issuerId = explicitId;
            } else {
              const ids = issuerPath === false ? [] : findPackageIds(
                /** @type {PackageMap} */
                packageMap,
                issuerPath
              );
              if (ids.length === 0) {
                return callback(
                  createError(
                    `Cannot resolve "${req}" from "${issuerPath}": the importing file is not inside any package of the package map`,
                    "ERR_PACKAGE_MAP_EXTERNAL_FILE"
                  )
                );
              }
              if (ids.length > 1) {
                return callback(
                  createError(
                    `Cannot resolve "${req}" from "${issuerPath}": the package ids ${ids.map((id) => `"${id}"`).join(
                      ", "
                    )} share this location, so the importing package is ambiguous. Propagate the package id of the previous resolution to disambiguate.`,
                    "ERR_PACKAGE_MAP_AMBIGUOUS_PACKAGE"
                  )
                );
              }
              [issuerId] = ids;
            }
            const issuer = (
              /** @type {import("./util/packageMap").PackageMapEntry} */
              packages.get(issuerId)
            );
            const targetId = issuer.dependencies.get(packageName2);
            if (targetId === void 0) {
              if (resolveContext.log) {
                resolveContext.log(
                  `"${packageName2}" is not a dependency of package "${issuerId}" in the package map`
                );
              }
              return callback(null, null);
            }
            const targetEntry = (
              /** @type {import("./util/packageMap").PackageMapEntry} */
              packages.get(targetId)
            );
            const obj = {
              ...request,
              path: targetEntry.path,
              request: innerRequest,
              packageId: targetId,
              fullySpecified: request.fullySpecified && innerRequest !== "."
            };
            resolver.doResolve(
              target,
              obj,
              `resolved "${packageName2}" to package "${targetId}" by the package map`,
              resolveContext,
              (resolveErr, result) => {
                if (resolveErr) return callback(resolveErr);
                if (result) return callback(null, result);
                return callback(null, null);
              }
            );
          });
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/ParsePlugin.js
var require_ParsePlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/ParsePlugin.js"(exports, module) {
    "use strict";
    module.exports = class ParsePlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {Partial<ResolveRequest>} requestOptions request options
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, requestOptions, target) {
        this.source = source;
        this.requestOptions = requestOptions;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        const { requestOptions } = this;
        resolver.getHook(this.source).tapAsync("ParsePlugin", (request, resolveContext, callback) => {
          const parsed = resolver.parse(
            /** @type {string} */
            request.request
          );
          const obj = { ...request };
          obj.request = parsed.request;
          obj.query = parsed.query || request.query || "";
          obj.fragment = parsed.fragment || request.fragment || "";
          obj.module = parsed.module;
          obj.directory = parsed.directory;
          obj.file = parsed.file;
          obj.internal = parsed.internal;
          Object.assign(obj, requestOptions);
          if (parsed && resolveContext.log) {
            if (parsed.module) resolveContext.log("Parsed request is a module");
            if (parsed.directory) {
              resolveContext.log("Parsed request is a directory");
            }
          }
          if (obj.request && !obj.query && obj.fragment) {
            const directory = obj.fragment.endsWith("/");
            const alternative = {
              ...obj,
              directory,
              request: obj.request + (obj.directory ? "/" : "") + (directory ? obj.fragment.slice(0, -1) : obj.fragment),
              fragment: ""
            };
            resolver.doResolve(
              target,
              alternative,
              null,
              resolveContext,
              (err, result) => {
                if (err) return callback(err);
                if (result) return callback(null, result);
                resolver.doResolve(target, obj, null, resolveContext, callback);
              }
            );
            return;
          }
          resolver.doResolve(target, obj, null, resolveContext, callback);
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/PnpPlugin.js
var require_PnpPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/PnpPlugin.js"(exports, module) {
    "use strict";
    module.exports = class PnpPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {PnpApiImpl} pnpApi pnpApi
       * @param {string | ResolveStepHook} target target
       * @param {string | ResolveStepHook} alternateTarget alternateTarget
       */
      constructor(source, pnpApi, target, alternateTarget) {
        this.source = source;
        this.pnpApi = pnpApi;
        this.target = target;
        this.alternateTarget = alternateTarget;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        const alternateTarget = resolver.ensureHook(this.alternateTarget);
        resolver.getHook(this.source).tapAsync("PnpPlugin", (request, resolveContext, callback) => {
          const req = request.request;
          if (!req) return callback();
          const issuer = `${request.path}/`;
          const packageMatch = /^(@[^/]+\/)?[^/]+/.exec(req);
          if (!packageMatch) return callback();
          const [packageName2] = packageMatch;
          const innerRequest = `.${req.slice(packageName2.length)}`;
          let resolution;
          let apiResolution;
          try {
            resolution = this.pnpApi.resolveToUnqualified(packageName2, issuer, {
              considerBuiltins: false
            });
            if (resolution === null) {
              resolver.doResolve(
                alternateTarget,
                request,
                "issuer is not managed by a pnpapi",
                resolveContext,
                (err, result) => {
                  if (err) return callback(err);
                  if (result) return callback(null, result);
                  return callback(null, null);
                }
              );
              return;
            }
            if (resolveContext.fileDependencies) {
              apiResolution = this.pnpApi.resolveToUnqualified("pnpapi", issuer, {
                considerBuiltins: false
              });
            }
          } catch (error) {
            if (
              /** @type {Error & { code: string }} */
              error.code === "MODULE_NOT_FOUND" && /** @type {Error & { pnpCode: string }} */
              error.pnpCode === "UNDECLARED_DEPENDENCY"
            ) {
              if (resolveContext.log) {
                resolveContext.log("request is not managed by the pnpapi");
                for (
                  const line of
                  /** @type {Error} */
                  error.message.split("\n").filter(Boolean)
                ) {
                  resolveContext.log(`  ${line}`);
                }
              }
              return callback();
            }
            return callback(
              /** @type {Error} */
              error
            );
          }
          if (resolution === packageName2) return callback();
          if (apiResolution && resolveContext.fileDependencies) {
            resolveContext.fileDependencies.add(apiResolution);
          }
          const obj = {
            ...request,
            path: resolution,
            request: innerRequest,
            ignoreSymlinks: true,
            fullySpecified: request.fullySpecified && innerRequest !== "."
          };
          resolver.doResolve(
            target,
            obj,
            `resolved by pnp to ${resolution}`,
            resolveContext,
            (err, result) => {
              if (err) return callback(err);
              if (result) return callback(null, result);
              return callback(null, null);
            }
          );
        });
      }
    };
  }
});

// node_modules/tapable/lib/Hook.js
var require_Hook = __commonJS({
  "node_modules/tapable/lib/Hook.js"(exports, module) {
    "use strict";
    var util = __require("util");
    var deprecateContext = util.deprecate(
      () => {
      },
      "Hook.context is deprecated and will be removed"
    );
    function CALL_DELEGATE(...args) {
      this.call = this._createCall("sync");
      return this.call(...args);
    }
    function CALL_ASYNC_DELEGATE(...args) {
      this.callAsync = this._createCall("async");
      return this.callAsync(...args);
    }
    function PROMISE_DELEGATE(...args) {
      this.promise = this._createCall("promise");
      return this.promise(...args);
    }
    var Hook = class {
      constructor(args = [], name = void 0) {
        this._args = args;
        this.name = name;
        this.taps = [];
        this.interceptors = [];
        this._call = CALL_DELEGATE;
        this.call = CALL_DELEGATE;
        this._callAsync = CALL_ASYNC_DELEGATE;
        this.callAsync = CALL_ASYNC_DELEGATE;
        this._promise = PROMISE_DELEGATE;
        this.promise = PROMISE_DELEGATE;
        this._x = void 0;
        this.compile = this.compile;
        this.tap = this.tap;
        this.tapAsync = this.tapAsync;
        this.tapPromise = this.tapPromise;
      }
      compile(_options) {
        throw new Error("Abstract: should be overridden");
      }
      _createCall(type) {
        return this.compile({
          taps: this.taps,
          interceptors: this.interceptors,
          args: this._args,
          type
        });
      }
      _tap(type, options, fn) {
        if (typeof options === "string") {
          const name = options.trim();
          if (name === "") {
            throw new Error("Missing name for tap");
          }
          options = { type, fn, name };
        } else {
          if (typeof options !== "object" || options === null) {
            throw new Error("Invalid tap options");
          }
          let { name } = options;
          if (typeof name === "string") {
            name = name.trim();
          }
          if (typeof name !== "string" || name === "") {
            throw new Error("Missing name for tap");
          }
          if (typeof options.context !== "undefined") {
            deprecateContext();
          }
          let onlyName = true;
          for (const key in options) {
            if (key !== "name") {
              onlyName = false;
              break;
            }
          }
          if (onlyName) {
            options = { type, fn, name };
          } else {
            options.name = name;
            options = Object.assign({ type, fn }, options);
          }
        }
        options = this._runRegisterInterceptors(options);
        this._insert(options);
      }
      tap(options, fn) {
        this._tap("sync", options, fn);
      }
      tapAsync(options, fn) {
        this._tap("async", options, fn);
      }
      tapPromise(options, fn) {
        this._tap("promise", options, fn);
      }
      _runRegisterInterceptors(options) {
        const { interceptors } = this;
        const { length } = interceptors;
        if (length === 0) return options;
        for (let i = 0; i < length; i++) {
          const interceptor = interceptors[i];
          if (interceptor.register) {
            const newOptions = interceptor.register(options);
            if (newOptions !== void 0) {
              options = newOptions;
            }
          }
        }
        return options;
      }
      withOptions(options) {
        const mergeOptions = (opt) => Object.assign({}, options, typeof opt === "string" ? { name: opt } : opt);
        return {
          name: this.name,
          tap: (opt, fn) => this.tap(mergeOptions(opt), fn),
          tapAsync: (opt, fn) => this.tapAsync(mergeOptions(opt), fn),
          tapPromise: (opt, fn) => this.tapPromise(mergeOptions(opt), fn),
          intercept: (interceptor) => this.intercept(interceptor),
          isUsed: () => this.isUsed(),
          withOptions: (opt) => this.withOptions(mergeOptions(opt))
        };
      }
      isUsed() {
        return this.taps.length > 0 || this.interceptors.length > 0;
      }
      intercept(interceptor) {
        this._resetCompilation();
        this.interceptors.push(Object.assign({}, interceptor));
        if (interceptor.register) {
          for (let i = 0; i < this.taps.length; i++) {
            this.taps[i] = interceptor.register(this.taps[i]);
          }
        }
      }
      _resetCompilation() {
        this.call = this._call;
        this.callAsync = this._callAsync;
        this.promise = this._promise;
      }
      _insert(item) {
        this._resetCompilation();
        const { taps } = this;
        const stage = typeof item.stage === "number" ? item.stage : 0;
        if (!(typeof item.before === "string" || Array.isArray(item.before))) {
          const n = taps.length;
          if (n === 0 || (taps[n - 1].stage || 0) <= stage) {
            taps[n] = item;
            return;
          }
        }
        let before;
        if (typeof item.before === "string") {
          before = /* @__PURE__ */ new Set([item.before]);
        } else if (Array.isArray(item.before)) {
          before = new Set(item.before);
        }
        let i = taps.length;
        while (i > 0) {
          i--;
          const tap = taps[i];
          taps[i + 1] = tap;
          const xStage = tap.stage || 0;
          if (before) {
            if (before.has(tap.name)) {
              before.delete(tap.name);
              continue;
            }
            if (before.size > 0) {
              continue;
            }
          }
          if (xStage > stage) {
            continue;
          }
          i++;
          break;
        }
        taps[i] = item;
      }
    };
    Object.setPrototypeOf(Hook.prototype, null);
    module.exports = Hook;
  }
});

// node_modules/tapable/lib/HookCodeFactory.js
var require_HookCodeFactory = __commonJS({
  "node_modules/tapable/lib/HookCodeFactory.js"(exports, module) {
    "use strict";
    var HookCodeFactory = class {
      constructor(config) {
        this.config = config;
        this.options = void 0;
        this._args = void 0;
      }
      create(options) {
        this.init(options);
        let fn;
        switch (options.type) {
          case "sync":
            fn = new Function(
              this.args(),
              `"use strict";
${this.header()}${this.contentWithInterceptors({
                onError: (err) => `throw ${err};
`,
                onResult: (result) => `return ${result};
`,
                resultReturns: true,
                onDone: () => "",
                rethrowIfPossible: true
              })}`
            );
            break;
          case "async":
            fn = new Function(
              this.args({
                after: "_callback"
              }),
              `"use strict";
${this.header()}${this.contentWithInterceptors({
                onError: (err) => `_callback(${err});
`,
                onResult: (result) => `_callback(null, ${result});
`,
                onDone: () => "_callback();\n"
              })}`
            );
            break;
          case "promise": {
            let errorHelperUsed = false;
            const content = this.contentWithInterceptors({
              onError: (err) => {
                errorHelperUsed = true;
                return `_error(${err});
`;
              },
              onResult: (result) => `_resolve(${result});
`,
              onDone: () => "_resolve();\n"
            });
            let code2 = "";
            code2 += '"use strict";\n';
            code2 += this.header();
            code2 += "return new Promise((function(_resolve, _reject) {\n";
            if (errorHelperUsed) {
              code2 += "var _sync = true;\n";
              code2 += "function _error(_err) {\n";
              code2 += "if(_sync)\n";
              code2 += "_resolve(Promise.resolve().then((function() { throw _err; })));\n";
              code2 += "else\n";
              code2 += "_reject(_err);\n";
              code2 += "};\n";
            }
            code2 += content;
            if (errorHelperUsed) {
              code2 += "_sync = false;\n";
            }
            code2 += "}));\n";
            fn = new Function(this.args(), code2);
            break;
          }
        }
        this.deinit();
        return fn;
      }
      setup(instance, options) {
        const { taps } = options;
        const { length } = taps;
        const fns = Array.from({ length });
        for (let i = 0; i < length; i++) {
          fns[i] = taps[i].fn;
        }
        instance._x = fns;
      }
      /**
       * @param {{ type: "sync" | "promise" | "async", taps: Array<Tap>, interceptors: Array<Interceptor> }} options
       */
      init(options) {
        this.options = options;
        this._args = options.args;
        this._joinedArgs = void 0;
      }
      deinit() {
        this.options = void 0;
        this._args = void 0;
        this._joinedArgs = void 0;
      }
      contentWithInterceptors(options) {
        if (this.options.interceptors.length > 0) {
          const { onError, onResult, onDone } = options;
          let code2 = "";
          for (let i = 0; i < this.options.interceptors.length; i++) {
            const interceptor = this.options.interceptors[i];
            if (interceptor.call) {
              code2 += `${this.getInterceptor(i)}.call(${this.args({
                before: interceptor.context ? "_context" : void 0
              })});
`;
            }
          }
          code2 += this.content(
            Object.assign(options, {
              onError: onError && ((err) => {
                let code3 = "";
                for (let i = 0; i < this.options.interceptors.length; i++) {
                  const interceptor = this.options.interceptors[i];
                  if (interceptor.error) {
                    code3 += `${this.getInterceptor(i)}.error(${err});
`;
                  }
                }
                code3 += onError(err);
                return code3;
              }),
              onResult: onResult && ((result) => {
                let code3 = "";
                for (let i = 0; i < this.options.interceptors.length; i++) {
                  const interceptor = this.options.interceptors[i];
                  if (interceptor.result) {
                    code3 += `${this.getInterceptor(i)}.result(${result});
`;
                  }
                }
                code3 += onResult(result);
                return code3;
              }),
              onDone: onDone && (() => {
                let code3 = "";
                for (let i = 0; i < this.options.interceptors.length; i++) {
                  const interceptor = this.options.interceptors[i];
                  if (interceptor.done) {
                    code3 += `${this.getInterceptor(i)}.done();
`;
                  }
                }
                code3 += onDone();
                return code3;
              })
            })
          );
          return code2;
        }
        return this.content(options);
      }
      header() {
        let code2 = "";
        code2 += this.needContext() ? "var _context = {};\n" : "var _context;\n";
        code2 += "var _x = this._x;\n";
        if (this.options.interceptors.length > 0) {
          code2 += "var _taps = this.taps;\n";
          code2 += "var _interceptors = this.interceptors;\n";
        }
        return code2;
      }
      needContext() {
        const { taps } = this.options;
        for (let i = 0; i < taps.length; i++) {
          if (taps[i].context) return true;
        }
        return false;
      }
      callTap(tapIndex, { onError, onResult, onDone, rethrowIfPossible }) {
        let code2 = "";
        let hasTapCached = false;
        for (let i = 0; i < this.options.interceptors.length; i++) {
          const interceptor = this.options.interceptors[i];
          if (interceptor.tap) {
            if (!hasTapCached) {
              code2 += `var _tap${tapIndex} = ${this.getTap(tapIndex)};
`;
              hasTapCached = true;
            }
            code2 += `${this.getInterceptor(i)}.tap(${interceptor.context ? "_context, " : ""}_tap${tapIndex});
`;
          }
        }
        code2 += `var _fn${tapIndex} = ${this.getTapFn(tapIndex)};
`;
        const tap = this.options.taps[tapIndex];
        switch (tap.type) {
          case "sync":
            if (!rethrowIfPossible) {
              code2 += `var _hasError${tapIndex} = false;
`;
              code2 += "try {\n";
            }
            if (onResult) {
              code2 += `var _result${tapIndex} = _fn${tapIndex}(${this.args({
                before: tap.context ? "_context" : void 0
              })});
`;
            } else {
              code2 += `_fn${tapIndex}(${this.args({
                before: tap.context ? "_context" : void 0
              })});
`;
            }
            if (!rethrowIfPossible) {
              code2 += "} catch(_err) {\n";
              code2 += `_hasError${tapIndex} = true;
`;
              code2 += onError("_err");
              code2 += "}\n";
              code2 += `if(!_hasError${tapIndex}) {
`;
            }
            if (onResult) {
              code2 += onResult(`_result${tapIndex}`);
            }
            if (onDone) {
              code2 += onDone();
            }
            if (!rethrowIfPossible) {
              code2 += "}\n";
            }
            break;
          case "async": {
            let cbCode = "";
            cbCode += onResult ? `(function(_err${tapIndex}, _result${tapIndex}) {
` : `(function(_err${tapIndex}) {
`;
            cbCode += `if(_err${tapIndex}) {
`;
            cbCode += onError(`_err${tapIndex}`);
            cbCode += "} else {\n";
            if (onResult) {
              cbCode += onResult(`_result${tapIndex}`);
            }
            if (onDone) {
              cbCode += onDone();
            }
            cbCode += "}\n";
            cbCode += "})";
            code2 += `_fn${tapIndex}(${this.args({
              before: tap.context ? "_context" : void 0,
              after: cbCode
            })});
`;
            break;
          }
          case "promise":
            code2 += `var _hasResult${tapIndex} = false;
`;
            code2 += `var _promise${tapIndex} = _fn${tapIndex}(${this.args({
              before: tap.context ? "_context" : void 0
            })});
`;
            code2 += `if (!_promise${tapIndex} || !_promise${tapIndex}.then)
`;
            code2 += `  throw new Error('Tap function (tapPromise) did not return promise (returned ' + _promise${tapIndex} + ')');
`;
            code2 += `_promise${tapIndex}.then((function(_result${tapIndex}) {
`;
            code2 += `_hasResult${tapIndex} = true;
`;
            if (onResult) {
              code2 += onResult(`_result${tapIndex}`);
            }
            if (onDone) {
              code2 += onDone();
            }
            code2 += `}), function(_err${tapIndex}) {
`;
            code2 += `if(_hasResult${tapIndex}) throw _err${tapIndex};
`;
            code2 += onError(
              `!_err${tapIndex} ? new Error('Tap function (tapPromise) rejects "' + _err${tapIndex} + '" value') : _err${tapIndex}`
            );
            code2 += "});\n";
            break;
        }
        return code2;
      }
      callTapsSeries({
        onError,
        onResult,
        resultReturns,
        onDone,
        doneReturns,
        rethrowIfPossible
      }) {
        const { taps } = this.options;
        const tapsLength = taps.length;
        if (tapsLength === 0) return onDone();
        let firstAsync = -1;
        for (let i = 0; i < tapsLength; i++) {
          if (taps[i].type !== "sync") {
            firstAsync = i;
            break;
          }
        }
        const somethingReturns = resultReturns || doneReturns;
        const doneBreak = (skipDone) => {
          if (skipDone) return "";
          return onDone();
        };
        let code2 = "";
        let current = onDone;
        let unrollCounter = 0;
        for (let j = tapsLength - 1; j >= 0; j--) {
          const i = j;
          const unroll = current !== onDone && (taps[i].type !== "sync" || unrollCounter++ > 20);
          if (unroll) {
            unrollCounter = 0;
            code2 += `function _next${i}() {
`;
            code2 += current();
            code2 += "}\n";
            current = () => `${somethingReturns ? "return " : ""}_next${i}();
`;
          }
          const done = current;
          const content = this.callTap(i, {
            onError: (error) => onError(i, error, done, doneBreak),
            onResult: onResult && ((result) => onResult(i, result, done, doneBreak)),
            onDone: !onResult && done,
            rethrowIfPossible: rethrowIfPossible && (firstAsync < 0 || i < firstAsync)
          });
          current = () => content;
        }
        code2 += current();
        return code2;
      }
      callTapsLooping({ onError, onDone, rethrowIfPossible }) {
        if (this.options.taps.length === 0) return onDone();
        const syncOnly = this.options.taps.every((t) => t.type === "sync");
        let code2 = "";
        if (!syncOnly) {
          code2 += "var _looper = (function() {\n";
          code2 += "var _loopAsync = false;\n";
        }
        code2 += "var _loop;\n";
        code2 += "do {\n";
        code2 += "_loop = false;\n";
        for (let i = 0; i < this.options.interceptors.length; i++) {
          const interceptor = this.options.interceptors[i];
          if (interceptor.loop) {
            code2 += `${this.getInterceptor(i)}.loop(${this.args({
              before: interceptor.context ? "_context" : void 0
            })});
`;
          }
        }
        code2 += this.callTapsSeries({
          onError,
          onResult: (i, result, next, doneBreak) => {
            let code3 = "";
            code3 += `if(${result} !== undefined) {
`;
            code3 += "_loop = true;\n";
            if (!syncOnly) code3 += "if(_loopAsync) _looper();\n";
            code3 += doneBreak(true);
            code3 += "} else {\n";
            code3 += next();
            code3 += "}\n";
            return code3;
          },
          onDone: onDone && (() => {
            let code3 = "";
            code3 += "if(!_loop) {\n";
            code3 += onDone();
            code3 += "}\n";
            return code3;
          }),
          rethrowIfPossible: rethrowIfPossible && syncOnly
        });
        code2 += "} while(_loop);\n";
        if (!syncOnly) {
          code2 += "_loopAsync = true;\n";
          code2 += "});\n";
          code2 += "_looper();\n";
        }
        return code2;
      }
      callTapsParallel({
        onError,
        onResult,
        onDone,
        rethrowIfPossible,
        onTap = (i, run) => run()
      }) {
        const { taps } = this.options;
        const tapsLength = taps.length;
        if (tapsLength <= 1) {
          return this.callTapsSeries({
            onError,
            onResult,
            onDone,
            rethrowIfPossible
          });
        }
        const done = () => {
          if (onDone) return "if(--_counter === 0) _done();\n";
          return "--_counter;";
        };
        const doneBreak = (skipDone) => {
          if (skipDone || !onDone) return "_counter = 0;\n";
          return "_counter = 0;\n_done();\n";
        };
        let code2 = "";
        code2 += "do {\n";
        code2 += `var _counter = ${tapsLength};
`;
        if (onDone) {
          code2 += "var _done = (function() {\n";
          code2 += onDone();
          code2 += "});\n";
        }
        for (let i = 0; i < tapsLength; i++) {
          code2 += "if(_counter <= 0) break;\n";
          code2 += onTap(
            i,
            () => this.callTap(i, {
              onError: (error) => {
                let code3 = "";
                code3 += "if(_counter > 0) {\n";
                code3 += onError(i, error, done, doneBreak);
                code3 += "}\n";
                return code3;
              },
              onResult: onResult && ((result) => {
                let code3 = "";
                code3 += "if(_counter > 0) {\n";
                code3 += onResult(i, result, done, doneBreak);
                code3 += "}\n";
                return code3;
              }),
              onDone: !onResult && (() => done()),
              rethrowIfPossible
            }),
            done,
            doneBreak
          );
        }
        code2 += "} while(false);\n";
        return code2;
      }
      args({ before, after } = {}) {
        let joined = this._joinedArgs;
        if (joined === void 0) {
          joined = this._args.length === 0 ? "" : this._args.join(", ");
          this._joinedArgs = joined;
        }
        if (!before && !after) return joined;
        if (joined.length === 0) {
          if (before && after) return `${before}, ${after}`;
          return before || after;
        }
        if (before && after) return `${before}, ${joined}, ${after}`;
        if (before) return `${before}, ${joined}`;
        return `${joined}, ${after}`;
      }
      getTapFn(idx) {
        return `_x[${idx}]`;
      }
      getTap(idx) {
        return `_taps[${idx}]`;
      }
      getInterceptor(idx) {
        return `_interceptors[${idx}]`;
      }
    };
    module.exports = HookCodeFactory;
  }
});

// node_modules/tapable/lib/AsyncParallelBailHook.js
var require_AsyncParallelBailHook = __commonJS({
  "node_modules/tapable/lib/AsyncParallelBailHook.js"(exports, module) {
    "use strict";
    var Hook = require_Hook();
    var HookCodeFactory = require_HookCodeFactory();
    var AsyncParallelBailHookCodeFactory = class extends HookCodeFactory {
      content({ onError, onResult, onDone }) {
        let code2 = "";
        code2 += `var _results = new Array(${this.options.taps.length});
`;
        code2 += "var _checkDone = function() {\n";
        code2 += "for(var i = 0; i < _results.length; i++) {\n";
        code2 += "var item = _results[i];\n";
        code2 += "if(item === undefined) return false;\n";
        code2 += "if(item.result !== undefined) {\n";
        code2 += onResult("item.result");
        code2 += "return true;\n";
        code2 += "}\n";
        code2 += "if(item.error) {\n";
        code2 += onError("item.error");
        code2 += "return true;\n";
        code2 += "}\n";
        code2 += "}\n";
        code2 += "return false;\n";
        code2 += "}\n";
        code2 += this.callTapsParallel({
          onError: (i, err, done, doneBreak) => {
            let code3 = "";
            code3 += `if(${i} < _results.length && ((_results.length = ${i + 1}), (_results[${i}] = { error: ${err} }), _checkDone())) {
`;
            code3 += doneBreak(true);
            code3 += "} else {\n";
            code3 += done();
            code3 += "}\n";
            return code3;
          },
          onResult: (i, result, done, doneBreak) => {
            let code3 = "";
            code3 += `if(${i} < _results.length && (${result} !== undefined && (_results.length = ${i + 1}), (_results[${i}] = { result: ${result} }), _checkDone())) {
`;
            code3 += doneBreak(true);
            code3 += "} else {\n";
            code3 += done();
            code3 += "}\n";
            return code3;
          },
          onTap: (i, run, done, _doneBreak) => {
            let code3 = "";
            if (i > 0) {
              code3 += `if(${i} >= _results.length) {
`;
              code3 += done();
              code3 += "} else {\n";
            }
            code3 += run();
            if (i > 0) code3 += "}\n";
            return code3;
          },
          onDone
        });
        return code2;
      }
    };
    var factory = new AsyncParallelBailHookCodeFactory();
    function COMPILE(options) {
      factory.setup(this, options);
      return factory.create(options);
    }
    function AsyncParallelBailHook(args = [], name = void 0) {
      const hook = new Hook(args, name);
      hook.constructor = AsyncParallelBailHook;
      hook.compile = COMPILE;
      hook._call = void 0;
      hook.call = void 0;
      return hook;
    }
    AsyncParallelBailHook.prototype = null;
    module.exports = AsyncParallelBailHook;
  }
});

// node_modules/tapable/lib/AsyncParallelHook.js
var require_AsyncParallelHook = __commonJS({
  "node_modules/tapable/lib/AsyncParallelHook.js"(exports, module) {
    "use strict";
    var Hook = require_Hook();
    var HookCodeFactory = require_HookCodeFactory();
    var AsyncParallelHookCodeFactory = class extends HookCodeFactory {
      content({ onError, onDone }) {
        return this.callTapsParallel({
          onError: (i, err, done, doneBreak) => onError(err) + doneBreak(true),
          onDone
        });
      }
    };
    var factory = new AsyncParallelHookCodeFactory();
    function COMPILE(options) {
      factory.setup(this, options);
      return factory.create(options);
    }
    function AsyncParallelHook(args = [], name = void 0) {
      const hook = new Hook(args, name);
      hook.constructor = AsyncParallelHook;
      hook.compile = COMPILE;
      hook._call = void 0;
      hook.call = void 0;
      return hook;
    }
    AsyncParallelHook.prototype = null;
    module.exports = AsyncParallelHook;
  }
});

// node_modules/tapable/lib/AsyncSeriesBailHook.js
var require_AsyncSeriesBailHook = __commonJS({
  "node_modules/tapable/lib/AsyncSeriesBailHook.js"(exports, module) {
    "use strict";
    var Hook = require_Hook();
    var HookCodeFactory = require_HookCodeFactory();
    var AsyncSeriesBailHookCodeFactory = class extends HookCodeFactory {
      content({ onError, onResult, resultReturns, onDone }) {
        return this.callTapsSeries({
          onError: (i, err, next, doneBreak) => onError(err) + doneBreak(true),
          onResult: (i, result, next) => `if(${result} !== undefined) {
${onResult(
            result
          )}
} else {
${next()}}
`,
          resultReturns,
          onDone
        });
      }
    };
    var factory = new AsyncSeriesBailHookCodeFactory();
    function COMPILE(options) {
      factory.setup(this, options);
      return factory.create(options);
    }
    function AsyncSeriesBailHook(args = [], name = void 0) {
      const hook = new Hook(args, name);
      hook.constructor = AsyncSeriesBailHook;
      hook.compile = COMPILE;
      hook._call = void 0;
      hook.call = void 0;
      return hook;
    }
    AsyncSeriesBailHook.prototype = null;
    module.exports = AsyncSeriesBailHook;
  }
});

// node_modules/tapable/lib/AsyncSeriesHook.js
var require_AsyncSeriesHook = __commonJS({
  "node_modules/tapable/lib/AsyncSeriesHook.js"(exports, module) {
    "use strict";
    var Hook = require_Hook();
    var HookCodeFactory = require_HookCodeFactory();
    var AsyncSeriesHookCodeFactory = class extends HookCodeFactory {
      content({ onError, onDone }) {
        return this.callTapsSeries({
          onError: (i, err, next, doneBreak) => onError(err) + doneBreak(true),
          onDone
        });
      }
    };
    var factory = new AsyncSeriesHookCodeFactory();
    function COMPILE(options) {
      factory.setup(this, options);
      return factory.create(options);
    }
    function AsyncSeriesHook(args = [], name = void 0) {
      const hook = new Hook(args, name);
      hook.constructor = AsyncSeriesHook;
      hook.compile = COMPILE;
      hook._call = void 0;
      hook.call = void 0;
      return hook;
    }
    AsyncSeriesHook.prototype = null;
    module.exports = AsyncSeriesHook;
  }
});

// node_modules/tapable/lib/AsyncSeriesLoopHook.js
var require_AsyncSeriesLoopHook = __commonJS({
  "node_modules/tapable/lib/AsyncSeriesLoopHook.js"(exports, module) {
    "use strict";
    var Hook = require_Hook();
    var HookCodeFactory = require_HookCodeFactory();
    var AsyncSeriesLoopHookCodeFactory = class extends HookCodeFactory {
      content({ onError, onDone }) {
        return this.callTapsLooping({
          onError: (i, err, next, doneBreak) => onError(err) + doneBreak(true),
          onDone
        });
      }
    };
    var factory = new AsyncSeriesLoopHookCodeFactory();
    function COMPILE(options) {
      factory.setup(this, options);
      return factory.create(options);
    }
    function AsyncSeriesLoopHook(args = [], name = void 0) {
      const hook = new Hook(args, name);
      hook.constructor = AsyncSeriesLoopHook;
      hook.compile = COMPILE;
      hook._call = void 0;
      hook.call = void 0;
      return hook;
    }
    AsyncSeriesLoopHook.prototype = null;
    module.exports = AsyncSeriesLoopHook;
  }
});

// node_modules/tapable/lib/AsyncSeriesWaterfallHook.js
var require_AsyncSeriesWaterfallHook = __commonJS({
  "node_modules/tapable/lib/AsyncSeriesWaterfallHook.js"(exports, module) {
    "use strict";
    var Hook = require_Hook();
    var HookCodeFactory = require_HookCodeFactory();
    var AsyncSeriesWaterfallHookCodeFactory = class extends HookCodeFactory {
      content({ onError, onResult, _onDone }) {
        return this.callTapsSeries({
          onError: (i, err, next, doneBreak) => onError(err) + doneBreak(true),
          onResult: (i, result, next) => {
            let code2 = "";
            code2 += `if(${result} !== undefined) {
`;
            code2 += `${this._args[0]} = ${result};
`;
            code2 += "}\n";
            code2 += next();
            return code2;
          },
          onDone: () => onResult(this._args[0])
        });
      }
    };
    var factory = new AsyncSeriesWaterfallHookCodeFactory();
    function COMPILE(options) {
      factory.setup(this, options);
      return factory.create(options);
    }
    function AsyncSeriesWaterfallHook(args = [], name = void 0) {
      if (args.length < 1) {
        throw new Error("Waterfall hooks must have at least one argument");
      }
      const hook = new Hook(args, name);
      hook.constructor = AsyncSeriesWaterfallHook;
      hook.compile = COMPILE;
      hook._call = void 0;
      hook.call = void 0;
      return hook;
    }
    AsyncSeriesWaterfallHook.prototype = null;
    module.exports = AsyncSeriesWaterfallHook;
  }
});

// node_modules/tapable/lib/HookMap.js
var require_HookMap = __commonJS({
  "node_modules/tapable/lib/HookMap.js"(exports, module) {
    "use strict";
    var util = __require("util");
    var defaultFactory = (key, hook) => hook;
    var HookMap = class {
      constructor(factory, name = void 0) {
        this._map = /* @__PURE__ */ new Map();
        this.name = name;
        this._factory = factory;
        this._interceptors = [];
      }
      get(key) {
        return this._map.get(key);
      }
      for(key) {
        const map = this._map;
        const hook = map.get(key);
        if (hook !== void 0) {
          return hook;
        }
        let newHook = this._factory(key);
        const interceptors = this._interceptors;
        for (let i = 0; i < interceptors.length; i++) {
          newHook = interceptors[i].factory(key, newHook);
        }
        map.set(key, newHook);
        return newHook;
      }
      intercept(interceptor) {
        this._interceptors.push(
          Object.assign(
            {
              factory: defaultFactory
            },
            interceptor
          )
        );
      }
    };
    HookMap.prototype.tap = util.deprecate(function tap(key, options, fn) {
      return this.for(key).tap(options, fn);
    }, "HookMap#tap(key,\u2026) is deprecated. Use HookMap#for(key).tap(\u2026) instead.");
    HookMap.prototype.tapAsync = util.deprecate(function tapAsync(key, options, fn) {
      return this.for(key).tapAsync(options, fn);
    }, "HookMap#tapAsync(key,\u2026) is deprecated. Use HookMap#for(key).tapAsync(\u2026) instead.");
    HookMap.prototype.tapPromise = util.deprecate(function tapPromise(key, options, fn) {
      return this.for(key).tapPromise(options, fn);
    }, "HookMap#tapPromise(key,\u2026) is deprecated. Use HookMap#for(key).tapPromise(\u2026) instead.");
    module.exports = HookMap;
  }
});

// node_modules/tapable/lib/MultiHook.js
var require_MultiHook = __commonJS({
  "node_modules/tapable/lib/MultiHook.js"(exports, module) {
    "use strict";
    var MultiHook = class _MultiHook {
      constructor(hooks, name = void 0) {
        this.hooks = hooks;
        this.name = name;
      }
      tap(options, fn) {
        const { hooks } = this;
        for (let i = 0; i < hooks.length; i++) {
          hooks[i].tap(options, fn);
        }
      }
      tapAsync(options, fn) {
        const { hooks } = this;
        for (let i = 0; i < hooks.length; i++) {
          hooks[i].tapAsync(options, fn);
        }
      }
      tapPromise(options, fn) {
        const { hooks } = this;
        for (let i = 0; i < hooks.length; i++) {
          hooks[i].tapPromise(options, fn);
        }
      }
      isUsed() {
        const { hooks } = this;
        for (let i = 0; i < hooks.length; i++) {
          if (hooks[i].isUsed()) return true;
        }
        return false;
      }
      intercept(interceptor) {
        const { hooks } = this;
        for (let i = 0; i < hooks.length; i++) {
          hooks[i].intercept(interceptor);
        }
      }
      withOptions(options) {
        return new _MultiHook(
          this.hooks.map((hook) => hook.withOptions(options)),
          this.name
        );
      }
    };
    module.exports = MultiHook;
  }
});

// node_modules/tapable/lib/SyncBailHook.js
var require_SyncBailHook = __commonJS({
  "node_modules/tapable/lib/SyncBailHook.js"(exports, module) {
    "use strict";
    var Hook = require_Hook();
    var HookCodeFactory = require_HookCodeFactory();
    var SyncBailHookCodeFactory = class extends HookCodeFactory {
      content({ onError, onResult, resultReturns, onDone, rethrowIfPossible }) {
        return this.callTapsSeries({
          onError: (i, err) => onError(err),
          onResult: (i, result, next) => `if(${result} !== undefined) {
${onResult(
            result
          )};
} else {
${next()}}
`,
          resultReturns,
          onDone,
          rethrowIfPossible
        });
      }
    };
    var factory = new SyncBailHookCodeFactory();
    var TAP_ASYNC = () => {
      throw new Error("tapAsync is not supported on a SyncBailHook");
    };
    var TAP_PROMISE = () => {
      throw new Error("tapPromise is not supported on a SyncBailHook");
    };
    function COMPILE(options) {
      factory.setup(this, options);
      return factory.create(options);
    }
    function SyncBailHook(args = [], name = void 0) {
      const hook = new Hook(args, name);
      hook.constructor = SyncBailHook;
      hook.tapAsync = TAP_ASYNC;
      hook.tapPromise = TAP_PROMISE;
      hook.compile = COMPILE;
      return hook;
    }
    SyncBailHook.prototype = null;
    module.exports = SyncBailHook;
  }
});

// node_modules/tapable/lib/SyncHook.js
var require_SyncHook = __commonJS({
  "node_modules/tapable/lib/SyncHook.js"(exports, module) {
    "use strict";
    var Hook = require_Hook();
    var HookCodeFactory = require_HookCodeFactory();
    var SyncHookCodeFactory = class extends HookCodeFactory {
      content({ onError, onDone, rethrowIfPossible }) {
        return this.callTapsSeries({
          onError: (i, err) => onError(err),
          onDone,
          rethrowIfPossible
        });
      }
    };
    var factory = new SyncHookCodeFactory();
    var TAP_ASYNC = () => {
      throw new Error("tapAsync is not supported on a SyncHook");
    };
    var TAP_PROMISE = () => {
      throw new Error("tapPromise is not supported on a SyncHook");
    };
    function COMPILE(options) {
      factory.setup(this, options);
      return factory.create(options);
    }
    function SyncHook(args = [], name = void 0) {
      const hook = new Hook(args, name);
      hook.constructor = SyncHook;
      hook.tapAsync = TAP_ASYNC;
      hook.tapPromise = TAP_PROMISE;
      hook.compile = COMPILE;
      return hook;
    }
    SyncHook.prototype = null;
    module.exports = SyncHook;
  }
});

// node_modules/tapable/lib/SyncLoopHook.js
var require_SyncLoopHook = __commonJS({
  "node_modules/tapable/lib/SyncLoopHook.js"(exports, module) {
    "use strict";
    var Hook = require_Hook();
    var HookCodeFactory = require_HookCodeFactory();
    var SyncLoopHookCodeFactory = class extends HookCodeFactory {
      content({ onError, onDone, rethrowIfPossible }) {
        return this.callTapsLooping({
          onError: (i, err) => onError(err),
          onDone,
          rethrowIfPossible
        });
      }
    };
    var factory = new SyncLoopHookCodeFactory();
    var TAP_ASYNC = () => {
      throw new Error("tapAsync is not supported on a SyncLoopHook");
    };
    var TAP_PROMISE = () => {
      throw new Error("tapPromise is not supported on a SyncLoopHook");
    };
    function COMPILE(options) {
      factory.setup(this, options);
      return factory.create(options);
    }
    function SyncLoopHook(args = [], name = void 0) {
      const hook = new Hook(args, name);
      hook.constructor = SyncLoopHook;
      hook.tapAsync = TAP_ASYNC;
      hook.tapPromise = TAP_PROMISE;
      hook.compile = COMPILE;
      return hook;
    }
    SyncLoopHook.prototype = null;
    module.exports = SyncLoopHook;
  }
});

// node_modules/tapable/lib/SyncWaterfallHook.js
var require_SyncWaterfallHook = __commonJS({
  "node_modules/tapable/lib/SyncWaterfallHook.js"(exports, module) {
    "use strict";
    var Hook = require_Hook();
    var HookCodeFactory = require_HookCodeFactory();
    var SyncWaterfallHookCodeFactory = class extends HookCodeFactory {
      content({ onError, onResult, resultReturns, rethrowIfPossible }) {
        return this.callTapsSeries({
          onError: (i, err) => onError(err),
          onResult: (i, result, next) => {
            let code2 = "";
            code2 += `if(${result} !== undefined) {
`;
            code2 += `${this._args[0]} = ${result};
`;
            code2 += "}\n";
            code2 += next();
            return code2;
          },
          onDone: () => onResult(this._args[0]),
          doneReturns: resultReturns,
          rethrowIfPossible
        });
      }
    };
    var factory = new SyncWaterfallHookCodeFactory();
    var TAP_ASYNC = () => {
      throw new Error("tapAsync is not supported on a SyncWaterfallHook");
    };
    var TAP_PROMISE = () => {
      throw new Error("tapPromise is not supported on a SyncWaterfallHook");
    };
    function COMPILE(options) {
      factory.setup(this, options);
      return factory.create(options);
    }
    function SyncWaterfallHook(args = [], name = void 0) {
      if (args.length < 1) {
        throw new Error("Waterfall hooks must have at least one argument");
      }
      const hook = new Hook(args, name);
      hook.constructor = SyncWaterfallHook;
      hook.tapAsync = TAP_ASYNC;
      hook.tapPromise = TAP_PROMISE;
      hook.compile = COMPILE;
      return hook;
    }
    SyncWaterfallHook.prototype = null;
    module.exports = SyncWaterfallHook;
  }
});

// node_modules/tapable/lib/index.js
var require_lib = __commonJS({
  "node_modules/tapable/lib/index.js"(exports, module) {
    "use strict";
    module.exports.AsyncParallelBailHook = require_AsyncParallelBailHook();
    module.exports.AsyncParallelHook = require_AsyncParallelHook();
    module.exports.AsyncSeriesBailHook = require_AsyncSeriesBailHook();
    module.exports.AsyncSeriesHook = require_AsyncSeriesHook();
    module.exports.AsyncSeriesLoopHook = require_AsyncSeriesLoopHook();
    module.exports.AsyncSeriesWaterfallHook = require_AsyncSeriesWaterfallHook();
    module.exports.HookMap = require_HookMap();
    module.exports.MultiHook = require_MultiHook();
    module.exports.SyncBailHook = require_SyncBailHook();
    module.exports.SyncHook = require_SyncHook();
    module.exports.SyncLoopHook = require_SyncLoopHook();
    module.exports.SyncWaterfallHook = require_SyncWaterfallHook();
    module.exports.__esModule = true;
  }
});

// node_modules/enhanced-resolve/lib/createInnerContext.js
var require_createInnerContext = __commonJS({
  "node_modules/enhanced-resolve/lib/createInnerContext.js"(exports, module) {
    "use strict";
    module.exports = function createInnerContext(parent, stack, message) {
      const parentLog = parent.log;
      let innerLog;
      if (parentLog) {
        if (message) {
          let messageReported = false;
          innerLog = (msg) => {
            if (!messageReported) {
              parentLog(message);
              messageReported = true;
            }
            parentLog(`  ${msg}`);
          };
        } else {
          innerLog = parentLog;
        }
      }
      return {
        log: innerLog,
        yield: parent.yield,
        fileDependencies: parent.fileDependencies,
        contextDependencies: parent.contextDependencies,
        missingDependencies: parent.missingDependencies,
        stack
      };
    };
  }
});

// node_modules/enhanced-resolve/lib/Resolver.js
var require_Resolver = __commonJS({
  "node_modules/enhanced-resolve/lib/Resolver.js"(exports, module) {
    "use strict";
    var { AsyncSeriesBailHook, AsyncSeriesHook, SyncHook } = require_lib();
    var createInnerContext = require_createInnerContext();
    var { parseIdentifier } = require_identifier();
    var {
      PathType,
      createCachedBasename,
      createCachedDirname,
      createCachedJoin,
      getType,
      isFileURL,
      normalize,
      toPath
    } = require_path();
    var _withResolvers = (
      // eslint-disable-next-line n/no-unsupported-features/es-syntax
      Promise.withResolvers ? (
        /**
        * @param {Resolver} self resolver
        * @param {Context} context context information object
        * @param {string | URL} path context path or a `file:` URL instance
        * @param {string | URL} request request string or a `file:` URL instance
        * @param {ResolveContext} resolveContext resolve context
        * @returns {Promise<string | false>} result
        */
        (self, context, path, request, resolveContext) => {
          const { promise, resolve: resolve2, reject } = Promise.withResolvers();
          self.resolve(context, path, request, resolveContext, (err, res) => {
            if (err) reject(err);
            else resolve2(
              /** @type {string | false} */
              res
            );
          });
          return promise;
        }
      ) : (
        /**
        * @param {Resolver} self resolver
        * @param {Context} context context information object
        * @param {string | URL} path context path or a `file:` URL instance
        * @param {string | URL} request request string or a `file:` URL instance
        * @param {ResolveContext} resolveContext resolve context
        * @returns {Promise<string | false>} result
        */
        (self, context, path, request, resolveContext) => new Promise((resolve2, reject) => {
          self.resolve(context, path, request, resolveContext, (err, res) => {
            if (err) reject(err);
            else resolve2(
              /** @type {string | false} */
              res
            );
          });
        })
      )
    );
    var _pathCacheByFs = /* @__PURE__ */ new WeakMap();
    var HASH_ESCAPE_RE = /#/g;
    var StackEntry = class {
      /**
       * @param {ResolveStepHook} hook hook
       * @param {ResolveRequest} request request
       * @param {StackEntry=} parent previous tip
       * @param {Set<string>=} preSeeded entries pre-seeded via the legacy `Set<string>` API
       */
      constructor(hook, request, parent, preSeeded) {
        this.name = hook.name;
        this.path = request.path;
        this.request = request.request || "";
        this.query = request.query || "";
        this.fragment = request.fragment || "";
        this.directory = Boolean(request.directory);
        this.module = Boolean(request.module);
        this.parent = parent;
        this.preSeeded = preSeeded;
      }
      /**
       * Walk the linked list looking for an entry with the same request shape.
       * Set-compatible: callers that used `stack.has(entry)` keep working.
       *
       * NOTE: kept monomorphic on purpose. An earlier draft accepted a string
       * query too (so pre-5.21 plugins keeping their own `Set<string>` of
       * seen entries could probe the live stack with the formatted form),
       * but adding the second shape regressed `doResolve`'s heap profile by
       * ~1 MiB / 200 resolves on stack-churn — V8 keeps a polymorphic
       * call-site state for `parent.has(stackEntry)` once `has` has two
       * argument shapes. Plugins that need string membership can reach for
       * `[...stack].find(e => e.includes(formattedString))` via the
       * `String`-method proxies on `StackEntry` instead.
       * @param {StackEntry} query entry to look for
       * @returns {boolean} whether the stack already contains an equivalent entry
       */
      has(query) {
        let node = this;
        while (node) {
          if (node.name === query.name && node.path === query.path && node.request === query.request && node.query === query.query && node.fragment === query.fragment && node.directory === query.directory && node.module === query.module) {
            return true;
          }
          node = node.parent;
        }
        return this.preSeeded !== void 0 && this.preSeeded.has(query.toString());
      }
      /**
       * Number of entries on the stack (oldest-to-newest length).
       * @returns {number} size
       */
      get size() {
        let count = this.preSeeded ? this.preSeeded.size : 0;
        let node = this;
        while (node) {
          count++;
          node = node.parent;
        }
        return count;
      }
      /**
       * Iterate entries from oldest (root) to newest (tip), matching how a
       * `Set` that was populated in insertion order would iterate. Pre-seeded
       * legacy `Set<string>` entries come first so error-message output stays
       * ordered oldest-to-newest.
       *
       * Yields each entry as its formatted `toString()` form. Plugins written
       * against the pre-5.21 `Set<string>` shape — e.g.
       * `[...resolveContext.stack].find(a => a.includes("module:"))` — keep
       * working unchanged because each yielded value is a plain string with
       * all of `String.prototype` available natively. Resolves that never
       * iterate the stack pay nothing; iteration costs one `toString()`
       * allocation per stack frame.
       * @returns {IterableIterator<string>} iterator
       */
      *[Symbol.iterator]() {
        if (this.preSeeded !== void 0) {
          for (const entry of this.preSeeded) yield entry;
        }
        const entries = [];
        let node = this;
        while (node) {
          entries.push(node);
          node = node.parent;
        }
        for (let i = entries.length - 1; i >= 0; i--) yield entries[i].toString();
      }
      /**
       * Human-readable form used in recursion error messages, logs, and the
       * iterator above. Not memoized: caching would require an extra slot on
       * every `StackEntry`, which costs heap even on resolves that never look
       * at the formatted form.
       * @returns {string} formatted entry
       */
      toString() {
        return `${this.name}: (${this.path}) ${this.request}${this.query}${this.fragment}${this.directory ? " directory" : ""}${this.module ? " module" : ""}`;
      }
    };
    function toCamelCase(str) {
      return str.replace(/-([a-z])/g, (str2) => str2.slice(1).toUpperCase());
    }
    var Resolver = class _Resolver {
      /**
       * @param {ResolveStepHook} hook hook
       * @param {ResolveRequest} request request
       * @param {StackEntry=} parent previous tip of the stack
       * @param {Set<string>=} preSeeded entries pre-seeded via the legacy `Set<string>` API
       * @returns {StackEntry} stack entry
       */
      static createStackEntry(hook, request, parent, preSeeded) {
        return new StackEntry(hook, request, parent, preSeeded);
      }
      /**
       * @param {FileSystem} fileSystem a filesystem
       * @param {ResolveOptions} options options
       */
      constructor(fileSystem, options) {
        this.fileSystem = fileSystem;
        this.options = options;
        let pathCache = _pathCacheByFs.get(fileSystem);
        if (!pathCache) {
          pathCache = {
            join: createCachedJoin(),
            dirname: createCachedDirname(),
            basename: createCachedBasename()
          };
          _pathCacheByFs.set(fileSystem, pathCache);
        }
        this.pathCache = pathCache;
        this.hooks = {
          resolveStep: new SyncHook(["hook", "request"], "resolveStep"),
          noResolve: new SyncHook(["request", "error"], "noResolve"),
          resolve: new AsyncSeriesBailHook(
            ["request", "resolveContext"],
            "resolve"
          ),
          result: new AsyncSeriesHook(["result", "resolveContext"], "result")
        };
      }
      /**
       * @param {string | ResolveStepHook} name hook name or hook itself
       * @returns {ResolveStepHook} the hook
       */
      ensureHook(name) {
        if (typeof name !== "string") {
          return name;
        }
        name = toCamelCase(name);
        if (name.startsWith("before")) {
          return (
            /** @type {ResolveStepHook} */
            this.ensureHook(name[6].toLowerCase() + name.slice(7)).withOptions({
              stage: -10
            })
          );
        }
        if (name.startsWith("after")) {
          return (
            /** @type {ResolveStepHook} */
            this.ensureHook(name[5].toLowerCase() + name.slice(6)).withOptions({
              stage: 10
            })
          );
        }
        const hook = (
          /** @type {KnownHooks & EnsuredHooks} */
          this.hooks[name]
        );
        if (!hook) {
          this.hooks[name] = new AsyncSeriesBailHook(
            ["request", "resolveContext"],
            name
          );
          return (
            /** @type {KnownHooks & EnsuredHooks} */
            this.hooks[name]
          );
        }
        return hook;
      }
      /**
       * @param {string | ResolveStepHook} name hook name or hook itself
       * @returns {ResolveStepHook} the hook
       */
      getHook(name) {
        if (typeof name !== "string") {
          return name;
        }
        name = toCamelCase(name);
        if (name.startsWith("before")) {
          return (
            /** @type {ResolveStepHook} */
            this.getHook(name[6].toLowerCase() + name.slice(7)).withOptions({
              stage: -10
            })
          );
        }
        if (name.startsWith("after")) {
          return (
            /** @type {ResolveStepHook} */
            this.getHook(name[5].toLowerCase() + name.slice(6)).withOptions({
              stage: 10
            })
          );
        }
        const hook = (
          /** @type {KnownHooks & EnsuredHooks} */
          this.hooks[name]
        );
        if (!hook) {
          throw new Error(`Hook ${name} doesn't exist`);
        }
        return hook;
      }
      /**
       * @overload
       * @param {string | URL} parent context path or a `file:` URL
       * @param {string | URL} specifier request string or a `file:` URL
       * @param {ResolveContext=} resolveContext resolve context
       * @returns {string | false} result
       */
      /**
       * @overload
       * @param {Context} context context information object
       * @param {string | URL} parent context path or a `file:` URL
       * @param {string | URL} specifier request string or a `file:` URL
       * @param {ResolveContext=} resolveContext resolve context
       * @returns {string | false} result
       */
      /**
       * @param {Context | string | URL} context context information object, or the context path (a path or a `file:` URL) when no context is provided
       * @param {string | URL | ResolveContext=} parent context path (a path or a `file:` URL) or resolve context when no context is provided
       * @param {string | URL | ResolveContext=} specifier request string (or a `file:` URL) or resolve context when no context is provided
       * @param {ResolveContext=} resolveContext resolve context
       * @returns {string | false} result
       */
      resolveSync(context, parent, specifier, resolveContext) {
        let err;
        let result;
        let sync = false;
        this.resolve(
          /** @type {Context} */
          context,
          /** @type {string} */
          parent,
          /** @type {string} */
          specifier,
          /** @type {ResolveContext} */
          resolveContext || {},
          (_err, r) => {
            err = _err;
            result = r;
            sync = true;
          }
        );
        if (!sync) {
          throw new Error(
            "Cannot 'resolveSync' because the fileSystem is not sync. Use 'resolve'!"
          );
        }
        if (err) throw err;
        if (result === void 0) throw new Error("No result");
        return result;
      }
      /**
       * @overload
       * @param {string | URL} parent context path or a `file:` URL
       * @param {string | URL} specifier request string or a `file:` URL
       * @param {ResolveContext=} resolveContext resolve context
       * @returns {Promise<string | false>} result
       */
      /**
       * @overload
       * @param {Context} context context information object
       * @param {string | URL} parent context path or a `file:` URL
       * @param {string | URL} specifier request string or a `file:` URL
       * @param {ResolveContext=} resolveContext resolve context
       * @returns {Promise<string | false>} result
       */
      /**
       * @param {Context | string | URL} context context information object, or the context path (a path or a `file:` URL) when no context is provided
       * @param {string | URL | ResolveContext=} parent context path (a path or a `file:` URL) or resolve context when no context is provided
       * @param {string | URL | ResolveContext=} specifier request string (or a `file:` URL) or resolve context when no context is provided
       * @param {ResolveContext=} resolveContext resolve context
       * @returns {Promise<string | false>} result
       */
      resolvePromise(context, parent, specifier, resolveContext) {
        return _withResolvers(
          this,
          /** @type {Context} */
          context,
          /** @type {string} */
          parent,
          /** @type {string} */
          specifier,
          /** @type {ResolveContext} */
          resolveContext || {}
        );
      }
      /**
       * @overload
       * @param {string | URL} parent context path or a `file:` URL
       * @param {string | URL} specifier request string or a `file:` URL
       * @param {ResolveCallback} callback callback function
       * @returns {void}
       */
      /**
       * @overload
       * @param {string | URL} parent context path or a `file:` URL
       * @param {string | URL} specifier request string or a `file:` URL
       * @param {ResolveContext} resolveContext resolve context
       * @param {ResolveCallback} callback callback function
       * @returns {void}
       */
      /**
       * @overload
       * @param {Context} context context information object
       * @param {string | URL} parent context path or a `file:` URL
       * @param {string | URL} specifier request string or a `file:` URL
       * @param {ResolveCallback} callback callback function
       * @returns {void}
       */
      /**
       * @overload
       * @param {Context} context context information object
       * @param {string | URL} parent context path or a `file:` URL
       * @param {string | URL} specifier request string or a `file:` URL
       * @param {ResolveContext} resolveContext resolve context
       * @param {ResolveCallback} callback callback function
       * @returns {void}
       */
      /**
       * @param {Context | string | URL} context context information object, or the context path (a path or a `file:` URL) when no context is provided
       * @param {string | URL | ResolveContext | ResolveCallback=} parent context path (a path or a `file:` URL) or (when no context) resolve context or callback
       * @param {string | URL | ResolveContext | ResolveCallback=} specifier request string (or a `file:` URL) or (when no context) resolve context or callback
       * @param {ResolveContext | ResolveCallback=} resolveContext resolve context or callback when no resolve context is provided
       * @param {ResolveCallback=} callback callback function
       * @returns {void}
       */
      resolve(context, parent, specifier, resolveContext, callback) {
        if (typeof callback === "function" && typeof context === "object" && context !== null && typeof resolveContext === "object" && resolveContext !== null) {
        } else {
          if (typeof context === "string" || context instanceof URL) {
            if (typeof callback !== "function") {
              callback = /** @type {ResolveCallback | undefined} */
              resolveContext;
            }
            resolveContext = /** @type {ResolveContext | ResolveCallback | undefined} */
            specifier;
            specifier = /** @type {string} */
            parent;
            parent = context;
            context = {};
          }
          if (typeof resolveContext === "function") {
            callback = resolveContext;
            resolveContext = {};
          } else if (!resolveContext || typeof resolveContext !== "object") {
            resolveContext = {};
          }
          if (typeof callback !== "function") {
            throw new TypeError("callback argument is not a function");
          }
          if (!context || typeof context !== "object") {
            context = {};
          }
        }
        if (typeof parent !== "string") {
          if (parent instanceof URL) parent = toPath(parent);
          else return callback(new Error("path argument is not a string"));
        } else if (isFileURL(parent)) {
          parent = toPath(parent);
        }
        if (typeof specifier !== "string") {
          if (specifier instanceof URL) specifier = toPath(specifier);
          else return callback(new Error("request argument is not a string"));
        }
        const obj = {
          context,
          path: parent,
          request: specifier
        };
        let yield_;
        let yieldCalled = false;
        let finishYield;
        if (typeof resolveContext.yield === "function") {
          const old = resolveContext.yield;
          yield_ = (obj2) => {
            old(obj2);
            yieldCalled = true;
          };
          finishYield = (result) => {
            if (result) {
              yield_(result);
            }
            callback(null);
          };
        }
        const finishResolved = (result) => {
          const resultPath = result.path;
          if (resultPath === false) return callback(null, false, result);
          const escapedPath = resultPath.includes("#") ? resultPath.replace(HASH_ESCAPE_RE, "\0#") : resultPath;
          const resultQuery = result.query;
          let escapedQuery;
          if (resultQuery) {
            escapedQuery = resultQuery.includes("#") ? resultQuery.replace(HASH_ESCAPE_RE, "\0#") : resultQuery;
          } else {
            escapedQuery = "";
          }
          return callback(
            null,
            `${escapedPath}${escapedQuery}${result.fragment || ""}`,
            result
          );
        };
        const finishWithoutResolve = (message, log) => {
          const error = new Error(`Can't ${message}`);
          error.details = log.join("\n");
          this.hooks.noResolve.call(obj, error);
          return callback(error);
        };
        if (resolveContext.log) {
          const message = `resolve '${specifier}' in '${parent}'`;
          const parentLog = resolveContext.log;
          const log = [];
          return this.doResolve(
            this.hooks.resolve,
            obj,
            message,
            {
              log: (msg) => {
                parentLog(msg);
                log.push(msg);
              },
              yield: yield_,
              fileDependencies: resolveContext.fileDependencies,
              contextDependencies: resolveContext.contextDependencies,
              missingDependencies: resolveContext.missingDependencies,
              stack: resolveContext.stack
            },
            (err, result) => {
              if (err) return callback(err);
              if (yieldCalled || result && yield_) {
                return (
                  /** @type {ResolveContextYield} */
                  finishYield(
                    /** @type {ResolveRequest} */
                    result
                  )
                );
              }
              if (result) return finishResolved(result);
              return finishWithoutResolve(message, log);
            }
          );
        }
        const rc = yield_ ? {
          log: void 0,
          yield: yield_,
          fileDependencies: resolveContext.fileDependencies,
          contextDependencies: resolveContext.contextDependencies,
          missingDependencies: resolveContext.missingDependencies,
          stack: resolveContext.stack
        } : resolveContext;
        return this.doResolve(this.hooks.resolve, obj, null, rc, (err, result) => {
          if (err) return callback(err);
          if (yieldCalled || result && yield_) {
            return (
              /** @type {ResolveContextYield} */
              finishYield(
                /** @type {ResolveRequest} */
                result
              )
            );
          }
          if (result) return finishResolved(result);
          const message = `resolve '${specifier}' in '${parent}'`;
          const log = [];
          return this.doResolve(
            this.hooks.resolve,
            obj,
            message,
            {
              log: (msg) => log.push(msg),
              yield: yield_,
              stack: resolveContext.stack
            },
            (err2, result2) => {
              if (err2) return callback(err2);
              if (yieldCalled || result2 && yield_) {
                return (
                  /** @type {ResolveContextYield} */
                  finishYield(
                    /** @type {ResolveRequest} */
                    result2
                  )
                );
              }
              return finishWithoutResolve(message, log);
            }
          );
        });
      }
      /**
       * @param {ResolveStepHook} hook hook
       * @param {ResolveRequest} request request
       * @param {null | string} message string
       * @param {ResolveContext} resolveContext resolver context
       * @param {(err?: null | Error, result?: ResolveRequest) => void} callback callback
       * @returns {void}
       */
      doResolve(hook, request, message, resolveContext, callback) {
        const rawStack = resolveContext.stack;
        let parent;
        let preSeeded;
        if (rawStack instanceof StackEntry) {
          parent = rawStack;
          preSeeded = rawStack.preSeeded;
        } else if (rawStack) {
          preSeeded = /** @type {Set<string>} */
          rawStack;
        }
        const stackEntry = _Resolver.createStackEntry(
          hook,
          request,
          parent,
          preSeeded
        );
        if (parent !== void 0 ? parent.has(stackEntry) : preSeeded !== void 0 && preSeeded.has(stackEntry.toString())) {
          const recursionError = new Error(
            `Recursion in resolving
Stack:
  ${[...stackEntry].join("\n  ")}`
          );
          recursionError.recursion = true;
          if (resolveContext.log) {
            resolveContext.log("abort resolving because of recursion");
          }
          return callback(recursionError);
        }
        this.hooks.resolveStep.call(hook, request);
        if (hook.isUsed()) {
          if (!resolveContext.log && rawStack instanceof StackEntry) {
            resolveContext.stack = stackEntry;
            return hook.callAsync(request, resolveContext, (err, result) => {
              resolveContext.stack = rawStack;
              if (err) return callback(err);
              if (result) return callback(null, result);
              callback();
            });
          }
          const innerContext = createInnerContext(
            resolveContext,
            stackEntry,
            message
          );
          return hook.callAsync(request, innerContext, (err, result) => {
            if (err) return callback(err);
            if (result) return callback(null, result);
            callback();
          });
        }
        callback();
      }
      /**
       * @param {string} identifier identifier
       * @returns {ParsedIdentifier} parsed identifier
       */
      parse(identifier) {
        const part = {
          request: "",
          query: "",
          fragment: "",
          module: false,
          directory: false,
          file: false,
          internal: false
        };
        const parsedIdentifier = parseIdentifier(identifier);
        if (!parsedIdentifier) return part;
        [part.request, part.query, part.fragment] = parsedIdentifier;
        if (part.request.length > 0) {
          const requestType = getType(part.request);
          part.module = requestType === PathType.Normal;
          part.internal = identifier === part.request ? requestType === PathType.Internal : getType(identifier) === PathType.Internal;
          part.directory = part.request.endsWith("/");
          if (part.directory) {
            part.request = part.request.slice(0, -1);
          }
        }
        return part;
      }
      /**
       * @param {string} path path
       * @returns {boolean} true, if the path is a module
       */
      isModule(path) {
        return getType(path) === PathType.Normal;
      }
      /**
       * @param {string} path path
       * @returns {boolean} true, if the path is private
       */
      isPrivate(path) {
        return getType(path) === PathType.Internal;
      }
      /**
       * @param {string} path a path
       * @returns {boolean} true, if the path is a directory path
       */
      isDirectory(path) {
        return path.endsWith("/");
      }
      /**
       * @param {string} path path
       * @returns {string} normalized path
       */
      normalize(path) {
        return normalize(path);
      }
      /**
       * @param {string} path path
       * @param {string} request request
       * @returns {string} joined path
       */
      join(path, request) {
        return this.pathCache.join.fn(path, request);
      }
      /**
       * @param {string} path path
       * @returns {string} parent directory
       */
      dirname(path) {
        return this.pathCache.dirname.fn(path);
      }
      /**
       * @param {string} path the path to evaluate
       * @param {string=} suffix an extension to remove from the result
       * @returns {string} the last portion of a path
       */
      basename(path, suffix) {
        return this.pathCache.basename.fn(path, suffix);
      }
    };
    module.exports = Resolver;
  }
});

// node_modules/enhanced-resolve/lib/RestrictionsPlugin.js
var require_RestrictionsPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/RestrictionsPlugin.js"(exports, module) {
    "use strict";
    var { isInside, normalize } = require_path();
    module.exports = class RestrictionsPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {Set<string | RegExp>} restrictions restrictions
       */
      constructor(source, restrictions) {
        this.source = source;
        this.restrictions = restrictions;
        this._restrictions = [];
        for (const rule of restrictions) {
          this._restrictions.push(
            typeof rule === "string" ? { type: "path", rule: normalize(rule) } : { type: "regexp", rule }
          );
        }
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        resolver.getHook(this.source).tapAsync("RestrictionsPlugin", (request, resolveContext, callback) => {
          if (typeof request.path === "string") {
            const { path } = request;
            for (const restriction of this._restrictions) {
              if (restriction.type === "path") {
                if (isInside(restriction.rule, path)) continue;
                if (resolveContext.log) {
                  resolveContext.log(
                    `${path} is not inside of the restriction ${restriction.rule}`
                  );
                }
              } else {
                if (restriction.rule.test(path)) continue;
                if (resolveContext.log) {
                  resolveContext.log(
                    `${path} doesn't match the restriction ${restriction.rule}`
                  );
                }
              }
              if (request.__restrictionsMarker) {
                request.__restrictionsMarker.blocked = true;
              }
              return callback(null, null);
            }
          }
          callback();
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/ResultPlugin.js
var require_ResultPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/ResultPlugin.js"(exports, module) {
    "use strict";
    module.exports = class ResultPlugin {
      /**
       * @param {ResolveStepHook} source source
       */
      constructor(source) {
        this.source = source;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        this.source.tapAsync(
          "ResultPlugin",
          (request, resolverContext, callback) => {
            const obj = { ...request };
            if (resolverContext.log) {
              resolverContext.log(`reporting result ${obj.path}`);
            }
            resolver.hooks.result.callAsync(obj, resolverContext, (err) => {
              if (err) return callback(err);
              if (typeof resolverContext.yield === "function") {
                resolverContext.yield(obj);
                callback(null, null);
              } else {
                callback(null, obj);
              }
            });
          }
        );
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/RootsPlugin.js
var require_RootsPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/RootsPlugin.js"(exports, module) {
    "use strict";
    var forEachBail = require_forEachBail();
    var RootsPlugin = class {
      /**
       * @param {string | ResolveStepHook} source source hook
       * @param {Set<string>} roots roots
       * @param {string | ResolveStepHook} target target hook
       */
      constructor(source, roots, target) {
        this.roots = [...roots];
        this.source = source;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync("RootsPlugin", (request, resolveContext, callback) => {
          const req = request.request;
          if (!req) return callback();
          if (!req.startsWith("/")) return callback();
          forEachBail(
            this.roots,
            /**
             * @param {string} root root
             * @param {(err?: null | Error, result?: null | ResolveRequest) => void} callback callback
             * @returns {void}
             */
            (root, callback2) => {
              const path = resolver.join(root, req.slice(1));
              const obj = {
                ...request,
                path,
                relativePath: request.relativePath && path
              };
              resolver.doResolve(
                target,
                obj,
                `root path ${root}`,
                resolveContext,
                callback2
              );
            },
            callback
          );
        });
      }
    };
    module.exports = RootsPlugin;
  }
});

// node_modules/enhanced-resolve/lib/SelfReferencePlugin.js
var require_SelfReferencePlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/SelfReferencePlugin.js"(exports, module) {
    "use strict";
    var DescriptionFileUtils = require_DescriptionFileUtils();
    var slashCode = "/".charCodeAt(0);
    var NO_SELF_REF = /* @__PURE__ */ Symbol("NoSelfRef");
    module.exports = class SelfReferencePlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {string | string[]} fieldNamePath name path
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, fieldNamePath, target) {
        this.source = source;
        this.target = target;
        this.fieldName = fieldNamePath;
        this._nameCache = /* @__PURE__ */ new WeakMap();
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync("SelfReferencePlugin", (request, resolveContext, callback) => {
          if (!request.descriptionFileData) return callback();
          const req = request.request;
          if (!req) return callback();
          const { descriptionFileData } = request;
          let name = this._nameCache.get(descriptionFileData);
          if (name === void 0) {
            const exportsField = DescriptionFileUtils.getField(
              descriptionFileData,
              this.fieldName
            );
            if (!exportsField) {
              this._nameCache.set(descriptionFileData, NO_SELF_REF);
              return callback();
            }
            const rawName = DescriptionFileUtils.getField(
              descriptionFileData,
              "name"
            );
            if (typeof rawName !== "string") {
              this._nameCache.set(descriptionFileData, NO_SELF_REF);
              return callback();
            }
            name = rawName;
            this._nameCache.set(descriptionFileData, name);
          } else if (name === NO_SELF_REF) {
            return callback();
          }
          if (req.startsWith(name) && (req.length === name.length || req.charCodeAt(name.length) === slashCode)) {
            const remainingRequest = `.${req.slice(name.length)}`;
            const obj = {
              ...request,
              request: remainingRequest,
              path: (
                /** @type {string} */
                request.descriptionFileRoot
              ),
              relativePath: "."
            };
            resolver.doResolve(
              target,
              obj,
              "self reference",
              resolveContext,
              callback
            );
          } else {
            return callback();
          }
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/SymlinkPlugin.js
var require_SymlinkPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/SymlinkPlugin.js"(exports, module) {
    "use strict";
    var forEachBail = require_forEachBail();
    var { getPathsCached } = require_getPaths();
    var { PathType, getType } = require_path();
    module.exports = class SymlinkPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, target) {
        this.source = source;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        const fs = resolver.fileSystem;
        resolver.getHook(this.source).tapAsync("SymlinkPlugin", (request, resolveContext, callback) => {
          if (request.ignoreSymlinks) return callback();
          const pathsResult = getPathsCached(
            fs,
            /** @type {string} */
            request.path
          );
          const { paths, segments } = pathsResult;
          let pathSegments = null;
          let containsSymlink = false;
          let idx = -1;
          forEachBail(
            paths,
            /**
             * @param {string} path path
             * @param {(err?: null | Error, result?: null | number) => void} callback callback
             * @returns {void}
             */
            (path, callback2) => {
              idx++;
              if (resolveContext.fileDependencies) {
                resolveContext.fileDependencies.add(path);
              }
              fs.readlink(path, (err, result) => {
                if (!err && result) {
                  if (pathSegments === null) {
                    pathSegments = [...segments];
                  }
                  pathSegments[idx] = /** @type {string} */
                  result;
                  containsSymlink = true;
                  const resultType = getType(result.toString());
                  if (resultType === PathType.AbsoluteWin || resultType === PathType.AbsolutePosix) {
                    return callback2(null, idx);
                  }
                }
                callback2();
              });
            },
            /**
             * @param {null | Error=} err error
             * @param {null | number=} idx result
             * @returns {void}
             */
            (err, idx2) => {
              if (!containsSymlink) return callback();
              const own = (
                /** @type {string[]} */
                pathSegments
              );
              const resultSegments = typeof idx2 === "number" ? own.slice(0, idx2 + 1) : own;
              const result = resultSegments.reduceRight(
                (a, b) => resolver.join(a, b)
              );
              const obj = {
                ...request,
                path: result
              };
              resolver.doResolve(
                target,
                obj,
                `resolved symlink to ${result}`,
                resolveContext,
                (err2, innerResult) => {
                  if (err2) return callback(err2);
                  if (innerResult) return callback(null, innerResult);
                  return callback(null, null);
                }
              );
            }
          );
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/SyncAsyncFileSystemDecorator.js
var require_SyncAsyncFileSystemDecorator = __commonJS({
  "node_modules/enhanced-resolve/lib/SyncAsyncFileSystemDecorator.js"(exports, module) {
    "use strict";
    var readFileSyncWith = (fs, path, options) => options === void 0 || options === null ? fs.readFileSync(path, options) : typeof options === "string" ? fs.readFileSync(path, options) : fs.readFileSync(path, options);
    function SyncAsyncFileSystemDecorator(fs) {
      this.fs = fs;
      this.lstat = void 0;
      this.lstatSync = void 0;
      const { lstatSync } = fs;
      if (lstatSync) {
        this.lstat = /** @type {FileSystem["lstat"]} */
        ((arg, options, callback) => {
          let result;
          try {
            result = /** @type {SyncOrAsyncFunction | undefined} */
            callback ? lstatSync.call(fs, arg, options) : lstatSync.call(fs, arg);
          } catch (err) {
            return (callback || options)(
              /** @type {NodeJS.ErrnoException | null} */
              err
            );
          }
          (callback || options)(
            null,
            /** @type {ResultOfSyncOrAsyncFunction} */
            result
          );
        });
        this.lstatSync = /** @type {SyncFileSystem["lstatSync"]} */
        ((arg, options) => lstatSync.call(fs, arg, options));
      }
      this.stat = /** @type {FileSystem["stat"]} */
      ((arg, options, callback) => {
        let result;
        try {
          result = /** @type {SyncOrAsyncFunction | undefined} */
          callback ? fs.statSync(arg, options) : fs.statSync(arg);
        } catch (err) {
          return (callback || options)(
            /** @type {NodeJS.ErrnoException | null} */
            err
          );
        }
        (callback || options)(
          null,
          /** @type {ResultOfSyncOrAsyncFunction} */
          result
        );
      });
      this.statSync = /** @type {SyncFileSystem["statSync"]} */
      ((arg, options) => fs.statSync(arg, options));
      this.readdir = /** @type {FileSystem["readdir"]} */
      ((arg, options, callback) => {
        let result;
        try {
          result = /** @type {SyncOrAsyncFunction | undefined} */
          callback ? fs.readdirSync(
            arg,
            /** @type {Exclude<Parameters<FileSystem["readdir"]>[1], (err: NodeJS.ErrnoException | null, files: string[]) => void>} */
            options
          ) : fs.readdirSync(arg);
        } catch (err) {
          return (callback || options)(
            /** @type {NodeJS.ErrnoException | null} */
            err,
            []
          );
        }
        (callback || options)(
          null,
          /** @type {ResultOfSyncOrAsyncFunction} */
          result
        );
      });
      this.readdirSync = /** @type {SyncFileSystem["readdirSync"]} */
      ((arg, options) => fs.readdirSync(
        arg,
        /** @type {Parameters<SyncFileSystem["readdirSync"]>[1]} */
        options
      ));
      this.readFile = /** @type {FileSystem["readFile"]} */
      ((arg, options, callback) => {
        let result;
        try {
          result = /** @type {SyncOrAsyncFunction | undefined} */
          callback ? readFileSyncWith(fs, arg, options) : fs.readFileSync(arg);
        } catch (err) {
          return (callback || options)(
            /** @type {NodeJS.ErrnoException | null} */
            err
          );
        }
        (callback || options)(
          null,
          /** @type {ResultOfSyncOrAsyncFunction} */
          result
        );
      });
      this.readFileSync = /** @type {SyncFileSystem["readFileSync"]} */
      ((arg, options) => readFileSyncWith(fs, arg, options));
      this.readlink = /** @type {FileSystem["readlink"]} */
      ((arg, options, callback) => {
        let result;
        try {
          result = /** @type {SyncOrAsyncFunction | undefined} */
          callback ? fs.readlinkSync(
            arg,
            /** @type {Exclude<Parameters<FileSystem["readlink"]>[1], StringCallback>} */
            options
          ) : fs.readlinkSync(arg);
        } catch (err) {
          return (callback || options)(
            /** @type {NodeJS.ErrnoException | null} */
            err
          );
        }
        (callback || options)(
          null,
          /** @type {ResultOfSyncOrAsyncFunction} */
          result
        );
      });
      this.readlinkSync = /** @type {SyncFileSystem["readlinkSync"]} */
      ((arg, options) => fs.readlinkSync(
        arg,
        /** @type {Parameters<SyncFileSystem["readlinkSync"]>[1]} */
        options
      ));
      this.readJson = void 0;
      this.readJsonSync = void 0;
      const { readJsonSync } = fs;
      if (readJsonSync) {
        this.readJson = /** @type {FileSystem["readJson"]} */
        ((arg, callback) => {
          let result;
          try {
            result = readJsonSync.call(fs, arg);
          } catch (err) {
            return callback(
              /** @type {NodeJS.ErrnoException | Error | null} */
              err
            );
          }
          callback(null, result);
        });
        this.readJsonSync = /** @type {SyncFileSystem["readJsonSync"]} */
        ((arg) => readJsonSync.call(fs, arg));
      }
      this.realpath = void 0;
      this.realpathSync = void 0;
      const { realpathSync } = fs;
      if (realpathSync) {
        this.realpath = /** @type {FileSystem["realpath"]} */
        ((arg, options, callback) => {
          let result;
          try {
            result = /** @type {SyncOrAsyncFunction | undefined} */
            callback ? realpathSync.call(
              fs,
              arg,
              /** @type {Exclude<Parameters<NonNullable<FileSystem["realpath"]>>[1], StringCallback>} */
              options
            ) : realpathSync.call(fs, arg);
          } catch (err) {
            return (callback || options)(
              /** @type {NodeJS.ErrnoException | null} */
              err
            );
          }
          (callback || options)(
            null,
            /** @type {ResultOfSyncOrAsyncFunction} */
            result
          );
        });
        this.realpathSync = /** @type {SyncFileSystem["realpathSync"]} */
        ((arg, options) => realpathSync.call(
          fs,
          arg,
          /** @type {Parameters<NonNullable<SyncFileSystem["realpathSync"]>>[1]} */
          options
        ));
      }
    }
    module.exports = SyncAsyncFileSystemDecorator;
  }
});

// node_modules/enhanced-resolve/lib/TryNextPlugin.js
var require_TryNextPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/TryNextPlugin.js"(exports, module) {
    "use strict";
    module.exports = class TryNextPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {string} message message
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, message, target) {
        this.source = source;
        this.message = message;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync("TryNextPlugin", (request, resolveContext, callback) => {
          resolver.doResolve(
            target,
            request,
            this.message,
            resolveContext,
            callback
          );
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/TsconfigPathsPlugin.js
var require_TsconfigPathsPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/TsconfigPathsPlugin.js"(exports, module) {
    "use strict";
    var { aliasResolveHandler, compileAliasOptions } = require_AliasUtils();
    var { modulesResolveHandler } = require_ModulesUtils();
    var { readJson } = require_fs();
    var { PathType: _PathType, isSubPath, normalize } = require_path();
    var NULL_CONTEXT = /* @__PURE__ */ Symbol("NULL_CONTEXT");
    var _contextSelectionCache = /* @__PURE__ */ new WeakMap();
    var DEFAULT_CONFIG_FILE = "tsconfig.json";
    var READ_JSON_OPTIONS = { stripComments: true };
    var WILDCARD_TAIL_RE = /[/\\]\*$/;
    function getPrefixLength(pattern) {
      const prefixLength = pattern.indexOf("*");
      if (prefixLength === -1) {
        return pattern.length;
      }
      return prefixLength;
    }
    function sortByLongestPrefix(arr) {
      return [...arr].sort((a, b) => getPrefixLength(b) - getPrefixLength(a));
    }
    function mergeTsconfigs(base, config) {
      base = base || {};
      config = config || {};
      return {
        ...base,
        ...config,
        compilerOptions: {
          .../** @type {TsconfigCompilerOptions} */
          base.compilerOptions,
          .../** @type {TsconfigCompilerOptions} */
          config.compilerOptions
        }
      };
    }
    function substituteConfigDir(pathValue, configDir) {
      if (!pathValue.includes("${configDir}")) return pathValue;
      return pathValue.replace(/\$\{configDir\}/g, configDir);
    }
    function tsconfigPathsToResolveOptions(configDir, paths, resolver, baseUrl) {
      const absoluteBaseUrl = !baseUrl ? configDir : resolver.join(configDir, baseUrl);
      const sortedKeys = sortByLongestPrefix(Object.keys(paths));
      const alias = [];
      const modules = [];
      for (const pattern of sortedKeys) {
        const mappings = paths[pattern];
        const absolutePaths = mappings.map((mapping) => {
          const substituted = substituteConfigDir(mapping, configDir);
          return resolver.join(absoluteBaseUrl, substituted);
        });
        if (absolutePaths.length > 0) {
          if (pattern === "*") {
            for (let j = 0; j < absolutePaths.length; j++) {
              const dir = absolutePaths[j];
              if (WILDCARD_TAIL_RE.test(dir)) {
                modules.push(dir.replace(WILDCARD_TAIL_RE, ""));
              }
            }
          } else {
            alias.push({ name: pattern, alias: absolutePaths });
          }
        }
      }
      if (baseUrl && absoluteBaseUrl && !modules.includes(absoluteBaseUrl)) {
        modules.push(absoluteBaseUrl);
      }
      return {
        alias: compileAliasOptions(resolver, alias),
        modules
      };
    }
    function getAbsoluteBaseUrl(context, resolver, baseUrl) {
      return !baseUrl ? context : resolver.join(context, baseUrl);
    }
    function buildTsconfigPathsMap(main, mainContext, refs, fileDependencies) {
      const allContexts = (
        /** @type {{ [context: string]: TsconfigPathsData }} */
        {
          [mainContext]: main,
          ...refs
        }
      );
      const contextList = Object.keys(allContexts);
      return {
        main,
        mainContext,
        refs,
        allContexts,
        contextList,
        fileDependencies
      };
    }
    module.exports = class TsconfigPathsPlugin {
      /**
       * @param {true | string | TsconfigOptions} configFileOrOptions tsconfig file path or options object
       */
      constructor(configFileOrOptions) {
        if (typeof configFileOrOptions === "object" && configFileOrOptions !== null) {
          const { configFile } = configFileOrOptions;
          this.isAutoConfigFile = typeof configFile !== "string";
          this.configFile = this.isAutoConfigFile ? DEFAULT_CONFIG_FILE : (
            /** @type {string} */
            configFile
          );
          if (Array.isArray(configFileOrOptions.references)) {
            this.references = configFileOrOptions.references.map((ref) => ({
              path: ref
            }));
          } else if (configFileOrOptions.references === "auto") {
            this.references = "auto";
          } else {
            this.references = [];
          }
          this.baseUrl = configFileOrOptions.baseUrl;
        } else {
          this.isAutoConfigFile = configFileOrOptions === true;
          this.configFile = this.isAutoConfigFile ? DEFAULT_CONFIG_FILE : (
            /** @type {string} */
            configFileOrOptions
          );
          this.references = [];
          this.baseUrl = void 0;
        }
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const aliasTarget = resolver.ensureHook("internal-resolve");
        const moduleTarget = resolver.ensureHook("module");
        resolver.getHook("raw-resolve").tapAsync("TsconfigPathsPlugin", (request, resolveContext, callback) => {
          this._getTsconfigPathsMap(
            resolver,
            request,
            resolveContext,
            (err, tsconfigPathsMap) => {
              if (err) return callback(err);
              if (!tsconfigPathsMap) return callback();
              const selectedData = this._selectPathsDataForContext(
                request.path,
                tsconfigPathsMap
              );
              if (!selectedData) return callback();
              aliasResolveHandler(
                resolver,
                selectedData.alias,
                aliasTarget,
                request,
                resolveContext,
                (err2, result) => {
                  if (err2) return callback(err2);
                  if (result) return callback(null, result);
                  return callback();
                }
              );
            }
          );
        });
        resolver.getHook("raw-module").tapAsync("TsconfigPathsPlugin", (request, resolveContext, callback) => {
          this._getTsconfigPathsMap(
            resolver,
            request,
            resolveContext,
            (err, tsconfigPathsMap) => {
              if (err) return callback(err);
              if (!tsconfigPathsMap) return callback();
              const selectedData = this._selectPathsDataForContext(
                request.path,
                tsconfigPathsMap
              );
              if (!selectedData) return callback();
              modulesResolveHandler(
                resolver,
                selectedData.modules,
                moduleTarget,
                request,
                resolveContext,
                callback
              );
            }
          );
        });
      }
      /**
       * Get TsconfigPathsMap for the request (with caching)
       * @param {Resolver} resolver the resolver
       * @param {ResolveRequest} request the request
       * @param {ResolveContext} resolveContext the resolve context
       * @param {(err: Error | null, result?: TsconfigPathsMap | null) => void} callback the callback
       * @returns {void}
       */
      _getTsconfigPathsMap(resolver, request, resolveContext, callback) {
        if (typeof request.tsconfigPathsMap !== "undefined") {
          const cached = request.tsconfigPathsMap;
          if (!cached) return callback(null, null);
          if (resolveContext.fileDependencies) {
            for (const fileDependency of cached.fileDependencies) {
              resolveContext.fileDependencies.add(fileDependency);
            }
          }
          return callback(null, cached);
        }
        if (this.isAutoConfigFile) {
          this._findTsconfigUpward(
            resolver,
            request.path || process.cwd(),
            (err, result) => {
              if (err) {
                request.tsconfigPathsMap = null;
                return callback(err);
              }
              if (!result) {
                request.tsconfigPathsMap = null;
                return callback(null, null);
              }
              const map = (
                /** @type {TsconfigPathsMap} */
                result
              );
              request.tsconfigPathsMap = map;
              if (resolveContext.fileDependencies) {
                for (const fileDependency of map.fileDependencies) {
                  resolveContext.fileDependencies.add(fileDependency);
                }
              }
              callback(null, map);
            }
          );
          return;
        }
        const absTsconfigPath = resolver.join(
          request.path || process.cwd(),
          this.configFile
        );
        this._loadTsconfigPathsMap(resolver, absTsconfigPath, (err, result) => {
          if (err) {
            request.tsconfigPathsMap = null;
            return callback(err);
          }
          const map = (
            /** @type {TsconfigPathsMap} */
            result
          );
          request.tsconfigPathsMap = map;
          if (resolveContext.fileDependencies) {
            for (const fileDependency of map.fileDependencies) {
              resolveContext.fileDependencies.add(fileDependency);
            }
          }
          callback(null, map);
        });
      }
      /**
       * Walk up from startDir to the filesystem root looking for tsconfig.json.
       * Like TypeScript's own `findConfigFile` / `forEachAncestorDirectory`.
       * @param {Resolver} resolver the resolver
       * @param {string} startDir the directory to start searching from
       * @param {(err: Error | null, result?: TsconfigPathsMap | null) => void} callback the callback
       * @returns {void}
       */
      _findTsconfigUpward(resolver, startDir, callback) {
        const { fileSystem } = resolver;
        const configFileName = this.configFile;
        const check = (dir) => {
          const candidate = resolver.join(dir, configFileName);
          fileSystem.stat(candidate, (statErr) => {
            if (!statErr) {
              this._loadTsconfigPathsMap(resolver, candidate, (loadErr, result) => {
                if (loadErr) {
                  return callback(null, null);
                }
                callback(null, result);
              });
              return;
            }
            const parentDir = resolver.dirname(dir);
            if (parentDir === dir) {
              return callback(null, null);
            }
            check(parentDir);
          });
        };
        check(startDir);
      }
      /**
       * Load tsconfig.json and build complete TsconfigPathsMap
       * Includes main project paths and all referenced projects
       * @param {Resolver} resolver the resolver
       * @param {string} absTsconfigPath absolute path to tsconfig.json
       * @param {(err: Error | null, result?: TsconfigPathsMap) => void} callback the callback
       * @returns {void}
       */
      _loadTsconfigPathsMap(resolver, absTsconfigPath, callback) {
        const fileDependencies = /* @__PURE__ */ new Set();
        this._loadTsconfig(
          resolver,
          absTsconfigPath,
          fileDependencies,
          void 0,
          (err, config) => {
            if (err) return callback(err);
            const cfg = (
              /** @type {Tsconfig} */
              config
            );
            const compilerOptions = cfg.compilerOptions || {};
            const mainContext = resolver.dirname(absTsconfigPath);
            const baseUrl = this.baseUrl !== void 0 ? this.baseUrl : compilerOptions.baseUrl;
            const main = tsconfigPathsToResolveOptions(
              mainContext,
              compilerOptions.paths || {},
              resolver,
              baseUrl
            );
            const refs = {};
            let referencesToUse = null;
            if (this.references === "auto") {
              referencesToUse = cfg.references;
            } else if (Array.isArray(this.references)) {
              referencesToUse = this.references;
            }
            if (!Array.isArray(referencesToUse)) {
              return callback(
                null,
                buildTsconfigPathsMap(main, mainContext, refs, fileDependencies)
              );
            }
            this._loadTsconfigReferences(
              resolver,
              mainContext,
              referencesToUse,
              fileDependencies,
              refs,
              (refErr) => {
                if (refErr) return callback(refErr);
                callback(
                  null,
                  buildTsconfigPathsMap(main, mainContext, refs, fileDependencies)
                );
              }
            );
          }
        );
      }
      /**
       * Select the correct TsconfigPathsData based on request.path (context-aware)
       * Matches the behavior of tsconfig-paths-webpack-plugin
       * @param {string | false} requestPath the request path
       * @param {TsconfigPathsMap} tsconfigPathsMap the tsconfig paths map
       * @returns {TsconfigPathsData | null} the selected paths data
       */
      _selectPathsDataForContext(requestPath, tsconfigPathsMap) {
        const { main, allContexts, contextList } = tsconfigPathsMap;
        if (!requestPath) {
          return main;
        }
        let perMap;
        if (contextList.length >= 2) {
          perMap = _contextSelectionCache.get(tsconfigPathsMap);
          if (perMap !== void 0) {
            const cached = perMap.get(requestPath);
            if (cached !== void 0) {
              return cached === NULL_CONTEXT ? null : (
                /** @type {TsconfigPathsData} */
                cached
              );
            }
          } else {
            perMap = /* @__PURE__ */ new Map();
            _contextSelectionCache.set(tsconfigPathsMap, perMap);
          }
        }
        let longestMatchContext = null;
        let longestMatchLength = 0;
        for (let i = 0; i < contextList.length; i++) {
          const context = contextList[i];
          if (context === requestPath) {
            const exact = allContexts[context];
            if (perMap !== void 0) perMap.set(requestPath, exact);
            return exact;
          }
          if (context.length > longestMatchLength && isSubPath(context, requestPath)) {
            longestMatchContext = context;
            longestMatchLength = context.length;
          }
        }
        const result = longestMatchContext === null ? null : allContexts[longestMatchContext];
        if (perMap !== void 0) {
          perMap.set(requestPath, result === null ? NULL_CONTEXT : result);
        }
        return result;
      }
      /**
       * Load tsconfig from extends path
       * @param {Resolver} resolver the resolver
       * @param {string} configFilePath current config file path
       * @param {string} extendedConfigValue extends value
       * @param {Set<string>} fileDependencies the file dependencies
       * @param {Set<string>} visitedConfigPaths config paths being loaded (for circular extends detection)
       * @param {(err: Error | null, result?: Tsconfig) => void} callback callback
       * @returns {void}
       */
      _loadTsconfigFromExtends(resolver, configFilePath, extendedConfigValue, fileDependencies, visitedConfigPaths, callback) {
        const { fileSystem } = resolver;
        const currentDir = resolver.dirname(configFilePath);
        extendedConfigValue = substituteConfigDir(extendedConfigValue, currentDir);
        const originalExtendedConfigValue = extendedConfigValue;
        if (typeof extendedConfigValue === "string" && !extendedConfigValue.includes(".json")) {
          extendedConfigValue += ".json";
        }
        const initialExtendedConfigPath = resolver.join(
          currentDir,
          extendedConfigValue
        );
        const loadExtended = (extendedConfigPath) => {
          this._loadTsconfig(
            resolver,
            extendedConfigPath,
            fileDependencies,
            visitedConfigPaths,
            (err, config) => {
              if (err) return callback(err);
              const cfg = (
                /** @type {Tsconfig} */
                config
              );
              const compilerOptions = cfg.compilerOptions || {
                baseUrl: void 0
              };
              if (compilerOptions.baseUrl) {
                const extendedConfigDir = resolver.dirname(extendedConfigPath);
                compilerOptions.baseUrl = getAbsoluteBaseUrl(
                  extendedConfigDir,
                  resolver,
                  compilerOptions.baseUrl
                );
              }
              delete cfg.references;
              callback(null, cfg);
            }
          );
        };
        fileSystem.stat(initialExtendedConfigPath, (existsErr) => {
          if (!existsErr) return loadExtended(initialExtendedConfigPath);
          let nodeModulesSubPath = null;
          if (typeof originalExtendedConfigValue === "string" && originalExtendedConfigValue.startsWith("@") && originalExtendedConfigValue.split("/").length === 2) {
            nodeModulesSubPath = `${originalExtendedConfigValue}/${DEFAULT_CONFIG_FILE}`;
          } else if (extendedConfigValue.includes("/") && !originalExtendedConfigValue.startsWith(".") && !originalExtendedConfigValue.startsWith("/")) {
            nodeModulesSubPath = extendedConfigValue;
          } else if (!originalExtendedConfigValue.startsWith(".") && !originalExtendedConfigValue.startsWith("/")) {
            nodeModulesSubPath = `${originalExtendedConfigValue}/${DEFAULT_CONFIG_FILE}`;
          }
          if (nodeModulesSubPath === null) {
            return loadExtended(initialExtendedConfigPath);
          }
          const subPath = normalize(`node_modules/${nodeModulesSubPath}`);
          this._findExtendsInNodeModules(resolver, currentDir, subPath, (found) => {
            loadExtended(found || resolver.join(currentDir, subPath));
          });
        });
      }
      /**
       * Walk up from startDir looking for `<dir>/<subPath>` (a
       * `node_modules/...` sub-path), matching Node.js module resolution so a
       * package hoisted to a parent workspace's node_modules is found.
       * @param {Resolver} resolver the resolver
       * @param {string} startDir directory to start searching from
       * @param {string} subPath node_modules-relative sub-path to look for
       * @param {(found: string | null) => void} callback receives the found path or null
       * @returns {void}
       */
      _findExtendsInNodeModules(resolver, startDir, subPath, callback) {
        const { fileSystem } = resolver;
        const check = (dir) => {
          const candidate = resolver.join(dir, subPath);
          fileSystem.stat(candidate, (statErr) => {
            if (!statErr) return callback(candidate);
            const parentDir = resolver.dirname(dir);
            if (parentDir === dir) return callback(null);
            check(parentDir);
          });
        };
        check(startDir);
      }
      /**
       * Load referenced tsconfig projects and store in referenceMatchMap
       * Simple implementation matching tsconfig-paths-webpack-plugin:
       * Just load each reference and store independently
       * @param {Resolver} resolver the resolver
       * @param {string} context the context
       * @param {TsconfigReference[]} references array of references
       * @param {Set<string>} fileDependencies the file dependencies
       * @param {{ [baseUrl: string]: TsconfigPathsData }} referenceMatchMap the map to populate
       * @param {(err: Error | null) => void} callback callback
       * @param {Set<string>=} visitedRefPaths visited reference config paths (for circular reference detection)
       * @returns {void}
       */
      _loadTsconfigReferences(resolver, context, references, fileDependencies, referenceMatchMap, callback, visitedRefPaths) {
        if (references.length === 0) return callback(null);
        const visited = visitedRefPaths || /* @__PURE__ */ new Set();
        let pending = references.length;
        const finishOne = () => {
          if (--pending === 0) callback(null);
        };
        for (const ref of references) {
          const refPath = substituteConfigDir(ref.path, context);
          const refConfigPath = resolver.join(
            resolver.join(context, refPath),
            DEFAULT_CONFIG_FILE
          );
          if (visited.has(refConfigPath)) {
            finishOne();
            continue;
          }
          visited.add(refConfigPath);
          this._loadTsconfig(
            resolver,
            refConfigPath,
            fileDependencies,
            void 0,
            (err, refConfig) => {
              if (err) return finishOne();
              const cfg = (
                /** @type {Tsconfig} */
                refConfig
              );
              if (cfg.compilerOptions && cfg.compilerOptions.paths) {
                const refContext = resolver.dirname(refConfigPath);
                referenceMatchMap[refContext] = tsconfigPathsToResolveOptions(
                  refContext,
                  cfg.compilerOptions.paths || {},
                  resolver,
                  cfg.compilerOptions.baseUrl
                );
              }
              if (this.references === "auto" && Array.isArray(cfg.references)) {
                this._loadTsconfigReferences(
                  resolver,
                  resolver.dirname(refConfigPath),
                  cfg.references,
                  fileDependencies,
                  referenceMatchMap,
                  finishOne,
                  visited
                );
              } else {
                finishOne();
              }
            }
          );
        }
      }
      /**
       * Load tsconfig.json with extends support
       * @param {Resolver} resolver the resolver
       * @param {string} configFilePath absolute path to tsconfig.json
       * @param {Set<string>} fileDependencies the file dependencies
       * @param {Set<string> | undefined} visitedConfigPaths config paths being loaded (for circular extends detection)
       * @param {(err: Error | null, result?: Tsconfig) => void} callback callback
       * @returns {void}
       */
      _loadTsconfig(resolver, configFilePath, fileDependencies, visitedConfigPaths, callback) {
        const visited = visitedConfigPaths || /* @__PURE__ */ new Set();
        if (visited.has(configFilePath)) {
          return callback(
            null,
            /** @type {Tsconfig} */
            {}
          );
        }
        visited.add(configFilePath);
        readJson(
          resolver.fileSystem,
          configFilePath,
          READ_JSON_OPTIONS,
          (err, parsed) => {
            if (err) return callback(
              /** @type {Error} */
              err
            );
            const config = (
              /** @type {Tsconfig} */
              parsed
            );
            fileDependencies.add(configFilePath);
            const extendedConfig = config.extends;
            if (!extendedConfig) return callback(null, config);
            if (!Array.isArray(extendedConfig)) {
              this._loadTsconfigFromExtends(
                resolver,
                configFilePath,
                extendedConfig,
                fileDependencies,
                visited,
                (extErr, extendedTsconfig) => {
                  if (extErr) return callback(extErr);
                  callback(
                    null,
                    mergeTsconfigs(
                      /** @type {Tsconfig} */
                      extendedTsconfig,
                      config
                    )
                  );
                }
              );
              return;
            }
            let base = {};
            let i = 0;
            const next = () => {
              if (i >= extendedConfig.length) {
                return callback(null, mergeTsconfigs(base, config));
              }
              this._loadTsconfigFromExtends(
                resolver,
                configFilePath,
                extendedConfig[i++],
                fileDependencies,
                visited,
                (extErr, extendedTsconfig) => {
                  if (extErr) return callback(extErr);
                  base = mergeTsconfigs(
                    base,
                    /** @type {Tsconfig} */
                    extendedTsconfig
                  );
                  next();
                }
              );
            };
            next();
          }
        );
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/UnsafeCachePlugin.js
var require_UnsafeCachePlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/UnsafeCachePlugin.js"(exports, module) {
    "use strict";
    var { isRelativeRequest } = require_path();
    function joinRelativePreservingLeadingDot(relativePath, request, resolver) {
      const normalized = resolver.join(relativePath, request);
      return isRelativeRequest(normalized) ? normalized : `./${normalized}`;
    }
    function getCachePath(request) {
      if (request.descriptionFileRoot && !request.module) {
        return request.descriptionFileRoot;
      }
      return request.path;
    }
    function getCacheRequest(request, resolver) {
      const requestString = request.request;
      if (!requestString || !request.relativePath || !isRelativeRequest(requestString)) {
        return requestString;
      }
      return joinRelativePreservingLeadingDot(
        request.relativePath,
        requestString,
        resolver
      );
    }
    function getCacheId(type, request, withContext, resolver) {
      return JSON.stringify({
        type,
        context: withContext ? request.context : "",
        path: getCachePath(request),
        query: request.query,
        fragment: request.fragment,
        request: getCacheRequest(request, resolver)
      });
    }
    module.exports = class UnsafeCachePlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {(request: ResolveRequest) => boolean} filterPredicate filterPredicate
       * @param {Cache} cache cache
       * @param {boolean} withContext withContext
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, filterPredicate, cache, withContext, target) {
        this.source = source;
        this.filterPredicate = filterPredicate;
        this.withContext = withContext;
        this.cache = cache;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync("UnsafeCachePlugin", (request, resolveContext, callback) => {
          if (!this.filterPredicate(request)) {
            return resolver.doResolve(
              target,
              request,
              null,
              resolveContext,
              callback
            );
          }
          const isYield = typeof resolveContext.yield === "function";
          const cacheId = getCacheId(
            isYield ? "yield" : "default",
            request,
            this.withContext,
            resolver
          );
          const cacheEntry = this.cache[cacheId];
          if (cacheEntry) {
            if (isYield) {
              const yield_2 = (
                /** @type {ResolveContextYield} */
                resolveContext.yield
              );
              if (Array.isArray(cacheEntry)) {
                for (const result of cacheEntry) yield_2(result);
              } else {
                yield_2(cacheEntry);
              }
              return callback(null, null);
            }
            return callback(
              null,
              /** @type {ResolveRequest} */
              cacheEntry
            );
          }
          let yieldFn;
          let yield_;
          const yieldResult = [];
          if (isYield) {
            yieldFn = resolveContext.yield;
            yield_ = (result) => {
              yieldResult.push(result);
            };
          }
          resolver.doResolve(
            target,
            request,
            null,
            yield_ ? { ...resolveContext, yield: yield_ } : resolveContext,
            (err, result) => {
              if (err) return callback(err);
              if (isYield) {
                if (result) yieldResult.push(result);
                for (const result2 of yieldResult) {
                  yieldFn(result2);
                }
                this.cache[cacheId] = yieldResult;
                return callback(null, null);
              }
              if (result) return callback(null, this.cache[cacheId] = result);
              callback();
            }
          );
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/UseFilePlugin.js
var require_UseFilePlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/UseFilePlugin.js"(exports, module) {
    "use strict";
    module.exports = class UseFilePlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {string} filename filename
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, filename, target) {
        this.source = source;
        this.filename = filename;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync("UseFilePlugin", (request, resolveContext, callback) => {
          const filePath = resolver.join(
            /** @type {string} */
            request.path,
            this.filename
          );
          const obj = {
            ...request,
            path: filePath,
            relativePath: request.relativePath && resolver.join(request.relativePath, this.filename)
          };
          resolver.doResolve(
            target,
            obj,
            `using path: ${filePath}`,
            resolveContext,
            callback
          );
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/ResolverFactory.js
var require_ResolverFactory = __commonJS({
  "node_modules/enhanced-resolve/lib/ResolverFactory.js"(exports, module) {
    "use strict";
    var { cwd, versions } = __require("process");
    var AliasFieldPlugin = require_AliasFieldPlugin();
    var AliasPlugin = require_AliasPlugin();
    var AppendPlugin = require_AppendPlugin();
    var ConditionalPlugin = require_ConditionalPlugin();
    var DescriptionFilePlugin = require_DescriptionFilePlugin();
    var DirectoryExistsPlugin = require_DirectoryExistsPlugin();
    var ExportsFieldPlugin = require_ExportsFieldPlugin();
    var ExtensionAliasPlugin = require_ExtensionAliasPlugin();
    var FileExistsPlugin = require_FileExistsPlugin();
    var ImportsFieldPlugin = require_ImportsFieldPlugin();
    var JoinRequestPartPlugin = require_JoinRequestPartPlugin();
    var JoinRequestPlugin = require_JoinRequestPlugin();
    var MainFieldPlugin = require_MainFieldPlugin();
    var ModulesInHierarchicalDirectoriesPlugin = require_ModulesInHierarchicalDirectoriesPlugin();
    var ModulesInRootPlugin = require_ModulesInRootPlugin();
    var NextPlugin = require_NextPlugin();
    var PackageMapPlugin = require_PackageMapPlugin();
    var ParsePlugin = require_ParsePlugin();
    var PnpPlugin = require_PnpPlugin();
    var Resolver = require_Resolver();
    var RestrictionsPlugin = require_RestrictionsPlugin();
    var ResultPlugin = require_ResultPlugin();
    var RootsPlugin = require_RootsPlugin();
    var SelfReferencePlugin = require_SelfReferencePlugin();
    var SymlinkPlugin = require_SymlinkPlugin();
    var SyncAsyncFileSystemDecorator = require_SyncAsyncFileSystemDecorator();
    var TryNextPlugin = require_TryNextPlugin();
    var TsconfigPathsPlugin = require_TsconfigPathsPlugin();
    var UnsafeCachePlugin = require_UnsafeCachePlugin();
    var UseFilePlugin = require_UseFilePlugin();
    var { PathType, getType, join: join2, toPath } = require_path();
    function processPnpApiOption(option) {
      if (option === void 0 && /** @type {NodeJS.ProcessVersions & { pnp: string }} */
      versions.pnp) {
        const _findPnpApi = (
          /** @type {(issuer: string) => PnpApi | null}} */
          // @ts-expect-error maybe nothing
          __require("module").findPnpApi
        );
        if (_findPnpApi) {
          return {
            resolveToUnqualified(request, issuer, opts) {
              const pnpapi = _findPnpApi(issuer);
              if (!pnpapi) {
                return null;
              }
              return pnpapi.resolveToUnqualified(request, issuer, opts);
            }
          };
        }
      }
      return option || null;
    }
    function toPathAlias(alias) {
      if (alias === false) return false;
      return Array.isArray(alias) ? alias.map(toPath) : toPath(alias);
    }
    function normalizeAlias(alias) {
      if (typeof alias === "object" && !Array.isArray(alias) && alias !== null) {
        return Object.keys(alias).map((key) => {
          const obj = {
            name: key,
            onlyModule: false,
            alias: toPathAlias(alias[key])
          };
          if (/\$$/.test(key)) {
            obj.onlyModule = true;
            obj.name = key.slice(0, -1);
          }
          return obj;
        });
      }
      return alias ? alias.map((item) => ({ ...item, alias: toPathAlias(item.alias) })) : [];
    }
    function toPackageMapConfigFile(configFile) {
      const file = toPath(configFile);
      const type = getType(file);
      if (type === PathType.AbsolutePosix || type === PathType.AbsoluteWin) {
        return file;
      }
      if (typeof cwd !== "function") {
        throw new Error(
          "The 'packageMap' option needs an absolute 'configFile' in an environment without a working directory"
        );
      }
      return join2(cwd(), file);
    }
    function normalizePackageMap(packageMap) {
      if (packageMap === void 0) return null;
      if (typeof packageMap === "string" || packageMap instanceof URL) {
        return { configFile: toPackageMapConfigFile(packageMap), packages: null };
      }
      const { configFile, packages } = packageMap;
      if (packages !== void 0 && configFile === void 0) {
        throw new Error(
          "The 'packageMap' option needs a 'configFile' next to 'packages' to resolve the package urls against"
        );
      }
      if (configFile === void 0) {
        throw new Error(
          "The 'packageMap' option needs either a 'configFile' or 'packages'"
        );
      }
      return {
        configFile: toPackageMapConfigFile(configFile),
        packages: packages === void 0 ? null : packages
      };
    }
    function normalizeTsconfig(tsconfig) {
      if (tsconfig === void 0) return false;
      if (typeof tsconfig === "boolean") return tsconfig;
      if (typeof tsconfig === "string" || tsconfig instanceof URL) {
        return toPath(tsconfig);
      }
      const result = {};
      if (tsconfig.configFile !== void 0) {
        result.configFile = toPath(tsconfig.configFile);
      }
      if (tsconfig.baseUrl !== void 0) {
        result.baseUrl = toPath(tsconfig.baseUrl);
      }
      if (tsconfig.references !== void 0) {
        result.references = Array.isArray(tsconfig.references) ? tsconfig.references.map(toPath) : tsconfig.references;
      }
      return result;
    }
    function mergeFilteredToArray(array, filter) {
      const result = [];
      const set = new Set(array);
      for (const item of set) {
        if (filter(item)) {
          const lastElement = result.length > 0 ? result[result.length - 1] : void 0;
          if (Array.isArray(lastElement)) {
            lastElement.push(item);
          } else {
            result.push([item]);
          }
        } else {
          result.push(item);
        }
      }
      return result;
    }
    function createOptions(options) {
      const mainFieldsSet = new Set(options.mainFields || ["main"]);
      const mainFields = [];
      for (const item of mainFieldsSet) {
        if (typeof item === "string") {
          mainFields.push({
            name: [item],
            forceRelative: true
          });
        } else if (Array.isArray(item)) {
          mainFields.push({
            name: item,
            forceRelative: true
          });
        } else {
          mainFields.push({
            name: Array.isArray(item.name) ? item.name : [item.name],
            forceRelative: item.forceRelative
          });
        }
      }
      return {
        alias: normalizeAlias(options.alias),
        fallback: normalizeAlias(options.fallback),
        aliasFields: new Set(options.aliasFields),
        cachePredicate: options.cachePredicate || function trueFn() {
          return true;
        },
        cacheWithContext: typeof options.cacheWithContext !== "undefined" ? options.cacheWithContext : true,
        exportsFields: new Set(options.exportsFields || ["exports"]),
        importsFields: new Set(options.importsFields || ["imports"]),
        conditionNames: new Set(options.conditionNames),
        descriptionFiles: [
          ...new Set(options.descriptionFiles || ["package.json"])
        ],
        enforceExtension: options.enforceExtension === void 0 ? Boolean(options.extensions && options.extensions.includes("")) : options.enforceExtension,
        extensions: new Set(options.extensions || [".js", ".json", ".node"]),
        extensionAlias: options.extensionAlias ? Object.keys(options.extensionAlias).map((k) => ({
          extension: k,
          alias: (
            /** @type {ExtensionAliasOptions} */
            options.extensionAlias[k]
          )
        })) : [],
        extensionAliasForExports: options.extensionAliasForExports || false,
        fileSystem: options.useSyncFileSystemCalls ? new SyncAsyncFileSystemDecorator(
          /** @type {SyncFileSystem} */
          /** @type {unknown} */
          options.fileSystem
        ) : options.fileSystem,
        unsafeCache: options.unsafeCache && typeof options.unsafeCache !== "object" ? (
          /** @type {Cache} */
          {}
        ) : options.unsafeCache || false,
        symlinks: typeof options.symlinks !== "undefined" ? options.symlinks : true,
        resolver: options.resolver,
        modules: mergeFilteredToArray(
          Array.isArray(options.modules) ? options.modules.map(toPath) : options.modules ? [toPath(options.modules)] : ["node_modules"],
          (item) => {
            const type = getType(item);
            return type === PathType.Normal || type === PathType.Relative;
          }
        ),
        mainFields,
        mainFiles: new Set(options.mainFiles || ["index"]),
        plugins: options.plugins || [],
        packageMap: normalizePackageMap(options.packageMap),
        pnpApi: processPnpApiOption(options.pnpApi),
        roots: new Set(options.roots ? options.roots.map(toPath) : void 0),
        fullySpecified: options.fullySpecified || false,
        resolveToContext: options.resolveToContext || false,
        preferRelative: options.preferRelative || false,
        preferAbsolute: options.preferAbsolute || false,
        restrictions: new Set(
          options.restrictions && options.restrictions.map((r) => r instanceof RegExp ? r : toPath(r))
        ),
        tsconfig: normalizeTsconfig(options.tsconfig)
      };
    }
    module.exports.createResolver = function createResolver(options) {
      const normalizedOptions = createOptions(options);
      const {
        alias,
        fallback,
        aliasFields,
        extensionAliasForExports,
        cachePredicate,
        cacheWithContext,
        conditionNames,
        descriptionFiles,
        enforceExtension,
        exportsFields,
        extensionAlias,
        importsFields,
        extensions: extensions2,
        fileSystem,
        fullySpecified,
        mainFields,
        mainFiles,
        modules,
        packageMap,
        plugins: userPlugins,
        pnpApi,
        resolveToContext,
        preferRelative,
        preferAbsolute,
        symlinks,
        unsafeCache,
        resolver: customResolver,
        restrictions,
        roots,
        tsconfig
      } = normalizedOptions;
      const plugins = [...userPlugins];
      const resolver = customResolver || new Resolver(fileSystem, normalizedOptions);
      resolver.ensureHook("resolve");
      resolver.ensureHook("internalResolve");
      resolver.ensureHook("newInternalResolve");
      resolver.ensureHook("importsResolve");
      resolver.ensureHook("parsedResolve");
      resolver.ensureHook("describedResolve");
      resolver.ensureHook("rawResolve");
      resolver.ensureHook("normalResolve");
      resolver.ensureHook("internal");
      resolver.ensureHook("rawModule");
      resolver.ensureHook("alternateRawModule");
      resolver.ensureHook("module");
      resolver.ensureHook("resolveAsModule");
      resolver.ensureHook("undescribedResolveInPackage");
      resolver.ensureHook("resolveInPackage");
      resolver.ensureHook("resolveInExistingDirectory");
      resolver.ensureHook("importsFieldRelative");
      if (extensionAliasForExports) {
        resolver.ensureHook("exportsFieldRelative");
      }
      resolver.ensureHook("relative");
      resolver.ensureHook("describedRelative");
      resolver.ensureHook("directory");
      resolver.ensureHook("undescribedExistingDirectory");
      resolver.ensureHook("existingDirectory");
      resolver.ensureHook("undescribedRawFile");
      resolver.ensureHook("rawFile");
      resolver.ensureHook("file");
      resolver.ensureHook("finalFile");
      resolver.ensureHook("existingFile");
      resolver.ensureHook("resolved");
      resolver.hooks.newInteralResolve = resolver.hooks.newInternalResolve;
      for (const { source, resolveOptions } of [
        { source: "resolve", resolveOptions: { fullySpecified } },
        { source: "internal-resolve", resolveOptions: { fullySpecified: false } },
        // Entry point for non-relative targets from the imports field.
        // Sets internal: false to prevent re-entering imports resolution,
        // aligning with the Node.js ESM spec where PACKAGE_IMPORTS_RESOLVE
        // does not recursively resolve # specifiers.
        // https://nodejs.org/api/esm.html#resolution-algorithm-specification
        {
          source: "imports-resolve",
          resolveOptions: { fullySpecified: false, internal: false }
        }
      ]) {
        plugins.push(new ParsePlugin(source, resolveOptions, "parsed-resolve"));
      }
      plugins.push(
        new DescriptionFilePlugin(
          "parsed-resolve",
          descriptionFiles,
          false,
          "described-resolve"
        )
      );
      plugins.push(new NextPlugin("after-parsed-resolve", "described-resolve"));
      if (unsafeCache) {
        plugins.push(
          new UnsafeCachePlugin(
            "described-resolve",
            cachePredicate,
            /** @type {import("./UnsafeCachePlugin").Cache} */
            unsafeCache,
            cacheWithContext,
            "raw-resolve"
          )
        );
      } else {
        plugins.push(new NextPlugin("described-resolve", "raw-resolve"));
      }
      if (fallback.length > 0) {
        plugins.push(
          new AliasPlugin("described-resolve", fallback, "internal-resolve")
        );
      }
      if (alias.length > 0) {
        plugins.push(new AliasPlugin("raw-resolve", alias, "internal-resolve"));
      }
      if (tsconfig) {
        plugins.push(new TsconfigPathsPlugin(tsconfig));
      }
      for (const item of aliasFields) {
        plugins.push(new AliasFieldPlugin("raw-resolve", item, "internal-resolve"));
      }
      for (const item of extensionAlias) {
        plugins.push(
          new ExtensionAliasPlugin("raw-resolve", item, "normal-resolve")
        );
      }
      plugins.push(new NextPlugin("raw-resolve", "normal-resolve"));
      if (preferRelative) {
        plugins.push(new JoinRequestPlugin("after-normal-resolve", "relative"));
      }
      plugins.push(
        new ConditionalPlugin(
          "after-normal-resolve",
          { module: true },
          "resolve as module",
          false,
          "raw-module"
        )
      );
      plugins.push(
        new ConditionalPlugin(
          "after-normal-resolve",
          { internal: true },
          "resolve as internal import",
          false,
          "internal"
        )
      );
      if (preferAbsolute) {
        plugins.push(new JoinRequestPlugin("after-normal-resolve", "relative"));
      }
      if (roots.size > 0) {
        plugins.push(new RootsPlugin("after-normal-resolve", roots, "relative"));
      }
      if (!preferRelative && !preferAbsolute) {
        plugins.push(new JoinRequestPlugin("after-normal-resolve", "relative"));
      }
      for (const importsField of importsFields) {
        plugins.push(
          new ImportsFieldPlugin(
            "internal",
            conditionNames,
            importsField,
            "imports-field-relative",
            "imports-resolve"
          )
        );
      }
      for (const item of extensionAlias) {
        plugins.push(
          new ExtensionAliasPlugin("imports-field-relative", item, "relative")
        );
      }
      plugins.push(new NextPlugin("imports-field-relative", "relative"));
      if (packageMap) {
        plugins.push(
          new PackageMapPlugin(
            "raw-module",
            packageMap,
            symlinks,
            "undescribed-resolve-in-package"
          )
        );
      }
      for (const exportsField of exportsFields) {
        plugins.push(
          new SelfReferencePlugin("raw-module", exportsField, "resolve-as-module")
        );
      }
      for (const item of modules) {
        if (Array.isArray(item)) {
          if (item.includes("node_modules") && pnpApi) {
            plugins.push(
              new ModulesInHierarchicalDirectoriesPlugin(
                "raw-module",
                item.filter((i) => i !== "node_modules"),
                "module"
              )
            );
            plugins.push(
              new PnpPlugin(
                "raw-module",
                pnpApi,
                "undescribed-resolve-in-package",
                "alternate-raw-module"
              )
            );
            plugins.push(
              new ModulesInHierarchicalDirectoriesPlugin(
                "alternate-raw-module",
                ["node_modules"],
                "module"
              )
            );
          } else {
            plugins.push(
              new ModulesInHierarchicalDirectoriesPlugin(
                "raw-module",
                item,
                "module"
              )
            );
          }
        } else {
          plugins.push(new ModulesInRootPlugin("raw-module", item, "module"));
        }
      }
      plugins.push(new JoinRequestPartPlugin("module", "resolve-as-module"));
      if (!resolveToContext) {
        plugins.push(
          new ConditionalPlugin(
            "resolve-as-module",
            { directory: false, request: "." },
            "single file module",
            true,
            "undescribed-raw-file"
          )
        );
      }
      plugins.push(
        new DirectoryExistsPlugin(
          "resolve-as-module",
          "undescribed-resolve-in-package"
        )
      );
      plugins.push(
        new DescriptionFilePlugin(
          "undescribed-resolve-in-package",
          descriptionFiles,
          false,
          "resolve-in-package"
        )
      );
      plugins.push(
        new NextPlugin(
          "after-undescribed-resolve-in-package",
          "resolve-in-package"
        )
      );
      const exportsFieldTarget = extensionAliasForExports ? "exports-field-relative" : "relative";
      for (const exportsField of exportsFields) {
        plugins.push(
          new ExportsFieldPlugin(
            "resolve-in-package",
            conditionNames,
            exportsField,
            exportsFieldTarget,
            restrictions.size > 0
          )
        );
      }
      plugins.push(
        new NextPlugin("resolve-in-package", "resolve-in-existing-directory")
      );
      if (extensionAliasForExports) {
        for (const item of extensionAlias) {
          plugins.push(
            new ExtensionAliasPlugin("exports-field-relative", item, "relative")
          );
        }
        plugins.push(new NextPlugin("exports-field-relative", "relative"));
      }
      plugins.push(
        new JoinRequestPlugin("resolve-in-existing-directory", "relative")
      );
      plugins.push(
        new DescriptionFilePlugin(
          "relative",
          descriptionFiles,
          true,
          "described-relative"
        )
      );
      plugins.push(new NextPlugin("after-relative", "described-relative"));
      if (resolveToContext) {
        plugins.push(new NextPlugin("described-relative", "directory"));
      } else {
        plugins.push(
          new ConditionalPlugin(
            "described-relative",
            { directory: false },
            null,
            true,
            "raw-file"
          )
        );
        plugins.push(
          new ConditionalPlugin(
            "described-relative",
            { fullySpecified: false },
            "as directory",
            true,
            "directory"
          )
        );
      }
      plugins.push(
        new DirectoryExistsPlugin("directory", "undescribed-existing-directory")
      );
      if (resolveToContext) {
        plugins.push(new NextPlugin("undescribed-existing-directory", "resolved"));
      } else {
        plugins.push(
          new DescriptionFilePlugin(
            "undescribed-existing-directory",
            descriptionFiles,
            false,
            "existing-directory"
          )
        );
        for (const item of mainFiles) {
          plugins.push(
            new UseFilePlugin(
              "undescribed-existing-directory",
              item,
              "undescribed-raw-file"
            )
          );
        }
        for (const item of mainFields) {
          plugins.push(
            new MainFieldPlugin(
              "existing-directory",
              item,
              "resolve-in-existing-directory"
            )
          );
        }
        for (const item of mainFiles) {
          plugins.push(
            new UseFilePlugin("existing-directory", item, "undescribed-raw-file")
          );
        }
        plugins.push(
          new DescriptionFilePlugin(
            "undescribed-raw-file",
            descriptionFiles,
            true,
            "raw-file"
          )
        );
        plugins.push(new NextPlugin("after-undescribed-raw-file", "raw-file"));
        plugins.push(
          new ConditionalPlugin(
            "raw-file",
            { fullySpecified: true },
            null,
            false,
            "file"
          )
        );
        if (!enforceExtension) {
          plugins.push(new TryNextPlugin("raw-file", "no extension", "file"));
        }
        for (const item of extensions2) {
          plugins.push(new AppendPlugin("raw-file", item, "file"));
        }
        if (alias.length > 0) {
          plugins.push(new AliasPlugin("file", alias, "internal-resolve"));
        }
        for (const item of aliasFields) {
          plugins.push(new AliasFieldPlugin("file", item, "internal-resolve"));
        }
        plugins.push(new NextPlugin("file", "final-file"));
        plugins.push(new FileExistsPlugin("final-file", "existing-file"));
        if (symlinks) {
          plugins.push(new SymlinkPlugin("existing-file", "existing-file"));
        }
        plugins.push(new NextPlugin("existing-file", "resolved"));
      }
      const { resolved } = (
        /** @type {KnownHooks & EnsuredHooks} */
        resolver.hooks
      );
      if (restrictions.size > 0) {
        plugins.push(new RestrictionsPlugin(resolved, restrictions));
      }
      plugins.push(new ResultPlugin(resolved));
      for (const plugin of plugins) {
        if (typeof plugin === "function") {
          plugin.call(resolver, resolver);
        } else if (plugin) {
          plugin.apply(resolver);
        }
      }
      return resolver;
    };
  }
});

// node_modules/enhanced-resolve/lib/CloneBasenamePlugin.js
var require_CloneBasenamePlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/CloneBasenamePlugin.js"(exports, module) {
    "use strict";
    module.exports = class CloneBasenamePlugin {
      /**
       * @param {string | ResolveStepHook} source source
       * @param {string | ResolveStepHook} target target
       */
      constructor(source, target) {
        this.source = source;
        this.target = target;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const target = resolver.ensureHook(this.target);
        resolver.getHook(this.source).tapAsync("CloneBasenamePlugin", (request, resolveContext, callback) => {
          const requestPath = (
            /** @type {string} */
            request.path
          );
          const filename = resolver.basename(requestPath);
          const filePath = resolver.join(requestPath, filename);
          const obj = {
            ...request,
            path: filePath,
            relativePath: request.relativePath && resolver.join(request.relativePath, filename)
          };
          resolver.doResolve(
            target,
            obj,
            `using path: ${filePath}`,
            resolveContext,
            callback
          );
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/LogInfoPlugin.js
var require_LogInfoPlugin = __commonJS({
  "node_modules/enhanced-resolve/lib/LogInfoPlugin.js"(exports, module) {
    "use strict";
    module.exports = class LogInfoPlugin {
      /**
       * @param {string | ResolveStepHook} source source
       */
      constructor(source) {
        this.source = source;
      }
      /**
       * @param {Resolver} resolver the resolver
       * @returns {void}
       */
      apply(resolver) {
        const { source } = this;
        resolver.getHook(this.source).tapAsync("LogInfoPlugin", (request, resolveContext, callback) => {
          if (!resolveContext.log) return callback();
          const { log } = resolveContext;
          const prefix2 = `[${source}] `;
          if (request.path) {
            log(`${prefix2}Resolving in directory: ${request.path}`);
          }
          if (request.request) {
            log(`${prefix2}Resolving request: ${request.request}`);
          }
          if (request.module) log(`${prefix2}Request is an module request.`);
          if (request.directory) log(`${prefix2}Request is a directory request.`);
          if (request.query) {
            log(`${prefix2}Resolving request query: ${request.query}`);
          }
          if (request.fragment) {
            log(`${prefix2}Resolving request fragment: ${request.fragment}`);
          }
          if (request.descriptionFilePath) {
            log(
              `${prefix2}Has description data from ${request.descriptionFilePath}`
            );
          }
          if (request.relativePath) {
            log(
              `${prefix2}Relative path from description file is: ${request.relativePath}`
            );
          }
          callback();
        });
      }
    };
  }
});

// node_modules/enhanced-resolve/lib/index.js
var require_lib2 = __commonJS({
  "node_modules/enhanced-resolve/lib/index.js"(exports, module) {
    "use strict";
    var memoize = require_memoize();
    var getCachedFileSystem = memoize(() => require_CachedInputFileSystem());
    var getNodeFileSystem = memoize(() => {
      const fs = require_graceful_fs();
      const CachedInputFileSystem = getCachedFileSystem();
      return new CachedInputFileSystem(fs, 4e3);
    });
    var getNodeContext = memoize(() => ({
      environments: ["node+es3+es5+process+native"]
    }));
    var getResolverFactory = memoize(() => require_ResolverFactory());
    var getAsyncResolver = memoize(
      () => getResolverFactory().createResolver({
        conditionNames: ["node"],
        extensions: [".js", ".json", ".node"],
        fileSystem: getNodeFileSystem()
      })
    );
    var resolve2 = (
      /**
       * @param {object | string | URL} context context
       * @param {string | URL} parent parent path
       * @param {string | URL | ResolveContext | ResolveCallback} specifier specifier to resolve
       * @param {ResolveContext | ResolveCallback=} resolveContext resolve context
       * @param {ResolveCallback=} callback callback
       */
      (context, parent, specifier, resolveContext, callback) => {
        if (typeof context === "string" || context instanceof URL) {
          callback = /** @type {ResolveCallback} */
          resolveContext;
          resolveContext = /** @type {ResolveContext} */
          specifier;
          specifier = parent;
          parent = context;
          context = getNodeContext();
        }
        if (typeof callback !== "function") {
          callback = /** @type {ResolveCallback} */
          resolveContext;
        }
        getAsyncResolver().resolve(
          context,
          parent,
          /** @type {string} */
          specifier,
          /** @type {ResolveContext} */
          resolveContext,
          /** @type {ResolveCallback} */
          callback
        );
      }
    );
    var getSyncResolver = memoize(
      () => getResolverFactory().createResolver({
        conditionNames: ["node"],
        extensions: [".js", ".json", ".node"],
        useSyncFileSystemCalls: true,
        fileSystem: getNodeFileSystem()
      })
    );
    var resolveSync = (
      /**
       * @param {object | string | URL} context context
       * @param {string | URL} parent parent path
       * @param {string | URL | ResolveContext | undefined} specifier specifier to resolve
       * @param {ResolveContext=} resolveContext resolve context
       * @returns {string | false} resolved path
       */
      (context, parent, specifier, resolveContext) => {
        if (typeof context === "string" || context instanceof URL) {
          resolveContext = /** @type {ResolveContext} */
          specifier;
          specifier = parent;
          parent = context;
          context = getNodeContext();
        }
        return getSyncResolver().resolveSync(
          context,
          parent,
          /** @type {string} */
          specifier,
          /** @type {ResolveContext} */
          resolveContext
        );
      }
    );
    var resolvePromise = (
      /**
       * @param {object | string | URL} context context
       * @param {string | URL} parent parent path
       * @param {string | URL | ResolveContext | undefined} specifier specifier to resolve
       * @param {ResolveContext=} resolveContext resolve context
       * @returns {Promise<string | false>} resolved path
       */
      (context, parent, specifier, resolveContext) => {
        if (typeof context === "string" || context instanceof URL) {
          resolveContext = /** @type {ResolveContext} */
          specifier;
          specifier = parent;
          parent = context;
          context = getNodeContext();
        }
        return getAsyncResolver().resolvePromise(
          context,
          parent,
          /** @type {string} */
          specifier,
          /** @type {ResolveContext} */
          resolveContext
        );
      }
    );
    function create(options) {
      const resolver = getResolverFactory().createResolver({
        ...options,
        fileSystem: options.fileSystem || getNodeFileSystem()
      });
      return function create2(context, parent, specifier, resolveContext, callback) {
        if (typeof context === "string" || context instanceof URL) {
          callback = /** @type {ResolveCallback} */
          resolveContext;
          resolveContext = /** @type {ResolveContext} */
          specifier;
          specifier = parent;
          parent = context;
          context = getNodeContext();
        }
        if (typeof callback !== "function") {
          callback = /** @type {ResolveCallback} */
          resolveContext;
        }
        resolver.resolve(
          context,
          parent,
          /** @type {string} */
          specifier,
          /** @type {ResolveContext} */
          resolveContext,
          callback
        );
      };
    }
    function createSync(options) {
      const resolver = getResolverFactory().createResolver({
        useSyncFileSystemCalls: true,
        ...options,
        fileSystem: options.fileSystem || getNodeFileSystem()
      });
      return function createSync2(context, parent, specifier, resolveContext) {
        if (typeof context === "string" || context instanceof URL) {
          resolveContext = /** @type {ResolveContext} */
          specifier;
          specifier = parent;
          parent = context;
          context = getNodeContext();
        }
        return resolver.resolveSync(
          context,
          parent,
          /** @type {string} */
          specifier,
          /** @type {ResolveContext} */
          resolveContext
        );
      };
    }
    function createPromise(options) {
      const resolver = getResolverFactory().createResolver({
        ...options,
        fileSystem: options.fileSystem || getNodeFileSystem()
      });
      return function createPromise2(context, parent, specifier, resolveContext) {
        if (typeof context === "string" || context instanceof URL) {
          resolveContext = /** @type {ResolveContext} */
          specifier;
          specifier = parent;
          parent = context;
          context = getNodeContext();
        }
        return resolver.resolvePromise(
          context,
          parent,
          /** @type {string} */
          specifier,
          /** @type {ResolveContext} */
          resolveContext
        );
      };
    }
    var mergeExports = (obj, exports2) => {
      const descriptors = Object.getOwnPropertyDescriptors(exports2);
      Object.defineProperties(obj, descriptors);
      return (
        /** @type {A & B} */
        Object.freeze(obj)
      );
    };
    module.exports = mergeExports(resolve2, {
      get sync() {
        return resolveSync;
      },
      get promise() {
        return resolvePromise;
      },
      create: mergeExports(create, {
        get sync() {
          return createSync;
        },
        get promise() {
          return createPromise;
        }
      }),
      get ResolverFactory() {
        return getResolverFactory();
      },
      get CachedInputFileSystem() {
        return getCachedFileSystem();
      },
      get CloneBasenamePlugin() {
        return require_CloneBasenamePlugin();
      },
      get LogInfoPlugin() {
        return require_LogInfoPlugin();
      },
      get TsconfigPathsPlugin() {
        return require_TsconfigPathsPlugin();
      },
      get forEachBail() {
        return require_forEachBail();
      }
    });
  }
});

// packages/core/src/app-intelligence/worker.ts
import { parentPort, workerData } from "node:worker_threads";

// packages/core/src/app-intelligence/analyzer.ts
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

// node_modules/@babel/parser/lib/index.js
var Position = class {
  constructor(line, col, index) {
    this.line = void 0;
    this.column = void 0;
    if (index !== void 0) this.index = void 0;
    this.line = line;
    this.column = col;
    if (index !== void 0) this.index = index;
  }
};
var SourceLocation = class {
  start;
  end;
  filename;
  identifierName;
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
};
function createPositionWithColumnOffset(position, columnOffset) {
  const {
    line,
    column,
    index
  } = position;
  return new Position(line, column + columnOffset, index + columnOffset);
}
var code = "BABEL_PARSER_SOURCETYPE_MODULE_REQUIRED";
var ModuleErrors = {
  ImportMetaOutsideModule: {
    message: `import.meta may appear only with 'sourceType: "module"'`,
    code
  },
  ImportOutsideModule: {
    message: `'import' and 'export' may appear only with 'sourceType: "module"'`,
    code
  }
};
var NodeDescriptions = {
  ArrayPattern: "array destructuring pattern",
  AssignmentExpression: "assignment expression",
  AssignmentPattern: "assignment expression",
  ArrowFunctionExpression: "arrow function expression",
  ConditionalExpression: "conditional expression",
  CatchClause: "catch clause",
  ForOfStatement: "for-of statement",
  ForInStatement: "for-in statement",
  ForStatement: "for-loop",
  FormalParameters: "function parameter list",
  Identifier: "identifier",
  ImportSpecifier: "import specifier",
  ImportDefaultSpecifier: "import default specifier",
  ImportNamespaceSpecifier: "import namespace specifier",
  ObjectPattern: "object destructuring pattern",
  ParenthesizedExpression: "parenthesized expression",
  RestElement: "rest element",
  UpdateExpression: {
    true: "prefix operation",
    false: "postfix operation"
  },
  VariableDeclarator: "variable declaration",
  YieldExpression: "yield expression"
};
var toNodeDescription = (node) => node.type === "UpdateExpression" ? NodeDescriptions.UpdateExpression[`${node.prefix}`] : NodeDescriptions[node.type];
var StandardErrors = {
  AccessorIsGenerator: ({
    kind
  }) => `A ${kind}ter cannot be a generator.`,
  ArgumentsInClass: "'arguments' is only allowed in functions and class methods.",
  AsyncFunctionInSingleStatementContext: "Async functions can only be declared at the top level or inside a block.",
  AwaitBindingIdentifier: "Can not use 'await' as identifier inside an async function.",
  AwaitBindingIdentifierInStaticBlock: "Can not use 'await' as identifier inside a static block.",
  AwaitExpressionFormalParameter: "'await' is not allowed in async function parameters.",
  AwaitUsingNotInAsyncContext: "'await using' is only allowed within async functions and at the top levels of modules.",
  AwaitNotInAsyncContext: "'await' is only allowed within async functions and at the top levels of modules.",
  BadGetterArity: "A 'get' accessor must not have any formal parameters.",
  BadSetterArity: "A 'set' accessor must have exactly one formal parameter.",
  BadSetterRestParameter: "A 'set' accessor function argument must not be a rest parameter.",
  ConstructorClassField: "Classes may not have a field named 'constructor'.",
  ConstructorClassPrivateField: "Classes may not have a private field named '#constructor'.",
  ConstructorIsAccessor: "Class constructor may not be an accessor.",
  ConstructorIsAsync: "Constructor can't be an async function.",
  ConstructorIsGenerator: "Constructor can't be a generator.",
  DeclarationMissingInitializer: ({
    kind
  }) => `Missing initializer in ${kind} declaration.`,
  DecoratorArgumentsOutsideParentheses: "Decorator arguments must be moved inside parentheses: use '@(decorator(args))' instead of '@(decorator)(args)'.",
  DecoratorsBeforeAfterExport: "Decorators can be placed *either* before or after the 'export' keyword, but not in both locations at the same time.",
  DecoratorConstructor: "Decorators can't be used with a constructor. Did you mean '@dec class { ... }'?",
  DecoratorSemicolon: "Decorators must not be followed by a semicolon.",
  DecoratorStaticBlock: "Decorators can't be used with a static block.",
  DeferImportRequiresNamespace: 'Only `import defer * as x from "./module"` is valid.',
  DeferExportInvalidAll: '`export defer * from "./module"` is invalid. Explicitly list the re-exported names.',
  DeletePrivateField: "Deleting a private field is not allowed.",
  DestructureNamedImport: "ES2015 named imports do not destructure. Use another statement for destructuring after the import.",
  DuplicateConstructor: "Duplicate constructor in the same class.",
  DuplicateDefaultExport: "Only one default export allowed per module.",
  DuplicateExport: ({
    exportName
  }) => `\`${exportName}\` has already been exported. Exported identifiers must be unique.`,
  DuplicateProto: "Redefinition of __proto__ property.",
  DuplicateRegExpFlags: "Duplicate regular expression flag.",
  ElementAfterRest: "Rest element must be last element.",
  EscapedCharNotAnIdentifier: "Invalid Unicode escape.",
  ExportBindingIsString: ({
    localName,
    exportName
  }) => `A string literal cannot be used as an exported binding without \`from\`.
- Did you mean \`export { '${localName}' as '${exportName}' } from 'some-module'\`?`,
  ExportDefaultFromAsIdentifier: "'from' is not allowed as an identifier after 'export default'.",
  FilteredNamespaceDuplicateName: ({
    name
  }) => `Duplicate name '${name}' in filtered namespace.`,
  FilteredNamespaceRename: "Names in a filtered namespace cannot be renamed using `as`.",
  FilteredNamespaceTypeModifier: "Names in a filtered namespace cannot have a type modifier.",
  ForInOfLoopInitializer: ({
    type
  }) => `'${type === "ForInStatement" ? "for-in" : "for-of"}' loop variable declaration may not have an initializer.`,
  ForInUsing: "For-in loop may not start with 'using' declaration.",
  ForOfAsync: "The left-hand side of a for-of loop may not be 'async'.",
  ForOfLet: "The left-hand side of a for-of loop may not start with 'let'.",
  GeneratorInSingleStatementContext: "Generators can only be declared at the top level or inside a block.",
  IllegalBreakContinue: ({
    type
  }) => `Unsyntactic ${type === "BreakStatement" ? "break" : "continue"}.`,
  IllegalLanguageModeDirective: "Illegal 'use strict' directive in function with non-simple parameter list.",
  IllegalReturn: "'return' outside of function.",
  ImportBindingIsString: ({
    importName
  }) => `A string literal cannot be used as an imported binding.
- Did you mean \`import { "${importName}" as foo }\`?`,
  ImportCallArity: ({
    phase,
    sync
  }) => `\`import${phase ? `.${phase}` : sync ? ".sync" : ""}()\` requires exactly one or two arguments.`,
  ImportCallNotNewExpression: ({
    phase,
    sync
  }) => `Cannot use new with import${phase ? `.${phase}` : sync ? ".sync" : ""}().`,
  ImportCallSpreadArgument: ({
    phase,
    sync
  }) => `\`...\` is not allowed in \`import${phase ? `.${phase}` : sync ? ".sync" : ""}()\`.`,
  IncompatibleRegExpUVFlags: "The 'u' and 'v' regular expression flags cannot be enabled at the same time.",
  InvalidBigIntLiteral: "Invalid BigIntLiteral.",
  InvalidCodePoint: "Code point out of bounds.",
  InvalidCoverDiscardElement: "'void' must be followed by an expression when not used in a binding position.",
  InvalidCoverInitializedName: "Invalid shorthand property initializer.",
  InvalidDigit: ({
    radix
  }) => `Expected number in radix ${radix}.`,
  InvalidEscapeSequence: "Bad character escape sequence.",
  InvalidEscapeSequenceTemplate: "Invalid escape sequence in template.",
  InvalidEscapedReservedWord: ({
    reservedWord
  }) => `Escape sequence in keyword ${reservedWord}.`,
  InvalidIdentifier: ({
    identifierName
  }) => `Invalid identifier ${identifierName}.`,
  InvalidLhs: ({
    ancestor
  }) => `Invalid left-hand side in ${toNodeDescription(ancestor)}.`,
  InvalidLhsBinding: ({
    ancestor
  }) => `Binding invalid left-hand side in ${toNodeDescription(ancestor)}.`,
  InvalidLhsOptionalChaining: ({
    ancestor
  }) => `Invalid optional chaining in the left-hand side of ${toNodeDescription(ancestor)}.`,
  InvalidOrMissingExponent: "Floating-point numbers require a valid exponent after the 'e'.",
  InvalidOrUnexpectedToken: ({
    unexpected
  }) => `Unexpected character '${unexpected}'.`,
  InvalidParenthesizedAssignment: "Invalid parenthesized assignment pattern.",
  InvalidPrivateFieldResolution: ({
    identifierName
  }) => `Private name #${identifierName} is not defined.`,
  InvalidPropertyBindingPattern: "Binding member expression.",
  InvalidRestAssignmentPattern: "Invalid rest operator's argument.",
  LabelRedeclaration: ({
    labelName
  }) => `Label '${labelName}' is already declared.`,
  LetInLexicalBinding: "'let' is disallowed as a lexically bound name.",
  LineTerminatorBeforeArrow: "No line break is allowed before '=>'.",
  MalformedRegExpFlags: "Invalid regular expression flag.",
  MissingClassName: "A class name is required.",
  MissingEqInAssignment: "Only '=' operator can be used for specifying default value.",
  MissingSemicolon: "Missing semicolon.",
  MissingPlugin: ({
    missingPlugin
  }) => `This experimental syntax requires enabling the parser plugin: ${missingPlugin.map((name) => JSON.stringify(name)).join(", ")}.`,
  MissingOneOfPlugins: ({
    missingPlugin
  }) => `This experimental syntax requires enabling one of the following parser plugin(s): ${missingPlugin.map((name) => JSON.stringify(name)).join(", ")}.`,
  MissingUnicodeEscape: "Expecting Unicode escape sequence \\uXXXX.",
  MixingCoalesceWithLogical: "Nullish coalescing operator(??) requires parens when mixing with logical operators.",
  ModuleAttributeInvalidValue: "Only string literals are allowed as module attribute values.",
  ModuleAttributesWithDuplicateKeys: ({
    key
  }) => `Duplicate key "${key}" is not allowed in module attributes.`,
  ModuleExportNameHasLoneSurrogate: ({
    surrogateCharCode
  }) => `An export name cannot include a lone surrogate, found '\\u${surrogateCharCode.toString(16)}'.`,
  ModuleExportUndefined: ({
    localName
  }) => `Export '${localName}' is not defined.`,
  MultipleDefaultsInSwitch: "Multiple default clauses.",
  NewlineAfterThrow: "Illegal newline after throw.",
  NoCatchOrFinally: "Missing catch or finally clause.",
  NumberIdentifier: "Identifier directly after number.",
  NumericSeparatorInEscapeSequence: "Numeric separators are not allowed inside unicode escape sequences or hex escape sequences.",
  ObsoleteAwaitStar: "'await*' has been removed from the async functions proposal. Use Promise.all() instead.",
  OptionalChainingNoNew: "Constructors in/after an Optional Chain are not allowed.",
  OptionalChainingNoTemplate: "Tagged Template Literals are not allowed in optionalChain.",
  OverrideOnConstructor: "'override' modifier cannot appear on a constructor declaration.",
  ParamDupe: "Argument name clash.",
  PatternHasAccessor: "Object pattern can't contain getter or setter.",
  PatternHasMethod: "Object pattern can't contain methods.",
  PrivateInExpectedIn: ({
    identifierName
  }) => `Private names are only allowed in property accesses (\`obj.#${identifierName}\`) or in \`in\` expressions (\`#${identifierName} in obj\`).`,
  PrivateNameRedeclaration: ({
    identifierName
  }) => `Duplicate private name #${identifierName}.`,
  RestTrailingComma: "Unexpected trailing comma after rest element.",
  SloppyFunction: "In non-strict mode code, functions can only be declared at top level or inside a block.",
  SloppyFunctionAnnexB: "In non-strict mode code, functions can only be declared at top level, inside a block, or as the body of an if statement.",
  SourcePhaseImportRequiresDefault: 'Only `import source x from "./module"` is valid.',
  StaticPrototype: "Classes may not have static property named prototype.",
  SuperCallNotNewExpression: "Cannot use new with super(...).",
  SuperNotAllowed: "`super()` is only valid inside a class constructor of a subclass. Maybe a typo in the method name ('constructor') or not extending another class?",
  SuperPrivateField: "Private fields can't be accessed on super.",
  TrailingDecorator: "Decorators must be attached to a class element.",
  UnexpectedArgumentPlaceholder: "Unexpected argument placeholder.",
  UnexpectedDigitAfterHash: "Unexpected digit after hash token.",
  UnexpectedImportExport: "'import' and 'export' may only appear at the top level.",
  UnexpectedKeyword: ({
    keyword
  }) => `Unexpected keyword '${keyword}'.`,
  UnexpectedLeadingDecorator: "Leading decorators must be attached to a class declaration.",
  UnexpectedLexicalDeclaration: "Lexical declaration cannot appear in a single-statement context.",
  UnexpectedNewTarget: "`new.target` can only be used in functions or class properties.",
  UnexpectedNumericSeparator: "A numeric separator is only allowed between two digits.",
  UnexpectedPrivateField: "Unexpected private name.",
  UnexpectedReservedWord: ({
    reservedWord
  }) => `Unexpected reserved word '${reservedWord}'.`,
  UnexpectedSuper: "'super' is only allowed in object methods and classes.",
  UnexpectedToken: ({
    expected,
    unexpected
  }) => `Unexpected token${unexpected ? ` '${unexpected}'.` : ""}${expected ? `, expected "${expected}"` : ""}`,
  UnexpectedTokenUnaryExponentiation: "Illegal expression. Wrap left hand side or entire exponentiation in parentheses.",
  UnexpectedUsingDeclaration: "Using declaration cannot appear in the top level when source type is `script` or in the bare case statement.",
  UnexpectedVoidPattern: "Unexpected void binding.",
  UnsupportedDecoratorExport: "A decorated export must export a class declaration.",
  UnsupportedDefaultExport: "Only expressions, functions or classes are allowed as the `default` export.",
  UnsupportedImport: "`import` can only be used in `import()` or `import.meta`.",
  UnsupportedMetaProperty: ({
    target,
    onlyValidPropertyName
  }) => `The only valid meta property for ${target} is ${target}.${onlyValidPropertyName}.`,
  UnsupportedParameterDecorator: "Decorators cannot be used to decorate parameters.",
  UnsupportedPropertyDecorator: "Decorators cannot be used to decorate object literal properties.",
  UnsupportedSuper: "'super' can only be used with function calls (i.e. super()) or in property accesses (i.e. super.prop or super[prop]).",
  UnterminatedComment: "Unterminated comment.",
  UnterminatedRegExp: "Unterminated regular expression.",
  UnterminatedString: "Unterminated string constant.",
  UnterminatedTemplate: "Unterminated template.",
  UsingDeclarationExport: "Using declaration cannot be exported.",
  UsingDeclarationHasBindingPattern: "Using declaration cannot have destructuring patterns.",
  VarRedeclaration: ({
    identifierName
  }) => `Identifier '${identifierName}' has already been declared.`,
  VoidPatternCatchClauseParam: "A void binding can not be the catch clause parameter. Use `try { ... } catch { ... }` if you want to discard the caught error.",
  VoidPatternInitializer: "A void binding may not have an initializer.",
  YieldBindingIdentifier: "Can not use 'yield' as identifier inside a generator.",
  YieldInParameter: "Yield expression is not allowed in formal parameters.",
  YieldNotInGeneratorFunction: "'yield' is only allowed within generator functions.",
  ZeroDigitNumericSeparator: "Numeric separator can not be used after leading 0."
};
var StrictModeErrors = {
  StrictDelete: "Deleting local variable in strict mode.",
  StrictEvalArguments: ({
    referenceName
  }) => `Assigning to '${referenceName}' in strict mode.`,
  StrictEvalArgumentsBinding: ({
    bindingName
  }) => `Binding '${bindingName}' in strict mode.`,
  StrictFunction: "In strict mode code, functions can only be declared at top level or inside a block.",
  StrictNumericEscape: "The only valid numeric escape in strict mode is '\\0'.",
  StrictOctalLiteral: "Legacy octal literals are not allowed in strict mode.",
  StrictWith: "'with' in strict mode."
};
var ParseExpressionErrors = {
  ParseExpressionEmptyInput: "Unexpected parseExpression() input: The input is empty or contains only comments.",
  ParseExpressionExpectsEOF: ({
    unexpected
  }) => `Unexpected parseExpression() input: The input should contain exactly one expression, but the first expression is followed by the unexpected character \`${String.fromCodePoint(unexpected)}\`.`
};
var UnparenthesizedPipeBodyDescriptions = /* @__PURE__ */ new Set(["ArrowFunctionExpression", "AssignmentExpression", "ConditionalExpression", "YieldExpression"]);
var PipelineOperatorErrors = {
  PipeTopicRequiresHackPipes: 'Topic references are only supported when using the `"proposal": "hack"` version of the pipeline proposal.',
  PipeTopicUnbound: "Topic reference is unbound; it must be inside a pipe body.",
  PipeTopicUnconfiguredToken: ({
    token
  }) => `Invalid topic token ${token}. In order to use ${token} as a topic reference, the pipelineOperator plugin must be configured with { "proposal": "hack", "topicToken": "${token}" }.`,
  PipeTopicUnused: "Hack-style pipe body does not contain a topic reference; Hack-style pipes must use topic at least once.",
  PipeUnparenthesizedBody: ({
    type
  }) => `Hack-style pipe body cannot be an unparenthesized ${toNodeDescription({
    type
  })}; please wrap it in parentheses.`,
  PipelineUnparenthesized: "Cannot mix binary operator with solo-await F#-style pipeline. Please wrap the pipeline in parentheses."
};
var FunctionBindErrors = {
  UnsupportedBind: "Binding should be performed on object property.",
  UnsupportedBindRHS: "The right-hand side of binding can not be super or import."
};
function defineHidden(obj, key, value) {
  Object.defineProperty(obj, key, {
    enumerable: false,
    configurable: true,
    value
  });
}
function toParseErrorConstructor({
  toMessage,
  code: code2,
  reasonCode,
  syntaxPlugin
}) {
  const hasMissingPlugin = reasonCode === "MissingPlugin" || reasonCode === "MissingOneOfPlugins";
  return function constructor(loc, pos, details) {
    const error = new SyntaxError();
    error.code = code2;
    error.reasonCode = reasonCode;
    error.loc = loc;
    error.pos = pos;
    error.syntaxPlugin = syntaxPlugin;
    if (hasMissingPlugin) {
      error.missingPlugin = details.missingPlugin;
    }
    defineHidden(error, "clone", function clone(overrides = {}) {
      const {
        line,
        column,
        index = pos
      } = overrides.loc ?? loc;
      return constructor(new Position(line, column), index, {
        ...details,
        ...overrides.details
      });
    });
    defineHidden(error, "details", details);
    Object.defineProperty(error, "message", {
      configurable: true,
      get() {
        const message = `${toMessage(details)} (${loc.line}:${loc.column})`;
        this.message = message;
        return message;
      },
      set(value) {
        Object.defineProperty(this, "message", {
          value,
          writable: true
        });
      }
    });
    return error;
  };
}
function ParseErrorEnum(argument, syntaxPlugin) {
  if (Array.isArray(argument)) {
    return (parseErrorTemplates) => ParseErrorEnum(parseErrorTemplates, argument[0]);
  }
  const ParseErrorConstructors = {};
  for (const reasonCode of Object.keys(argument)) {
    const template = argument[reasonCode];
    const {
      message,
      ...rest
    } = typeof template === "string" ? {
      message: () => template
    } : typeof template === "function" ? {
      message: template
    } : template;
    const toMessage = typeof message === "string" ? () => message : message;
    ParseErrorConstructors[reasonCode] = toParseErrorConstructor({
      code: "BABEL_PARSER_SYNTAX_ERROR",
      reasonCode,
      toMessage,
      ...syntaxPlugin ? {
        syntaxPlugin
      } : {},
      ...rest
    });
  }
  return ParseErrorConstructors;
}
var Errors = {
  ...ParseErrorEnum(ModuleErrors),
  ...ParseErrorEnum(StandardErrors),
  ...ParseErrorEnum(StrictModeErrors),
  ...ParseErrorEnum(ParseExpressionErrors),
  ...ParseErrorEnum`pipelineOperator`(PipelineOperatorErrors),
  ...ParseErrorEnum`functionBind`(FunctionBindErrors)
};
function createDefaultOptions() {
  return {
    sourceType: "script",
    sourceFilename: void 0,
    startIndex: 0,
    startColumn: 0,
    startLine: 1,
    allowAwaitOutsideFunction: false,
    allowReturnOutsideFunction: false,
    allowNewTargetOutsideFunction: false,
    allowImportExportEverywhere: false,
    allowSuperOutsideMethod: false,
    allowUndeclaredExports: false,
    allowYieldOutsideFunction: false,
    plugins: [],
    strictMode: void 0,
    ranges: false,
    locations: true,
    tokens: false,
    createImportExpressions: true,
    createParenthesizedExpressions: false,
    errorRecovery: false,
    attachComment: true,
    annexB: true
  };
}
function getOptions(opts) {
  const options = createDefaultOptions();
  if (opts == null) {
    return options;
  }
  if (opts.annexB != null && opts.annexB !== false) {
    throw new Error("The `annexB` option can only be set to `false`.");
  }
  for (const key of Object.keys(options)) {
    if (opts[key] != null) options[key] = opts[key];
  }
  if (options.startLine === 1) {
    if (opts.startIndex == null && options.startColumn > 0) {
      options.startIndex = options.startColumn;
    } else if (opts.startColumn == null && options.startIndex > 0) {
      options.startColumn = options.startIndex;
    }
  } else if (opts.startColumn == null || opts.startIndex == null) {
    throw new Error("With a `startLine > 1` you must also specify `startIndex` and `startColumn`.");
  }
  if (options.sourceType === "commonjs") {
    if (opts.allowAwaitOutsideFunction != null) {
      throw new Error("The `allowAwaitOutsideFunction` option cannot be used with `sourceType: 'commonjs'`.");
    }
    if (opts.allowReturnOutsideFunction != null) {
      throw new Error("`sourceType: 'commonjs'` implies `allowReturnOutsideFunction: true`, please remove the `allowReturnOutsideFunction` option or use `sourceType: 'script'`.");
    }
    if (opts.allowNewTargetOutsideFunction != null) {
      throw new Error("`sourceType: 'commonjs'` implies `allowNewTargetOutsideFunction: true`, please remove the `allowNewTargetOutsideFunction` option or use `sourceType: 'script'`.");
    }
  }
  return options;
}
function toESTreeLocation(node) {
  if (node.loc) {
    const {
      start,
      end
    } = node.loc;
    node.loc.start = new Position(start.line, start.column);
    node.loc.end = new Position(end.line, end.column);
  }
  return node;
}
var estree = (superClass) => class ESTreeParserMixin extends superClass {
  createPosition(loc) {
    return new Position(loc.line, loc.column);
  }
  parse() {
    const file = super.parse();
    if (this.optionFlags & 512) {
      file.tokens = file.tokens.map(toESTreeLocation);
    }
    return toESTreeLocation(file);
  }
  parseRegExpLiteral({
    pattern,
    flags
  }) {
    let regex = null;
    try {
      regex = new RegExp(pattern, flags);
    } catch (_) {
    }
    const node = this.estreeParseLiteral(regex);
    node.regex = {
      pattern,
      flags
    };
    return node;
  }
  parseBigIntLiteral(value) {
    let bigInt;
    try {
      bigInt = BigInt(value);
    } catch {
      bigInt = null;
    }
    const node = this.estreeParseLiteral(bigInt);
    node.bigint = node.value !== null ? String(node.value) : value;
    return node;
  }
  estreeParseLiteral(value) {
    return this.parseLiteral(value, "Literal");
  }
  parseStringLiteral(value) {
    return this.estreeParseLiteral(value);
  }
  parseNumericLiteral(value) {
    return this.estreeParseLiteral(value);
  }
  parseNullLiteral() {
    return this.estreeParseLiteral(null);
  }
  parseBooleanLiteral(value) {
    return this.estreeParseLiteral(value);
  }
  estreeParseChainExpression(node, endNode) {
    const chain = this.startNodeAtNode(node);
    chain.expression = node;
    return this.finishNodeAtNode(chain, "ChainExpression", endNode);
  }
  directiveToStmt(directive) {
    const expression = directive.value;
    delete directive.value;
    this.castNodeTo(expression, "Literal");
    expression.raw = expression.extra.raw;
    expression.value = expression.extra.expressionValue;
    const stmt = this.castNodeTo(directive, "ExpressionStatement");
    stmt.expression = expression;
    stmt.directive = expression.extra.rawValue;
    delete expression.extra;
    return stmt;
  }
  fillOptionalPropertiesForTSESLint(node) {
  }
  cloneEstreeStringLiteral(node) {
    const {
      start,
      end,
      loc,
      range,
      raw,
      value
    } = node;
    const cloned = Object.create(node.constructor.prototype);
    cloned.type = "Literal";
    cloned.start = start;
    cloned.end = end;
    cloned.loc = loc;
    cloned.range = range;
    cloned.raw = raw;
    cloned.value = value;
    return cloned;
  }
  initFunction(node, isAsync) {
    super.initFunction(node, isAsync);
    node.expression = false;
  }
  checkDeclaration(node) {
    if (node != null && this.isObjectProperty(node)) {
      this.checkDeclaration(node.value);
    } else {
      super.checkDeclaration(node);
    }
  }
  getObjectOrClassMethodParams(method) {
    return method.value.params;
  }
  isValidDirective(stmt) {
    return stmt.type === "ExpressionStatement" && stmt.expression.type === "Literal" && typeof stmt.expression.value === "string" && !stmt.expression.extra?.parenthesized;
  }
  parseBlockBody(node, allowDirectives, topLevel, end, afterBlockParse) {
    super.parseBlockBody(node, allowDirectives, topLevel, end, afterBlockParse);
    const directiveStatements = node.directives.map((d) => this.directiveToStmt(d));
    node.body = directiveStatements.concat(node.body);
    delete node.directives;
  }
  parsePrivateName() {
    const node = super.parsePrivateName();
    return this.convertPrivateNameToPrivateIdentifier(node);
  }
  convertPrivateNameToPrivateIdentifier(node) {
    const name = super.getPrivateNameSV(node);
    delete node.id;
    node.name = name;
    return this.castNodeTo(node, "PrivateIdentifier");
  }
  isPrivateName(node) {
    return node.type === "PrivateIdentifier";
  }
  getPrivateNameSV(node) {
    return node.name;
  }
  parseLiteral(value, type) {
    const node = super.parseLiteral(value, type);
    node.raw = node.extra.raw;
    delete node.extra;
    return node;
  }
  parseFunctionBody(node, allowExpression, isMethod = false) {
    super.parseFunctionBody(node, allowExpression, isMethod);
    node.expression = node.body.type !== "BlockStatement";
  }
  parseMethod(node, isGenerator, isAsync, isConstructor, allowDirectSuper, type, inClassScope = false) {
    let funcNode = this.startNode();
    funcNode.kind = node.kind;
    funcNode = super.parseMethod(funcNode, isGenerator, isAsync, isConstructor, allowDirectSuper, type, inClassScope);
    delete funcNode.kind;
    const {
      typeParameters
    } = node;
    if (typeParameters) {
      delete node.typeParameters;
      funcNode.typeParameters = typeParameters;
      this.resetStartLocationFromNode(funcNode, typeParameters);
    }
    const valueNode = this.castNodeTo(funcNode, this.hasPlugin("typescript") && !funcNode.body ? "TSEmptyBodyFunctionExpression" : "FunctionExpression");
    node.value = valueNode;
    if (type === "ClassPrivateMethod") {
      node.computed = false;
    }
    if (this.hasPlugin("typescript")) {
      if (node.abstract) {
        delete node.abstract;
        return this.finishNode(node, "TSAbstractMethodDefinition");
      }
    }
    if (type === "ObjectMethod") {
      if (node.kind === "method") {
        node.kind = "init";
      }
      node.shorthand = false;
      return this.finishNode(node, "Property");
    } else {
      return this.finishNode(node, "MethodDefinition");
    }
  }
  nameIsConstructor(key) {
    if (key.type === "Literal") return key.value === "constructor";
    return super.nameIsConstructor(key);
  }
  parseClassProperty(...args) {
    const propertyNode = super.parseClassProperty(...args);
    if (propertyNode.abstract && this.hasPlugin("typescript")) {
      delete propertyNode.abstract;
      this.castNodeTo(propertyNode, "TSAbstractPropertyDefinition");
    } else {
      this.castNodeTo(propertyNode, "PropertyDefinition");
    }
    return propertyNode;
  }
  parseClassPrivateProperty(...args) {
    const propertyNode = super.parseClassPrivateProperty(...args);
    if (propertyNode.abstract && this.hasPlugin("typescript")) {
      this.castNodeTo(propertyNode, "TSAbstractPropertyDefinition");
    } else {
      this.castNodeTo(propertyNode, "PropertyDefinition");
    }
    propertyNode.computed = false;
    return propertyNode;
  }
  parseClassAccessorProperty(node) {
    const accessorPropertyNode = super.parseClassAccessorProperty(node);
    if (accessorPropertyNode.abstract && this.hasPlugin("typescript")) {
      delete accessorPropertyNode.abstract;
      this.castNodeTo(accessorPropertyNode, "TSAbstractAccessorProperty");
    } else {
      this.castNodeTo(accessorPropertyNode, "AccessorProperty");
    }
    return accessorPropertyNode;
  }
  parseObjectProperty(prop, startLoc, isPattern, refExpressionErrors) {
    const node = super.parseObjectProperty(prop, startLoc, isPattern, refExpressionErrors);
    if (node) {
      node.kind = "init";
      this.castNodeTo(node, "Property");
    }
    return node;
  }
  finishObjectProperty(node) {
    node.kind = "init";
    return this.finishNode(node, "Property");
  }
  isValidLVal(type, disallowCallExpression, isUnparenthesizedInAssign, binding) {
    return type === "Property" ? "value" : super.isValidLVal(type, disallowCallExpression, isUnparenthesizedInAssign, binding);
  }
  isAssignable(node, isBinding) {
    if (node != null && this.isObjectProperty(node)) {
      return this.isAssignable(node.value, isBinding);
    }
    return super.isAssignable(node, isBinding);
  }
  toAssignable(node, isLHS = false) {
    if (node != null && this.isObjectProperty(node)) {
      const {
        key,
        value
      } = node;
      if (this.isPrivateName(key)) {
        this.classScope.usePrivateName(this.getPrivateNameSV(key), key.start);
      }
      this.toAssignable(value, isLHS);
    } else {
      super.toAssignable(node, isLHS);
    }
  }
  toAssignableObjectExpressionProp(prop, isLast, isLHS) {
    if (prop.type === "Property" && (prop.kind === "get" || prop.kind === "set")) {
      this.raise(Errors.PatternHasAccessor, prop.key);
    } else if (prop.type === "Property" && prop.method) {
      this.raise(Errors.PatternHasMethod, prop.key);
    } else {
      super.toAssignableObjectExpressionProp(prop, isLast, isLHS);
    }
  }
  finishCallExpression(unfinished, optional) {
    const node = super.finishCallExpression(unfinished, optional);
    if (node.callee.type === "Import") {
      this.castNodeTo(node, "ImportExpression");
      node.source = node.arguments[0];
      node.options = node.arguments[1] ?? null;
      delete node.arguments;
      delete node.callee;
    } else if (node.type === "OptionalCallExpression") {
      this.castNodeTo(node, "CallExpression");
    } else {
      node.optional = false;
    }
    return node;
  }
  parseExport(unfinished, decorators) {
    const exportStartLoc = this.state.lastTokStartLoc;
    const node = super.parseExport(unfinished, decorators);
    switch (node.type) {
      case "ExportAllDeclaration":
        node.exported = null;
        break;
      case "ExportNamedDeclaration":
        if (node.specifiers.length === 1 && node.specifiers[0].type === "ExportNamespaceSpecifier" && !node.specifiers[0].exportsFilter) {
          this.castNodeTo(node, "ExportAllDeclaration");
          node.exported = node.specifiers[0].exported;
          delete node.specifiers;
        }
      case "ExportDefaultDeclaration":
        {
          const {
            declaration
          } = node;
          if (declaration?.type === "ClassDeclaration" && declaration.decorators?.length > 0 && declaration.start === node.start) {
            this.resetStartLocation(node, exportStartLoc);
          }
        }
        break;
    }
    return node;
  }
  stopParseSubscript(base, state) {
    const node = super.stopParseSubscript(base, state);
    if (state.optionalChainMember) {
      return this.estreeParseChainExpression(node, base);
    }
    return node;
  }
  parseMember(base, startLoc, state, computed, optional) {
    const node = super.parseMember(base, startLoc, state, computed, optional);
    if (node.type === "OptionalMemberExpression") {
      this.castNodeTo(node, "MemberExpression");
    } else {
      node.optional = false;
    }
    return node;
  }
  isOptionalMemberExpression(node) {
    if (node.type === "ChainExpression") {
      return node.expression.type === "MemberExpression";
    }
    return super.isOptionalMemberExpression(node);
  }
  hasPropertyAsPrivateName(node) {
    if (node.type === "ChainExpression") {
      node = node.expression;
    }
    return super.hasPropertyAsPrivateName(node);
  }
  isObjectProperty(node) {
    return node.type === "Property" && node.kind === "init" && !node.method;
  }
  isObjectMethod(node) {
    return node.type === "Property" && (node.method || node.kind === "get" || node.kind === "set");
  }
  castNodeTo(node, type) {
    const result = super.castNodeTo(node, type);
    this.fillOptionalPropertiesForTSESLint(result);
    return result;
  }
  cloneIdentifier(node) {
    const cloned = super.cloneIdentifier(node);
    this.fillOptionalPropertiesForTSESLint(cloned);
    return cloned;
  }
  cloneStringLiteral(node) {
    if (node.type === "Literal") {
      return this.cloneEstreeStringLiteral(node);
    }
    return super.cloneStringLiteral(node);
  }
  finishNodeAt(node, type, endLoc) {
    return toESTreeLocation(super.finishNodeAt(node, type, endLoc));
  }
  finishNodeAtNode(node, type, endNode) {
    return toESTreeLocation(super.finishNodeAtNode(node, type, endNode));
  }
  finishNode(node, type) {
    const result = super.finishNode(node, type);
    this.fillOptionalPropertiesForTSESLint(result);
    return result;
  }
  resetStartLocation(node, startLoc) {
    super.resetStartLocation(node, startLoc);
    toESTreeLocation(node);
  }
  resetEndLocation(node, endLoc = this.state.lastTokEndLoc) {
    super.resetEndLocation(node, endLoc);
    toESTreeLocation(node);
  }
};
var beforeExpr = true;
var startsExpr = true;
var isLoop = true;
var isAssign = true;
var prefix = true;
var postfix = true;
var ExportedTokenType = class {
  label;
  keyword;
  beforeExpr;
  startsExpr;
  rightAssociative;
  isLoop;
  isAssign;
  prefix;
  postfix;
  binop;
  constructor(label, conf = {}) {
    this.label = label;
    this.keyword = conf.keyword;
    this.beforeExpr = !!conf.beforeExpr;
    this.startsExpr = !!conf.startsExpr;
    this.rightAssociative = !!conf.rightAssociative;
    this.isLoop = !!conf.isLoop;
    this.isAssign = !!conf.isAssign;
    this.prefix = !!conf.prefix;
    this.postfix = !!conf.postfix;
    this.binop = conf.binop != null ? conf.binop : null;
  }
};
var keywords$1 = /* @__PURE__ */ new Map();
function createKeyword(name, options = {}) {
  options.keyword = name;
  const token = createToken(name, options);
  keywords$1.set(name, token);
  return token;
}
function createBinop(name, binop) {
  return createToken(name, {
    beforeExpr,
    binop
  });
}
var tokenTypeCounter = -1;
var tokenTypes = [];
var tokenLabels = [];
var tokenBinops = [];
var tokenBeforeExprs = [];
var tokenStartsExprs = [];
var tokenPrefixes = [];
function createToken(name, options = {}) {
  ++tokenTypeCounter;
  tokenLabels.push(name);
  tokenBinops.push(options.binop ?? -1);
  tokenBeforeExprs.push(options.beforeExpr ?? false);
  tokenStartsExprs.push(options.startsExpr ?? false);
  tokenPrefixes.push(options.prefix ?? false);
  tokenTypes.push(new ExportedTokenType(name, options));
  return tokenTypeCounter;
}
function createKeywordLike(name, options = {}) {
  ++tokenTypeCounter;
  keywords$1.set(name, tokenTypeCounter);
  tokenLabels.push(name);
  tokenBinops.push(options.binop ?? -1);
  tokenBeforeExprs.push(options.beforeExpr ?? false);
  tokenStartsExprs.push(options.startsExpr ?? false);
  tokenPrefixes.push(options.prefix ?? false);
  tokenTypes.push(new ExportedTokenType("name", options));
  return tokenTypeCounter;
}
var tt = {
  bracketL: createToken("[", {
    beforeExpr,
    startsExpr
  }),
  bracketR: createToken("]"),
  braceL: createToken("{", {
    beforeExpr,
    startsExpr
  }),
  braceBarL: createToken("{|", {
    beforeExpr,
    startsExpr
  }),
  braceR: createToken("}"),
  braceBarR: createToken("|}"),
  parenL: createToken("(", {
    beforeExpr,
    startsExpr
  }),
  parenR: createToken(")"),
  comma: createToken(",", {
    beforeExpr
  }),
  semi: createToken(";", {
    beforeExpr
  }),
  colon: createToken(":", {
    beforeExpr
  }),
  doubleColon: createToken("::", {
    beforeExpr
  }),
  dot: createToken("."),
  question: createToken("?", {
    beforeExpr
  }),
  questionDot: createToken("?."),
  arrow: createToken("=>", {
    beforeExpr
  }),
  template: createToken("template"),
  ellipsis: createToken("...", {
    beforeExpr
  }),
  backQuote: createToken("`", {
    startsExpr
  }),
  dollarBraceL: createToken("${", {
    beforeExpr,
    startsExpr
  }),
  templateTail: createToken("...`", {
    startsExpr
  }),
  templateNonTail: createToken("...${", {
    beforeExpr,
    startsExpr
  }),
  at: createToken("@"),
  hash: createToken("#", {
    startsExpr
  }),
  interpreterDirective: createToken("#!..."),
  eq: createToken("=", {
    beforeExpr,
    isAssign
  }),
  assign: createToken("_=", {
    beforeExpr,
    isAssign
  }),
  slashAssign: createToken("_=", {
    beforeExpr,
    isAssign
  }),
  xorAssign: createToken("_=", {
    beforeExpr,
    isAssign
  }),
  moduloAssign: createToken("_=", {
    beforeExpr,
    isAssign
  }),
  incDec: createToken("++/--", {
    prefix,
    postfix,
    startsExpr
  }),
  bang: createToken("!", {
    beforeExpr,
    prefix,
    startsExpr
  }),
  tilde: createToken("~", {
    beforeExpr,
    prefix,
    startsExpr
  }),
  doubleCaret: createToken("^^", {
    startsExpr
  }),
  doubleAt: createToken("@@", {
    startsExpr
  }),
  pipeline: createBinop("|>", 0),
  nullishCoalescing: createBinop("??", 1),
  logicalOR: createBinop("||", 1),
  logicalAND: createBinop("&&", 2),
  bitwiseOR: createBinop("|", 3),
  bitwiseXOR: createBinop("^", 4),
  bitwiseAND: createBinop("&", 5),
  equality: createBinop("==/!=/===/!==", 6),
  lt: createBinop("</>/<=/>=", 7),
  gt: createBinop("</>/<=/>=", 7),
  relational: createBinop("</>/<=/>=", 7),
  bitShift: createBinop("<</>>/>>>", 8),
  bitShiftL: createBinop("<</>>/>>>", 8),
  bitShiftR: createBinop("<</>>/>>>", 8),
  plusMin: createToken("+/-", {
    beforeExpr,
    binop: 9,
    prefix,
    startsExpr
  }),
  modulo: createToken("%", {
    binop: 10,
    startsExpr
  }),
  star: createToken("*", {
    binop: 10
  }),
  slash: createBinop("/", 10),
  exponent: createToken("**", {
    beforeExpr,
    binop: 11,
    rightAssociative: true
  }),
  _in: createKeyword("in", {
    beforeExpr,
    binop: 7
  }),
  _instanceof: createKeyword("instanceof", {
    beforeExpr,
    binop: 7
  }),
  _break: createKeyword("break"),
  _case: createKeyword("case", {
    beforeExpr
  }),
  _catch: createKeyword("catch"),
  _continue: createKeyword("continue"),
  _debugger: createKeyword("debugger"),
  _default: createKeyword("default", {
    beforeExpr
  }),
  _else: createKeyword("else", {
    beforeExpr
  }),
  _finally: createKeyword("finally"),
  _function: createKeyword("function", {
    startsExpr
  }),
  _if: createKeyword("if"),
  _return: createKeyword("return", {
    beforeExpr
  }),
  _switch: createKeyword("switch"),
  _throw: createKeyword("throw", {
    beforeExpr,
    prefix,
    startsExpr
  }),
  _try: createKeyword("try"),
  _var: createKeyword("var"),
  _const: createKeyword("const"),
  _with: createKeyword("with"),
  _new: createKeyword("new", {
    beforeExpr,
    startsExpr
  }),
  _this: createKeyword("this", {
    startsExpr
  }),
  _super: createKeyword("super", {
    startsExpr
  }),
  _class: createKeyword("class", {
    startsExpr
  }),
  _extends: createKeyword("extends", {
    beforeExpr
  }),
  _export: createKeyword("export"),
  _import: createKeyword("import", {
    startsExpr
  }),
  _null: createKeyword("null", {
    startsExpr
  }),
  _true: createKeyword("true", {
    startsExpr
  }),
  _false: createKeyword("false", {
    startsExpr
  }),
  _typeof: createKeyword("typeof", {
    beforeExpr,
    prefix,
    startsExpr
  }),
  _void: createKeyword("void", {
    beforeExpr,
    prefix,
    startsExpr
  }),
  _delete: createKeyword("delete", {
    beforeExpr,
    prefix,
    startsExpr
  }),
  _do: createKeyword("do", {
    isLoop,
    beforeExpr
  }),
  _for: createKeyword("for", {
    isLoop
  }),
  _while: createKeyword("while", {
    isLoop
  }),
  _arguments: createKeywordLike("arguments", {
    startsExpr
  }),
  _as: createKeywordLike("as", {
    startsExpr
  }),
  _assert: createKeywordLike("assert", {
    startsExpr
  }),
  _async: createKeywordLike("async", {
    startsExpr
  }),
  _await: createKeywordLike("await", {
    startsExpr
  }),
  _defer: createKeywordLike("defer", {
    startsExpr
  }),
  _from: createKeywordLike("from", {
    startsExpr
  }),
  _get: createKeywordLike("get", {
    startsExpr
  }),
  _let: createKeywordLike("let", {
    startsExpr
  }),
  _meta: createKeywordLike("meta", {
    startsExpr
  }),
  _of: createKeywordLike("of", {
    startsExpr
  }),
  _sent: createKeywordLike("sent", {
    startsExpr
  }),
  _set: createKeywordLike("set", {
    startsExpr
  }),
  _source: createKeywordLike("source", {
    startsExpr
  }),
  _static: createKeywordLike("static", {
    startsExpr
  }),
  _struct: createKeywordLike("struct", {
    startsExpr
  }),
  _sync: createKeywordLike("sync", {
    startsExpr
  }),
  _using: createKeywordLike("using", {
    startsExpr
  }),
  _yield: createKeywordLike("yield", {
    startsExpr
  }),
  _asserts: createKeywordLike("asserts", {
    startsExpr
  }),
  _checks: createKeywordLike("checks", {
    startsExpr
  }),
  _exports: createKeywordLike("exports", {
    startsExpr
  }),
  _global: createKeywordLike("global", {
    startsExpr
  }),
  _implements: createKeywordLike("implements", {
    startsExpr
  }),
  _intrinsic: createKeywordLike("intrinsic", {
    startsExpr
  }),
  _infer: createKeywordLike("infer", {
    startsExpr
  }),
  _is: createKeywordLike("is", {
    startsExpr
  }),
  _mixins: createKeywordLike("mixins", {
    startsExpr
  }),
  _proto: createKeywordLike("proto", {
    startsExpr
  }),
  _require: createKeywordLike("require", {
    startsExpr
  }),
  _satisfies: createKeywordLike("satisfies", {
    startsExpr
  }),
  _keyof: createKeywordLike("keyof", {
    startsExpr
  }),
  _readonly: createKeywordLike("readonly", {
    startsExpr
  }),
  _unique: createKeywordLike("unique", {
    startsExpr
  }),
  _abstract: createKeywordLike("abstract", {
    startsExpr
  }),
  _declare: createKeywordLike("declare", {
    startsExpr
  }),
  _enum: createKeywordLike("enum", {
    startsExpr
  }),
  _module: createKeywordLike("module", {
    startsExpr
  }),
  _namespace: createKeywordLike("namespace", {
    startsExpr
  }),
  _interface: createKeywordLike("interface", {
    startsExpr
  }),
  _type: createKeywordLike("type", {
    startsExpr
  }),
  _opaque: createKeywordLike("opaque", {
    startsExpr
  }),
  name: createToken("name", {
    startsExpr
  }),
  placeholder: createToken("%%", {
    startsExpr
  }),
  string: createToken("string", {
    startsExpr
  }),
  num: createToken("num", {
    startsExpr
  }),
  bigint: createToken("bigint", {
    startsExpr
  }),
  regexp: createToken("regexp", {
    startsExpr
  }),
  privateName: createToken("#name", {
    startsExpr
  }),
  eof: createToken("eof"),
  jsxName: createToken("jsxName"),
  jsxText: createToken("jsxText", {
    beforeExpr
  }),
  jsxTagStart: createToken("jsxTagStart", {
    startsExpr
  }),
  jsxTagEnd: createToken("jsxTagEnd")
};
function tokenIsIdentifier(token) {
  return token >= 89 && token <= 132;
}
function tokenKeywordOrIdentifierIsKeyword(token) {
  return token <= 88;
}
function tokenIsKeywordOrIdentifier(token) {
  return token >= 54 && token <= 132;
}
function tokenIsLiteralPropertyName(token) {
  return token >= 54 && token <= 135;
}
function tokenComesBeforeExpression(token) {
  return tokenBeforeExprs[token];
}
function tokenCanStartExpression(token) {
  return tokenStartsExprs[token];
}
function tokenIsAssignment(token) {
  return token >= 25 && token <= 29;
}
function tokenIsFlowInterfaceOrTypeOrOpaque(token) {
  return token >= 128 && token <= 130;
}
function tokenIsLoop(token) {
  return token >= 86 && token <= 88;
}
function tokenIsKeyword(token) {
  return token >= 54 && token <= 88;
}
function tokenIsOperator(token) {
  return token >= 35 && token <= 55;
}
function tokenIsPostfix(token) {
  return token === 30;
}
function tokenIsPrefix(token) {
  return tokenPrefixes[token];
}
function tokenIsTSTypeOperator(token) {
  return token >= 120 && token <= 122;
}
function tokenIsTSDeclarationStart(token) {
  return token >= 123 && token <= 129;
}
function tokenLabelName(token) {
  return tokenLabels[token];
}
function tokenOperatorPrecedence(token) {
  return tokenBinops[token];
}
function tokenIsRightAssociative(token) {
  return token === 53;
}
function tokenIsTemplate(token) {
  return token >= 20 && token <= 21;
}
function getExportedToken(token) {
  return tokenTypes[token];
}
var TokContext = class {
  constructor(token, preserveSpace) {
    this.token = token;
    this.preserveSpace = !!preserveSpace;
  }
  token;
  preserveSpace;
};
var types = {
  brace: new TokContext("{"),
  j_oTag: new TokContext("<tag"),
  j_cTag: new TokContext("</tag"),
  j_expr: new TokContext("<tag>...</tag>", true)
};
var bmpIdentifierStart = /[\p{ID_Start}\u0558\u058b\u058c\u088f\u0c5c\u0cdc\u208f\u209d-\u209f\ua7ce\ua7cf\ua7d2\ua7d4\ua7dd\ua7e2\ua7f1\uab6c\uab6d]/u;
var bmpIdentifier = /[\p{ID_Continue}\u0558\u058b\u058c\u088f\u0c5c\u0cdc\u208f\u209d-\u209f\ua7ce\ua7cf\ua7d2\ua7d4\ua7dd\ua7e2\ua7f1\uab6c\uab6d\u05c8\u05c9\u0b53\u0b54\u1acf-\u1af0]/u;
var supplementaryIdentifierStartCodes = [1979, 4, 385, 25, 1388, 2, 18, 21, 3100, 0, 678, 43, 22, 0, 1662, 0, 6, 10, 209, 310, 18458, 24, 3, 24, 287, 4, 6146, 7, 1239, 4, 47, 23, 96, 114, 14, 913, 15, 50, 8017, 5, 64, 0, 9534, 0, 2169, 5, 7, 86, 15, 6, 55, 50, 1729, 30, 2, 2, 2, 1, 2, 6, 3, 4, 10, 1, 53307, 5, 223, 0, 5764, 11, 21763, 4297, 39815, 11327];
var supplementaryIdentifierCodes = [3787, 4, 33, 11, 3173, 7, 633, 9, 7, 0, 45879, 1, 296, 2, 9, 1, 3, 0, 33, 1, 5218, 0, 3, 0, 8, 1, 6, 0];
function isInSupplementarySet(code2, set) {
  let pos = 65536;
  for (let i = 0, length = set.length; i < length; i += 2) {
    pos += set[i];
    if (pos > code2) return false;
    pos += set[i + 1];
    if (pos >= code2) return true;
  }
  return false;
}
function isIdentifierStart(code2) {
  if (code2 < 65) return code2 === 36;
  if (code2 <= 90) return true;
  if (code2 < 97) return code2 === 95;
  if (code2 <= 122) return true;
  if (code2 <= 65535) {
    return code2 >= 170 && bmpIdentifierStart.test(String.fromCharCode(code2));
  }
  return !isNaN(code2) && code2 <= 1114111 && (bmpIdentifierStart.test(String.fromCodePoint(code2)) || isInSupplementarySet(code2, supplementaryIdentifierStartCodes));
}
function isIdentifierChar(code2) {
  if (code2 < 48) return code2 === 36;
  if (code2 < 58) return true;
  if (code2 < 65) return false;
  if (code2 <= 90) return true;
  if (code2 < 97) return code2 === 95;
  if (code2 <= 122) return true;
  if (code2 <= 65535) {
    return code2 >= 170 && bmpIdentifier.test(String.fromCharCode(code2));
  }
  return !isNaN(code2) && code2 <= 1114111 && (bmpIdentifier.test(String.fromCodePoint(code2)) || isInSupplementarySet(code2, supplementaryIdentifierStartCodes) || isInSupplementarySet(code2, supplementaryIdentifierCodes));
}
var reservedWords = {
  keyword: ["break", "case", "catch", "continue", "debugger", "default", "do", "else", "finally", "for", "function", "if", "return", "switch", "throw", "try", "var", "const", "while", "with", "new", "this", "super", "class", "extends", "export", "import", "null", "true", "false", "in", "instanceof", "typeof", "void", "delete"],
  strict: ["implements", "interface", "let", "package", "private", "protected", "public", "static", "yield"],
  strictBind: ["eval", "arguments"]
};
var keywords = new Set(reservedWords.keyword);
var reservedWordsStrictSet = new Set(reservedWords.strict);
var reservedWordsStrictBindSet = new Set(reservedWords.strictBind);
function isReservedWord(word, inModule) {
  return inModule && word === "await" || word === "enum";
}
function isStrictReservedWord(word, inModule) {
  return isReservedWord(word, inModule) || reservedWordsStrictSet.has(word);
}
function isStrictBindOnlyReservedWord(word) {
  return reservedWordsStrictBindSet.has(word);
}
function isStrictBindReservedWord(word, inModule) {
  return isStrictReservedWord(word, inModule) || isStrictBindOnlyReservedWord(word);
}
function isKeyword(word) {
  return keywords.has(word);
}
function isIteratorStart(current, next, next2) {
  return current === 64 && next === 64 && isIdentifierStart(next2);
}
var reservedWordLikeSet = /* @__PURE__ */ new Set(["break", "case", "catch", "continue", "debugger", "default", "do", "else", "finally", "for", "function", "if", "return", "switch", "throw", "try", "var", "const", "while", "with", "new", "this", "super", "class", "extends", "export", "import", "null", "true", "false", "in", "instanceof", "typeof", "void", "delete", "implements", "interface", "let", "package", "private", "protected", "public", "static", "yield", "eval", "arguments", "enum", "await"]);
function canBeReservedWord(word) {
  return reservedWordLikeSet.has(word);
}
var Scope = class {
  flags = 0;
  names = /* @__PURE__ */ new Map();
  firstLexicalName = "";
  constructor(flags) {
    this.flags = flags;
  }
};
var ScopeHandler = class {
  parser;
  scopeStack = [];
  inModule;
  undefinedExports = /* @__PURE__ */ new Map();
  constructor(parser, inModule) {
    this.parser = parser;
    this.inModule = inModule;
  }
  get inTopLevel() {
    return (this.currentScope().flags & 1) > 0;
  }
  get inFunction() {
    return (this.currentVarScopeFlags() & 2) > 0;
  }
  get allowSuper() {
    return (this.currentThisScopeFlags() & 16) > 0;
  }
  get allowDirectSuper() {
    return (this.currentThisScopeFlags() & 32) > 0;
  }
  get allowNewTarget() {
    return (this.currentThisScopeFlags() & 512) > 0;
  }
  get inClass() {
    return (this.currentThisScopeFlags() & 64) > 0;
  }
  get inClassAndNotInNonArrowFunction() {
    const flags = this.currentThisScopeFlags();
    return (flags & 64) > 0 && (flags & 2) === 0;
  }
  get inStaticBlock() {
    for (let i = this.scopeStack.length - 1; ; i--) {
      const {
        flags
      } = this.scopeStack[i];
      if (flags & 128) {
        return true;
      }
      if (flags & (3715 | 64)) {
        return false;
      }
    }
  }
  get inNonArrowFunction() {
    return (this.currentThisScopeFlags() & 2) > 0;
  }
  get inBareCaseStatement() {
    return (this.currentScope().flags & 256) > 0;
  }
  get treatFunctionsAsVar() {
    return this.treatFunctionsAsVarInScope(this.currentScope());
  }
  createScope(flags) {
    return new Scope(flags);
  }
  enter(flags) {
    this.scopeStack.push(this.createScope(flags));
  }
  exit() {
    const scope = this.scopeStack.pop();
    return scope.flags;
  }
  treatFunctionsAsVarInScope(scope) {
    return !!(scope.flags & (2 | 128) || !this.parser.inModule && scope.flags & 1);
  }
  declareName(name, bindingType, loc) {
    let scope = this.currentScope();
    if (bindingType & 8 || bindingType & 16) {
      this.checkRedeclarationInScope(scope, name, bindingType, loc);
      let type = scope.names.get(name) || 0;
      if (bindingType & 16) {
        type = type | 4;
      } else {
        if (!scope.firstLexicalName) {
          scope.firstLexicalName = name;
        }
        type = type | 2;
      }
      scope.names.set(name, type);
      if (bindingType & 8) {
        this.maybeExportDefined(scope, name);
      }
    } else if (bindingType & 4) {
      for (let i = this.scopeStack.length - 1; i >= 0; --i) {
        scope = this.scopeStack[i];
        this.checkRedeclarationInScope(scope, name, bindingType, loc);
        scope.names.set(name, (scope.names.get(name) || 0) | 1);
        this.maybeExportDefined(scope, name);
        if (scope.flags & 3715) break;
      }
    }
    if (this.parser.inModule && scope.flags & 1) {
      this.undefinedExports.delete(name);
    }
  }
  maybeExportDefined(scope, name) {
    if (this.parser.inModule && scope.flags & 1) {
      this.undefinedExports.delete(name);
    }
  }
  checkRedeclarationInScope(scope, name, bindingType, loc) {
    if (this.isRedeclaredInScope(scope, name, bindingType)) {
      this.parser.raise(Errors.VarRedeclaration, loc, {
        identifierName: name
      });
    }
  }
  isRedeclaredInScope(scope, name, bindingType) {
    if (!(bindingType & 1)) return false;
    if (bindingType & 8) {
      return scope.names.has(name);
    }
    const type = scope.names.get(name) || 0;
    if (bindingType & 16) {
      return (type & 2) > 0 || !this.treatFunctionsAsVarInScope(scope) && (type & 1) > 0;
    }
    return (type & 2) > 0 && !(scope.flags & 8 && scope.firstLexicalName === name) || !this.treatFunctionsAsVarInScope(scope) && (type & 4) > 0;
  }
  checkLocalExport(id) {
    const {
      name
    } = id;
    const topLevelScope = this.scopeStack[0];
    if (!topLevelScope.names.has(name)) {
      this.undefinedExports.set(name, id.start);
    }
  }
  currentScope() {
    return this.scopeStack[this.scopeStack.length - 1];
  }
  currentVarScopeFlags() {
    for (let i = this.scopeStack.length - 1; ; i--) {
      const {
        flags
      } = this.scopeStack[i];
      if (flags & 3715) {
        return flags;
      }
    }
  }
  currentThisScopeFlags() {
    for (let i = this.scopeStack.length - 1; ; i--) {
      const {
        flags
      } = this.scopeStack[i];
      if (flags & (3715 | 64) && !(flags & 4)) {
        return flags;
      }
    }
  }
};
var FlowScope = class extends Scope {
  declareFunctions = /* @__PURE__ */ new Set();
};
var FlowScopeHandler = class extends ScopeHandler {
  createScope(flags) {
    return new FlowScope(flags);
  }
  declareName(name, bindingType, loc) {
    const scope = this.currentScope();
    if (bindingType & 2048) {
      this.checkRedeclarationInScope(scope, name, bindingType, loc);
      this.maybeExportDefined(scope, name);
      scope.declareFunctions.add(name);
      return;
    }
    super.declareName(name, bindingType, loc);
  }
  isRedeclaredInScope(scope, name, bindingType) {
    if (super.isRedeclaredInScope(scope, name, bindingType)) return true;
    if (bindingType & 2048 && !scope.declareFunctions.has(name)) {
      const type = scope.names.get(name);
      return (type & 4) > 0 || (type & 2) > 0;
    }
    return false;
  }
  checkLocalExport(id) {
    if (!this.scopeStack[0].declareFunctions.has(id.name)) {
      super.checkLocalExport(id);
    }
  }
};
var reservedTypes = /* @__PURE__ */ new Set(["_", "any", "bool", "boolean", "empty", "extends", "false", "interface", "mixed", "null", "number", "static", "string", "true", "typeof", "void"]);
var FlowErrorTemplates = {
  AmbiguousConditionalArrow: "Ambiguous expression: wrap the arrow functions in parentheses to disambiguate.",
  AmbiguousDeclareModuleKind: "Found both `declare module.exports` and `declare export` in the same module. Modules can only have 1 since they are either an ES module or they are a CommonJS module.",
  AssignReservedType: ({
    reservedType
  }) => `Cannot overwrite reserved type ${reservedType}.`,
  DeclareClassElement: "The `declare` modifier can only appear on class fields.",
  DeclareClassFieldInitializer: "Initializers are not allowed in fields with the `declare` modifier.",
  DuplicateDeclareModuleExports: "Duplicate `declare module.exports` statement.",
  EnumBooleanMemberNotInitialized: ({
    memberName,
    enumName
  }) => `Boolean enum members need to be initialized. Use either \`${memberName} = true,\` or \`${memberName} = false,\` in enum \`${enumName}\`.`,
  EnumDuplicateMemberName: ({
    memberName,
    enumName
  }) => `Enum member names need to be unique, but the name \`${memberName}\` has already been used before in enum \`${enumName}\`.`,
  EnumInconsistentMemberValues: ({
    enumName
  }) => `Enum \`${enumName}\` has inconsistent member initializers. Either use no initializers, or consistently use literals (either booleans, numbers, or strings) for all member initializers.`,
  EnumInvalidExplicitType: ({
    invalidEnumType,
    enumName
  }) => `Enum type \`${invalidEnumType}\` is not valid. Use one of \`boolean\`, \`number\`, \`string\`, or \`symbol\` in enum \`${enumName}\`.`,
  EnumInvalidExplicitTypeUnknownSupplied: ({
    enumName
  }) => `Supplied enum type is not valid. Use one of \`boolean\`, \`number\`, \`string\`, or \`symbol\` in enum \`${enumName}\`.`,
  EnumInvalidMemberInitializerPrimaryType: ({
    enumName,
    memberName,
    explicitType
  }) => `Enum \`${enumName}\` has type \`${explicitType}\`, so the initializer of \`${memberName}\` needs to be a ${explicitType} literal.`,
  EnumInvalidMemberInitializerSymbolType: ({
    enumName,
    memberName
  }) => `Symbol enum members cannot be initialized. Use \`${memberName},\` in enum \`${enumName}\`.`,
  EnumInvalidMemberInitializerUnknownType: ({
    enumName,
    memberName
  }) => `The enum member initializer for \`${memberName}\` needs to be a literal (either a boolean, number, or string) in enum \`${enumName}\`.`,
  EnumInvalidMemberName: ({
    enumName,
    memberName,
    suggestion
  }) => `Enum member names cannot start with lowercase 'a' through 'z'. Instead of using \`${memberName}\`, consider using \`${suggestion}\`, in enum \`${enumName}\`.`,
  EnumNumberMemberNotInitialized: ({
    enumName,
    memberName
  }) => `Number enum members need to be initialized, e.g. \`${memberName} = 1\` in enum \`${enumName}\`.`,
  EnumStringMemberInconsistentlyInitialized: ({
    enumName
  }) => `String enum members need to consistently either all use initializers, or use no initializers, in enum \`${enumName}\`.`,
  GetterMayNotHaveThisParam: "A getter cannot have a `this` parameter.",
  ImportTypeShorthandOnlyInPureImport: "The `type` and `typeof` keywords on named imports can only be used on regular `import` statements. It cannot be used with `import type` or `import typeof` statements.",
  InexactInsideExact: "Explicit inexact syntax cannot appear inside an explicit exact object type.",
  InexactInsideNonObject: "Explicit inexact syntax cannot appear in class or interface definitions.",
  InexactVariance: "Explicit inexact syntax cannot have variance.",
  InvalidNonTypeImportInDeclareModule: "Imports within a `declare module` body must always be `import type` or `import typeof`.",
  MissingTypeParamDefault: "Type parameter declaration needs a default, since a preceding type parameter declaration has a default.",
  NestedDeclareModule: "`declare module` cannot be used inside another `declare module`.",
  NestedFlowComment: "Cannot have a flow comment inside another flow comment.",
  PatternIsOptional: {
    message: "A binding pattern parameter cannot be optional in an implementation signature."
  },
  SetterMayNotHaveThisParam: "A setter cannot have a `this` parameter.",
  SpreadVariance: "Spread properties cannot have variance.",
  ThisParamAnnotationRequired: "A type annotation is required for the `this` parameter.",
  ThisParamBannedInConstructor: "Constructors cannot have a `this` parameter; constructors don't bind `this` like other functions.",
  ThisParamMayNotBeOptional: "The `this` parameter cannot be optional.",
  ThisParamMustBeFirst: "The `this` parameter must be the first function parameter.",
  ThisParamNoDefault: "The `this` parameter may not have a default value.",
  TypeBeforeInitializer: "Type annotations must come before default assignments, e.g. instead of `age = 25: number` use `age: number = 25`.",
  TypeCastInPattern: "The type cast expression is expected to be wrapped with parenthesis.",
  UnexpectedExplicitInexactInObject: "Explicit inexact syntax must appear at the end of an inexact object.",
  UnexpectedReservedType: ({
    reservedType
  }) => `Unexpected reserved type ${reservedType}.`,
  UnexpectedReservedUnderscore: "`_` is only allowed as a type argument to call or new.",
  UnexpectedSpaceBetweenModuloChecks: "Spaces between `%` and `checks` are not allowed here.",
  UnexpectedSpreadType: "Spread operator cannot appear in class or interface definitions.",
  UnexpectedSubtractionOperand: 'Unexpected token, expected "number" or "bigint".',
  UnexpectedTokenAfterTypeParameter: "Expected an arrow function after this type parameter declaration.",
  UnexpectedTypeParameterBeforeAsyncArrowFunction: "Type parameters must come after the async keyword, e.g. instead of `<T> async () => {}`, use `async <T>() => {}`.",
  UnsupportedDeclareExportKind: ({
    unsupportedExportKind,
    suggestion
  }) => `\`declare export ${unsupportedExportKind}\` is not supported. Use \`${suggestion}\` instead.`,
  UnsupportedStatementInDeclareModule: "Only declares and type imports are allowed inside declare module.",
  UnterminatedFlowComment: "Unterminated flow-comment."
};
var FlowErrors = ParseErrorEnum`flow`(FlowErrorTemplates);
function isEsModuleType(bodyElement) {
  return bodyElement.type === "DeclareExportAllDeclaration" || bodyElement.type === "DeclareExportDeclaration" && (!bodyElement.declaration || bodyElement.declaration.type !== "TypeAlias" && bodyElement.declaration.type !== "InterfaceDeclaration");
}
function hasTypeImportKind(node) {
  return node.importKind === "type" || node.importKind === "typeof";
}
var exportSuggestions = {
  const: "declare export var",
  let: "declare export var",
  type: "export type",
  interface: "export interface"
};
function partition(list, test) {
  const list1 = [];
  const list2 = [];
  for (let i = 0; i < list.length; i++) {
    (test(list[i], i, list) ? list1 : list2).push(list[i]);
  }
  return [list1, list2];
}
var FLOW_PRAGMA_REGEX = /\*?\s*@((?:no)?flow)\b/;
var flow = (superClass) => class FlowParserMixin extends superClass {
  flowPragma = void 0;
  getScopeHandler() {
    return FlowScopeHandler;
  }
  shouldParseTypes() {
    return this.getPluginOption("flow", "all") || this.flowPragma === "flow";
  }
  finishToken(type, val) {
    if (type !== 133 && type !== 9 && type !== 24) {
      if (this.flowPragma === void 0) {
        this.flowPragma = null;
      }
    }
    super.finishToken(type, val);
  }
  addComment(comment) {
    if (this.flowPragma === void 0) {
      const matches = FLOW_PRAGMA_REGEX.exec(comment.value);
      if (!matches) ;
      else if (matches[1] === "flow") {
        this.flowPragma = "flow";
      } else if (matches[1] === "noflow") {
        this.flowPragma = "noflow";
      } else {
        throw new Error("Unexpected flow pragma");
      }
    }
    super.addComment(comment);
  }
  flowParseTypeInitialiser(tok) {
    const oldInType = this.state.inType;
    this.state.inType = true;
    this.expect(tok || 10);
    const type = this.flowParseType();
    this.state.inType = oldInType;
    return type;
  }
  flowParsePredicate() {
    const node = this.startNode();
    const moduloLoc = this.state.startLoc;
    this.next();
    this.expectContextual(109);
    if (this.state.lastTokStartLoc.index > moduloLoc.index + 1) {
      this.raise(FlowErrors.UnexpectedSpaceBetweenModuloChecks, moduloLoc);
    }
    if (this.eat(6)) {
      node.value = super.parseExpression();
      this.expect(7);
      return this.finishNode(node, "DeclaredPredicate");
    } else {
      return this.finishNode(node, "InferredPredicate");
    }
  }
  flowParseTypeAndPredicateInitialiser(allowLonePredicate) {
    const oldInType = this.state.inType;
    this.state.inType = true;
    this.expect(10);
    let type = null;
    let predicate = null;
    if (allowLonePredicate && this.match(50)) {
      this.state.inType = oldInType;
      predicate = this.flowParsePredicate();
    } else {
      type = this.flowParseType();
      this.state.inType = oldInType;
      if (this.match(50)) {
        predicate = this.flowParsePredicate();
      }
    }
    return [type, predicate];
  }
  flowParseDeclareClass(node) {
    this.next();
    this.flowParseInterfaceish(node, true);
    return this.finishNode(node, "DeclareClass");
  }
  flowParseDeclareFunction(node) {
    this.next();
    const id = node.id = this.parseIdentifier();
    const typeNode = this.startNode();
    const typeContainer = this.startNode();
    if (this.match(43)) {
      typeNode.typeParameters = this.flowParseTypeParameterDeclaration();
    } else {
      typeNode.typeParameters = null;
    }
    this.expect(6);
    const tmp = this.flowParseFunctionTypeParams();
    typeNode.params = tmp.params;
    typeNode.rest = tmp.rest;
    typeNode.this = tmp._this;
    this.expect(7);
    [typeNode.returnType, node.predicate] = this.flowParseTypeAndPredicateInitialiser(false);
    typeContainer.typeAnnotation = this.finishNode(typeNode, "FunctionTypeAnnotation");
    id.typeAnnotation = this.finishNode(typeContainer, "TypeAnnotation");
    this.resetEndLocation(id);
    this.semicolon();
    this.scope.declareName(node.id.name, 2048, node.id.start);
    return this.finishNode(node, "DeclareFunction");
  }
  flowParseDeclare(node, insideModule) {
    if (this.match(76)) {
      return this.flowParseDeclareClass(node);
    } else if (this.match(64)) {
      return this.flowParseDeclareFunction(node);
    } else if (this.match(70)) {
      return this.flowParseDeclareVariable(node);
    } else if (this.eatContextual(126)) {
      if (this.match(12)) {
        return this.flowParseDeclareModuleExports(node);
      } else {
        if (insideModule) {
          this.raise(FlowErrors.NestedDeclareModule, this.state.lastTokStartLoc);
        }
        return this.flowParseDeclareModule(node);
      }
    } else if (this.isContextual(129)) {
      return this.flowParseDeclareTypeAlias(node);
    } else if (this.isContextual(130)) {
      return this.flowParseDeclareOpaqueType(node);
    } else if (this.isContextual(128)) {
      return this.flowParseDeclareInterface(node);
    } else if (this.match(78)) {
      return this.flowParseDeclareExportDeclaration(node, insideModule);
    }
    throw this.unexpected();
  }
  flowParseDeclareVariable(node) {
    this.next();
    node.id = this.flowParseTypeAnnotatableIdentifier();
    this.scope.declareName(node.id.name, 5, node.id.start);
    this.semicolon();
    return this.finishNode(node, "DeclareVariable");
  }
  flowParseDeclareModule(node) {
    this.scope.enter(0);
    if (this.match(133)) {
      node.id = super.parseExprAtom();
    } else {
      node.id = this.parseIdentifier();
    }
    const bodyNode = this.startNode();
    const body = bodyNode.body = [];
    this.expect(2);
    while (!this.match(4)) {
      const bodyNode2 = this.startNode();
      if (this.match(79)) {
        this.next();
        if (!this.isContextual(129) && !this.match(83)) {
          this.raise(FlowErrors.InvalidNonTypeImportInDeclareModule, this.state.lastTokStartLoc);
        }
        body.push(super.parseImport(bodyNode2));
      } else {
        this.expectContextual(124, FlowErrors.UnsupportedStatementInDeclareModule);
        body.push(this.flowParseDeclare(bodyNode2, true));
      }
    }
    this.scope.exit();
    this.expect(4);
    node.body = this.finishNode(bodyNode, "BlockStatement");
    let kind = null;
    let hasModuleExport = false;
    body.forEach((bodyElement) => {
      if (isEsModuleType(bodyElement)) {
        if (kind === "CommonJS") {
          this.raise(FlowErrors.AmbiguousDeclareModuleKind, bodyElement);
        }
        kind = "ES";
      } else if (bodyElement.type === "DeclareModuleExports") {
        if (hasModuleExport) {
          this.raise(FlowErrors.DuplicateDeclareModuleExports, bodyElement);
        }
        if (kind === "ES") {
          this.raise(FlowErrors.AmbiguousDeclareModuleKind, bodyElement);
        }
        kind = "CommonJS";
        hasModuleExport = true;
      }
    });
    node.kind = kind || "CommonJS";
    return this.finishNode(node, "DeclareModule");
  }
  flowParseDeclareExportDeclaration(node, insideModule) {
    this.expect(78);
    if (this.eat(61)) {
      if (this.match(64) || this.match(76)) {
        node.declaration = this.flowParseDeclare(this.startNode());
      } else {
        node.declaration = this.flowParseType();
        this.semicolon();
      }
      node.default = true;
      return this.finishNode(node, "DeclareExportDeclaration");
    } else {
      if (this.match(71) || this.isLet() || (this.isContextual(129) || this.isContextual(128)) && !insideModule) {
        const label = this.state.value;
        throw this.raise(FlowErrors.UnsupportedDeclareExportKind, this.state.startLoc, {
          unsupportedExportKind: label,
          suggestion: exportSuggestions[label]
        });
      }
      if (this.match(70) || this.match(64) || this.match(76) || this.isContextual(130)) {
        node.declaration = this.flowParseDeclare(this.startNode());
        node.default = false;
        return this.finishNode(node, "DeclareExportDeclaration");
      } else if (this.match(51) || this.match(2) || this.isContextual(128) || this.isContextual(129) || this.isContextual(130)) {
        const result = this.parseExport(node, null);
        if (result.type === "ExportNamedDeclaration") {
          result.default = false;
          delete result.exportKind;
          return this.castNodeTo(result, "DeclareExportDeclaration");
        } else {
          return this.castNodeTo(result, "DeclareExportAllDeclaration");
        }
      }
    }
    throw this.unexpected();
  }
  flowParseDeclareModuleExports(node) {
    this.next();
    this.expectContextual(110);
    node.typeAnnotation = this.flowParseTypeAnnotation();
    this.semicolon();
    return this.finishNode(node, "DeclareModuleExports");
  }
  flowParseDeclareTypeAlias(node) {
    this.next();
    const finished = this.flowParseTypeAlias(node);
    this.castNodeTo(finished, "DeclareTypeAlias");
    return finished;
  }
  flowParseDeclareOpaqueType(node) {
    this.next();
    return this.flowParseOpaqueType(node, true);
  }
  flowParseDeclareInterface(node) {
    this.next();
    this.flowParseInterfaceish(node, false);
    return this.finishNode(node, "DeclareInterface");
  }
  flowParseInterfaceish(node, isClass) {
    node.id = this.flowParseRestrictedIdentifier(!isClass, true);
    this.scope.declareName(node.id.name, isClass ? 17 : 8201, node.id.start);
    if (this.match(43)) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    } else {
      node.typeParameters = null;
    }
    node.extends = [];
    if (this.eat(77)) {
      do {
        node.extends.push(this.flowParseInterfaceExtends());
      } while (!isClass && this.eat(8));
    }
    if (isClass) {
      const implemented = [];
      const mixins = [];
      if (this.eatContextual(116)) {
        do {
          mixins.push(this.flowParseInterfaceExtends());
        } while (this.eat(8));
      }
      if (this.eatContextual(112)) {
        do {
          implemented.push(this.flowParseClassImplements());
        } while (this.eat(8));
      }
      node.implements = implemented;
      node.mixins = mixins;
    }
    node.body = this.flowParseObjectType({
      allowStatic: isClass,
      allowExact: false,
      allowSpread: false,
      allowProto: isClass,
      allowInexact: false
    });
  }
  flowParseInterfaceExtends() {
    const node = this.startNode();
    node.id = this.flowParseQualifiedTypeIdentifier();
    if (this.match(43)) {
      node.typeParameters = this.flowParseTypeParameterInstantiation();
    } else {
      node.typeParameters = null;
    }
    return this.finishNode(node, "InterfaceExtends");
  }
  flowParseInterface(node) {
    this.flowParseInterfaceish(node, false);
    return this.finishNode(node, "InterfaceDeclaration");
  }
  checkNotUnderscore(word) {
    if (word === "_") {
      this.raise(FlowErrors.UnexpectedReservedUnderscore, this.state.startLoc);
    }
  }
  checkReservedType(word, startLoc, declaration) {
    if (!reservedTypes.has(word)) return;
    this.raise(declaration ? FlowErrors.AssignReservedType : FlowErrors.UnexpectedReservedType, startLoc, {
      reservedType: word
    });
  }
  flowParseRestrictedIdentifierName(liberal, declaration) {
    this.checkReservedType(this.state.value, this.state.startLoc, declaration);
    return this.parseIdentifierName(liberal);
  }
  flowParseRestrictedIdentifier(liberal, declaration) {
    const node = this.startNode();
    const name = this.flowParseRestrictedIdentifierName(liberal, declaration);
    return this.createIdentifier(node, name);
  }
  flowParseTypeAlias(node) {
    node.id = this.flowParseRestrictedIdentifier(false, true);
    this.scope.declareName(node.id.name, 8201, node.id.start);
    if (this.match(43)) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    } else {
      node.typeParameters = null;
    }
    node.right = this.flowParseTypeInitialiser(25);
    this.semicolon();
    return this.finishNode(node, "TypeAlias");
  }
  flowParseOpaqueType(node, declare) {
    this.expectContextual(129);
    node.id = this.flowParseRestrictedIdentifier(true, true);
    this.scope.declareName(node.id.name, 8201, node.id.start);
    if (this.match(43)) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    } else {
      node.typeParameters = null;
    }
    node.supertype = null;
    if (this.match(10)) {
      node.supertype = this.flowParseTypeInitialiser(10);
    }
    node.impltype = null;
    if (!declare) {
      node.impltype = this.flowParseTypeInitialiser(25);
    }
    this.semicolon();
    return this.finishNode(node, declare ? "DeclareOpaqueType" : "OpaqueType");
  }
  flowParseTypeParameterBound() {
    if (this.match(10) || this.isContextual(77)) {
      const node = this.startNode();
      this.next();
      node.typeAnnotation = this.flowParseType();
      return this.finishNode(node, "TypeAnnotation");
    }
  }
  flowParseTypeParameter(requireDefault = false) {
    const nodeStartLoc = this.state.startLoc;
    const node = this.startNode();
    const variance = this.flowParseVariance();
    node.name = this.flowParseRestrictedIdentifierName();
    node.variance = variance;
    node.bound = this.flowParseTypeParameterBound();
    if (this.match(25)) {
      this.eat(25);
      node.default = this.flowParseType();
    } else {
      if (requireDefault) {
        this.raise(FlowErrors.MissingTypeParamDefault, nodeStartLoc);
      }
    }
    return this.finishNode(node, "TypeParameter");
  }
  flowParseTypeParameterDeclaration() {
    const oldInType = this.state.inType;
    const node = this.startNode();
    node.params = [];
    this.state.inType = true;
    if (this.match(43) || this.match(141)) {
      this.next();
    } else {
      this.unexpected();
    }
    let defaultRequired = false;
    do {
      const typeParameter = this.flowParseTypeParameter(defaultRequired);
      node.params.push(typeParameter);
      if (typeParameter.default) {
        defaultRequired = true;
      }
      if (!this.match(44)) {
        this.expect(8);
      }
    } while (!this.match(44));
    this.expect(44);
    this.state.inType = oldInType;
    return this.finishNode(node, "TypeParameterDeclaration");
  }
  flowInTopLevelContext(cb) {
    if (this.curContext() !== types.brace) {
      const oldContext = this.state.context;
      this.state.context = [oldContext[0]];
      try {
        return cb();
      } finally {
        this.state.context = oldContext;
      }
    } else {
      return cb();
    }
  }
  flowParseTypeParameterInstantiationInExpression() {
    if (this.reScan_lt() !== 43) return;
    return this.flowParseTypeParameterInstantiation();
  }
  flowParseTypeParameterInstantiation() {
    const node = this.startNode();
    const oldInType = this.state.inType;
    this.state.inType = true;
    node.params = [];
    this.flowInTopLevelContext(() => {
      this.expect(43);
      const oldNoAnonFunctionType = this.state.noAnonFunctionType;
      this.state.noAnonFunctionType = false;
      while (!this.match(44)) {
        node.params.push(this.flowParseType());
        if (!this.match(44)) {
          this.expect(8);
        }
      }
      this.state.noAnonFunctionType = oldNoAnonFunctionType;
    });
    this.state.inType = oldInType;
    if (!this.state.inType && this.curContext() === types.brace) {
      this.reScan_lt_gt();
    }
    this.expect(44);
    return this.finishNode(node, "TypeParameterInstantiation");
  }
  flowParseTypeParameterInstantiationCallOrNew() {
    if (this.reScan_lt() !== 43) return null;
    const node = this.startNode();
    const oldInType = this.state.inType;
    node.params = [];
    this.state.inType = true;
    this.expect(43);
    while (!this.match(44)) {
      node.params.push(this.flowParseTypeOrImplicitInstantiation());
      if (!this.match(44)) {
        this.expect(8);
      }
    }
    this.expect(44);
    this.state.inType = oldInType;
    return this.finishNode(node, "TypeParameterInstantiation");
  }
  flowParseInterfaceType() {
    const node = this.startNode();
    this.expectContextual(128);
    node.extends = [];
    if (this.eat(77)) {
      do {
        node.extends.push(this.flowParseInterfaceExtends());
      } while (this.eat(8));
    }
    node.body = this.flowParseObjectType({
      allowStatic: false,
      allowExact: false,
      allowSpread: false,
      allowProto: false,
      allowInexact: false
    });
    return this.finishNode(node, "InterfaceTypeAnnotation");
  }
  flowParseObjectPropertyKey() {
    return this.match(134) || this.match(133) ? super.parseExprAtom() : this.parseIdentifier(true);
  }
  flowParseObjectTypeIndexer(node, isStatic, variance) {
    node.static = isStatic;
    if (this.lookahead().type === 10) {
      node.id = this.parseIdentifier(true);
      node.key = this.flowParseTypeInitialiser();
    } else {
      node.id = null;
      node.key = this.flowParseType();
    }
    this.expect(1);
    node.value = this.flowParseTypeInitialiser();
    node.variance = variance;
    return this.finishNode(node, "ObjectTypeIndexer");
  }
  flowParseObjectTypeInternalSlot(node, isStatic) {
    node.static = isStatic;
    node.id = this.parseIdentifier(true);
    this.expect(1);
    this.expect(1);
    if (this.match(43) || this.match(6)) {
      node.method = true;
      node.optional = false;
      node.value = this.flowParseObjectTypeMethodish(this.startNodeAtNode(node));
    } else {
      node.method = false;
      if (this.eat(13)) {
        node.optional = true;
      }
      node.value = this.flowParseTypeInitialiser();
    }
    return this.finishNode(node, "ObjectTypeInternalSlot");
  }
  flowParseObjectTypeMethodish(node) {
    node.params = [];
    node.rest = null;
    node.typeParameters = null;
    node.this = null;
    if (this.match(43)) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    }
    this.expect(6);
    if (this.match(74)) {
      node.this = this.flowParseFunctionTypeParam(true);
      node.this.name = null;
      if (!this.match(7)) {
        this.expect(8);
      }
    }
    while (!this.match(7) && !this.match(17)) {
      node.params.push(this.flowParseFunctionTypeParam(false));
      if (!this.match(7)) {
        this.expect(8);
      }
    }
    if (this.eat(17)) {
      node.rest = this.flowParseFunctionTypeParam(false);
    }
    this.expect(7);
    node.returnType = this.flowParseTypeInitialiser();
    return this.finishNode(node, "FunctionTypeAnnotation");
  }
  flowParseObjectTypeCallProperty(node, isStatic) {
    const valueNode = this.startNode();
    node.static = isStatic;
    node.value = this.flowParseObjectTypeMethodish(valueNode);
    return this.finishNode(node, "ObjectTypeCallProperty");
  }
  flowParseObjectType({
    allowStatic,
    allowExact,
    allowSpread,
    allowProto,
    allowInexact
  }) {
    const oldInType = this.state.inType;
    this.state.inType = true;
    const nodeStart = this.startNode();
    nodeStart.callProperties = [];
    nodeStart.properties = [];
    nodeStart.indexers = [];
    nodeStart.internalSlots = [];
    let endDelim;
    let exact;
    let inexact = false;
    if (allowExact && this.match(3)) {
      this.expect(3);
      endDelim = 5;
      exact = true;
    } else {
      this.expect(2);
      endDelim = 4;
      exact = false;
    }
    nodeStart.exact = exact;
    while (!this.match(endDelim)) {
      let isStatic = false;
      let protoStartLoc = null;
      let inexactStartLoc = null;
      const node = this.startNode();
      if (allowProto && this.isContextual(117)) {
        const lookahead = this.lookahead();
        if (lookahead.type !== 10 && lookahead.type !== 13) {
          this.next();
          protoStartLoc = this.state.startLoc;
          allowStatic = false;
        }
      }
      if (allowStatic && this.isContextual(103)) {
        const lookahead = this.lookahead();
        if (lookahead.type !== 10 && lookahead.type !== 13) {
          this.next();
          isStatic = true;
        }
      }
      const variance = this.flowParseVariance();
      if (this.eat(0)) {
        if (protoStartLoc != null) {
          this.unexpected(protoStartLoc);
        }
        if (this.eat(0)) {
          if (variance) {
            this.unexpected(variance.start);
          }
          nodeStart.internalSlots.push(this.flowParseObjectTypeInternalSlot(node, isStatic));
        } else {
          nodeStart.indexers.push(this.flowParseObjectTypeIndexer(node, isStatic, variance));
        }
      } else if (this.match(6) || this.match(43)) {
        if (protoStartLoc != null) {
          this.unexpected(protoStartLoc);
        }
        if (variance) {
          this.unexpected(variance.start);
        }
        nodeStart.callProperties.push(this.flowParseObjectTypeCallProperty(node, isStatic));
      } else {
        let kind = "init";
        if (this.isContextual(96) || this.isContextual(101)) {
          const lookahead = this.lookahead();
          if (tokenIsLiteralPropertyName(lookahead.type)) {
            kind = this.state.value;
            this.next();
          }
        }
        const propOrInexact = this.flowParseObjectTypeProperty(node, isStatic, protoStartLoc, variance, kind, allowSpread, allowInexact ?? !exact);
        if (propOrInexact === null) {
          inexact = true;
          inexactStartLoc = this.state.lastTokStartLoc;
        } else {
          nodeStart.properties.push(propOrInexact);
        }
      }
      this.flowObjectTypeSemicolon();
      if (inexactStartLoc && !this.match(4) && !this.match(5)) {
        this.raise(FlowErrors.UnexpectedExplicitInexactInObject, inexactStartLoc);
      }
    }
    this.expect(endDelim);
    if (allowSpread) {
      nodeStart.inexact = inexact;
    }
    const out = this.finishNode(nodeStart, "ObjectTypeAnnotation");
    this.state.inType = oldInType;
    return out;
  }
  flowParseObjectTypeProperty(node, isStatic, protoStartLoc, variance, kind, allowSpread, allowInexact) {
    if (this.eat(17)) {
      const isInexactToken = this.match(8) || this.match(9) || this.match(4) || this.match(5);
      if (isInexactToken) {
        if (!allowSpread) {
          this.raise(FlowErrors.InexactInsideNonObject, this.state.lastTokStartLoc);
        } else if (!allowInexact) {
          this.raise(FlowErrors.InexactInsideExact, this.state.lastTokStartLoc);
        }
        if (variance) {
          this.raise(FlowErrors.InexactVariance, variance);
        }
        return null;
      }
      if (!allowSpread) {
        this.raise(FlowErrors.UnexpectedSpreadType, this.state.lastTokStartLoc);
      }
      if (protoStartLoc != null) {
        this.unexpected(protoStartLoc);
      }
      if (variance) {
        this.raise(FlowErrors.SpreadVariance, variance);
      }
      node.argument = this.flowParseType();
      return this.finishNode(node, "ObjectTypeSpreadProperty");
    } else {
      node.key = this.flowParseObjectPropertyKey();
      node.static = isStatic;
      node.proto = protoStartLoc != null;
      node.kind = kind;
      let optional = false;
      if (this.match(43) || this.match(6)) {
        node.method = true;
        if (protoStartLoc != null) {
          this.unexpected(protoStartLoc);
        }
        if (variance) {
          this.unexpected(variance.start);
        }
        node.value = this.flowParseObjectTypeMethodish(this.startNodeAtNode(node));
        if (kind === "get" || kind === "set") {
          this.flowCheckGetterSetterParams(node);
        } else if (!isStatic && !allowSpread && node.key.name === "constructor" && node.value.this) {
          this.raise(FlowErrors.ThisParamBannedInConstructor, node.value.this);
        }
      } else {
        if (kind !== "init") this.unexpected();
        node.method = false;
        if (this.eat(13)) {
          optional = true;
        }
        node.value = this.flowParseTypeInitialiser();
        node.variance = variance;
      }
      node.optional = optional;
      return this.finishNode(node, "ObjectTypeProperty");
    }
  }
  flowCheckGetterSetterParams(property) {
    const paramCount = property.kind === "get" ? 0 : 1;
    const value = property.value;
    const length = value.params.length + (value.rest ? 1 : 0);
    if (value.this) {
      this.raise(property.kind === "get" ? FlowErrors.GetterMayNotHaveThisParam : FlowErrors.SetterMayNotHaveThisParam, value.this);
    }
    if (length !== paramCount) {
      this.raise(property.kind === "get" ? Errors.BadGetterArity : Errors.BadSetterArity, property);
    }
    if (property.kind === "set" && value.rest) {
      this.raise(Errors.BadSetterRestParameter, property);
    }
  }
  flowObjectTypeSemicolon() {
    if (!this.eat(9) && !this.eat(8) && !this.match(4) && !this.match(5)) {
      this.unexpected();
    }
  }
  flowParseQualifiedTypeIdentifier(startLoc, id) {
    startLoc ??= this.state.startLoc;
    let node = id || this.flowParseRestrictedIdentifier(true);
    while (this.eat(12)) {
      const node2 = this.startNodeAt(startLoc);
      node2.qualification = node;
      node2.id = this.flowParseRestrictedIdentifier(true);
      node = this.finishNode(node2, "QualifiedTypeIdentifier");
    }
    return node;
  }
  flowParseGenericType(startLoc, id) {
    const node = this.startNodeAt(startLoc);
    node.typeParameters = null;
    node.id = this.flowParseQualifiedTypeIdentifier(startLoc, id);
    if (this.match(43)) {
      node.typeParameters = this.flowParseTypeParameterInstantiation();
    }
    return this.finishNode(node, "GenericTypeAnnotation");
  }
  flowParseTypeofType() {
    const node = this.startNode();
    this.expect(83);
    node.argument = this.flowParsePrimaryType();
    return this.finishNode(node, "TypeofTypeAnnotation");
  }
  flowParseTupleType() {
    const node = this.startNode();
    node.types = [];
    this.expect(0);
    while (this.state.pos < this.length && !this.match(1)) {
      node.types.push(this.flowParseType());
      if (this.match(1)) break;
      this.expect(8);
    }
    this.expect(1);
    return this.finishNode(node, "TupleTypeAnnotation");
  }
  flowParseFunctionTypeParam(first) {
    let name = null;
    let optional = false;
    let typeAnnotation;
    const node = this.startNode();
    const lh = this.lookahead();
    const isThis = this.state.type === 74;
    if (lh.type === 10 || lh.type === 13) {
      if (isThis && !first) {
        this.raise(FlowErrors.ThisParamMustBeFirst, node);
      }
      name = this.parseIdentifier(isThis);
      if (this.eat(13)) {
        optional = true;
        if (isThis) {
          this.raise(FlowErrors.ThisParamMayNotBeOptional, node);
        }
      }
      typeAnnotation = this.flowParseTypeInitialiser();
    } else {
      typeAnnotation = this.flowParseType();
    }
    node.name = name;
    node.optional = optional;
    node.typeAnnotation = typeAnnotation;
    return this.finishNode(node, "FunctionTypeParam");
  }
  reinterpretTypeAsFunctionTypeParam(type) {
    const node = this.startNodeAtNode(type);
    node.name = null;
    node.optional = false;
    node.typeAnnotation = type;
    return this.finishNode(node, "FunctionTypeParam");
  }
  flowParseFunctionTypeParams(params = []) {
    let rest = null;
    let _this = null;
    if (this.match(74)) {
      _this = this.flowParseFunctionTypeParam(true);
      _this.name = null;
      if (!this.match(7)) {
        this.expect(8);
      }
    }
    while (!this.match(7) && !this.match(17)) {
      params.push(this.flowParseFunctionTypeParam(false));
      if (!this.match(7)) {
        this.expect(8);
      }
    }
    if (this.eat(17)) {
      rest = this.flowParseFunctionTypeParam(false);
    }
    return {
      params,
      rest,
      _this
    };
  }
  flowIdentToTypeAnnotation(startLoc, node, id) {
    switch (id.name) {
      case "any":
        return this.finishNode(node, "AnyTypeAnnotation");
      case "bool":
      case "boolean":
        return this.finishNode(node, "BooleanTypeAnnotation");
      case "mixed":
        return this.finishNode(node, "MixedTypeAnnotation");
      case "empty":
        return this.finishNode(node, "EmptyTypeAnnotation");
      case "number":
        return this.finishNode(node, "NumberTypeAnnotation");
      case "string":
        return this.finishNode(node, "StringTypeAnnotation");
      case "symbol":
        return this.finishNode(node, "SymbolTypeAnnotation");
      default:
        this.checkNotUnderscore(id.name);
        return this.flowParseGenericType(startLoc, id);
    }
  }
  flowParsePrimaryType() {
    const startLoc = this.state.startLoc;
    const node = this.startNode();
    let tmp;
    let type;
    let isGroupedType = false;
    const oldNoAnonFunctionType = this.state.noAnonFunctionType;
    switch (this.state.type) {
      case 2:
        return this.flowParseObjectType({
          allowStatic: false,
          allowExact: false,
          allowSpread: true,
          allowProto: false,
          allowInexact: true
        });
      case 3:
        return this.flowParseObjectType({
          allowStatic: false,
          allowExact: true,
          allowSpread: true,
          allowProto: false,
          allowInexact: false
        });
      case 0:
        this.state.noAnonFunctionType = false;
        type = this.flowParseTupleType();
        this.state.noAnonFunctionType = oldNoAnonFunctionType;
        return type;
      case 43: {
        const node2 = this.startNode();
        node2.typeParameters = this.flowParseTypeParameterDeclaration();
        this.expect(6);
        tmp = this.flowParseFunctionTypeParams();
        node2.params = tmp.params;
        node2.rest = tmp.rest;
        node2.this = tmp._this;
        this.expect(7);
        this.expect(15);
        node2.returnType = this.flowParseType();
        return this.finishNode(node2, "FunctionTypeAnnotation");
      }
      case 6: {
        const node2 = this.startNode();
        this.next();
        if (!this.match(7) && !this.match(17)) {
          if (tokenIsIdentifier(this.state.type) || this.match(74)) {
            const token = this.lookahead().type;
            isGroupedType = token !== 13 && token !== 10;
          } else {
            isGroupedType = true;
          }
        }
        if (isGroupedType) {
          this.state.noAnonFunctionType = false;
          type = this.flowParseType();
          this.state.noAnonFunctionType = oldNoAnonFunctionType;
          if (this.state.noAnonFunctionType || !(this.match(8) || this.match(7) && this.lookahead().type === 15)) {
            this.expect(7);
            return type;
          } else {
            this.eat(8);
          }
        }
        if (type) {
          tmp = this.flowParseFunctionTypeParams([this.reinterpretTypeAsFunctionTypeParam(type)]);
        } else {
          tmp = this.flowParseFunctionTypeParams();
        }
        node2.params = tmp.params;
        node2.rest = tmp.rest;
        node2.this = tmp._this;
        this.expect(7);
        this.expect(15);
        node2.returnType = this.flowParseType();
        node2.typeParameters = null;
        return this.finishNode(node2, "FunctionTypeAnnotation");
      }
      case 133:
        return this.parseLiteral(this.state.value, "StringLiteralTypeAnnotation");
      case 81:
      case 82:
        node.value = this.match(81);
        this.next();
        return this.finishNode(node, "BooleanLiteralTypeAnnotation");
      case 49:
        if (this.state.value === "-") {
          this.next();
          if (this.match(134)) {
            return this.parseLiteralAtNode(-this.state.value, "NumberLiteralTypeAnnotation", node);
          }
          if (this.match(135)) {
            return this.parseLiteralAtNode(-this.state.value, "BigIntLiteralTypeAnnotation", node);
          }
          throw this.raise(FlowErrors.UnexpectedSubtractionOperand, this.state.startLoc);
        }
        throw this.unexpected();
      case 134:
        return this.parseLiteral(this.state.value, "NumberLiteralTypeAnnotation");
      case 135:
        return this.parseLiteral(this.state.value, "BigIntLiteralTypeAnnotation");
      case 84:
        this.next();
        return this.finishNode(node, "VoidTypeAnnotation");
      case 80:
        this.next();
        return this.finishNode(node, "NullLiteralTypeAnnotation");
      case 74:
        this.next();
        return this.finishNode(node, "ThisTypeAnnotation");
      case 51:
        this.next();
        return this.finishNode(node, "ExistsTypeAnnotation");
      case 83:
        return this.flowParseTypeofType();
      default:
        if (tokenIsKeyword(this.state.type)) {
          const label = tokenLabelName(this.state.type);
          this.next();
          return super.createIdentifier(node, label);
        } else if (tokenIsIdentifier(this.state.type)) {
          if (this.isContextual(128)) {
            return this.flowParseInterfaceType();
          }
          return this.flowIdentToTypeAnnotation(startLoc, node, this.parseIdentifier());
        }
    }
    throw this.unexpected();
  }
  flowParsePostfixType() {
    const startLoc = this.state.startLoc;
    let type = this.flowParsePrimaryType();
    let seenOptionalIndexedAccess = false;
    while ((this.match(0) || this.match(14)) && !this.canInsertSemicolon()) {
      const node = this.startNodeAt(startLoc);
      const optional = this.eat(14);
      seenOptionalIndexedAccess = seenOptionalIndexedAccess || optional;
      this.expect(0);
      if (!optional && this.match(1)) {
        node.elementType = type;
        this.next();
        type = this.finishNode(node, "ArrayTypeAnnotation");
      } else {
        node.objectType = type;
        node.indexType = this.flowParseType();
        this.expect(1);
        if (seenOptionalIndexedAccess) {
          node.optional = optional;
          type = this.finishNode(node, "OptionalIndexedAccessType");
        } else {
          type = this.finishNode(node, "IndexedAccessType");
        }
      }
    }
    return type;
  }
  flowParsePrefixType() {
    const node = this.startNode();
    if (this.eat(13)) {
      node.typeAnnotation = this.flowParsePrefixType();
      return this.finishNode(node, "NullableTypeAnnotation");
    } else {
      return this.flowParsePostfixType();
    }
  }
  flowParseAnonFunctionWithoutParens() {
    const param = this.flowParsePrefixType();
    if (!this.state.noAnonFunctionType && this.eat(15)) {
      const node = this.startNodeAtNode(param);
      node.params = [this.reinterpretTypeAsFunctionTypeParam(param)];
      node.rest = null;
      node.this = null;
      node.returnType = this.flowParseType();
      node.typeParameters = null;
      return this.finishNode(node, "FunctionTypeAnnotation");
    }
    return param;
  }
  flowParseIntersectionType() {
    const node = this.startNode();
    this.eat(41);
    const type = this.flowParseAnonFunctionWithoutParens();
    node.types = [type];
    while (this.eat(41)) {
      node.types.push(this.flowParseAnonFunctionWithoutParens());
    }
    return node.types.length === 1 ? type : this.finishNode(node, "IntersectionTypeAnnotation");
  }
  flowParseUnionType() {
    const node = this.startNode();
    this.eat(39);
    const type = this.flowParseIntersectionType();
    node.types = [type];
    while (this.eat(39)) {
      node.types.push(this.flowParseIntersectionType());
    }
    return node.types.length === 1 ? type : this.finishNode(node, "UnionTypeAnnotation");
  }
  flowParseType() {
    const oldInType = this.state.inType;
    this.state.inType = true;
    const type = this.flowParseUnionType();
    this.state.inType = oldInType;
    return type;
  }
  flowParseTypeOrImplicitInstantiation() {
    if (this.state.type === 131 && this.state.value === "_") {
      const startLoc = this.state.startLoc;
      const node = this.parseIdentifier();
      return this.flowParseGenericType(startLoc, node);
    } else {
      return this.flowParseType();
    }
  }
  flowParseTypeAnnotation() {
    const node = this.startNode();
    node.typeAnnotation = this.flowParseTypeInitialiser();
    return this.finishNode(node, "TypeAnnotation");
  }
  flowParseTypeAnnotatableIdentifier() {
    const node = this.startNode();
    const name = this.parseIdentifierName();
    if (this.match(10)) {
      node.typeAnnotation = this.flowParseTypeAnnotation();
    }
    return this.createIdentifier(node, name);
  }
  typeCastToParameter(node) {
    node.expression.typeAnnotation = node.typeAnnotation;
    this.resetEndLocationFromNode(node.expression, node.typeAnnotation);
    return node.expression;
  }
  flowParseVariance() {
    let variance = null;
    if (this.match(49)) {
      variance = this.startNode();
      if (this.state.value === "+") {
        variance.kind = "plus";
      } else {
        variance.kind = "minus";
      }
      this.next();
      return this.finishNode(variance, "Variance");
    }
    return variance;
  }
  parseFunctionBody(node, allowExpressionBody, isMethod = false) {
    if (allowExpressionBody) {
      this.forwardNoArrowParamsConversionAt(node, () => super.parseFunctionBody(node, true, isMethod));
      return;
    }
    super.parseFunctionBody(node, false, isMethod);
  }
  parseFunctionBodyAndFinish(node, type, isMethod = false) {
    if (this.match(10)) {
      const typeNode = this.startNode();
      if (type === "FunctionDeclaration" || type === "FunctionExpression" || type === "ArrowFunctionExpression") {
        [typeNode.typeAnnotation, node.predicate] = this.flowParseTypeAndPredicateInitialiser(true);
      } else {
        typeNode.typeAnnotation = this.flowParseTypeInitialiser();
      }
      node.returnType = typeNode.typeAnnotation ? this.finishNode(typeNode, "TypeAnnotation") : null;
    }
    return super.parseFunctionBodyAndFinish(node, type, isMethod);
  }
  parseStatementLike(flags) {
    if (this.state.strict && this.isContextual(128)) {
      const lookahead = this.lookahead();
      if (tokenIsKeywordOrIdentifier(lookahead.type)) {
        const node = this.startNode();
        this.next();
        return this.flowParseInterface(node);
      }
    } else if (this.isContextual(125)) {
      const node = this.startNode();
      this.next();
      return this.flowParseEnumDeclaration(node);
    }
    const stmt = super.parseStatementLike(flags);
    if (this.flowPragma === void 0 && !this.isValidDirective(stmt)) {
      this.flowPragma = null;
    }
    return stmt;
  }
  parseExpressionStatement(node, expr, flags) {
    if (expr.type === "Identifier") {
      if (expr.name === "declare") {
        if (this.match(76) || tokenIsIdentifier(this.state.type) || this.match(64) || this.match(70) || this.match(78)) {
          return this.flowParseDeclare(node);
        }
      } else if (tokenIsIdentifier(this.state.type)) {
        if (expr.name === "interface") {
          return this.flowParseInterface(node);
        } else if (expr.name === "type") {
          return this.flowParseTypeAlias(node);
        } else if (expr.name === "opaque") {
          return this.flowParseOpaqueType(node, false);
        }
      }
    }
    return super.parseExpressionStatement(node, expr, flags);
  }
  shouldParseExportDeclaration() {
    const {
      type
    } = this.state;
    if (type === 125 || tokenIsFlowInterfaceOrTypeOrOpaque(type)) {
      return !this.state.containsEsc;
    }
    return super.shouldParseExportDeclaration();
  }
  isExportDefaultSpecifier() {
    const {
      type
    } = this.state;
    if (type === 125 || tokenIsFlowInterfaceOrTypeOrOpaque(type)) {
      return this.state.containsEsc;
    }
    return super.isExportDefaultSpecifier();
  }
  parseExportDefaultExpression() {
    if (this.isContextual(125)) {
      const node = this.startNode();
      this.next();
      return this.flowParseEnumDeclaration(node);
    }
    return super.parseExportDefaultExpression();
  }
  parseConditional(expr, startLoc, refExpressionErrors) {
    if (!this.match(13)) return expr;
    if (refExpressionErrors != null) {
      const nextCh = this.lookaheadCharCode();
      if (nextCh === 44 || nextCh === 61 || nextCh === 58 || nextCh === 41) {
        this.setOptionalParametersError(refExpressionErrors);
        return expr;
      }
    }
    this.expect(13);
    const state = this.state.clone();
    const originalNoArrowAt = this.state.noArrowAt;
    const node = this.startNodeAt(startLoc);
    let {
      consequent,
      failed
    } = this.tryParseConditionalConsequent();
    const result = this.getArrowLikeExpressions(consequent);
    let valid = result[0];
    const invalid = result[1];
    if (failed || invalid.length > 0) {
      const noArrowAt = [...originalNoArrowAt];
      if (invalid.length > 0) {
        this.state = state;
        this.state.noArrowAt = noArrowAt;
        for (let i = 0; i < invalid.length; i++) {
          noArrowAt.push(invalid[i].start);
        }
        ({
          consequent,
          failed
        } = this.tryParseConditionalConsequent());
        [valid] = this.getArrowLikeExpressions(consequent);
      }
      if (failed && valid.length > 1) {
        this.raise(FlowErrors.AmbiguousConditionalArrow, state.startLoc);
      }
      if (failed && valid.length === 1) {
        this.state = state;
        noArrowAt.push(valid[0].start);
        this.state.noArrowAt = noArrowAt;
        ({
          consequent
        } = this.tryParseConditionalConsequent());
      }
    }
    this.getArrowLikeExpressions(consequent, true);
    this.state.noArrowAt = originalNoArrowAt;
    this.expect(10);
    node.test = expr;
    node.consequent = consequent;
    node.alternate = this.forwardNoArrowParamsConversionAt(node, () => this.parseMaybeAssign());
    return this.finishNode(node, "ConditionalExpression");
  }
  tryParseConditionalConsequent() {
    this.state.noArrowParamsConversionAt.push(this.state.start);
    const consequent = this.parseMaybeAssignAllowIn();
    const failed = !this.match(10);
    this.state.noArrowParamsConversionAt.pop();
    return {
      consequent,
      failed
    };
  }
  getArrowLikeExpressions(node, disallowInvalid) {
    const stack = [node];
    const arrows = [];
    while (stack.length !== 0) {
      const node2 = stack.pop();
      if (node2.type === "ArrowFunctionExpression") {
        if (node2.typeParameters || !node2.returnType) {
          this.finishArrowValidation(node2);
        } else {
          arrows.push(node2);
        }
        if (node2.body.type !== "BlockStatement") {
          stack.push(node2.body);
        }
      } else if (node2.type === "ConditionalExpression") {
        stack.push(node2.consequent);
        stack.push(node2.alternate);
      }
    }
    if (disallowInvalid) {
      arrows.forEach((node2) => this.finishArrowValidation(node2));
      return [arrows, []];
    }
    return partition(arrows, (node2) => node2.params.every((param) => this.isAssignable(param, true)));
  }
  finishArrowValidation(node) {
    this.toAssignableList(node.params, node.extra?.trailingCommaLoc, false);
    this.scope.enter(514 | 4);
    super.checkParams(node, false, true);
    this.scope.exit();
  }
  forwardNoArrowParamsConversionAt(node, parse2) {
    let result;
    if (this.state.noArrowParamsConversionAt.includes(this.offsetToSourcePos(node.start))) {
      this.state.noArrowParamsConversionAt.push(this.state.start);
      result = parse2();
      this.state.noArrowParamsConversionAt.pop();
    } else {
      result = parse2();
    }
    return result;
  }
  parseParenItem(node, startLoc) {
    const newNode = super.parseParenItem(node, startLoc);
    if (this.eat(13)) {
      newNode.optional = true;
      this.resetEndLocation(node);
    }
    if (this.match(10)) {
      const typeCastNode = this.startNodeAt(startLoc);
      typeCastNode.expression = newNode;
      typeCastNode.typeAnnotation = this.flowParseTypeAnnotation();
      return this.finishNode(typeCastNode, "TypeCastExpression");
    }
    return newNode;
  }
  assertModuleNodeAllowed(node) {
    if (node.type === "ImportDeclaration" && (node.importKind === "type" || node.importKind === "typeof") || node.type === "ExportNamedDeclaration" && node.exportKind === "type" || node.type === "ExportAllDeclaration" && node.exportKind === "type") {
      return;
    }
    super.assertModuleNodeAllowed(node);
  }
  parseExportDeclaration(node) {
    if (this.isContextual(129)) {
      node.exportKind = "type";
      const declarationNode = this.startNode();
      this.next();
      if (this.match(2)) {
        node.specifiers = this.parseExportSpecifiers(true);
        super.parseExportFrom(node);
        return null;
      } else {
        return this.flowParseTypeAlias(declarationNode);
      }
    } else if (this.isContextual(130)) {
      node.exportKind = "type";
      const declarationNode = this.startNode();
      this.next();
      return this.flowParseOpaqueType(declarationNode, false);
    } else if (this.isContextual(128)) {
      node.exportKind = "type";
      const declarationNode = this.startNode();
      this.next();
      return this.flowParseInterface(declarationNode);
    } else if (this.isContextual(125)) {
      node.exportKind = "value";
      const declarationNode = this.startNode();
      this.next();
      return this.flowParseEnumDeclaration(declarationNode);
    } else {
      return super.parseExportDeclaration(node);
    }
  }
  eatExportStar(node) {
    if (super.eatExportStar(node)) return true;
    if (this.isContextual(129) && this.lookahead().type === 51) {
      node.exportKind = "type";
      this.next();
      this.next();
      return true;
    }
    return false;
  }
  maybeParseExportNamespaceSpecifier(node) {
    const {
      startLoc
    } = this.state;
    const hasNamespace = super.maybeParseExportNamespaceSpecifier(node);
    if (hasNamespace && node.exportKind === "type") {
      this.unexpected(startLoc);
    }
    return hasNamespace;
  }
  maybeParseExportNamedSpecifiers(node) {
    if (!super.maybeParseExportNamedSpecifiers(node)) return false;
    const specifier = node.specifiers[node.specifiers.length - 1];
    if (node.exportKind === "type" && specifier?.type === "ExportNamespaceSpecifier") {
      this.unexpected(specifier.start);
    }
    return true;
  }
  parseClassId(node, isStatement, optionalId) {
    if ((!isStatement || optionalId) && this.isContextual(112)) {
      node.id = null;
      return;
    }
    super.parseClassId(node, isStatement, optionalId);
    if (this.match(43)) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    }
  }
  parseClassMember(classBody, member, state) {
    const {
      startLoc
    } = this.state;
    if (this.isContextual(124)) {
      if (super.parseClassMemberFromModifier(classBody, member)) {
        return;
      }
      member.declare = true;
    }
    super.parseClassMember(classBody, member, state);
    if (member.declare) {
      if (member.type !== "ClassProperty" && member.type !== "ClassPrivateProperty" && member.type !== "PropertyDefinition") {
        this.raise(FlowErrors.DeclareClassElement, startLoc);
      } else if (member.value) {
        this.raise(FlowErrors.DeclareClassFieldInitializer, member.value);
      }
    }
  }
  isIterator(word) {
    return word === "iterator" || word === "asyncIterator";
  }
  readIterator() {
    const word = super.readWord1();
    const fullWord = "@@" + word;
    if (!this.isIterator(word) || !this.state.inType) {
      this.raise(Errors.InvalidIdentifier, this.state.curPosition(), {
        identifierName: fullWord
      });
    }
    this.finishToken(131, fullWord);
  }
  getTokenFromCode(code2) {
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (code2 === 123 && next === 124) {
      this.finishOp(3, 2);
    } else if (this.state.inType && (code2 === 62 || code2 === 60)) {
      this.finishOp(code2 === 62 ? 44 : 43, 1);
    } else if (this.state.inType && code2 === 63) {
      if (next === 46) {
        this.finishOp(14, 2);
      } else {
        this.finishOp(13, 1);
      }
    } else if (isIteratorStart(code2, next, this.input.charCodeAt(this.state.pos + 2))) {
      this.state.pos += 2;
      this.readIterator();
    } else {
      super.getTokenFromCode(code2);
    }
  }
  isAssignable(node, isBinding) {
    if (node.type === "TypeCastExpression") {
      return this.isAssignable(node.expression, isBinding);
    } else {
      return super.isAssignable(node, isBinding);
    }
  }
  toAssignable(node, isLHS = false) {
    if (!isLHS && node.type === "AssignmentExpression" && node.left.type === "TypeCastExpression") {
      node.left = this.typeCastToParameter(node.left);
    }
    super.toAssignable(node, isLHS);
  }
  toAssignableListItem(exprList, index, isLHS) {
    const node = exprList[index];
    if (node.type === "TypeCastExpression") {
      exprList[index] = this.typeCastToParameter(node);
    }
    super.toAssignableListItem(exprList, index, isLHS);
  }
  toReferencedList(exprList, isParenthesizedExpr) {
    for (let i = 0; i < exprList.length; i++) {
      const expr = exprList[i];
      if (expr?.type === "TypeCastExpression" && !expr.extra?.parenthesized && (exprList.length > 1 || !isParenthesizedExpr)) {
        this.raise(FlowErrors.TypeCastInPattern, expr.typeAnnotation);
      }
    }
    return exprList;
  }
  parseArrayLike(close, refExpressionErrors) {
    const node = super.parseArrayLike(close, refExpressionErrors);
    if (node.type === "ArrayExpression") {
      this.toReferencedList(node.elements);
    }
    return node;
  }
  isValidLVal(type, disallowCallExpression, isParenthesized, binding) {
    return type === "TypeCastExpression" || super.isValidLVal(type, disallowCallExpression, isParenthesized, binding);
  }
  parseClassProperty(node) {
    if (this.match(10)) {
      node.typeAnnotation = this.flowParseTypeAnnotation();
    }
    return super.parseClassProperty(node);
  }
  parseClassPrivateProperty(node) {
    if (this.match(10)) {
      node.typeAnnotation = this.flowParseTypeAnnotation();
    }
    return super.parseClassPrivateProperty(node);
  }
  isClassMethod() {
    return this.match(43) || super.isClassMethod();
  }
  isClassProperty() {
    return this.match(10) || super.isClassProperty();
  }
  isNonstaticConstructor(method) {
    return !this.match(10) && super.isNonstaticConstructor(method);
  }
  pushClassMethod(classBody, method, isGenerator, isAsync, isConstructor, allowsDirectSuper) {
    if (method.variance) {
      this.unexpected(method.variance.start);
    }
    delete method.variance;
    if (this.match(43)) {
      method.typeParameters = this.flowParseTypeParameterDeclaration();
    }
    super.pushClassMethod(classBody, method, isGenerator, isAsync, isConstructor, allowsDirectSuper);
    if (method.params && isConstructor) {
      const params = method.params;
      if (params.length > 0 && this.isThisParam(params[0])) {
        this.raise(FlowErrors.ThisParamBannedInConstructor, method);
      }
    } else if (method.type === "MethodDefinition" && isConstructor && method.value.params) {
      const params = method.value.params;
      if (params.length > 0 && this.isThisParam(params[0])) {
        this.raise(FlowErrors.ThisParamBannedInConstructor, method);
      }
    }
  }
  pushClassPrivateMethod(classBody, method, isGenerator, isAsync) {
    if (method.variance) {
      this.unexpected(method.variance.start);
    }
    delete method.variance;
    if (this.match(43)) {
      method.typeParameters = this.flowParseTypeParameterDeclaration();
    }
    super.pushClassPrivateMethod(classBody, method, isGenerator, isAsync);
  }
  flowParseClassImplements() {
    const node = this.startNode();
    node.id = this.flowParseRestrictedIdentifier(true);
    if (this.match(43)) {
      node.typeParameters = this.flowParseTypeParameterInstantiation();
    } else {
      node.typeParameters = null;
    }
    return this.finishNode(node, "ClassImplements");
  }
  parseClassSuper(node) {
    super.parseClassSuper(node);
    if (node.superClass && (this.match(43) || this.match(47))) {
      node.superTypeArguments = this.flowParseTypeParameterInstantiationInExpression();
    }
    if (this.eatContextual(112)) {
      const implemented = node.implements = [];
      do {
        implemented.push(this.flowParseClassImplements());
      } while (this.eat(8));
    }
  }
  checkGetterSetterParams(method) {
    super.checkGetterSetterParams(method);
    const params = this.getObjectOrClassMethodParams(method);
    if (params.length > 0) {
      const param = params[0];
      if (this.isThisParam(param) && method.kind === "get") {
        this.raise(FlowErrors.GetterMayNotHaveThisParam, param);
      } else if (this.isThisParam(param)) {
        this.raise(FlowErrors.SetterMayNotHaveThisParam, param);
      }
    }
  }
  parsePropertyNamePrefixOperator(node) {
    node.variance = this.flowParseVariance();
  }
  parseObjPropValue(prop, startLoc, isGenerator, isAsync, isPattern, isAccessor, refExpressionErrors) {
    if (prop.variance) {
      this.unexpected(prop.variance.start);
    }
    delete prop.variance;
    let typeParameters;
    if (this.match(43) && !isAccessor) {
      typeParameters = this.flowParseTypeParameterDeclaration();
      if (!this.match(6)) this.unexpected();
    }
    const result = super.parseObjPropValue(prop, startLoc, isGenerator, isAsync, isPattern, isAccessor, refExpressionErrors);
    if (typeParameters) {
      (result.value || result).typeParameters = typeParameters;
    }
    return result;
  }
  parseFunctionParamType(param) {
    if (this.eat(13)) {
      if (param.type !== "Identifier") {
        this.raise(FlowErrors.PatternIsOptional, param);
      }
      if (this.isThisParam(param)) {
        this.raise(FlowErrors.ThisParamMayNotBeOptional, param);
      }
      param.optional = true;
    }
    if (this.match(10)) {
      param.typeAnnotation = this.flowParseTypeAnnotation();
    } else if (this.isThisParam(param)) {
      this.raise(FlowErrors.ThisParamAnnotationRequired, param);
    }
    if (this.match(25) && this.isThisParam(param)) {
      this.raise(FlowErrors.ThisParamNoDefault, param);
    }
    this.resetEndLocation(param);
    return param;
  }
  parseMaybeDefault(startLoc, left) {
    const node = super.parseMaybeDefault(startLoc, left);
    if (node.type === "AssignmentPattern" && node.typeAnnotation && node.right.start < node.typeAnnotation.start) {
      this.raise(FlowErrors.TypeBeforeInitializer, node.typeAnnotation);
    }
    return node;
  }
  parseImportSpecifierLocal(node, specifier, type) {
    specifier.local = hasTypeImportKind(node) ? this.flowParseRestrictedIdentifier(true, true) : this.parseIdentifier();
    node.specifiers.push(this.finishImportSpecifier(specifier, type));
  }
  isPotentialImportPhase(isExport) {
    if (super.isPotentialImportPhase(isExport)) return true;
    if (this.isContextual(129)) {
      if (!isExport) return true;
      const ch = this.lookaheadCharCode();
      return ch === 123 || ch === 42;
    }
    return !isExport && this.isContextual(83);
  }
  applyImportPhase(node, isExport, phase, loc) {
    super.applyImportPhase(node, isExport, phase, loc);
    if (isExport) {
      if (!phase && this.match(61)) {
        return;
      }
      node.exportKind = phase === "type" ? phase : "value";
    } else {
      if (phase === "type" && this.match(51)) this.unexpected();
      node.importKind = phase === "type" || phase === "typeof" ? phase : "value";
    }
  }
  parseNamedOrFilteredImportSpecifiers(node) {
    super.parseNamedOrFilteredImportSpecifiers(node);
    const specifier = node.specifiers[node.specifiers.length - 1];
    if (hasTypeImportKind(node) && specifier?.type === "ImportNamespaceSpecifier") {
      this.unexpected(specifier.start);
    }
  }
  parseImportSpecifier(specifier, importedIsString, isInTypeOnlyImport, isMaybeTypeOnly) {
    const firstIdent = specifier.imported;
    let specifierTypeKind = null;
    if (firstIdent.type === "Identifier") {
      if (firstIdent.name === "type") {
        specifierTypeKind = "type";
      } else if (firstIdent.name === "typeof") {
        specifierTypeKind = "typeof";
      }
    }
    if (this.isContextual(90) && !this.isLookaheadContextual("as")) {
      const as_ident = this.parseIdentifier(true);
      if (specifierTypeKind !== null && !tokenIsKeywordOrIdentifier(this.state.type)) {
        specifier.imported = as_ident;
        specifier.importKind = specifierTypeKind;
        specifier.local = this.cloneIdentifier(as_ident);
      } else {
        specifier.imported = firstIdent;
        specifier.importKind = null;
        specifier.local = this.parseIdentifier();
      }
    } else {
      if (specifierTypeKind !== null && tokenIsKeywordOrIdentifier(this.state.type)) {
        specifier.imported = this.parseIdentifier(true);
        specifier.importKind = specifierTypeKind;
      } else {
        specifier.imported = firstIdent;
        specifier.importKind = null;
      }
      if (this.eatContextual(90)) {
        specifier.local = this.parseIdentifier();
      } else {
        specifier.local = this.cloneIdentifier(specifier.imported);
      }
    }
    return this.finishNode(specifier, "ImportSpecifier");
  }
  checkImportSpecifier(specifier, isInTypeOnlyImport) {
    const specifierIsTypeImport = hasTypeImportKind(specifier);
    const isTypeImport = isInTypeOnlyImport || specifierIsTypeImport;
    if (isTypeImport) {
      if (isInTypeOnlyImport && specifierIsTypeImport) {
        this.raise(FlowErrors.ImportTypeShorthandOnlyInPureImport, specifier);
      }
      const {
        local
      } = specifier;
      this.checkReservedType(local.name, local.start, true);
    }
    super.checkImportSpecifier(specifier, isInTypeOnlyImport, 8201, !isTypeImport);
  }
  parseBindingAtom() {
    switch (this.state.type) {
      case 74:
        return this.parseIdentifier(true);
      default:
        return super.parseBindingAtom();
    }
  }
  parseFunctionParams(node, isConstructor) {
    const kind = node.kind;
    if (kind !== "get" && kind !== "set" && this.match(43)) {
      node.typeParameters = this.flowParseTypeParameterDeclaration();
    }
    super.parseFunctionParams(node, isConstructor);
  }
  parseVarId(decl, kind) {
    super.parseVarId(decl, kind);
    if (this.match(10)) {
      decl.id.typeAnnotation = this.flowParseTypeAnnotation();
      this.resetEndLocation(decl.id);
    }
  }
  parseAsyncArrowFromCallExpression(node, call) {
    if (this.match(10)) {
      const oldNoAnonFunctionType = this.state.noAnonFunctionType;
      this.state.noAnonFunctionType = true;
      node.returnType = this.flowParseTypeAnnotation();
      this.state.noAnonFunctionType = oldNoAnonFunctionType;
    }
    return super.parseAsyncArrowFromCallExpression(node, call);
  }
  shouldParseAsyncArrow() {
    return this.match(10) || super.shouldParseAsyncArrow();
  }
  parseMaybeAssign(refExpressionErrors, isParenItem) {
    let state = null;
    let jsx2;
    if (this.hasPlugin("jsx") && (this.match(141) || this.match(43))) {
      state = this.state.clone();
      jsx2 = this.tryParse(() => super.parseMaybeAssign(refExpressionErrors, isParenItem), state);
      if (!jsx2.error) return jsx2.node;
      const {
        context
      } = this.state;
      const currentContext = context[context.length - 1];
      if (currentContext === types.j_oTag || currentContext === types.j_expr) {
        context.pop();
      }
    }
    if (jsx2?.error || this.match(43)) {
      state = state || this.state.clone();
      let typeParameters;
      const arrow = this.tryParse((abort) => {
        typeParameters = this.flowParseTypeParameterDeclaration();
        const arrowExpression2 = this.forwardNoArrowParamsConversionAt(typeParameters, () => {
          const result = super.parseMaybeAssign(refExpressionErrors, isParenItem);
          this.resetStartLocationFromNode(result, typeParameters);
          return result;
        });
        if (arrowExpression2.extra?.parenthesized) abort();
        const expr = this.maybeUnwrapTypeCastExpression(arrowExpression2);
        if (expr.type !== "ArrowFunctionExpression") abort();
        expr.typeParameters = typeParameters;
        this.resetStartLocationFromNode(expr, typeParameters);
        return arrowExpression2;
      }, state);
      let arrowExpression = null;
      if (arrow.node && this.maybeUnwrapTypeCastExpression(arrow.node).type === "ArrowFunctionExpression") {
        if (!arrow.error && !arrow.aborted) {
          if (arrow.node.async) {
            this.raise(FlowErrors.UnexpectedTypeParameterBeforeAsyncArrowFunction, typeParameters);
          }
          return arrow.node;
        }
        arrowExpression = arrow.node;
      }
      if (jsx2?.node) {
        this.state = jsx2.failState;
        return jsx2.node;
      }
      if (arrowExpression) {
        this.state = arrow.failState;
        return arrowExpression;
      }
      if (jsx2?.thrown) throw jsx2.error;
      if (arrow.thrown) throw arrow.error;
      throw this.raise(FlowErrors.UnexpectedTokenAfterTypeParameter, typeParameters);
    }
    return super.parseMaybeAssign(refExpressionErrors, isParenItem);
  }
  parseArrow(node) {
    if (this.match(10)) {
      const result = this.tryParse(() => {
        const oldNoAnonFunctionType = this.state.noAnonFunctionType;
        this.state.noAnonFunctionType = true;
        const typeNode = this.startNode();
        [typeNode.typeAnnotation, node.predicate] = this.flowParseTypeAndPredicateInitialiser(true);
        this.state.noAnonFunctionType = oldNoAnonFunctionType;
        if (this.canInsertSemicolon()) this.unexpected();
        if (!this.match(15)) this.unexpected();
        return typeNode;
      });
      if (result.thrown) return null;
      if (result.error) this.state = result.failState;
      node.returnType = result.node.typeAnnotation ? this.finishNode(result.node, "TypeAnnotation") : null;
    }
    return super.parseArrow(node);
  }
  shouldParseArrow(params) {
    return this.match(10) || super.shouldParseArrow(params);
  }
  setArrowFunctionParameters(node, params) {
    if (this.state.noArrowParamsConversionAt.includes(this.offsetToSourcePos(node.start))) {
      node.params = params;
    } else {
      super.setArrowFunctionParameters(node, params);
    }
  }
  checkParams(node, allowDuplicates, isArrowFunction, strictModeChanged = true) {
    if (isArrowFunction && this.state.noArrowParamsConversionAt.includes(this.offsetToSourcePos(node.start))) {
      return;
    }
    for (let i = 0; i < node.params.length; i++) {
      if (this.isThisParam(node.params[i]) && i > 0) {
        this.raise(FlowErrors.ThisParamMustBeFirst, node.params[i]);
      }
    }
    super.checkParams(node, allowDuplicates, isArrowFunction, strictModeChanged);
  }
  parseParenAndDistinguishExpression(canStartArrow) {
    return super.parseParenAndDistinguishExpression(canStartArrow && !this.state.noArrowAt.includes(this.sourceToOffsetPos(this.state.start)));
  }
  parseSubscripts(base, startLoc, noCalls) {
    if (base.type === "Identifier" && base.name === "async" && this.state.noArrowAt.includes(startLoc.index)) {
      this.next();
      const node = this.startNodeAt(startLoc);
      node.callee = base;
      node.arguments = super.parseCallExpressionArguments();
      base = this.finishNode(node, "CallExpression");
    } else if (base.type === "Identifier" && base.name === "async" && this.match(43)) {
      const state = this.state.clone();
      const arrow = this.tryParse((abort) => this.parseAsyncArrowWithTypeParameters(startLoc) || abort(), state);
      if (!arrow.error && !arrow.aborted) return arrow.node;
      const result = this.tryParse(() => super.parseSubscripts(base, startLoc, noCalls), state);
      if (result.node && !result.error) return result.node;
      if (arrow.node) {
        this.state = arrow.failState;
        return arrow.node;
      }
      if (result.node) {
        this.state = result.failState;
        return result.node;
      }
      throw arrow.error || result.error;
    }
    return super.parseSubscripts(base, startLoc, noCalls);
  }
  parseSubscript(base, startLoc, noCalls, subscriptState) {
    if (this.match(14) && this.isLookaheadToken_lt()) {
      subscriptState.optionalChainMember = true;
      if (noCalls) {
        subscriptState.stop = true;
        return base;
      }
      this.next();
      const node = this.startNodeAt(startLoc);
      node.callee = base;
      node.typeArguments = this.flowParseTypeParameterInstantiationInExpression();
      this.expect(6);
      node.arguments = this.parseCallExpressionArguments();
      node.optional = true;
      return this.finishCallExpression(node, true);
    } else if (!noCalls && this.shouldParseTypes() && (this.match(43) || this.match(47))) {
      const node = this.startNodeAt(startLoc);
      node.callee = base;
      const result = this.tryParse(() => {
        node.typeArguments = this.flowParseTypeParameterInstantiationCallOrNew();
        this.expect(6);
        node.arguments = super.parseCallExpressionArguments();
        if (subscriptState.optionalChainMember) {
          node.optional = false;
        }
        return this.finishCallExpression(node, subscriptState.optionalChainMember);
      });
      if (result.node) {
        if (result.error) this.state = result.failState;
        return result.node;
      }
    }
    return super.parseSubscript(base, startLoc, noCalls, subscriptState);
  }
  parseNewCallee(node) {
    super.parseNewCallee(node);
    let targs = null;
    if (this.shouldParseTypes() && this.match(43)) {
      targs = this.tryParse(() => this.flowParseTypeParameterInstantiationCallOrNew()).node;
    }
    node.typeArguments = targs;
  }
  parseAsyncArrowWithTypeParameters(startLoc) {
    const node = this.startNodeAt(startLoc);
    this.parseFunctionParams(node, false);
    if (!this.parseArrow(node)) return;
    return super.parseArrowExpression(node, void 0, true);
  }
  readToken_mult_modulo(code2) {
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (code2 === 42 && next === 47 && this.state.hasFlowComment) {
      this.state.hasFlowComment = false;
      this.state.pos += 2;
      this.nextToken();
      return;
    }
    super.readToken_mult_modulo(code2);
  }
  readToken_pipe_amp(code2) {
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (code2 === 124 && next === 125) {
      this.finishOp(5, 2);
      return;
    }
    super.readToken_pipe_amp(code2);
  }
  parseTopLevel(file, program) {
    const fileNode = super.parseTopLevel(file, program);
    if (this.state.hasFlowComment) {
      this.raise(FlowErrors.UnterminatedFlowComment, this.state.curPosition());
    }
    return fileNode;
  }
  skipBlockComment() {
    if (this.hasPlugin("flowComments") && this.skipFlowComment()) {
      if (this.state.hasFlowComment) {
        throw this.raise(FlowErrors.NestedFlowComment, this.state.startLoc);
      }
      this.hasFlowCommentCompletion();
      const commentSkip = this.skipFlowComment();
      if (commentSkip) {
        this.state.pos += commentSkip;
        this.state.hasFlowComment = true;
      }
      return;
    }
    return super.skipBlockComment(this.state.hasFlowComment ? "*-/" : "*/");
  }
  skipFlowComment() {
    const {
      pos
    } = this.state;
    let shiftToFirstNonWhiteSpace = 2;
    while ([32, 9].includes(this.input.charCodeAt(pos + shiftToFirstNonWhiteSpace))) {
      shiftToFirstNonWhiteSpace++;
    }
    const ch2 = this.input.charCodeAt(shiftToFirstNonWhiteSpace + pos);
    const ch3 = this.input.charCodeAt(shiftToFirstNonWhiteSpace + pos + 1);
    if (ch2 === 58 && ch3 === 58) {
      return shiftToFirstNonWhiteSpace + 2;
    }
    if (this.input.slice(shiftToFirstNonWhiteSpace + pos, shiftToFirstNonWhiteSpace + pos + 12) === "flow-include") {
      return shiftToFirstNonWhiteSpace + 12;
    }
    if (ch2 === 58 && ch3 !== 58) {
      return shiftToFirstNonWhiteSpace;
    }
    return false;
  }
  hasFlowCommentCompletion() {
    const end = this.input.indexOf("*/", this.state.pos);
    if (end === -1) {
      throw this.raise(Errors.UnterminatedComment, this.state.curPosition());
    }
  }
  flowEnumErrorBooleanMemberNotInitialized(loc, names) {
    this.raise(FlowErrors.EnumBooleanMemberNotInitialized, loc, names);
  }
  flowEnumErrorInvalidMemberInitializer(loc, enumContext) {
    return this.raise(!enumContext.explicitType ? FlowErrors.EnumInvalidMemberInitializerUnknownType : enumContext.explicitType === "symbol" ? FlowErrors.EnumInvalidMemberInitializerSymbolType : FlowErrors.EnumInvalidMemberInitializerPrimaryType, loc, enumContext);
  }
  flowEnumErrorNumberMemberNotInitialized(loc, details) {
    this.raise(FlowErrors.EnumNumberMemberNotInitialized, loc, details);
  }
  flowEnumErrorStringMemberInconsistentlyInitialized(node, details) {
    this.raise(FlowErrors.EnumStringMemberInconsistentlyInitialized, node, details);
  }
  flowEnumMemberInit() {
    const startLoc = this.state.startLoc;
    const endOfInit = () => this.match(8) || this.match(4);
    switch (this.state.type) {
      case 134: {
        const literal = this.parseNumericLiteral(this.state.value);
        if (endOfInit()) {
          return {
            type: "number",
            loc: literal.start,
            value: literal
          };
        }
        break;
      }
      case 133: {
        const literal = this.parseStringLiteral(this.state.value);
        if (endOfInit()) {
          return {
            type: "string",
            loc: literal.start,
            value: literal
          };
        }
        break;
      }
      case 81:
      case 82: {
        const literal = this.parseBooleanLiteral(this.match(81));
        if (endOfInit()) {
          return {
            type: "boolean",
            loc: literal.start,
            value: literal
          };
        }
      }
    }
    return {
      type: "invalid",
      loc: startLoc
    };
  }
  flowEnumMemberRaw() {
    const loc = this.state.startLoc;
    const id = this.parseIdentifier(true);
    const init = this.eat(25) ? this.flowEnumMemberInit() : {
      type: "none",
      loc
    };
    return {
      id,
      init
    };
  }
  flowEnumCheckExplicitTypeMismatch(loc, context, expectedType) {
    const {
      explicitType
    } = context;
    if (explicitType === null) {
      return;
    }
    if (explicitType !== expectedType) {
      this.flowEnumErrorInvalidMemberInitializer(loc, context);
    }
  }
  flowEnumMembers({
    enumName,
    explicitType
  }) {
    const seenNames = /* @__PURE__ */ new Set();
    const members = {
      booleanMembers: [],
      numberMembers: [],
      stringMembers: [],
      defaultedMembers: []
    };
    let hasUnknownMembers = false;
    while (!this.match(4)) {
      if (this.eat(17)) {
        hasUnknownMembers = true;
        break;
      }
      const memberNode = this.startNode();
      const {
        id,
        init
      } = this.flowEnumMemberRaw();
      const memberName = id.name;
      if (memberName === "") {
        continue;
      }
      if (/^[a-z]/.test(memberName)) {
        this.raise(FlowErrors.EnumInvalidMemberName, id, {
          memberName,
          suggestion: memberName[0].toUpperCase() + memberName.slice(1),
          enumName
        });
      }
      if (seenNames.has(memberName)) {
        this.raise(FlowErrors.EnumDuplicateMemberName, id, {
          memberName,
          enumName
        });
      }
      seenNames.add(memberName);
      const context = {
        enumName,
        explicitType,
        memberName
      };
      memberNode.id = id;
      switch (init.type) {
        case "boolean": {
          this.flowEnumCheckExplicitTypeMismatch(init.loc, context, "boolean");
          memberNode.init = init.value;
          members.booleanMembers.push(this.finishNode(memberNode, "EnumBooleanMember"));
          break;
        }
        case "number": {
          this.flowEnumCheckExplicitTypeMismatch(init.loc, context, "number");
          memberNode.init = init.value;
          members.numberMembers.push(this.finishNode(memberNode, "EnumNumberMember"));
          break;
        }
        case "string": {
          this.flowEnumCheckExplicitTypeMismatch(init.loc, context, "string");
          memberNode.init = init.value;
          members.stringMembers.push(this.finishNode(memberNode, "EnumStringMember"));
          break;
        }
        case "invalid": {
          throw this.flowEnumErrorInvalidMemberInitializer(init.loc, context);
        }
        case "none": {
          switch (explicitType) {
            case "boolean":
              this.flowEnumErrorBooleanMemberNotInitialized(init.loc, context);
              break;
            case "number":
              this.flowEnumErrorNumberMemberNotInitialized(init.loc, context);
              break;
            default:
              members.defaultedMembers.push(this.finishNode(memberNode, "EnumDefaultedMember"));
          }
        }
      }
      if (!this.match(4)) {
        this.expect(8);
      }
    }
    return {
      members,
      hasUnknownMembers
    };
  }
  flowEnumStringMembers(initializedMembers, defaultedMembers, {
    enumName
  }) {
    if (initializedMembers.length === 0) {
      return defaultedMembers;
    } else if (defaultedMembers.length === 0) {
      return initializedMembers;
    } else if (defaultedMembers.length > initializedMembers.length) {
      for (const member of initializedMembers) {
        this.flowEnumErrorStringMemberInconsistentlyInitialized(member, {
          enumName
        });
      }
      return defaultedMembers;
    } else {
      for (const member of defaultedMembers) {
        this.flowEnumErrorStringMemberInconsistentlyInitialized(member, {
          enumName
        });
      }
      return initializedMembers;
    }
  }
  flowEnumParseExplicitType({
    enumName
  }) {
    if (!this.eatContextual(99)) return null;
    if (!tokenIsIdentifier(this.state.type)) {
      throw this.raise(FlowErrors.EnumInvalidExplicitTypeUnknownSupplied, this.state.startLoc, {
        enumName
      });
    }
    const {
      value
    } = this.state;
    this.next();
    if (value !== "boolean" && value !== "number" && value !== "string" && value !== "symbol") {
      this.raise(FlowErrors.EnumInvalidExplicitType, this.state.startLoc, {
        enumName,
        invalidEnumType: value
      });
    }
    return value;
  }
  flowEnumBody(node, id) {
    const enumName = id.name;
    const nameLoc = id.start;
    const explicitType = this.flowEnumParseExplicitType({
      enumName
    });
    this.expect(2);
    const {
      members,
      hasUnknownMembers
    } = this.flowEnumMembers({
      enumName,
      explicitType
    });
    node.hasUnknownMembers = hasUnknownMembers;
    switch (explicitType) {
      case "boolean":
        node.explicitType = true;
        node.members = members.booleanMembers;
        this.expect(4);
        return this.finishNode(node, "EnumBooleanBody");
      case "number":
        node.explicitType = true;
        node.members = members.numberMembers;
        this.expect(4);
        return this.finishNode(node, "EnumNumberBody");
      case "string":
        node.explicitType = true;
        node.members = this.flowEnumStringMembers(members.stringMembers, members.defaultedMembers, {
          enumName
        });
        this.expect(4);
        return this.finishNode(node, "EnumStringBody");
      case "symbol":
        node.members = members.defaultedMembers;
        this.expect(4);
        return this.finishNode(node, "EnumSymbolBody");
      default: {
        const empty = () => {
          node.members = [];
          this.expect(4);
          return this.finishNode(node, "EnumStringBody");
        };
        node.explicitType = false;
        const boolsLen = members.booleanMembers.length;
        const numsLen = members.numberMembers.length;
        const strsLen = members.stringMembers.length;
        const defaultedLen = members.defaultedMembers.length;
        if (!boolsLen && !numsLen && !strsLen && !defaultedLen) {
          return empty();
        } else if (!boolsLen && !numsLen) {
          node.members = this.flowEnumStringMembers(members.stringMembers, members.defaultedMembers, {
            enumName
          });
          this.expect(4);
          return this.finishNode(node, "EnumStringBody");
        } else if (!numsLen && !strsLen && boolsLen >= defaultedLen) {
          for (const member of members.defaultedMembers) {
            this.flowEnumErrorBooleanMemberNotInitialized(member.start, {
              enumName,
              memberName: member.id.name
            });
          }
          node.members = members.booleanMembers;
          this.expect(4);
          return this.finishNode(node, "EnumBooleanBody");
        } else if (!boolsLen && !strsLen && numsLen >= defaultedLen) {
          for (const member of members.defaultedMembers) {
            this.flowEnumErrorNumberMemberNotInitialized(member.start, {
              enumName,
              memberName: member.id.name
            });
          }
          node.members = members.numberMembers;
          this.expect(4);
          return this.finishNode(node, "EnumNumberBody");
        } else {
          this.raise(FlowErrors.EnumInconsistentMemberValues, nameLoc, {
            enumName
          });
          return empty();
        }
      }
    }
  }
  flowParseEnumDeclaration(node) {
    const id = this.parseIdentifier();
    node.id = id;
    node.body = this.flowEnumBody(this.startNode(), id);
    return this.finishNode(node, "EnumDeclaration");
  }
  jsxParseOpeningElementAfterName(node) {
    if (this.shouldParseTypes()) {
      if (this.match(43) || this.match(47)) {
        node.typeArguments = this.flowParseTypeParameterInstantiationInExpression();
      }
    }
    return super.jsxParseOpeningElementAfterName(node);
  }
  isLookaheadToken_lt() {
    const next = this.nextTokenStart();
    if (this.input.charCodeAt(next) === 60) {
      const afterNext = this.input.charCodeAt(next + 1);
      return afterNext !== 60 && afterNext !== 61;
    }
    return false;
  }
  reScan_lt_gt() {
    const {
      type
    } = this.state;
    if (type === 43) {
      this.state.pos -= 1;
      this.readToken_lt();
    } else if (type === 44) {
      this.state.pos -= 1;
      this.readToken_gt();
    }
  }
  reScan_lt() {
    const {
      type
    } = this.state;
    if (type === 47) {
      this.state.pos -= 2;
      this.finishOp(43, 1);
      return 43;
    }
    return type;
  }
  maybeUnwrapTypeCastExpression(node) {
    return node.type === "TypeCastExpression" ? node.expression : node;
  }
};
var entities = {
  __proto__: null,
  quot: '"',
  amp: "&",
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: "\xA0",
  iexcl: "\xA1",
  cent: "\xA2",
  pound: "\xA3",
  curren: "\xA4",
  yen: "\xA5",
  brvbar: "\xA6",
  sect: "\xA7",
  uml: "\xA8",
  copy: "\xA9",
  ordf: "\xAA",
  laquo: "\xAB",
  not: "\xAC",
  shy: "\xAD",
  reg: "\xAE",
  macr: "\xAF",
  deg: "\xB0",
  plusmn: "\xB1",
  sup2: "\xB2",
  sup3: "\xB3",
  acute: "\xB4",
  micro: "\xB5",
  para: "\xB6",
  middot: "\xB7",
  cedil: "\xB8",
  sup1: "\xB9",
  ordm: "\xBA",
  raquo: "\xBB",
  frac14: "\xBC",
  frac12: "\xBD",
  frac34: "\xBE",
  iquest: "\xBF",
  Agrave: "\xC0",
  Aacute: "\xC1",
  Acirc: "\xC2",
  Atilde: "\xC3",
  Auml: "\xC4",
  Aring: "\xC5",
  AElig: "\xC6",
  Ccedil: "\xC7",
  Egrave: "\xC8",
  Eacute: "\xC9",
  Ecirc: "\xCA",
  Euml: "\xCB",
  Igrave: "\xCC",
  Iacute: "\xCD",
  Icirc: "\xCE",
  Iuml: "\xCF",
  ETH: "\xD0",
  Ntilde: "\xD1",
  Ograve: "\xD2",
  Oacute: "\xD3",
  Ocirc: "\xD4",
  Otilde: "\xD5",
  Ouml: "\xD6",
  times: "\xD7",
  Oslash: "\xD8",
  Ugrave: "\xD9",
  Uacute: "\xDA",
  Ucirc: "\xDB",
  Uuml: "\xDC",
  Yacute: "\xDD",
  THORN: "\xDE",
  szlig: "\xDF",
  agrave: "\xE0",
  aacute: "\xE1",
  acirc: "\xE2",
  atilde: "\xE3",
  auml: "\xE4",
  aring: "\xE5",
  aelig: "\xE6",
  ccedil: "\xE7",
  egrave: "\xE8",
  eacute: "\xE9",
  ecirc: "\xEA",
  euml: "\xEB",
  igrave: "\xEC",
  iacute: "\xED",
  icirc: "\xEE",
  iuml: "\xEF",
  eth: "\xF0",
  ntilde: "\xF1",
  ograve: "\xF2",
  oacute: "\xF3",
  ocirc: "\xF4",
  otilde: "\xF5",
  ouml: "\xF6",
  divide: "\xF7",
  oslash: "\xF8",
  ugrave: "\xF9",
  uacute: "\xFA",
  ucirc: "\xFB",
  uuml: "\xFC",
  yacute: "\xFD",
  thorn: "\xFE",
  yuml: "\xFF",
  OElig: "\u0152",
  oelig: "\u0153",
  Scaron: "\u0160",
  scaron: "\u0161",
  Yuml: "\u0178",
  fnof: "\u0192",
  circ: "\u02C6",
  tilde: "\u02DC",
  Alpha: "\u0391",
  Beta: "\u0392",
  Gamma: "\u0393",
  Delta: "\u0394",
  Epsilon: "\u0395",
  Zeta: "\u0396",
  Eta: "\u0397",
  Theta: "\u0398",
  Iota: "\u0399",
  Kappa: "\u039A",
  Lambda: "\u039B",
  Mu: "\u039C",
  Nu: "\u039D",
  Xi: "\u039E",
  Omicron: "\u039F",
  Pi: "\u03A0",
  Rho: "\u03A1",
  Sigma: "\u03A3",
  Tau: "\u03A4",
  Upsilon: "\u03A5",
  Phi: "\u03A6",
  Chi: "\u03A7",
  Psi: "\u03A8",
  Omega: "\u03A9",
  alpha: "\u03B1",
  beta: "\u03B2",
  gamma: "\u03B3",
  delta: "\u03B4",
  epsilon: "\u03B5",
  zeta: "\u03B6",
  eta: "\u03B7",
  theta: "\u03B8",
  iota: "\u03B9",
  kappa: "\u03BA",
  lambda: "\u03BB",
  mu: "\u03BC",
  nu: "\u03BD",
  xi: "\u03BE",
  omicron: "\u03BF",
  pi: "\u03C0",
  rho: "\u03C1",
  sigmaf: "\u03C2",
  sigma: "\u03C3",
  tau: "\u03C4",
  upsilon: "\u03C5",
  phi: "\u03C6",
  chi: "\u03C7",
  psi: "\u03C8",
  omega: "\u03C9",
  thetasym: "\u03D1",
  upsih: "\u03D2",
  piv: "\u03D6",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  zwnj: "\u200C",
  zwj: "\u200D",
  lrm: "\u200E",
  rlm: "\u200F",
  ndash: "\u2013",
  mdash: "\u2014",
  lsquo: "\u2018",
  rsquo: "\u2019",
  sbquo: "\u201A",
  ldquo: "\u201C",
  rdquo: "\u201D",
  bdquo: "\u201E",
  dagger: "\u2020",
  Dagger: "\u2021",
  bull: "\u2022",
  hellip: "\u2026",
  permil: "\u2030",
  prime: "\u2032",
  Prime: "\u2033",
  lsaquo: "\u2039",
  rsaquo: "\u203A",
  oline: "\u203E",
  frasl: "\u2044",
  euro: "\u20AC",
  image: "\u2111",
  weierp: "\u2118",
  real: "\u211C",
  trade: "\u2122",
  alefsym: "\u2135",
  larr: "\u2190",
  uarr: "\u2191",
  rarr: "\u2192",
  darr: "\u2193",
  harr: "\u2194",
  crarr: "\u21B5",
  lArr: "\u21D0",
  uArr: "\u21D1",
  rArr: "\u21D2",
  dArr: "\u21D3",
  hArr: "\u21D4",
  forall: "\u2200",
  part: "\u2202",
  exist: "\u2203",
  empty: "\u2205",
  nabla: "\u2207",
  isin: "\u2208",
  notin: "\u2209",
  ni: "\u220B",
  prod: "\u220F",
  sum: "\u2211",
  minus: "\u2212",
  lowast: "\u2217",
  radic: "\u221A",
  prop: "\u221D",
  infin: "\u221E",
  ang: "\u2220",
  and: "\u2227",
  or: "\u2228",
  cap: "\u2229",
  cup: "\u222A",
  int: "\u222B",
  there4: "\u2234",
  sim: "\u223C",
  cong: "\u2245",
  asymp: "\u2248",
  ne: "\u2260",
  equiv: "\u2261",
  le: "\u2264",
  ge: "\u2265",
  sub: "\u2282",
  sup: "\u2283",
  nsub: "\u2284",
  sube: "\u2286",
  supe: "\u2287",
  oplus: "\u2295",
  otimes: "\u2297",
  perp: "\u22A5",
  sdot: "\u22C5",
  lceil: "\u2308",
  rceil: "\u2309",
  lfloor: "\u230A",
  rfloor: "\u230B",
  lang: "\u2329",
  rang: "\u232A",
  loz: "\u25CA",
  spades: "\u2660",
  clubs: "\u2663",
  hearts: "\u2665",
  diams: "\u2666"
};
var lineBreakG = /\r\n|[\r\n\u2028\u2029]/g;
function isNewLine(code2) {
  switch (code2) {
    case 10:
    case 13:
    case 8232:
    case 8233:
      return true;
    default:
      return false;
  }
}
function hasNewLine(input, start, end) {
  for (let i = start; i < end; i++) {
    if (isNewLine(input.charCodeAt(i))) {
      return true;
    }
  }
  return false;
}
var skipWhiteSpace = /(?:\s|\/\/.*|\/\*[^]*?\*\/)*/g;
var skipWhiteSpaceAnnexB = /(?:[^\S\n\r\u2028\u2029]|\/\*.*?\*\/)*(?:(?!-->)(?:\s|\/\/.*|\/\*[^]*?\*\/|<!--.*|-->.*)*)?/g;
var skipWhiteSpaceInLine = /(?:[^\S\n\r\u2028\u2029]|\/\/.*|\/\*.*?\*\/)*/g;
function isWhitespace(code2) {
  switch (code2) {
    case 9:
    case 11:
    case 12:
    case 32:
    case 160:
    case 5760:
    case 8192:
    case 8193:
    case 8194:
    case 8195:
    case 8196:
    case 8197:
    case 8198:
    case 8199:
    case 8200:
    case 8201:
    case 8202:
    case 8239:
    case 8287:
    case 12288:
    case 65279:
      return true;
    default:
      return false;
  }
}
var JsxErrorTemplates = {
  AttributeIsEmpty: "JSX attributes must only be assigned a non-empty expression.",
  MissingClosingTagElement: ({
    openingTagName
  }) => `Expected corresponding JSX closing tag for <${openingTagName}>.`,
  MissingClosingTagFragment: "Expected corresponding JSX closing tag for <>.",
  UnexpectedSequenceExpression: "Sequence expressions cannot be directly nested inside JSX. Did you mean to wrap it in parentheses (...)?",
  UnexpectedToken: ({
    unexpected,
    HTMLEntity
  }) => `Unexpected token \`${unexpected}\`. Did you mean \`${HTMLEntity}\` or \`{'${unexpected}'}\`?`,
  UnsupportedJsxValue: "JSX value should be either an expression or a quoted JSX text.",
  UnterminatedJsxContent: "Unterminated JSX contents.",
  UnwrappedAdjacentJSXElements: "Adjacent JSX elements must be wrapped in an enclosing tag. Did you want a JSX fragment <>...</>?"
};
var JsxErrors = ParseErrorEnum`jsx`(JsxErrorTemplates);
function isFragment(object) {
  return object ? object.type === "JSXOpeningFragment" || object.type === "JSXClosingFragment" : false;
}
function getQualifiedJSXName(object) {
  if (object.type === "JSXIdentifier") {
    return object.name;
  }
  if (object.type === "JSXNamespacedName") {
    return object.namespace.name + ":" + object.name.name;
  }
  if (object.type === "JSXMemberExpression") {
    return getQualifiedJSXName(object.object) + "." + getQualifiedJSXName(object.property);
  }
  throw new Error("Node had unexpected type: " + object.type);
}
var jsx = (superClass) => class JSXParserMixin extends superClass {
  jsxReadToken() {
    let out = "";
    let chunkStart = this.state.pos;
    for (; ; ) {
      if (this.state.pos >= this.length) {
        throw this.raise(JsxErrors.UnterminatedJsxContent, this.state.startLoc);
      }
      const ch = this.input.charCodeAt(this.state.pos);
      switch (ch) {
        case 60:
        case 123:
          if (this.state.pos === this.state.start) {
            if (ch === 60 && this.state.canStartJSXElement) {
              ++this.state.pos;
              this.finishToken(141);
            } else {
              super.getTokenFromCode(ch);
            }
            return;
          }
          out += this.input.slice(chunkStart, this.state.pos);
          this.finishToken(140, out);
          return;
        case 38:
          out += this.input.slice(chunkStart, this.state.pos);
          out += this.jsxReadEntity();
          chunkStart = this.state.pos;
          break;
        case 62:
        case 125:
          this.raise(JsxErrors.UnexpectedToken, this.state.curPosition(), {
            unexpected: this.input[this.state.pos],
            HTMLEntity: ch === 125 ? "&rbrace;" : "&gt;"
          });
        default:
          if (isNewLine(ch)) {
            out += this.input.slice(chunkStart, this.state.pos);
            out += this.jsxReadNewLine(true);
            chunkStart = this.state.pos;
          } else {
            ++this.state.pos;
          }
      }
    }
  }
  jsxReadNewLine(normalizeCRLF) {
    const ch = this.input.charCodeAt(this.state.pos);
    let out;
    ++this.state.pos;
    if (ch === 13 && this.input.charCodeAt(this.state.pos) === 10) {
      ++this.state.pos;
      out = normalizeCRLF ? "\n" : "\r\n";
    } else {
      out = String.fromCharCode(ch);
    }
    ++this.state.curLine;
    this.state.lineStart = this.state.pos;
    return out;
  }
  jsxReadString(quote) {
    let out = "";
    let chunkStart = ++this.state.pos;
    for (; ; ) {
      if (this.state.pos >= this.length) {
        throw this.raise(Errors.UnterminatedString, this.state.startLoc);
      }
      const ch = this.input.charCodeAt(this.state.pos);
      if (ch === quote) break;
      if (ch === 38) {
        out += this.input.slice(chunkStart, this.state.pos);
        out += this.jsxReadEntity();
        chunkStart = this.state.pos;
      } else if (isNewLine(ch)) {
        out += this.input.slice(chunkStart, this.state.pos);
        out += this.jsxReadNewLine(false);
        chunkStart = this.state.pos;
      } else {
        ++this.state.pos;
      }
    }
    out += this.input.slice(chunkStart, this.state.pos++);
    this.finishToken(133, out);
  }
  jsxReadEntity() {
    const startPos = ++this.state.pos;
    if (this.codePointAtPos(this.state.pos) === 35) {
      ++this.state.pos;
      let radix = 10;
      if (this.codePointAtPos(this.state.pos) === 120) {
        radix = 16;
        ++this.state.pos;
      }
      const codePoint = this.readInt(radix, void 0, false, "bail");
      if (codePoint !== null && codePoint <= 1114111 && this.codePointAtPos(this.state.pos) === 59) {
        ++this.state.pos;
        return String.fromCodePoint(codePoint);
      }
    } else {
      let count = 0;
      let semi = false;
      while (count++ < 10 && this.state.pos < this.length && !(semi = this.codePointAtPos(this.state.pos) === 59)) {
        ++this.state.pos;
      }
      if (semi) {
        const desc = this.input.slice(startPos, this.state.pos);
        const entity = entities[desc];
        ++this.state.pos;
        if (entity) {
          return entity;
        }
      }
    }
    this.state.pos = startPos;
    return "&";
  }
  jsxReadWord() {
    let ch;
    const start = this.state.pos;
    do {
      ch = this.input.charCodeAt(++this.state.pos);
    } while (isIdentifierChar(ch) || ch === 45);
    this.finishToken(139, this.input.slice(start, this.state.pos));
  }
  jsxParseIdentifier() {
    const node = this.startNode();
    if (this.match(139)) {
      node.name = this.state.value;
    } else if (tokenIsKeyword(this.state.type)) {
      node.name = tokenLabelName(this.state.type);
    } else {
      this.unexpected();
    }
    this.next();
    return this.finishNode(node, "JSXIdentifier");
  }
  jsxParseNamespacedName() {
    const startLoc = this.state.startLoc;
    const name = this.jsxParseIdentifier();
    if (!this.eat(10)) return name;
    const node = this.startNodeAt(startLoc);
    node.namespace = name;
    node.name = this.jsxParseIdentifier();
    return this.finishNode(node, "JSXNamespacedName");
  }
  jsxParseElementName() {
    const startLoc = this.state.startLoc;
    let node = this.jsxParseNamespacedName();
    if (node.type === "JSXNamespacedName") {
      return node;
    }
    while (this.eat(12)) {
      const newNode = this.startNodeAt(startLoc);
      newNode.object = node;
      newNode.property = this.jsxParseIdentifier();
      node = this.finishNode(newNode, "JSXMemberExpression");
    }
    return node;
  }
  jsxParseAttributeValue() {
    let node;
    switch (this.state.type) {
      case 2:
        node = this.startNode();
        this.setContext(types.brace);
        this.next();
        node = this.jsxParseExpressionContainer(node, types.j_oTag);
        if (node.expression.type === "JSXEmptyExpression") {
          this.raise(JsxErrors.AttributeIsEmpty, node);
        }
        return node;
      case 141:
      case 133:
        return this.parseExprAtom();
      default:
        throw this.raise(JsxErrors.UnsupportedJsxValue, this.state.startLoc);
    }
  }
  jsxParseEmptyExpression() {
    const node = this.startNodeAt(this.state.lastTokEndLoc);
    return this.finishNodeAt(node, "JSXEmptyExpression", this.state.startLoc);
  }
  jsxParseSpreadChild(node) {
    this.next();
    node.expression = this.parseExpression();
    this.setContext(types.j_expr);
    this.state.canStartJSXElement = true;
    this.expect(4);
    return this.finishNode(node, "JSXSpreadChild");
  }
  jsxParseExpressionContainer(node, previousContext) {
    if (this.match(4)) {
      node.expression = this.jsxParseEmptyExpression();
    } else {
      const expression = this.parseExpression();
      if (expression.type === "SequenceExpression" && !expression.extra?.parenthesized) {
        this.raise(JsxErrors.UnexpectedSequenceExpression, expression.expressions[1]);
      }
      node.expression = expression;
    }
    this.setContext(previousContext);
    this.state.canStartJSXElement = true;
    this.expect(4);
    return this.finishNode(node, "JSXExpressionContainer");
  }
  jsxParseAttribute() {
    if (this.match(2)) {
      const node2 = this.startNode();
      this.setContext(types.brace);
      this.next();
      this.expect(17);
      node2.argument = this.parseMaybeAssignAllowIn();
      this.setContext(types.j_oTag);
      this.state.canStartJSXElement = true;
      this.expect(4);
      return this.finishNode(node2, "JSXSpreadAttribute");
    }
    const node = this.startNode();
    node.name = this.jsxParseNamespacedName();
    node.value = this.eat(25) ? this.jsxParseAttributeValue() : null;
    return this.finishNode(node, "JSXAttribute");
  }
  jsxParseOpeningElementAt(startLoc) {
    if (this.eat(142)) {
      const node2 = this.startNodeAt(startLoc);
      return this.finishNode(node2, "JSXOpeningFragment");
    }
    const node = this.startNodeAt(startLoc);
    node.name = this.jsxParseElementName();
    return this.jsxParseOpeningElementAfterName(node);
  }
  jsxParseOpeningElementAfterName(node) {
    const attributes = [];
    while (!this.match(52) && !this.match(142)) {
      attributes.push(this.jsxParseAttribute());
    }
    node.attributes = attributes;
    node.selfClosing = this.eat(52);
    this.expect(142);
    return this.finishNode(node, "JSXOpeningElement");
  }
  jsxParseClosingElementAt(startLoc) {
    if (this.eat(142)) {
      const node2 = this.startNodeAt(startLoc);
      return this.finishNode(node2, "JSXClosingFragment");
    }
    const node = this.startNodeAt(startLoc);
    node.name = this.jsxParseElementName();
    this.expect(142);
    return this.finishNode(node, "JSXClosingElement");
  }
  jsxParseElementAt(startLoc) {
    const node = this.startNodeAt(startLoc);
    const children = [];
    const openingElement = this.jsxParseOpeningElementAt(startLoc);
    let closingElement = null;
    if (!openingElement.selfClosing) {
      contents: for (; ; ) {
        switch (this.state.type) {
          case 141:
            startLoc = this.state.startLoc;
            this.next();
            if (this.eat(52)) {
              closingElement = this.jsxParseClosingElementAt(startLoc);
              break contents;
            }
            children.push(this.jsxParseElementAt(startLoc));
            break;
          case 140:
            children.push(this.parseLiteral(this.state.value, "JSXText"));
            break;
          case 2: {
            const node2 = this.startNode();
            this.setContext(types.brace);
            this.next();
            if (this.match(17)) {
              children.push(this.jsxParseSpreadChild(node2));
            } else {
              children.push(this.jsxParseExpressionContainer(node2, types.j_expr));
            }
            break;
          }
          default:
            this.unexpected();
        }
      }
      if (isFragment(openingElement) && !isFragment(closingElement) && closingElement !== null) {
        this.raise(JsxErrors.MissingClosingTagFragment, closingElement);
      } else if (!isFragment(openingElement) && isFragment(closingElement)) {
        this.raise(JsxErrors.MissingClosingTagElement, closingElement, {
          openingTagName: getQualifiedJSXName(openingElement.name)
        });
      } else if (!isFragment(openingElement) && !isFragment(closingElement)) {
        if (getQualifiedJSXName(closingElement.name) !== getQualifiedJSXName(openingElement.name)) {
          this.raise(JsxErrors.MissingClosingTagElement, closingElement, {
            openingTagName: getQualifiedJSXName(openingElement.name)
          });
        }
      }
    }
    if (isFragment(openingElement)) {
      node.openingFragment = openingElement;
      node.closingFragment = closingElement;
    } else {
      node.openingElement = openingElement;
      node.closingElement = closingElement;
    }
    node.children = children;
    if (this.match(43)) {
      throw this.raise(JsxErrors.UnwrappedAdjacentJSXElements, this.state.startLoc);
    }
    return isFragment(openingElement) ? this.finishNode(node, "JSXFragment") : this.finishNode(node, "JSXElement");
  }
  jsxParseElement() {
    const startLoc = this.state.startLoc;
    this.next();
    return this.jsxParseElementAt(startLoc);
  }
  setContext(newContext) {
    const {
      context
    } = this.state;
    context[context.length - 1] = newContext;
  }
  parseExprAtom(refExpressionErrors) {
    if (this.match(141)) {
      return this.jsxParseElement();
    } else if (this.match(43) && this.input.charCodeAt(this.state.pos) !== 33) {
      this.replaceToken(141);
      return this.jsxParseElement();
    } else {
      return super.parseExprAtom(refExpressionErrors);
    }
  }
  skipSpace() {
    const curContext = this.curContext();
    if (!curContext.preserveSpace) super.skipSpace();
  }
  getTokenFromCode(code2) {
    const context = this.curContext();
    if (context === types.j_expr) {
      this.jsxReadToken();
      return;
    }
    if (context === types.j_oTag || context === types.j_cTag) {
      if (isIdentifierStart(code2)) {
        this.jsxReadWord();
        return;
      }
      if (code2 === 62) {
        ++this.state.pos;
        this.finishToken(142);
        return;
      }
      if ((code2 === 34 || code2 === 39) && context === types.j_oTag) {
        this.jsxReadString(code2);
        return;
      }
    }
    if (code2 === 60 && this.state.canStartJSXElement && this.input.charCodeAt(this.state.pos + 1) !== 33) {
      ++this.state.pos;
      this.finishToken(141);
      return;
    }
    super.getTokenFromCode(code2);
  }
  updateContext(prevType) {
    const {
      context,
      type
    } = this.state;
    if (type === 52 && prevType === 141) {
      context.splice(-2, 2, types.j_cTag);
      this.state.canStartJSXElement = false;
    } else if (type === 141) {
      context.push(types.j_oTag);
    } else if (type === 142) {
      const out = context[context.length - 1];
      if (out === types.j_oTag && prevType === 52 || out === types.j_cTag) {
        context.pop();
        this.state.canStartJSXElement = context[context.length - 1] === types.j_expr;
      } else {
        this.setContext(types.j_expr);
        this.state.canStartJSXElement = true;
      }
    } else {
      this.state.canStartJSXElement = tokenComesBeforeExpression(type);
    }
  }
};
var TypeScriptScope = class extends Scope {
  tsNames = /* @__PURE__ */ new Map();
};
var TypeScriptScopeHandler = class extends ScopeHandler {
  get inTSNamespace() {
    const scopeStack = this.scopeStack;
    return scopeStack.length >= 2 && scopeStack[scopeStack.length - 1].flags === 0 && (scopeStack[scopeStack.length - 2].flags & 2048) > 0;
  }
  importsStack = [];
  createScope(flags) {
    this.importsStack.push(/* @__PURE__ */ new Set());
    return new TypeScriptScope(flags);
  }
  enter(flags) {
    if (flags & (1024 | 2048)) {
      this.importsStack.push(/* @__PURE__ */ new Set());
    }
    super.enter(flags);
  }
  exit() {
    const flags = super.exit();
    if (flags & (1024 | 2048)) {
      this.importsStack.pop();
    }
    return flags;
  }
  hasImport(name, allowShadow) {
    const len = this.importsStack.length;
    if (this.importsStack[len - 1].has(name)) {
      return true;
    }
    if (!allowShadow && len > 1) {
      for (let i = 0; i < len - 1; i++) {
        if (this.importsStack[i].has(name)) return true;
      }
    }
    return false;
  }
  declareName(name, bindingType, loc) {
    if (bindingType & 4096) {
      if (this.hasImport(name, true)) {
        this.parser.raise(Errors.VarRedeclaration, loc, {
          identifierName: name
        });
      }
      this.importsStack[this.importsStack.length - 1].add(name);
      return;
    }
    const scope = this.currentScope();
    let type = scope.tsNames.get(name) || 0;
    if (bindingType & 1024) {
      this.maybeExportDefined(scope, name);
      scope.tsNames.set(name, type | 16);
      return;
    }
    super.declareName(name, bindingType, loc);
    if (bindingType & 2) {
      if (!(bindingType & 1)) {
        this.checkRedeclarationInScope(scope, name, bindingType, loc);
        this.maybeExportDefined(scope, name);
      }
      type = type | 1;
    }
    if (bindingType & 256) {
      type = type | 2;
    }
    if (bindingType & 512) {
      type = type | 4;
    }
    if (bindingType & 128) {
      type = type | 8;
    }
    if (type) scope.tsNames.set(name, type);
  }
  isRedeclaredInScope(scope, name, bindingType) {
    const type = scope.tsNames.get(name);
    if ((type & 2) > 0) {
      if (bindingType & 256) {
        const isConst = (bindingType & 512) > 0;
        const wasConst = (type & 4) > 0;
        return isConst !== wasConst;
      }
      return true;
    }
    if (bindingType & 128 && (type & 8) > 0) {
      if (scope.names.get(name) & 2) {
        return !!(bindingType & 1);
      } else {
        return false;
      }
    }
    if (bindingType & 2 && (type & 1) > 0) {
      return true;
    }
    return super.isRedeclaredInScope(scope, name, bindingType);
  }
  checkLocalExport(id) {
    const {
      name
    } = id;
    if (this.hasImport(name)) return;
    const len = this.scopeStack.length;
    for (let i = len - 1; i >= 0; i--) {
      const scope = this.scopeStack[i];
      const type = scope.tsNames.get(name);
      if ((type & 1) > 0 || (type & 16) > 0) {
        return;
      }
    }
    super.checkLocalExport(id);
  }
};
var BaseParser = class {
  sawUnambiguousESM = false;
  ambiguousScriptDifferentAst = false;
  sourceToOffsetPos(sourcePos) {
    return sourcePos + this.startIndex;
  }
  offsetToSourcePos(offsetPos) {
    return offsetPos - this.startIndex;
  }
  hasPlugin(pluginConfig) {
    if (typeof pluginConfig === "string") {
      return this.plugins.has(pluginConfig);
    } else {
      const [pluginName, pluginOptions] = pluginConfig;
      if (!this.hasPlugin(pluginName)) {
        return false;
      }
      const actualOptions = this.plugins.get(pluginName);
      for (const key of Object.keys(pluginOptions)) {
        if (actualOptions?.[key] !== pluginOptions[key]) {
          return false;
        }
      }
      return true;
    }
  }
  getPluginOption(plugin, name) {
    return this.plugins.get(plugin)?.[name];
  }
};
function setTrailingComments(node, comments) {
  if (node.trailingComments === void 0) {
    node.trailingComments = comments;
  } else {
    node.trailingComments.unshift(...comments);
  }
}
function setLeadingComments(node, comments) {
  if (node.leadingComments === void 0) {
    node.leadingComments = comments;
  } else {
    node.leadingComments.unshift(...comments);
  }
}
function setInnerComments(node, comments) {
  if (node.innerComments === void 0) {
    node.innerComments = comments;
  } else {
    node.innerComments.unshift(...comments);
  }
}
function adjustInnerComments(node, elements, commentWS) {
  let lastElement = null;
  let i = elements.length;
  while (lastElement === null && i > 0) {
    lastElement = elements[--i];
  }
  if (lastElement === null || lastElement.start > commentWS.start) {
    setInnerComments(node, commentWS.comments);
  } else {
    setTrailingComments(lastElement, commentWS.comments);
  }
}
var CommentsParser = class extends BaseParser {
  addComment(comment) {
    if (this.filename) comment.loc.filename = this.filename;
    const {
      commentsLen
    } = this.state;
    if (this.comments.length !== commentsLen) {
      this.comments.length = commentsLen;
    }
    this.comments.push(comment);
    this.state.commentsLen++;
  }
  processComment(node) {
    const {
      commentStack
    } = this.state;
    const commentStackLength = commentStack.length;
    if (commentStackLength === 0) return;
    let i = commentStackLength - 1;
    const lastCommentWS = commentStack[i];
    if (lastCommentWS.start === node.end) {
      lastCommentWS.leadingNode = node;
      i--;
    }
    const nodeStart = node.start;
    for (; i >= 0; i--) {
      const commentWS = commentStack[i];
      const commentEnd = commentWS.end;
      if (commentEnd > nodeStart) {
        commentWS.containingNode = node;
        this.finalizeComment(commentWS);
        commentStack.splice(i, 1);
      } else {
        if (commentEnd === nodeStart) {
          commentWS.trailingNode = node;
        }
        break;
      }
    }
  }
  finalizeComment(commentWS) {
    const {
      comments
    } = commentWS;
    if (commentWS.leadingNode !== null || commentWS.trailingNode !== null) {
      if (commentWS.leadingNode !== null) {
        setTrailingComments(commentWS.leadingNode, comments);
      }
      if (commentWS.trailingNode !== null) {
        setLeadingComments(commentWS.trailingNode, comments);
      }
    } else {
      const node = commentWS.containingNode;
      const commentStart = commentWS.start;
      if (this.input.charCodeAt(this.offsetToSourcePos(commentStart) - 1) === 44) {
        switch (node.type) {
          case "ObjectExpression":
          case "ObjectPattern":
            adjustInnerComments(node, node.properties, commentWS);
            break;
          case "CallExpression":
          case "NewExpression":
          case "OptionalCallExpression":
            adjustInnerComments(node, node.arguments, commentWS);
            break;
          case "ImportExpression":
            adjustInnerComments(node, [node.source, node.options ?? null], commentWS);
            break;
          case "FunctionDeclaration":
          case "FunctionExpression":
          case "ArrowFunctionExpression":
          case "ObjectMethod":
          case "ClassMethod":
          case "ClassPrivateMethod":
          case "TSTypeParameterDeclaration":
            adjustInnerComments(node, node.params, commentWS);
            break;
          case "ArrayExpression":
          case "ArrayPattern":
            adjustInnerComments(node, node.elements, commentWS);
            break;
          case "ExportNamedDeclaration":
          case "ImportDeclaration":
            adjustInnerComments(node, node.specifiers, commentWS);
            break;
          case "ImportNamespaceSpecifier":
          case "ExportNamespaceSpecifier":
            adjustInnerComments(node, node.exportsFilter ?? [], commentWS);
            break;
          case "TSEnumBody":
            adjustInnerComments(node, node.members, commentWS);
            break;
          case "TSInterfaceBody":
            adjustInnerComments(node, node.body, commentWS);
            break;
          default: {
            setInnerComments(node, comments);
          }
        }
      } else {
        setInnerComments(node, comments);
      }
    }
  }
  finalizeRemainingComments() {
    const {
      commentStack
    } = this.state;
    for (let i = commentStack.length - 1; i >= 0; i--) {
      this.finalizeComment(commentStack[i]);
    }
    this.state.commentStack = [];
  }
  resetPreviousNodeTrailingComments(node) {
    const {
      commentStack
    } = this.state;
    const {
      length
    } = commentStack;
    if (length === 0) return;
    const commentWS = commentStack[length - 1];
    if (commentWS.leadingNode === node) {
      commentWS.leadingNode = null;
    }
  }
  replaceNodeInPendingComments(oldNode, newNode) {
    for (const commentWS of this.state.commentStack) {
      if (commentWS.leadingNode === oldNode) commentWS.leadingNode = newNode;
      if (commentWS.trailingNode === oldNode) commentWS.trailingNode = newNode;
    }
  }
  takeSurroundingComments(node, start, end) {
    const {
      commentStack
    } = this.state;
    const commentStackLength = commentStack.length;
    if (commentStackLength === 0) return;
    let i = commentStackLength - 1;
    for (; i >= 0; i--) {
      const commentWS = commentStack[i];
      const commentEnd = commentWS.end;
      const commentStart = commentWS.start;
      if (commentStart === end) {
        commentWS.leadingNode = node;
      } else if (commentEnd === start) {
        commentWS.trailingNode = node;
      } else if (commentEnd < start) {
        break;
      }
    }
  }
};
var State = class _State {
  flags = 2048;
  get strict() {
    return (this.flags & 1) > 0;
  }
  set strict(v) {
    if (v) this.flags |= 1;
    else this.flags &= -2;
  }
  startIndex;
  curLine;
  lineStart;
  startLoc;
  endLoc;
  init({
    strictMode,
    sourceType,
    startIndex,
    startLine,
    startColumn
  }) {
    this.strict = strictMode === false ? false : strictMode === true ? true : sourceType === "module";
    this.startIndex = startIndex;
    this.curLine = startLine;
    this.lineStart = -startColumn;
    this.startLoc = this.endLoc = new Position(startLine, startColumn, startIndex);
  }
  errors = [];
  noArrowAt = [];
  noArrowParamsConversionAt = [];
  regExpAllowedAt = -1;
  get canStartArrow() {
    return (this.flags & 2) > 0;
  }
  set canStartArrow(v) {
    if (v) this.flags |= 2;
    else this.flags &= -3;
  }
  get inType() {
    return (this.flags & 4) > 0;
  }
  set inType(v) {
    if (v) this.flags |= 4;
    else this.flags &= -5;
  }
  get noAnonFunctionType() {
    return (this.flags & 8) > 0;
  }
  set noAnonFunctionType(v) {
    if (v) this.flags |= 8;
    else this.flags &= -9;
  }
  get hasFlowComment() {
    return (this.flags & 16) > 0;
  }
  set hasFlowComment(v) {
    if (v) this.flags |= 16;
    else this.flags &= -17;
  }
  get isAmbientContext() {
    return (this.flags & 32) > 0;
  }
  set isAmbientContext(v) {
    if (v) this.flags |= 32;
    else this.flags &= -33;
  }
  get inAbstractClass() {
    return (this.flags & 64) > 0;
  }
  set inAbstractClass(v) {
    if (v) this.flags |= 64;
    else this.flags &= -65;
  }
  get inDisallowConditionalTypesContext() {
    return (this.flags & 128) > 0;
  }
  set inDisallowConditionalTypesContext(v) {
    if (v) this.flags |= 128;
    else this.flags &= -129;
  }
  get inConditionalConsequent() {
    return (this.flags & 256) > 0;
  }
  set inConditionalConsequent(v) {
    if (v) this.flags |= 256;
    else this.flags &= -257;
  }
  get inHackPipelineBody() {
    return (this.flags & 512) > 0;
  }
  set inHackPipelineBody(v) {
    if (v) this.flags |= 512;
    else this.flags &= -513;
  }
  get seenTopicReference() {
    return (this.flags & 1024) > 0;
  }
  set seenTopicReference(v) {
    if (v) this.flags |= 1024;
    else this.flags &= -1025;
  }
  labels = [];
  commentsLen = 0;
  commentStack = [];
  pos = 0;
  type = 138;
  value = null;
  start = 0;
  end = 0;
  lastTokEndLoc = null;
  lastTokStartLoc = null;
  context = [types.brace];
  get canStartJSXElement() {
    return (this.flags & 2048) > 0;
  }
  set canStartJSXElement(v) {
    if (v) this.flags |= 2048;
    else this.flags &= -2049;
  }
  get containsEsc() {
    return (this.flags & 4096) > 0;
  }
  set containsEsc(v) {
    if (v) this.flags |= 4096;
    else this.flags &= -4097;
  }
  firstInvalidTemplateEscapePos = null;
  get hasTopLevelAwait() {
    return (this.flags & 8192) > 0;
  }
  set hasTopLevelAwait(v) {
    if (v) this.flags |= 8192;
    else this.flags &= -8193;
  }
  strictErrors = /* @__PURE__ */ new Map();
  tokensLength = 0;
  curPosition() {
    return new Position(this.curLine, this.pos - this.lineStart, this.pos + this.startIndex);
  }
  clone() {
    const state = new _State();
    state.flags = this.flags;
    state.startIndex = this.startIndex;
    state.curLine = this.curLine;
    state.lineStart = this.lineStart;
    state.startLoc = this.startLoc;
    state.endLoc = this.endLoc;
    state.errors = this.errors.slice();
    state.noArrowAt = this.noArrowAt.slice();
    state.noArrowParamsConversionAt = this.noArrowParamsConversionAt.slice();
    state.regExpAllowedAt = this.regExpAllowedAt;
    state.labels = this.labels.slice();
    state.commentsLen = this.commentsLen;
    state.commentStack = this.commentStack.slice();
    state.pos = this.pos;
    state.type = this.type;
    state.value = this.value;
    state.start = this.start;
    state.end = this.end;
    state.lastTokEndLoc = this.lastTokEndLoc;
    state.lastTokStartLoc = this.lastTokStartLoc;
    state.context = this.context.slice();
    state.firstInvalidTemplateEscapePos = this.firstInvalidTemplateEscapePos;
    state.strictErrors = this.strictErrors;
    state.tokensLength = this.tokensLength;
    return state;
  }
};
var _isDigit = function isDigit(code2) {
  return code2 >= 48 && code2 <= 57;
};
var forbiddenNumericSeparatorSiblings = {
  decBinOct: /* @__PURE__ */ new Set([46, 66, 69, 79, 95, 98, 101, 111, 43, 45]),
  hex: /* @__PURE__ */ new Set([46, 88, 95, 120])
};
var isAllowedNumericSeparatorSibling = {
  bin: (ch) => ch === 48 || ch === 49,
  oct: (ch) => ch >= 48 && ch <= 55,
  dec: (ch) => ch >= 48 && ch <= 57,
  hex: (ch) => ch >= 48 && ch <= 57 || ch >= 65 && ch <= 70 || ch >= 97 && ch <= 102
};
function readStringContents(type, input, pos, lineStart, curLine, errors) {
  const initialPos = pos;
  const initialLineStart = lineStart;
  const initialCurLine = curLine;
  let out = "";
  let firstInvalidLoc = null;
  let chunkStart = pos;
  const {
    length
  } = input;
  for (; ; ) {
    if (pos >= length) {
      errors.unterminated(initialPos, initialLineStart, initialCurLine);
      out += input.slice(chunkStart, pos);
      break;
    }
    const ch = input.charCodeAt(pos);
    if (isStringEnd(type, ch, input, pos)) {
      out += input.slice(chunkStart, pos);
      break;
    }
    if (ch === 92) {
      out += input.slice(chunkStart, pos);
      const res = readEscapedChar(input, pos, lineStart, curLine, type === "template", errors);
      if (res.ch === null && !firstInvalidLoc) {
        firstInvalidLoc = {
          pos,
          lineStart,
          curLine
        };
      } else {
        out += res.ch;
      }
      ({
        pos,
        lineStart,
        curLine
      } = res);
      chunkStart = pos;
    } else if (ch === 8232 || ch === 8233) {
      ++pos;
      ++curLine;
      lineStart = pos;
    } else if (ch === 10 || ch === 13) {
      if (type === "template") {
        out += input.slice(chunkStart, pos) + "\n";
        ++pos;
        if (ch === 13 && input.charCodeAt(pos) === 10) {
          ++pos;
        }
        ++curLine;
        chunkStart = lineStart = pos;
      } else {
        errors.unterminated(initialPos, initialLineStart, initialCurLine);
      }
    } else {
      ++pos;
    }
  }
  return {
    pos,
    str: out,
    firstInvalidLoc,
    lineStart,
    curLine
  };
}
function isStringEnd(type, ch, input, pos) {
  if (type === "template") {
    return ch === 96 || ch === 36 && input.charCodeAt(pos + 1) === 123;
  }
  return ch === (type === "double" ? 34 : 39);
}
function readEscapedChar(input, pos, lineStart, curLine, inTemplate, errors) {
  const throwOnInvalid = !inTemplate;
  pos++;
  const res = (ch2) => ({
    pos,
    ch: ch2,
    lineStart,
    curLine
  });
  const ch = input.charCodeAt(pos++);
  switch (ch) {
    case 110:
      return res("\n");
    case 114:
      return res("\r");
    case 120: {
      let code2;
      ({
        code: code2,
        pos
      } = readHexChar(input, pos, lineStart, curLine, 2, false, throwOnInvalid, errors));
      return res(code2 === null ? null : String.fromCharCode(code2));
    }
    case 117: {
      let code2;
      ({
        code: code2,
        pos
      } = readCodePoint(input, pos, lineStart, curLine, throwOnInvalid, errors));
      return res(code2 === null ? null : String.fromCodePoint(code2));
    }
    case 116:
      return res("	");
    case 98:
      return res("\b");
    case 118:
      return res("\v");
    case 102:
      return res("\f");
    case 13:
      if (input.charCodeAt(pos) === 10) {
        ++pos;
      }
    case 10:
      lineStart = pos;
      ++curLine;
    case 8232:
    case 8233:
      return res("");
    case 56:
    case 57:
      if (inTemplate) {
        return res(null);
      } else {
        errors.strictNumericEscape(pos - 1, lineStart, curLine);
      }
    default:
      if (ch >= 48 && ch <= 55) {
        const startPos = pos - 1;
        const match = /^[0-7]+/.exec(input.slice(startPos, pos + 2));
        let octalStr = match[0];
        let octal = parseInt(octalStr, 8);
        if (octal > 255) {
          octalStr = octalStr.slice(0, -1);
          octal = parseInt(octalStr, 8);
        }
        pos += octalStr.length - 1;
        const next = input.charCodeAt(pos);
        if (octalStr !== "0" || next === 56 || next === 57) {
          if (inTemplate) {
            return res(null);
          } else {
            errors.strictNumericEscape(startPos, lineStart, curLine);
          }
        }
        return res(String.fromCharCode(octal));
      }
      return res(String.fromCharCode(ch));
  }
}
function readHexChar(input, pos, lineStart, curLine, len, forceLen, throwOnInvalid, errors) {
  const initialPos = pos;
  let n;
  ({
    n,
    pos
  } = readInt(input, pos, lineStart, curLine, 16, len, forceLen, false, errors, !throwOnInvalid));
  if (n === null) {
    if (throwOnInvalid) {
      errors.invalidEscapeSequence(initialPos, lineStart, curLine);
    } else {
      pos = initialPos - 1;
    }
  }
  return {
    code: n,
    pos
  };
}
function readInt(input, pos, lineStart, curLine, radix, len, forceLen, allowNumSeparator, errors, bailOnError) {
  const start = pos;
  const forbiddenSiblings = radix === 16 ? forbiddenNumericSeparatorSiblings.hex : forbiddenNumericSeparatorSiblings.decBinOct;
  const isAllowedSibling = radix === 16 ? isAllowedNumericSeparatorSibling.hex : radix === 10 ? isAllowedNumericSeparatorSibling.dec : radix === 8 ? isAllowedNumericSeparatorSibling.oct : isAllowedNumericSeparatorSibling.bin;
  let invalid = false;
  let total = 0;
  for (let i = 0, e = len == null ? Infinity : len; i < e; ++i) {
    const code2 = input.charCodeAt(pos);
    let val;
    if (code2 === 95 && allowNumSeparator !== "bail") {
      const prev = input.charCodeAt(pos - 1);
      const next = input.charCodeAt(pos + 1);
      if (!allowNumSeparator) {
        if (bailOnError) return {
          n: null,
          pos
        };
        errors.numericSeparatorInEscapeSequence(pos, lineStart, curLine);
      } else if (Number.isNaN(next) || !isAllowedSibling(next) || forbiddenSiblings.has(prev)) {
        if (bailOnError) return {
          n: null,
          pos
        };
        errors.unexpectedNumericSeparator(pos, lineStart, curLine);
      }
      ++pos;
      continue;
    }
    if (code2 >= 97) {
      val = code2 - 97 + 10;
    } else if (code2 >= 65) {
      val = code2 - 65 + 10;
    } else if (_isDigit(code2)) {
      val = code2 - 48;
    } else {
      val = Infinity;
    }
    if (val >= radix) {
      if (val <= 9) {
        if (bailOnError) return {
          n: null,
          pos
        };
        errors.invalidDigit(pos, lineStart, curLine, radix);
        val = 0;
      } else if (forceLen) {
        val = 0;
        invalid = true;
      } else {
        break;
      }
    }
    ++pos;
    total = total * radix + val;
  }
  if (pos === start || len != null && pos - start !== len || invalid) {
    return {
      n: null,
      pos
    };
  }
  return {
    n: total,
    pos
  };
}
function readCodePoint(input, pos, lineStart, curLine, throwOnInvalid, errors) {
  const ch = input.charCodeAt(pos);
  let code2;
  if (ch === 123) {
    ++pos;
    ({
      code: code2,
      pos
    } = readHexChar(input, pos, lineStart, curLine, input.indexOf("}", pos) - pos, true, throwOnInvalid, errors));
    ++pos;
    if (code2 !== null && code2 > 1114111) {
      if (throwOnInvalid) {
        errors.invalidCodePoint(pos, lineStart, curLine);
      } else {
        return {
          code: null,
          pos
        };
      }
    }
  } else {
    ({
      code: code2,
      pos
    } = readHexChar(input, pos, lineStart, curLine, 4, false, throwOnInvalid, errors));
  }
  return {
    code: code2,
    pos
  };
}
function buildPosition(pos, lineStart, curLine) {
  return new Position(curLine, pos - lineStart, pos);
}
var VALID_REGEX_FLAGS = /* @__PURE__ */ new Set([103, 109, 115, 105, 121, 117, 100, 118]);
var Token = class {
  constructor(state) {
    const startIndex = state.startIndex || 0;
    this.type = state.type;
    this.value = state.value;
    this.start = startIndex + state.start;
    this.end = startIndex + state.end;
    this.loc = new SourceLocation(state.startLoc, state.endLoc);
  }
};
var locDataCache;
var Tokenizer = class extends CommentsParser {
  isLookahead;
  tokens = [];
  constructor(options, input) {
    super();
    this.state = new State();
    this.state.init(options);
    this.input = input;
    this.length = input.length;
    this.comments = [];
    this.isLookahead = false;
    if (!locDataCache || locDataCache.length < (this.length + 1) * 2) {
      locDataCache = new Uint32Array((this.length + 1) * 2);
    }
    this.locData = locDataCache;
  }
  setLoc(loc) {
    const dataIndex = this.offsetToSourcePos(loc.index);
    this.locData[dataIndex * 2] = loc.line;
    this.locData[dataIndex * 2 + 1] = loc.column;
  }
  getLoc(locIndex) {
    const dataIndex = this.offsetToSourcePos(locIndex);
    const loc = new Position(this.locData[dataIndex * 2], this.locData[dataIndex * 2 + 1], locIndex);
    return loc;
  }
  pushToken(token) {
    this.tokens.length = this.state.tokensLength;
    this.tokens.push(token);
    ++this.state.tokensLength;
  }
  next() {
    this.checkKeywordEscapes();
    if (this.optionFlags & 512) {
      this.pushToken(new Token(this.state));
    }
    this.state.lastTokEndLoc = this.state.endLoc;
    this.state.lastTokStartLoc = this.state.startLoc;
    this.nextToken();
  }
  eat(type) {
    if (this.match(type)) {
      this.next();
      return true;
    } else {
      return false;
    }
  }
  match(type) {
    return this.state.type === type;
  }
  createLookaheadState(state) {
    return {
      pos: state.pos,
      value: null,
      type: state.type,
      start: state.start,
      end: state.end,
      context: [this.curContext()],
      inType: state.inType,
      strict: state.strict,
      startLoc: state.startLoc,
      lastTokEndLoc: state.lastTokEndLoc,
      curLine: state.curLine,
      lineStart: state.lineStart,
      curPosition: state.curPosition
    };
  }
  lookahead() {
    const old = this.state;
    this.state = this.createLookaheadState(old);
    this.isLookahead = true;
    this.nextToken();
    this.isLookahead = false;
    const curr = this.state;
    this.state = old;
    return curr;
  }
  nextTokenStart() {
    return this.nextTokenStartSince(this.state.pos);
  }
  nextTokenStartSince(pos) {
    const skipWhiteSpaceRe = this.inModule || !(this.optionFlags & 16384) ? skipWhiteSpace : skipWhiteSpaceAnnexB;
    skipWhiteSpaceRe.lastIndex = pos;
    return skipWhiteSpaceRe.test(this.input) ? skipWhiteSpaceRe.lastIndex : pos;
  }
  lookaheadCharCode() {
    return this.lookaheadCharCodeSince(this.state.pos);
  }
  lookaheadCharCodeSince(pos) {
    return this.input.charCodeAt(this.nextTokenStartSince(pos));
  }
  nextTokenInLineStart() {
    return this.nextTokenInLineStartSince(this.state.pos);
  }
  nextTokenInLineStartSince(pos) {
    skipWhiteSpaceInLine.lastIndex = pos;
    return skipWhiteSpaceInLine.test(this.input) ? skipWhiteSpaceInLine.lastIndex : pos;
  }
  lookaheadInLineCharCode() {
    return this.input.charCodeAt(this.nextTokenInLineStart());
  }
  codePointAtPos(pos) {
    let cp = this.input.charCodeAt(pos);
    if ((cp & 64512) === 55296 && ++pos < this.input.length) {
      const trail = this.input.charCodeAt(pos);
      if ((trail & 64512) === 56320) {
        cp = 65536 + ((cp & 1023) << 10) + (trail & 1023);
      }
    }
    return cp;
  }
  setStrict(strict) {
    this.state.strict = strict;
    if (strict) {
      this.state.strictErrors.forEach(([toParseError, at]) => this.raise(toParseError, at));
      this.state.strictErrors.clear();
    }
  }
  curContext() {
    return this.state.context[this.state.context.length - 1];
  }
  nextToken() {
    this.skipSpace();
    this.state.start = this.state.pos;
    if (!this.isLookahead) this.state.startLoc = this.state.curPosition();
    if (this.state.pos >= this.length) {
      this.finishToken(138);
      return;
    }
    this.getTokenFromCode(this.codePointAtPos(this.state.pos));
  }
  skipBlockComment(commentEnd) {
    let startLoc;
    if (!this.isLookahead) startLoc = this.state.curPosition();
    const start = this.state.pos;
    const end = this.input.indexOf(commentEnd, start + 2);
    if (end === -1) {
      throw this.raise(Errors.UnterminatedComment, this.state.curPosition());
    }
    this.state.pos = end + commentEnd.length;
    lineBreakG.lastIndex = start + 2;
    while (lineBreakG.test(this.input) && lineBreakG.lastIndex <= end) {
      ++this.state.curLine;
      this.state.lineStart = lineBreakG.lastIndex;
    }
    if (this.isLookahead) return;
    const comment = {
      type: "CommentBlock",
      value: this.input.slice(start + 2, end),
      start: this.sourceToOffsetPos(start),
      end: this.sourceToOffsetPos(end + commentEnd.length),
      loc: new SourceLocation(startLoc, this.state.curPosition())
    };
    if (this.optionFlags & 512) this.pushToken(comment);
    return comment;
  }
  skipLineComment(startSkip) {
    const start = this.state.pos;
    let startLoc;
    if (!this.isLookahead) startLoc = this.state.curPosition();
    let ch = this.input.charCodeAt(this.state.pos += startSkip);
    if (this.state.pos < this.length) {
      while (!isNewLine(ch) && ++this.state.pos < this.length) {
        ch = this.input.charCodeAt(this.state.pos);
      }
    }
    if (this.isLookahead) return;
    const end = this.state.pos;
    const value = this.input.slice(start + startSkip, end);
    const comment = {
      type: "CommentLine",
      value,
      start: this.sourceToOffsetPos(start),
      end: this.sourceToOffsetPos(end),
      loc: new SourceLocation(startLoc, this.state.curPosition())
    };
    if (this.optionFlags & 512) this.pushToken(comment);
    return comment;
  }
  skipSpace() {
    const spaceStart = this.state.pos;
    const attachComment = (this.optionFlags & 8192) > 0;
    let comments;
    loop: while (this.state.pos < this.length) {
      const ch = this.input.charCodeAt(this.state.pos);
      switch (ch) {
        case 32:
        case 160:
        case 9:
          ++this.state.pos;
          break;
        case 13:
          if (this.input.charCodeAt(this.state.pos + 1) === 10) {
            ++this.state.pos;
          }
        case 10:
        case 8232:
        case 8233:
          ++this.state.pos;
          ++this.state.curLine;
          this.state.lineStart = this.state.pos;
          break;
        case 47:
          switch (this.input.charCodeAt(this.state.pos + 1)) {
            case 42: {
              const comment = this.skipBlockComment("*/");
              if (comment !== void 0) {
                this.addComment(comment);
                if (attachComment) {
                  (comments ??= []).push(comment);
                }
              }
              break;
            }
            case 47: {
              const comment = this.skipLineComment(2);
              if (comment !== void 0) {
                this.addComment(comment);
                if (attachComment) {
                  (comments ??= []).push(comment);
                }
              }
              break;
            }
            default:
              break loop;
          }
          break;
        default:
          if (isWhitespace(ch)) {
            ++this.state.pos;
          } else if (ch === 45 && !this.inModule && this.optionFlags & 16384) {
            const pos = this.state.pos;
            if (this.input.charCodeAt(pos + 1) === 45 && this.input.charCodeAt(pos + 2) === 62 && (spaceStart === 0 || this.state.lineStart > spaceStart)) {
              const comment = this.skipLineComment(3);
              if (comment !== void 0) {
                this.addComment(comment);
                if (attachComment) {
                  (comments ??= []).push(comment);
                }
              }
            } else {
              break loop;
            }
          } else if (ch === 60 && !this.inModule && this.optionFlags & 16384) {
            const pos = this.state.pos;
            if (this.input.charCodeAt(pos + 1) === 33 && this.input.charCodeAt(pos + 2) === 45 && this.input.charCodeAt(pos + 3) === 45) {
              const comment = this.skipLineComment(4);
              if (comment !== void 0) {
                this.addComment(comment);
                if (attachComment) {
                  (comments ??= []).push(comment);
                }
              }
            } else {
              break loop;
            }
          } else {
            break loop;
          }
      }
    }
    if (comments?.length) {
      const end = this.state.pos;
      const commentWhitespace = {
        start: this.sourceToOffsetPos(spaceStart),
        end: this.sourceToOffsetPos(end),
        comments,
        leadingNode: null,
        trailingNode: null,
        containingNode: null
      };
      this.state.commentStack.push(commentWhitespace);
    }
  }
  finishToken(type, val) {
    this.state.end = this.state.pos;
    this.state.endLoc = this.state.curPosition();
    const prevType = this.state.type;
    this.state.type = type;
    this.state.value = val;
    if (!this.isLookahead) {
      this.updateContext(prevType);
    }
  }
  replaceToken(type) {
    this.state.type = type;
    this.updateContext();
  }
  readToken_numberSign() {
    if (this.state.pos === 0 && this.readToken_interpreter()) {
      return;
    }
    const nextPos = this.state.pos + 1;
    const next = this.codePointAtPos(nextPos);
    if (next >= 48 && next <= 57) {
      throw this.raise(Errors.UnexpectedDigitAfterHash, this.state.curPosition());
    }
    if (isIdentifierStart(next)) {
      ++this.state.pos;
      this.finishToken(137, this.readWord1(next));
    } else if (next === 92) {
      ++this.state.pos;
      this.finishToken(137, this.readWord1());
    } else {
      this.finishOp(23, 1);
    }
  }
  readToken_dot() {
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next >= 48 && next <= 57) {
      this.readNumber(true);
      return;
    }
    if (next === 46 && this.input.charCodeAt(this.state.pos + 2) === 46) {
      this.state.pos += 3;
      this.finishToken(17);
    } else {
      ++this.state.pos;
      this.finishToken(12);
    }
  }
  readToken_slash() {
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === 61) {
      this.finishOp(27, 2);
    } else {
      this.finishOp(52, 1);
    }
  }
  readToken_interpreter() {
    if (this.state.pos !== 0 || this.length < 2) return false;
    let ch = this.input.charCodeAt(this.state.pos + 1);
    if (ch !== 33) return false;
    const start = this.state.pos;
    this.state.pos += 1;
    while (!isNewLine(ch) && ++this.state.pos < this.length) {
      ch = this.input.charCodeAt(this.state.pos);
    }
    const value = this.input.slice(start + 2, this.state.pos);
    this.finishToken(24, value);
    return true;
  }
  readToken_mult_modulo(code2) {
    let type = code2 === 42 ? 51 : 50;
    let width = 1;
    let next = this.input.charCodeAt(this.state.pos + 1);
    if (code2 === 42 && next === 42) {
      width++;
      next = this.input.charCodeAt(this.state.pos + 2);
      type = 53;
    }
    if (next === 61 && !this.state.inType) {
      width++;
      type = code2 === 37 ? 29 : 26;
    }
    this.finishOp(type, width);
  }
  readToken_pipe_amp(code2) {
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === code2) {
      if (this.input.charCodeAt(this.state.pos + 2) === 61) {
        this.finishOp(26, 3);
      } else {
        this.finishOp(code2 === 124 ? 37 : 38, 2);
      }
      return;
    }
    if (code2 === 124) {
      if (next === 62) {
        this.finishOp(35, 2);
        return;
      }
    }
    if (next === 61) {
      this.finishOp(26, 2);
      return;
    }
    this.finishOp(code2 === 124 ? 39 : 41, 1);
  }
  readToken_caret() {
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === 61 && !this.state.inType) {
      this.finishOp(28, 2);
    } else if (next === 94 && this.hasPlugin(["pipelineOperator", {
      proposal: "hack",
      topicToken: "^^"
    }])) {
      this.finishOp(33, 2);
      const lookaheadCh = this.input.codePointAt(this.state.pos);
      if (lookaheadCh === 94) {
        this.unexpected();
      }
    } else {
      this.finishOp(40, 1);
    }
  }
  readToken_atSign() {
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === 64 && this.hasPlugin(["pipelineOperator", {
      proposal: "hack",
      topicToken: "@@"
    }])) {
      this.finishOp(34, 2);
    } else {
      this.finishOp(22, 1);
    }
  }
  readToken_plus_min(code2) {
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === code2) {
      this.finishOp(30, 2);
      return;
    }
    if (next === 61) {
      this.finishOp(26, 2);
    } else {
      this.finishOp(49, 1);
    }
  }
  readToken_lt() {
    const {
      pos
    } = this.state;
    const next = this.input.charCodeAt(pos + 1);
    if (next === 60) {
      if (this.input.charCodeAt(pos + 2) === 61) {
        this.finishOp(26, 3);
        return;
      }
      this.finishOp(47, 2);
      return;
    }
    if (next === 61) {
      this.finishOp(45, 2);
      return;
    }
    this.finishOp(43, 1);
  }
  readToken_gt() {
    const {
      pos
    } = this.state;
    const next = this.input.charCodeAt(pos + 1);
    if (next === 62) {
      const size = this.input.charCodeAt(pos + 2) === 62 ? 3 : 2;
      if (this.input.charCodeAt(pos + size) === 61) {
        this.finishOp(26, size + 1);
        return;
      }
      this.finishOp(48, size);
      return;
    }
    if (next === 61) {
      this.finishOp(45, 2);
      return;
    }
    this.finishOp(44, 1);
  }
  readToken_eq_excl(code2) {
    const next = this.input.charCodeAt(this.state.pos + 1);
    if (next === 61) {
      this.finishOp(42, this.input.charCodeAt(this.state.pos + 2) === 61 ? 3 : 2);
      return;
    }
    if (code2 === 61 && next === 62) {
      this.state.pos += 2;
      this.finishToken(15);
      return;
    }
    this.finishOp(code2 === 61 ? 25 : 31, 1);
  }
  readToken_question() {
    const next = this.input.charCodeAt(this.state.pos + 1);
    const next2 = this.input.charCodeAt(this.state.pos + 2);
    if (next === 63) {
      if (next2 === 61) {
        this.finishOp(26, 3);
      } else {
        this.finishOp(36, 2);
      }
    } else if (next === 46 && !(next2 >= 48 && next2 <= 57)) {
      this.state.pos += 2;
      this.finishToken(14);
    } else {
      ++this.state.pos;
      this.finishToken(13);
    }
  }
  getTokenFromCode(code2) {
    switch (code2) {
      case 46:
        this.readToken_dot();
        return;
      case 40:
        ++this.state.pos;
        this.finishToken(6);
        return;
      case 41:
        ++this.state.pos;
        this.finishToken(7);
        return;
      case 59:
        ++this.state.pos;
        this.finishToken(9);
        return;
      case 44:
        ++this.state.pos;
        this.finishToken(8);
        return;
      case 91:
        ++this.state.pos;
        this.finishToken(0);
        return;
      case 93:
        ++this.state.pos;
        this.finishToken(1);
        return;
      case 123:
        ++this.state.pos;
        this.finishToken(2);
        return;
      case 125:
        ++this.state.pos;
        this.finishToken(4);
        return;
      case 58:
        if (this.hasPlugin("functionBind") && this.input.charCodeAt(this.state.pos + 1) === 58) {
          this.finishOp(11, 2);
        } else {
          ++this.state.pos;
          this.finishToken(10);
        }
        return;
      case 63:
        this.readToken_question();
        return;
      case 96:
        this.readTemplateToken();
        return;
      case 48: {
        const next = this.input.charCodeAt(this.state.pos + 1);
        if (next === 120 || next === 88) {
          this.readRadixNumber(16);
          return;
        }
        if (next === 111 || next === 79) {
          this.readRadixNumber(8);
          return;
        }
        if (next === 98 || next === 66) {
          this.readRadixNumber(2);
          return;
        }
      }
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        this.readNumber(false);
        return;
      case 34:
      case 39:
        this.readString(code2);
        return;
      case 47:
        this.readToken_slash();
        return;
      case 37:
      case 42:
        this.readToken_mult_modulo(code2);
        return;
      case 124:
      case 38:
        this.readToken_pipe_amp(code2);
        return;
      case 94:
        this.readToken_caret();
        return;
      case 43:
      case 45:
        this.readToken_plus_min(code2);
        return;
      case 60:
        this.readToken_lt();
        return;
      case 62:
        this.readToken_gt();
        return;
      case 61:
      case 33:
        this.readToken_eq_excl(code2);
        return;
      case 126:
        this.finishOp(32, 1);
        return;
      case 64:
        this.readToken_atSign();
        return;
      case 35:
        this.readToken_numberSign();
        return;
      case 92:
        this.readWord();
        return;
      default:
        if (isIdentifierStart(code2)) {
          this.readWord(code2);
          return;
        }
    }
    throw this.raise(Errors.InvalidOrUnexpectedToken, this.state.curPosition(), {
      unexpected: String.fromCodePoint(code2)
    });
  }
  finishOp(type, size) {
    const str = this.input.slice(this.state.pos, this.state.pos + size);
    this.state.pos += size;
    this.finishToken(type, str);
  }
  readRegexp() {
    const startLoc = this.state.startLoc;
    const start = this.state.start + 1;
    let escaped, inClass;
    let {
      pos
    } = this.state;
    for (; ; ++pos) {
      if (pos >= this.length) {
        throw this.raise(Errors.UnterminatedRegExp, createPositionWithColumnOffset(startLoc, 1));
      }
      const ch = this.input.charCodeAt(pos);
      if (isNewLine(ch)) {
        throw this.raise(Errors.UnterminatedRegExp, createPositionWithColumnOffset(startLoc, 1));
      }
      if (escaped) {
        escaped = false;
      } else {
        if (ch === 91) {
          inClass = true;
        } else if (ch === 93 && inClass) {
          inClass = false;
        } else if (ch === 47 && !inClass) {
          break;
        }
        escaped = ch === 92;
      }
    }
    const content = this.input.slice(start, pos);
    ++pos;
    let mods = "";
    const nextPos = () => createPositionWithColumnOffset(startLoc, pos + 2 - start);
    while (pos < this.length) {
      const cp = this.codePointAtPos(pos);
      const char = String.fromCharCode(cp);
      if (VALID_REGEX_FLAGS.has(cp)) {
        if (cp === 118) {
          if (mods.includes("u")) {
            this.raise(Errors.IncompatibleRegExpUVFlags, nextPos());
          }
        } else if (cp === 117) {
          if (mods.includes("v")) {
            this.raise(Errors.IncompatibleRegExpUVFlags, nextPos());
          }
        }
        if (mods.includes(char)) {
          this.raise(Errors.DuplicateRegExpFlags, nextPos());
        }
      } else if (isIdentifierChar(cp) || cp === 92) {
        this.raise(Errors.MalformedRegExpFlags, nextPos());
      } else {
        break;
      }
      ++pos;
      mods += char;
    }
    this.state.pos = pos;
    this.finishToken(136, {
      pattern: content,
      flags: mods
    });
  }
  readInt(radix, len, forceLen = false, allowNumSeparator = true) {
    const {
      n,
      pos
    } = readInt(this.input, this.state.pos, this.state.lineStart, this.state.curLine, radix, len, forceLen, allowNumSeparator, this.errorHandlers_readInt, false);
    this.state.pos = pos;
    return n;
  }
  readLiteralInt(radix) {
    let pos = this.state.pos;
    let val = 0;
    let code2;
    for (; ; ) {
      code2 = this.input.charCodeAt(pos);
      let digit;
      if (code2 >= 48 && code2 <= 57) {
        digit = code2 - 48;
      } else {
        digit = (code2 | 32) - 97;
        if (digit < 0 || digit > 5) break;
        digit += 10;
      }
      if (digit >= radix) break;
      val = val * radix + digit;
      ++pos;
    }
    if (code2 === 95 || code2 >= 48 && code2 <= 57) {
      return this.readInt(radix);
    }
    if (pos === this.state.pos) return null;
    this.state.pos = pos;
    return val;
  }
  readRadixNumber(radix) {
    const start = this.state.pos;
    const startLoc = this.state.curPosition();
    this.state.pos += 2;
    let val = this.readLiteralInt(radix);
    const end = this.state.pos;
    if (val == null) {
      this.raise(Errors.InvalidDigit, createPositionWithColumnOffset(startLoc, 2), {
        radix
      });
    }
    const isBigInt = this.input.charCodeAt(this.state.pos) === 110;
    if (isBigInt) ++this.state.pos;
    if (isIdentifierStart(this.codePointAtPos(this.state.pos))) {
      throw this.raise(Errors.NumberIdentifier, this.state.curPosition());
    }
    if (isBigInt || val !== null && val > Number.MAX_SAFE_INTEGER) {
      const str = this.input.slice(start, end).replaceAll("_", "");
      if (isBigInt) {
        this.finishToken(135, str);
        return;
      }
      val = Number(radix !== 16 && this.optionFlags & 4096 ? str.replace(radix === 2 ? /[2-9]/g : /[89]/g, "0") : str);
    }
    this.finishToken(134, val);
  }
  readNumber(startsWithDot) {
    const start = this.state.pos;
    const startLoc = this.state.curPosition();
    let isFloat = false;
    let isOctal = false;
    const integerValue = startsWithDot ? 0 : this.readLiteralInt(10);
    const hasLeadingZero = this.state.pos - start >= 2 && this.input.charCodeAt(start) === 48;
    if (hasLeadingZero) {
      const integer = this.input.slice(start, this.state.pos);
      this.recordStrictModeErrors(Errors.StrictOctalLiteral, startLoc);
      if (!this.state.strict) {
        const underscorePos = integer.indexOf("_");
        if (underscorePos > 0) {
          this.raise(Errors.ZeroDigitNumericSeparator, createPositionWithColumnOffset(startLoc, underscorePos));
        }
      }
      isOctal = !/[89]/.test(integer);
    }
    let next = this.input.charCodeAt(this.state.pos);
    if (next === 46 && !isOctal) {
      ++this.state.pos;
      this.readLiteralInt(10);
      isFloat = true;
      next = this.input.charCodeAt(this.state.pos);
    }
    if ((next === 69 || next === 101) && !isOctal) {
      next = this.input.charCodeAt(++this.state.pos);
      if (next === 43 || next === 45) {
        ++this.state.pos;
      }
      if (this.readLiteralInt(10) === null) {
        this.raise(Errors.InvalidOrMissingExponent, startLoc);
      }
      isFloat = true;
      next = this.input.charCodeAt(this.state.pos);
    }
    const end = this.state.pos;
    const isBigInt = next === 110;
    if (isBigInt) {
      if (isFloat || hasLeadingZero) {
        this.raise(Errors.InvalidBigIntLiteral, startLoc);
      }
      ++this.state.pos;
    }
    if (isIdentifierStart(this.codePointAtPos(this.state.pos))) {
      throw this.raise(Errors.NumberIdentifier, this.state.curPosition());
    }
    if (!isFloat && !isBigInt && !hasLeadingZero && integerValue <= Number.MAX_SAFE_INTEGER) {
      this.finishToken(134, integerValue);
      return;
    }
    const str = this.input.slice(start, end).replaceAll("_", "");
    if (isBigInt) {
      this.finishToken(135, str);
      return;
    }
    const val = isOctal ? parseInt(str, 8) : parseFloat(str);
    this.finishToken(134, val);
  }
  readCodePoint(throwOnInvalid) {
    const {
      code: code2,
      pos
    } = readCodePoint(this.input, this.state.pos, this.state.lineStart, this.state.curLine, throwOnInvalid, this.errorHandlers_readCodePoint);
    this.state.pos = pos;
    return code2;
  }
  readString(quote) {
    const {
      str,
      pos,
      curLine,
      lineStart
    } = readStringContents(quote === 34 ? "double" : "single", this.input, this.state.pos + 1, this.state.lineStart, this.state.curLine, this.errorHandlers_readStringContents_string);
    this.state.pos = pos + 1;
    this.state.lineStart = lineStart;
    this.state.curLine = curLine;
    this.finishToken(133, str);
  }
  readTemplateContinuation() {
    if (!this.match(4)) {
      this.unexpected(null, 4);
    }
    this.state.pos--;
    this.readTemplateToken();
  }
  readTemplateToken() {
    const opening = this.input[this.state.pos];
    const {
      str,
      firstInvalidLoc,
      pos,
      curLine,
      lineStart
    } = readStringContents("template", this.input, this.state.pos + 1, this.state.lineStart, this.state.curLine, this.errorHandlers_readStringContents_template);
    this.state.pos = pos + 1;
    this.state.lineStart = lineStart;
    this.state.curLine = curLine;
    if (firstInvalidLoc) {
      this.state.firstInvalidTemplateEscapePos = new Position(firstInvalidLoc.curLine, firstInvalidLoc.pos - firstInvalidLoc.lineStart, this.sourceToOffsetPos(firstInvalidLoc.pos));
    }
    if (this.input.codePointAt(pos) === 96) {
      this.finishToken(20, firstInvalidLoc ? null : opening + str + "`");
    } else {
      this.state.pos++;
      this.finishToken(21, firstInvalidLoc ? null : opening + str + "${");
    }
  }
  recordStrictModeErrors(toParseError, at) {
    if (this.isLookahead) return;
    const index = at.index;
    if (this.state.strict && !this.state.strictErrors.has(index)) {
      this.raise(toParseError, at);
    } else {
      this.state.strictErrors.set(index, [toParseError, at]);
    }
  }
  readWord1(firstCode) {
    this.state.containsEsc = false;
    let word = "";
    const start = this.state.pos;
    let chunkStart = this.state.pos;
    if (firstCode !== void 0) {
      this.state.pos += firstCode <= 65535 ? 1 : 2;
    }
    while (this.state.pos < this.length) {
      const ch = this.codePointAtPos(this.state.pos);
      if (isIdentifierChar(ch)) {
        this.state.pos += ch <= 65535 ? 1 : 2;
      } else if (ch === 92) {
        this.state.containsEsc = true;
        word += this.input.slice(chunkStart, this.state.pos);
        const escStart = this.state.curPosition();
        const identifierCheck = this.state.pos === start ? isIdentifierStart : isIdentifierChar;
        if (this.input.charCodeAt(++this.state.pos) !== 117) {
          this.raise(Errors.MissingUnicodeEscape, this.state.curPosition());
          chunkStart = this.state.pos - 1;
          continue;
        }
        ++this.state.pos;
        const esc = this.readCodePoint(true);
        if (esc !== null) {
          if (!identifierCheck(esc)) {
            this.raise(Errors.EscapedCharNotAnIdentifier, escStart);
          }
          word += String.fromCodePoint(esc);
        }
        chunkStart = this.state.pos;
      } else {
        break;
      }
    }
    return word + this.input.slice(chunkStart, this.state.pos);
  }
  readWord(firstCode) {
    const word = this.readWord1(firstCode);
    const type = keywords$1.get(word);
    if (type !== void 0) {
      this.finishToken(type, tokenLabelName(type));
    } else {
      this.finishToken(131, word);
    }
  }
  checkKeywordEscapes() {
    const {
      type
    } = this.state;
    if (tokenIsKeyword(type) && this.state.containsEsc) {
      this.raise(Errors.InvalidEscapedReservedWord, this.state.startLoc, {
        reservedWord: tokenLabelName(type)
      });
    }
  }
  raise(toParseError, at, details = {}) {
    const loc = at instanceof Position ? at : typeof at === "number" ? this.getLoc(at) : this.optionFlags & 256 ? at.loc.start : this.getLoc(at.start);
    const pos = at instanceof Position ? loc.index : typeof at === "number" ? at : at.start;
    const error = toParseError(loc, pos, details);
    if (!(this.optionFlags & 4096)) throw error;
    if (!this.isLookahead) this.state.errors.push(error);
    return error;
  }
  raiseOverwrite(toParseError, at, details = {}) {
    const loc = at instanceof Position ? at : this.optionFlags & 256 ? at.loc.start : this.getLoc(at.start);
    const pos = at instanceof Position ? loc.index : at.start;
    const errors = this.state.errors;
    for (let i = errors.length - 1; i >= 0; i--) {
      const error = errors[i];
      if (error.pos === pos) {
        return errors[i] = toParseError(loc, pos, details);
      }
      if (error.pos < pos) break;
    }
    return this.raise(toParseError, loc, details);
  }
  updateContext(prevType) {
  }
  unexpected(loc, type) {
    throw this.raise(Errors.UnexpectedToken, loc != null ? loc : this.state.startLoc, {
      expected: type ? tokenLabelName(type) : null
    });
  }
  expectPlugin(pluginName, loc) {
    if (this.hasPlugin(pluginName)) {
      return true;
    }
    throw this.raise(Errors.MissingPlugin, loc != null ? loc : this.state.startLoc, {
      missingPlugin: [pluginName]
    });
  }
  expectOnePlugin(pluginNames) {
    if (!pluginNames.some((name) => this.hasPlugin(name))) {
      throw this.raise(Errors.MissingOneOfPlugins, this.state.startLoc, {
        missingPlugin: pluginNames
      });
    }
  }
  errorBuilder(error) {
    return (pos, lineStart, curLine) => {
      this.raise(error, buildPosition(pos, lineStart, curLine));
    };
  }
  errorHandlers_readInt = {
    invalidDigit: (pos, lineStart, curLine, radix) => {
      this.raise(Errors.InvalidDigit, buildPosition(pos, lineStart, curLine), {
        radix
      });
    },
    numericSeparatorInEscapeSequence: this.errorBuilder(Errors.NumericSeparatorInEscapeSequence),
    unexpectedNumericSeparator: this.errorBuilder(Errors.UnexpectedNumericSeparator)
  };
  errorHandlers_readCodePoint = {
    ...this.errorHandlers_readInt,
    invalidEscapeSequence: this.errorBuilder(Errors.InvalidEscapeSequence),
    invalidCodePoint: this.errorBuilder(Errors.InvalidCodePoint)
  };
  errorHandlers_readStringContents_string = {
    ...this.errorHandlers_readCodePoint,
    strictNumericEscape: (pos, lineStart, curLine) => {
      this.recordStrictModeErrors(Errors.StrictNumericEscape, buildPosition(pos, lineStart, curLine));
    },
    unterminated: (pos, lineStart, curLine) => {
      throw this.raise(Errors.UnterminatedString, buildPosition(pos - 1, lineStart, curLine));
    }
  };
  errorHandlers_readStringContents_template = {
    ...this.errorHandlers_readCodePoint,
    strictNumericEscape: this.errorBuilder(Errors.StrictNumericEscape),
    unterminated: (pos, lineStart, curLine) => {
      throw this.raise(Errors.UnterminatedTemplate, buildPosition(pos, lineStart, curLine));
    }
  };
};
var ClassScope = class {
  privateNames = /* @__PURE__ */ new Set();
  loneAccessors = /* @__PURE__ */ new Map();
  undefinedPrivateNames = /* @__PURE__ */ new Map();
};
var ClassScopeHandler = class {
  parser;
  stack = [];
  constructor(parser) {
    this.parser = parser;
  }
  current() {
    return this.stack[this.stack.length - 1];
  }
  enter() {
    this.stack.push(new ClassScope());
  }
  exit() {
    const oldClassScope = this.stack.pop();
    const current = this.current();
    for (const [name, loc] of Array.from(oldClassScope.undefinedPrivateNames)) {
      if (current) {
        if (!current.undefinedPrivateNames.has(name)) {
          current.undefinedPrivateNames.set(name, loc);
        }
      } else {
        this.parser.raise(Errors.InvalidPrivateFieldResolution, loc, {
          identifierName: name
        });
      }
    }
  }
  declarePrivateName(name, elementType, loc) {
    const {
      privateNames,
      loneAccessors,
      undefinedPrivateNames
    } = this.current();
    let redefined = privateNames.has(name);
    if (elementType & 3) {
      const accessor = redefined && loneAccessors.get(name);
      if (accessor) {
        const oldStatic = accessor & 4;
        const newStatic = elementType & 4;
        const oldKind = accessor & 3;
        const newKind = elementType & 3;
        redefined = oldKind === newKind || oldStatic !== newStatic;
        if (!redefined) loneAccessors.delete(name);
      } else if (!redefined) {
        loneAccessors.set(name, elementType);
      }
    }
    if (redefined) {
      this.parser.raise(Errors.PrivateNameRedeclaration, loc, {
        identifierName: name
      });
    }
    privateNames.add(name);
    undefinedPrivateNames.delete(name);
  }
  usePrivateName(name, loc) {
    let classScope;
    for (classScope of this.stack) {
      if (classScope.privateNames.has(name)) return;
    }
    if (classScope) {
      classScope.undefinedPrivateNames.set(name, loc);
    } else {
      this.parser.raise(Errors.InvalidPrivateFieldResolution, loc, {
        identifierName: name
      });
    }
  }
};
var ExpressionScope = class {
  constructor(type = 0) {
    this.type = type;
  }
  canBeArrowParameterDeclaration() {
    return this.type === 2 || this.type === 1;
  }
  isCertainlyParameterDeclaration() {
    return this.type === 3;
  }
  isInitializer() {
    return this.type === 4;
  }
};
var ArrowHeadParsingScope = class extends ExpressionScope {
  declarationErrors = /* @__PURE__ */ new Map();
  constructor(type) {
    super(type);
  }
  recordDeclarationError(ParsingErrorClass, index) {
    this.declarationErrors.set(index, ParsingErrorClass);
  }
  clearDeclarationError(index) {
    this.declarationErrors.delete(index);
  }
  iterateErrors(iterator) {
    this.declarationErrors.forEach(iterator);
  }
};
var ExpressionScopeHandler = class {
  parser;
  stack = [new ExpressionScope()];
  constructor(parser) {
    this.parser = parser;
  }
  enter(scope) {
    this.stack.push(scope);
  }
  exit() {
    this.stack.pop();
  }
  canBeInParameters() {
    const scope = this.stack[this.stack.length - 1];
    return scope.canBeArrowParameterDeclaration() || scope.isCertainlyParameterDeclaration();
  }
  recordParameterInitializerError(toParseError, loc) {
    const {
      stack
    } = this;
    let i = stack.length - 1;
    let scope = stack[i];
    while (!scope.isCertainlyParameterDeclaration()) {
      if (scope.canBeArrowParameterDeclaration()) {
        scope.recordDeclarationError(toParseError, loc);
      } else if (!scope.isInitializer()) {
        return;
      }
      scope = stack[--i];
    }
    this.parser.raise(toParseError, loc);
  }
  recordArrowParameterBindingError(error, node) {
    const {
      stack
    } = this;
    const scope = stack[stack.length - 1];
    const origin = node.start;
    if (scope.isCertainlyParameterDeclaration()) {
      this.parser.raise(error, origin);
    } else if (scope.canBeArrowParameterDeclaration()) {
      scope.recordDeclarationError(error, origin);
    } else {
      return;
    }
  }
  recordAsyncArrowParametersError(at) {
    const {
      stack
    } = this;
    for (let i = stack.length - 1; ; i--) {
      const scope = stack[i];
      if (scope.canBeArrowParameterDeclaration()) {
        if (scope.type === 2) {
          scope.recordDeclarationError(Errors.AwaitBindingIdentifier, at);
        }
      } else if (!scope.isInitializer()) {
        return;
      }
    }
  }
  validateAsPattern() {
    const {
      stack
    } = this;
    const currentScope = stack[stack.length - 1];
    if (!currentScope.canBeArrowParameterDeclaration()) return;
    currentScope.iterateErrors((toParseError, key) => {
      this.parser.raise(toParseError, key);
      for (let i = stack.length - 2; ; i--) {
        const scope = stack[i];
        if (scope.canBeArrowParameterDeclaration()) {
          scope.clearDeclarationError(key);
        } else if (!scope.isInitializer()) {
          break;
        }
      }
    });
  }
};
function newArrowHeadScope() {
  return new ArrowHeadParsingScope(1);
}
function newAsyncArrowScope() {
  return new ArrowHeadParsingScope(2);
}
var sharedExpressionScope = new ExpressionScope();
var parameterDeclarationScope = new ExpressionScope(3);
var initializerScope = new ExpressionScope(4);
var ProductionParameterHandler = class {
  stacks = [];
  enter(flags) {
    this.stacks.push(flags);
  }
  exit() {
    this.stacks.pop();
  }
  currentFlags() {
    return this.stacks[this.stacks.length - 1];
  }
  get hasAwait() {
    return (this.currentFlags() & 2) > 0;
  }
  get hasYield() {
    return (this.currentFlags() & 1) > 0;
  }
  get hasReturn() {
    return (this.currentFlags() & 4) > 0;
  }
  get hasIn() {
    return (this.currentFlags() & 8) > 0;
  }
  get inFSharpPipelineDirectBody() {
    return (this.currentFlags() & 16) === 0;
  }
};
function functionFlags(isAsync, isGenerator) {
  return (isAsync ? 2 : 0) | (isGenerator ? 1 : 0);
}
var UtilParser = class extends Tokenizer {
  addExtra(node, key, value, enumerable = true) {
    if (!node) return;
    let {
      extra
    } = node;
    if (extra == null) {
      extra = {};
      node.extra = extra;
    }
    if (enumerable) {
      extra[key] = value;
    } else {
      Object.defineProperty(extra, key, {
        enumerable,
        value
      });
    }
  }
  isContextual(token) {
    return this.state.type === token && !this.state.containsEsc;
  }
  isUnparsedContextual(nameStart, name) {
    if (this.input.startsWith(name, nameStart)) {
      const nextCh = this.input.charCodeAt(nameStart + name.length);
      return !(isIdentifierChar(nextCh) || nextCh === 92 || (nextCh & 64512) === 55296);
    }
    return false;
  }
  isLookaheadContextual(name) {
    const next = this.nextTokenStart();
    return this.isUnparsedContextual(next, name);
  }
  eatContextual(token) {
    if (this.isContextual(token)) {
      this.next();
      return true;
    }
    return false;
  }
  expectContextual(token, toParseError) {
    if (!this.eatContextual(token)) {
      if (toParseError != null) {
        throw this.raise(toParseError, this.state.startLoc);
      }
      this.unexpected(null, token);
    }
  }
  canInsertSemicolon() {
    return this.match(138) || this.match(4) || this.hasPrecedingLineBreak();
  }
  hasPrecedingLineBreak() {
    return hasNewLine(this.input, this.offsetToSourcePos(this.state.lastTokEndLoc.index), this.state.start);
  }
  hasFollowingLineBreak() {
    return hasNewLine(this.input, this.state.end, this.nextTokenStart());
  }
  isLineTerminator() {
    return this.eat(9) || this.canInsertSemicolon();
  }
  semicolon(allowAsi = true) {
    if (allowAsi ? this.isLineTerminator() : this.eat(9)) return;
    this.raise(Errors.MissingSemicolon, this.state.lastTokEndLoc);
  }
  expect(type, loc) {
    if (!this.eat(type)) {
      this.unexpected(loc, type);
    }
  }
  snapshotScopeStacks() {
    return {
      scopeDepth: this.scope.scopeStack.length,
      prodParamDepth: this.prodParam.stacks.length,
      classScopeDepth: this.classScope.stack.length,
      expressionScopeDepth: this.expressionScope.stack.length
    };
  }
  restoreScopeStacks(snapshot) {
    const {
      scope
    } = this;
    while (scope.scopeStack.length > snapshot.scopeDepth) scope.exit();
    this.prodParam.stacks.length = snapshot.prodParamDepth;
    this.classScope.stack.length = snapshot.classScopeDepth;
    this.expressionScope.stack.length = snapshot.expressionScopeDepth;
  }
  tryParse(fn, oldState = this.state.clone()) {
    const abortSignal = {
      node: null
    };
    const scopeStacksSnapshot = this.snapshotScopeStacks();
    try {
      const node = fn((node2 = null) => {
        abortSignal.node = node2;
        throw abortSignal;
      });
      if (this.state.errors.length > oldState.errors.length) {
        const failState = this.state;
        this.state = oldState;
        this.state.tokensLength = failState.tokensLength;
        return {
          node,
          error: failState.errors[oldState.errors.length],
          thrown: false,
          aborted: false,
          failState
        };
      }
      return {
        node,
        error: null,
        thrown: false,
        aborted: false,
        failState: null
      };
    } catch (error) {
      const failState = this.state;
      this.state = oldState;
      this.restoreScopeStacks(scopeStacksSnapshot);
      if (error instanceof SyntaxError) {
        return {
          node: null,
          error,
          thrown: true,
          aborted: false,
          failState
        };
      }
      if (error === abortSignal) {
        return {
          node: abortSignal.node,
          error: null,
          thrown: false,
          aborted: true,
          failState
        };
      }
      throw error;
    }
  }
  checkExpressionErrors(refExpressionErrors, andThrow) {
    if (!refExpressionErrors) return false;
    const {
      shorthandAssignLoc,
      doubleProtoLoc,
      privateKeyLoc,
      optionalParametersLoc,
      voidPatternLoc
    } = refExpressionErrors;
    const hasErrors = !!shorthandAssignLoc || !!doubleProtoLoc || !!optionalParametersLoc || !!privateKeyLoc || !!voidPatternLoc;
    if (!andThrow) {
      return hasErrors;
    }
    if (shorthandAssignLoc != null) {
      this.raise(Errors.InvalidCoverInitializedName, shorthandAssignLoc);
    }
    if (doubleProtoLoc != null) {
      this.raise(Errors.DuplicateProto, doubleProtoLoc);
    }
    if (privateKeyLoc != null) {
      this.raise(Errors.UnexpectedPrivateField, privateKeyLoc);
    }
    if (optionalParametersLoc != null) {
      this.unexpected(optionalParametersLoc);
    }
    if (voidPatternLoc != null) {
      this.raise(Errors.InvalidCoverDiscardElement, voidPatternLoc);
    }
  }
  isLiteralPropertyName() {
    return tokenIsLiteralPropertyName(this.state.type);
  }
  isPrivateName(node) {
    return node.type === "PrivateName";
  }
  getPrivateNameSV(node) {
    return node.id.name;
  }
  hasPropertyAsPrivateName(node) {
    return (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") && this.isPrivateName(node.property);
  }
  isObjectProperty(node) {
    return node.type === "ObjectProperty";
  }
  isObjectMethod(node) {
    return node.type === "ObjectMethod";
  }
  initializeScopes(inModule = this.options.sourceType === "module") {
    const oldLabels = this.state.labels;
    this.state.labels = [];
    const oldExportedIdentifiers = this.exportedIdentifiers;
    this.exportedIdentifiers = /* @__PURE__ */ new Set();
    const oldInModule = this.inModule;
    this.inModule = inModule;
    const oldScope = this.scope;
    const ScopeHandler2 = this.getScopeHandler();
    this.scope = new ScopeHandler2(this, inModule);
    const oldProdParam = this.prodParam;
    this.prodParam = new ProductionParameterHandler();
    const oldClassScope = this.classScope;
    this.classScope = new ClassScopeHandler(this);
    const oldExpressionScope = this.expressionScope;
    this.expressionScope = new ExpressionScopeHandler(this);
    return () => {
      this.state.labels = oldLabels;
      this.exportedIdentifiers = oldExportedIdentifiers;
      this.inModule = oldInModule;
      this.scope = oldScope;
      this.prodParam = oldProdParam;
      this.classScope = oldClassScope;
      this.expressionScope = oldExpressionScope;
    };
  }
  enterInitialScopes() {
    let paramFlags = 0;
    if (this.inModule || this.optionFlags & 1) {
      paramFlags |= 2;
    }
    if (this.optionFlags & 32) {
      paramFlags |= 1;
    }
    const isCommonJS = !this.inModule && this.options.sourceType === "commonjs";
    if (isCommonJS || this.optionFlags & 2) {
      paramFlags |= 4;
    }
    this.prodParam.enter(paramFlags);
    let scopeFlags = isCommonJS ? 514 : 1;
    if (this.optionFlags & 4) {
      scopeFlags |= 512;
    }
    if (this.optionFlags & 16) {
      scopeFlags |= 16 | 32;
    }
    this.scope.enter(scopeFlags);
  }
  checkDestructuringPrivate(refExpressionErrors) {
    const {
      privateKeyLoc
    } = refExpressionErrors;
    if (privateKeyLoc !== null) {
      this.expectPlugin("destructuringPrivate", privateKeyLoc);
    }
  }
};
var ExpressionErrors = class {
  shorthandAssignLoc = null;
  doubleProtoLoc = null;
  privateKeyLoc = null;
  optionalParametersLoc = null;
  voidPatternLoc = null;
};
var Node = class {
  constructor(optionFlags, filename, pos, loc) {
    this.start = pos;
    this.end = 0;
    if (loc !== void 0) this.loc = new SourceLocation(loc);
    if (optionFlags & 128) this.range = [pos, 0];
    if (loc !== void 0 && filename) {
      this.loc.filename = filename;
    }
  }
  type = "";
};
var NodePrototype = Node.prototype;
var NodeUtils = class extends UtilParser {
  createPosition(loc) {
    return loc;
  }
  startNode() {
    return this.startNodeAt(this.state.startLoc);
  }
  startNodeAt(loc) {
    this.setLoc(loc);
    const {
      optionFlags,
      filename
    } = this;
    if (!(optionFlags & 256)) {
      return new Node(optionFlags, filename, loc.index);
    }
    return new Node(optionFlags, filename, loc.index, this.createPosition(loc));
  }
  startNodeAtNode(type) {
    const {
      optionFlags,
      filename
    } = this;
    if (!(optionFlags & 256)) {
      return new Node(optionFlags, filename, type.start);
    }
    return new Node(optionFlags, filename, type.start, type.loc.start);
  }
  finishNode(node, type) {
    return this.finishNodeAt(node, type, this.state.lastTokEndLoc);
  }
  finishNodeAt(node, type, endLoc) {
    node.type = type;
    node.end = endLoc.index;
    const {
      optionFlags
    } = this;
    if (optionFlags & 256) {
      node.loc.end = this.createPosition(endLoc);
    }
    if (optionFlags & 128) node.range[1] = endLoc.index;
    if (optionFlags & 8192) this.processComment(node);
    return node;
  }
  finishNodeAtNode(node, type, endNode) {
    node.type = type;
    node.end = endNode.end;
    const {
      optionFlags
    } = this;
    if (optionFlags & 256) {
      node.loc.end = endNode.loc.end;
    }
    if (optionFlags & 128) node.range[1] = node.end;
    if (optionFlags & 8192) this.processComment(node);
    return node;
  }
  resetStartLocation(node, startLoc) {
    node.start = startLoc.index;
    const {
      optionFlags
    } = this;
    if (optionFlags & 256) {
      node.loc.start = this.createPosition(startLoc);
    }
    if (optionFlags & 128) node.range[0] = startLoc.index;
  }
  resetEndLocation(node, endLoc = this.state.lastTokEndLoc) {
    node.end = endLoc.index;
    const {
      optionFlags
    } = this;
    if (optionFlags & 256) {
      node.loc.end = this.createPosition(endLoc);
    }
    if (optionFlags & 128) node.range[1] = endLoc.index;
  }
  resetStartLocationFromNode(node, locationNode) {
    node.start = locationNode.start;
    const {
      optionFlags
    } = this;
    if (optionFlags & 256) {
      node.loc.start = locationNode.loc.start;
    }
    if (optionFlags & 128) node.range[0] = locationNode.start;
  }
  resetEndLocationFromNode(node, locationNode) {
    node.end = locationNode.end;
    const {
      optionFlags
    } = this;
    if (optionFlags & 256) {
      node.loc.end = locationNode.loc.end;
    }
    if (optionFlags & 128) node.range[1] = locationNode.end;
  }
  castNodeTo(node, type) {
    node.type = type;
    return node;
  }
  cloneIdentifier(node) {
    const {
      type,
      start,
      end,
      loc,
      range,
      name
    } = node;
    const cloned = Object.create(NodePrototype);
    cloned.type = type;
    cloned.start = start;
    cloned.end = end;
    cloned.loc = loc;
    cloned.range = range;
    cloned.name = name;
    if (node.extra) cloned.extra = node.extra;
    return cloned;
  }
  cloneStringLiteral(node) {
    const {
      type,
      start,
      end,
      loc,
      range,
      extra
    } = node;
    const cloned = Object.create(NodePrototype);
    cloned.type = type;
    cloned.start = start;
    cloned.end = end;
    cloned.loc = loc;
    cloned.range = range;
    cloned.extra = extra;
    cloned.value = node.value;
    return cloned;
  }
};
var unwrapParenthesizedExpression = (node) => {
  return node.type === "ParenthesizedExpression" ? unwrapParenthesizedExpression(node.expression) : node;
};
var LValParser = class extends NodeUtils {
  raiseOnce(toParseError, node) {
    const {
      errors
    } = this.state;
    const length = errors.length;
    const error = this.raise(toParseError, node);
    if (errors.length === length) return;
    for (let i = length - 1; i >= 0; i--) {
      if (errors[i].pos === error.pos && errors[i].reasonCode === error.reasonCode) {
        errors.pop();
        return;
      }
    }
  }
  toAssignable(node, isLHS = false) {
    let parenthesized = void 0;
    if (node.type === "ParenthesizedExpression" || node.extra?.parenthesized) {
      parenthesized = unwrapParenthesizedExpression(node);
      if (isLHS) {
        if (parenthesized.type === "Identifier") {
          this.expressionScope.recordArrowParameterBindingError(Errors.InvalidParenthesizedAssignment, node);
        } else if (parenthesized.type !== "CallExpression" && parenthesized.type !== "MemberExpression" && !this.isOptionalMemberExpression(parenthesized)) {
          this.raiseOnce(Errors.InvalidParenthesizedAssignment, node);
        }
      } else {
        this.raiseOnce(Errors.InvalidParenthesizedAssignment, node);
      }
    }
    switch (node.type) {
      case "Identifier":
      case "ObjectPattern":
      case "ArrayPattern":
      case "AssignmentPattern":
      case "RestElement":
      case "VoidPattern":
        break;
      case "ObjectExpression":
        this.castNodeTo(node, "ObjectPattern");
        for (let i = 0, length = node.properties.length, last = length - 1; i < length; i++) {
          const prop = node.properties[i];
          const isLast = i === last;
          this.toAssignableObjectExpressionProp(prop, isLast, isLHS);
          if (isLast && prop.type === "RestElement" && node.extra?.trailingCommaLoc) {
            this.raise(Errors.RestTrailingComma, node.extra.trailingCommaLoc);
          }
        }
        break;
      case "ObjectProperty": {
        const {
          key,
          value
        } = node;
        if (this.isPrivateName(key)) {
          this.classScope.usePrivateName(this.getPrivateNameSV(key), key.start);
        }
        this.toAssignable(value, isLHS);
        break;
      }
      case "SpreadElement": {
        throw new Error("Internal @babel/parser error (this is a bug, please report it). SpreadElement should be converted by .toAssignable's caller.");
      }
      case "ArrayExpression":
        this.castNodeTo(node, "ArrayPattern");
        this.toAssignableList(node.elements, node.extra?.trailingCommaLoc, isLHS);
        break;
      case "AssignmentExpression":
        if (node.operator !== "=") {
          this.raise(Errors.MissingEqInAssignment, this.optionFlags & 256 ? node.left.loc.end : node.left);
        }
        this.castNodeTo(node, "AssignmentPattern");
        delete node.operator;
        if (node.left.type === "VoidPattern") {
          this.raise(Errors.VoidPatternInitializer, node.left);
        }
        this.toAssignable(node.left, isLHS);
        break;
      case "ParenthesizedExpression":
        this.toAssignable(parenthesized, isLHS);
        break;
    }
  }
  toAssignableObjectExpressionProp(prop, isLast, isLHS) {
    if (prop.type === "ObjectMethod") {
      this.raise(prop.kind === "get" || prop.kind === "set" ? Errors.PatternHasAccessor : Errors.PatternHasMethod, prop.key);
    } else if (prop.type === "SpreadElement") {
      this.castNodeTo(prop, "RestElement");
      const arg = prop.argument;
      this.checkToRestConversion(arg, false);
      this.toAssignable(arg, isLHS);
      if (!isLast) {
        this.raise(Errors.RestTrailingComma, prop);
      }
    } else {
      this.toAssignable(prop, isLHS);
    }
  }
  toAssignableList(exprList, trailingCommaLoc, isLHS) {
    const end = exprList.length - 1;
    for (let i = 0; i <= end; i++) {
      const elt = exprList[i];
      if (!elt) continue;
      this.toAssignableListItem(exprList, i, isLHS);
      if (elt.type === "RestElement") {
        if (i < end) {
          this.raise(Errors.RestTrailingComma, elt);
        } else if (trailingCommaLoc) {
          this.raise(Errors.RestTrailingComma, trailingCommaLoc);
        }
      }
    }
  }
  toAssignableListItem(exprList, index, isLHS) {
    const node = exprList[index];
    if (node.type === "SpreadElement") {
      this.castNodeTo(node, "RestElement");
      const arg = node.argument;
      this.checkToRestConversion(arg, true);
      this.toAssignable(arg, isLHS);
    } else {
      this.toAssignable(node, isLHS);
    }
  }
  isAssignable(node, isBinding) {
    switch (node.type) {
      case "Identifier":
      case "ObjectPattern":
      case "ArrayPattern":
      case "AssignmentPattern":
      case "RestElement":
      case "VoidPattern":
        return true;
      case "ObjectExpression": {
        const last = node.properties.length - 1;
        return node.properties.every((prop, i) => {
          return prop.type !== "ObjectMethod" && (i === last || prop.type !== "SpreadElement") && this.isAssignable(prop);
        });
      }
      case "ObjectProperty":
        return this.isAssignable(node.value);
      case "SpreadElement":
        return this.isAssignable(node.argument);
      case "ArrayExpression":
        return node.elements.every((element) => element === null || this.isAssignable(element));
      case "AssignmentExpression":
        return node.operator === "=";
      case "ParenthesizedExpression":
        return this.isAssignable(node.expression);
      case "MemberExpression":
      case "OptionalMemberExpression":
        return !isBinding;
      default:
        return false;
    }
  }
  toReferencedList(exprList, isParenthesizedExpr) {
    return exprList;
  }
  parseSpread(refExpressionErrors) {
    const node = this.startNode();
    this.next();
    node.argument = this.parseMaybeAssignAllowIn(refExpressionErrors);
    return this.finishNode(node, "SpreadElement");
  }
  parseRestBinding() {
    const node = this.startNode();
    this.next();
    const argument = this.parseBindingAtom();
    if (argument.type === "VoidPattern") {
      this.raise(Errors.UnexpectedVoidPattern, argument);
    }
    node.argument = argument;
    return this.finishNode(node, "RestElement");
  }
  parseBindingAtom() {
    switch (this.state.type) {
      case 0: {
        const node = this.startNode();
        this.next();
        node.elements = this.parseBindingList(1, 93, 1);
        return this.finishNode(node, "ArrayPattern");
      }
      case 2:
        return this.parseObjectLike(4, true);
      case 84:
        return this.parseVoidPattern(null);
    }
    return this.parseIdentifier();
  }
  parseBindingList(close, closeCharCode, flags) {
    const allowEmpty = flags & 1;
    const elts = [];
    let first = true;
    while (!this.eat(close)) {
      if (first) {
        first = false;
      } else {
        this.expect(8);
      }
      if (allowEmpty && this.match(8)) {
        elts.push(null);
      } else if (this.eat(close)) {
        break;
      } else if (this.match(17)) {
        let rest = this.parseRestBinding();
        if (flags & 2) {
          rest = this.parseFunctionParamType(rest);
        }
        elts.push(rest);
        if (!this.checkCommaAfterRest(closeCharCode)) {
          this.expect(close);
          break;
        }
      } else {
        const decorators = [];
        if (flags & 2) {
          if (this.match(22) && this.hasPlugin("decorators")) {
            this.raise(Errors.UnsupportedParameterDecorator, this.state.startLoc);
          }
          while (this.match(22)) {
            decorators.push(this.parseDecorator());
          }
        }
        elts.push(this.parseBindingElement(flags, decorators));
      }
    }
    return elts;
  }
  parseBindingRestProperty(prop) {
    this.next();
    if (this.hasPlugin("discardBinding") && this.match(84)) {
      prop.argument = this.parseVoidPattern(null);
      this.raise(Errors.UnexpectedVoidPattern, prop.argument);
    } else {
      prop.argument = this.parseIdentifier();
    }
    this.checkCommaAfterRest(125);
    return this.finishNode(prop, "RestElement");
  }
  parseBindingProperty() {
    const {
      type,
      startLoc
    } = this.state;
    if (type === 17) {
      return this.parseBindingRestProperty(this.startNode());
    }
    const prop = this.startNode();
    if (type === 137) {
      this.expectPlugin("destructuringPrivate", startLoc);
      this.classScope.usePrivateName(this.state.value, startLoc);
      prop.key = this.parsePrivateName();
    } else {
      this.parsePropertyName(prop);
    }
    prop.method = false;
    return this.parseObjPropValue(prop, startLoc, false, false, true, false);
  }
  parseBindingElement(flags, decorators) {
    const {
      startLoc
    } = this.state;
    const left = this.parseMaybeDefault();
    if (flags & 2) {
      this.parseFunctionParamType(left);
    }
    if (decorators.length) {
      left.decorators = decorators;
      this.resetStartLocationFromNode(left, decorators[0]);
    }
    const elt = this.parseMaybeDefault(startLoc, left);
    return elt;
  }
  parseFunctionParamType(param) {
    return param;
  }
  parseMaybeDefault(startLoc, left) {
    startLoc ??= this.state.startLoc;
    left = left ?? this.parseBindingAtom();
    if (!this.eat(25)) return left;
    const node = this.startNodeAt(startLoc);
    if (left.type === "VoidPattern") {
      this.raise(Errors.VoidPatternInitializer, left);
    }
    node.left = left;
    node.right = this.parseMaybeAssignAllowIn();
    return this.finishNode(node, "AssignmentPattern");
  }
  isValidLVal(type, disallowCallExpression, isUnparenthesizedInAssign, binding) {
    switch (type) {
      case "AssignmentPattern":
        return "left";
      case "RestElement":
        return "argument";
      case "ObjectProperty":
        return "value";
      case "ParenthesizedExpression":
        return "expression";
      case "ArrayPattern":
        return "elements";
      case "ObjectPattern":
        return "properties";
      case "VoidPattern":
        return true;
      case "CallExpression":
        if (!disallowCallExpression && !this.state.strict && this.optionFlags & 16384) {
          return true;
        }
    }
    return false;
  }
  isOptionalMemberExpression(expression) {
    return expression.type === "OptionalMemberExpression";
  }
  checkLVal(expression, ancestor, binding = 64, checkClashes = false, strictModeChanged = false, hasParenthesizedAncestor = false, disallowCallExpression = false) {
    const type = expression.type;
    if (this.isObjectMethod(expression)) return;
    const isOptionalMemberExpression = this.isOptionalMemberExpression(expression);
    if (isOptionalMemberExpression || type === "MemberExpression") {
      if (isOptionalMemberExpression) {
        this.expectPlugin("optionalChainingAssign", expression.start);
        if (ancestor.type !== "AssignmentExpression") {
          this.raise(Errors.InvalidLhsOptionalChaining, expression, {
            ancestor
          });
        }
      }
      if (binding !== 64) {
        this.raise(Errors.InvalidPropertyBindingPattern, expression);
      }
      return;
    }
    if (type === "Identifier") {
      this.checkIdentifier(expression, binding, strictModeChanged);
      const {
        name
      } = expression;
      if (checkClashes) {
        if (checkClashes.has(name)) {
          this.raise(Errors.ParamDupe, expression);
        } else {
          checkClashes.add(name);
        }
      }
      return;
    } else if (type === "VoidPattern" && ancestor.type === "CatchClause") {
      this.raise(Errors.VoidPatternCatchClauseParam, expression);
    }
    const unwrappedExpression = unwrapParenthesizedExpression(expression);
    disallowCallExpression ||= binding !== 64 || unwrappedExpression.type === "CallExpression" && (unwrappedExpression.callee.type === "Import" || unwrappedExpression.callee.type === "Super");
    const validity = this.isValidLVal(type, disallowCallExpression, !(hasParenthesizedAncestor || expression.extra?.parenthesized) && ancestor.type === "AssignmentExpression", binding);
    if (validity === true) return;
    if (validity === false) {
      const ParseErrorClass = binding === 64 ? Errors.InvalidLhs : Errors.InvalidLhsBinding;
      this.raise(ParseErrorClass, expression, {
        ancestor
      });
      return;
    }
    let key, isParenthesizedExpression;
    if (typeof validity === "string") {
      key = validity;
      isParenthesizedExpression = type === "ParenthesizedExpression";
    } else {
      [key, isParenthesizedExpression] = validity;
    }
    const nextAncestor = type === "ArrayPattern" || type === "ObjectPattern" ? {
      type
    } : ancestor;
    const val = expression[key];
    if (Array.isArray(val)) {
      for (const child of val) {
        if (child) {
          this.checkLVal(child, nextAncestor, binding, checkClashes, strictModeChanged, isParenthesizedExpression, true);
        }
      }
    } else if (val) {
      this.checkLVal(val, nextAncestor, binding, checkClashes, strictModeChanged, isParenthesizedExpression, disallowCallExpression);
    }
  }
  checkIdentifier(at, bindingType, strictModeChanged = false) {
    this.checkStrictBindReservedWord(at, bindingType, strictModeChanged);
    if (bindingType & 8192 && at.name === "let") {
      this.raise(Errors.LetInLexicalBinding, at);
    }
    if (!(bindingType & 64)) {
      this.declareNameFromIdentifier(at, bindingType);
    }
  }
  checkStrictBindReservedWord(at, bindingType, strictModeChanged = false) {
    if (this.state.strict && (strictModeChanged ? isStrictBindReservedWord(at.name, this.inModule) : isStrictBindOnlyReservedWord(at.name))) {
      if (bindingType === 64) {
        this.raise(Errors.StrictEvalArguments, at, {
          referenceName: at.name
        });
      } else {
        this.raise(Errors.StrictEvalArgumentsBinding, at, {
          bindingName: at.name
        });
      }
    }
  }
  declareNameFromIdentifier(identifier, binding) {
    this.scope.declareName(identifier.name, binding, identifier.start);
  }
  checkToRestConversion(node, allowPattern) {
    switch (node.type) {
      case "ParenthesizedExpression":
        this.checkToRestConversion(node.expression, allowPattern);
        break;
      case "Identifier":
      case "MemberExpression":
        break;
      case "ArrayExpression":
      case "ObjectExpression":
        if (allowPattern) break;
      default:
        this.raise(Errors.InvalidRestAssignmentPattern, node);
    }
  }
  checkCommaAfterRest(close) {
    if (!this.match(8)) {
      return false;
    }
    this.raise(this.lookaheadCharCode() === close ? Errors.RestTrailingComma : Errors.ElementAfterRest, this.state.startLoc);
    return true;
  }
};
var ExpressionParser = class extends LValParser {
  checkProto(prop, sawProto, refExpressionErrors) {
    if (prop.type === "SpreadElement" || this.isObjectMethod(prop) || prop.computed || prop.shorthand) {
      return sawProto;
    }
    const key = prop.key;
    const name = key.type === "Identifier" ? key.name : key.value;
    if (name === "__proto__") {
      if (sawProto) {
        if (refExpressionErrors) {
          if (refExpressionErrors.doubleProtoLoc === null) {
            refExpressionErrors.doubleProtoLoc = this.getLoc(key.start);
          }
        } else {
          this.raise(Errors.DuplicateProto, key);
        }
      }
      return true;
    }
    return sawProto;
  }
  shouldExitDescending(expr) {
    return expr.type === "ArrowFunctionExpression" && !expr.extra?.parenthesized;
  }
  getExpression() {
    this.enterInitialScopes();
    this.nextToken();
    if (this.match(138)) {
      throw this.raise(Errors.ParseExpressionEmptyInput, this.state.startLoc);
    }
    const expr = this.parseExpression();
    if (!this.match(138)) {
      throw this.raise(Errors.ParseExpressionExpectsEOF, this.state.startLoc, {
        unexpected: this.input.codePointAt(this.state.start)
      });
    }
    this.finalizeRemainingComments();
    expr.comments = this.comments;
    expr.errors = this.state.errors;
    if (this.optionFlags & 512) {
      expr.tokens = createExportedTokens(this.tokens);
    }
    return expr;
  }
  parseExpression(disallowIn, refExpressionErrors) {
    if (disallowIn) {
      return this.disallowInAnd(() => this.parseExpressionBase(refExpressionErrors));
    }
    return this.allowInAnd(() => this.parseExpressionBase(refExpressionErrors));
  }
  parseExpressionBase(refExpressionErrors) {
    const startLoc = this.state.startLoc;
    const expr = this.parseMaybeAssign(refExpressionErrors);
    if (this.match(8)) {
      const node = this.startNodeAt(startLoc);
      node.expressions = [expr];
      while (this.eat(8)) {
        node.expressions.push(this.parseMaybeAssign(refExpressionErrors));
      }
      this.toReferencedList(node.expressions);
      return this.finishNode(node, "SequenceExpression");
    }
    return expr;
  }
  parseMaybeAssignDisallowIn(refExpressionErrors) {
    return this.disallowInAnd(() => this.parseMaybeAssign(refExpressionErrors));
  }
  parseMaybeAssignAllowIn(refExpressionErrors, isParenItem) {
    return this.allowInAnd(() => this.parseMaybeAssign(refExpressionErrors, isParenItem));
  }
  setOptionalParametersError(refExpressionErrors) {
    refExpressionErrors.optionalParametersLoc = this.state.startLoc;
  }
  parseMaybeAssign(refExpressionErrors, isParenItem) {
    const startLoc = this.state.startLoc;
    const isYield = this.isContextual(107);
    if (isYield) {
      if (this.prodParam.hasYield) {
        this.next();
        let left2 = this.parseYield(startLoc);
        if (isParenItem) {
          left2 = this.parseParenItem(left2, startLoc);
        }
        return left2;
      }
    }
    let ownExpressionErrors;
    let inInitializerScope = false;
    if (refExpressionErrors) {
      ownExpressionErrors = false;
    } else {
      refExpressionErrors = new ExpressionErrors();
      ownExpressionErrors = true;
      if (this.expressionScope.canBeInParameters()) {
        this.expressionScope.enter(initializerScope);
        inInitializerScope = true;
      }
    }
    this.state.canStartArrow = true;
    let left = this.parseMaybeConditional(refExpressionErrors);
    if (isParenItem) {
      left = this.parseParenItem(left, startLoc);
    }
    if (tokenIsAssignment(this.state.type) && !(this.match(27) && this.state.lastTokEndLoc.index === this.state.regExpAllowedAt)) {
      const node = this.startNodeAt(startLoc);
      const operator = this.state.value;
      node.operator = operator;
      if (this.match(25)) {
        this.toAssignable(left, true);
        node.left = left;
        const startIndex = startLoc.index;
        if (refExpressionErrors.doubleProtoLoc != null && refExpressionErrors.doubleProtoLoc.index >= startIndex) {
          refExpressionErrors.doubleProtoLoc = null;
        }
        if (refExpressionErrors.shorthandAssignLoc != null && refExpressionErrors.shorthandAssignLoc.index >= startIndex) {
          refExpressionErrors.shorthandAssignLoc = null;
        }
        if (refExpressionErrors.privateKeyLoc != null && refExpressionErrors.privateKeyLoc.index >= startIndex) {
          this.checkDestructuringPrivate(refExpressionErrors);
          refExpressionErrors.privateKeyLoc = null;
        }
        if (refExpressionErrors.voidPatternLoc != null && refExpressionErrors.voidPatternLoc.index >= startIndex) {
          refExpressionErrors.voidPatternLoc = null;
        }
      } else {
        node.left = left;
      }
      this.next();
      node.right = this.parseMaybeAssign();
      if (inInitializerScope) this.expressionScope.exit();
      this.checkLVal(left, this.finishNode(node, "AssignmentExpression"), void 0, void 0, void 0, void 0, operator === "||=" || operator === "&&=" || operator === "??=");
      return node;
    } else if (ownExpressionErrors) {
      this.checkExpressionErrors(refExpressionErrors, true);
      if (inInitializerScope) this.expressionScope.exit();
    }
    if (isYield) {
      const {
        type
      } = this.state;
      const startsExpr2 = this.hasPlugin("v8intrinsic") ? tokenCanStartExpression(type) : tokenCanStartExpression(type) && !this.match(50);
      if (startsExpr2 && !this.isAmbiguousPrefixOrIdentifier()) {
        this.raiseOverwrite(Errors.YieldNotInGeneratorFunction, startLoc);
        return this.parseYield(startLoc);
      }
    }
    return left;
  }
  parseMaybeConditional(refExpressionErrors) {
    const startLoc = this.state.startLoc;
    const expr = this.parseExprOps(refExpressionErrors);
    if (this.shouldExitDescending(expr)) {
      return expr;
    }
    return this.parseConditional(expr, startLoc, refExpressionErrors);
  }
  parseConditional(expr, startLoc, refExpressionErrors) {
    if (this.eat(13)) {
      const node = this.startNodeAt(startLoc);
      node.test = expr;
      node.consequent = this.parseMaybeAssignAllowIn();
      this.expect(10);
      node.alternate = this.parseMaybeAssign();
      return this.finishNode(node, "ConditionalExpression");
    }
    return expr;
  }
  parseMaybeUnaryOrPrivate(refExpressionErrors) {
    return this.match(137) ? this.parsePrivateName() : this.parseMaybeUnary(refExpressionErrors);
  }
  parseExprOps(refExpressionErrors) {
    const startLoc = this.state.startLoc;
    const expr = this.parseMaybeUnaryOrPrivate(refExpressionErrors);
    if (this.shouldExitDescending(expr)) {
      return expr;
    }
    this.state.canStartArrow = false;
    return this.parseExprOp(expr, startLoc, -1);
  }
  isEscapedKeywordOperatorAfterLineBreak() {
    return tokenIsKeyword(this.state.type) && this.state.containsEsc && this.hasPrecedingLineBreak();
  }
  isBinaryOperator(op) {
    return tokenIsOperator(op) && (this.prodParam.hasIn || op !== 54) && !this.isEscapedKeywordOperatorAfterLineBreak();
  }
  parseExprOp(left, leftStartLoc, minPrec) {
    const op = this.state.type;
    const isOperator = this.isBinaryOperator(op);
    if (this.isPrivateName(left)) {
      const value = this.getPrivateNameSV(left);
      if (minPrec >= tokenOperatorPrecedence(54) || op !== 54 || !isOperator) {
        this.raise(Errors.PrivateInExpectedIn, leftStartLoc, {
          identifierName: value
        });
      }
      this.classScope.usePrivateName(value, leftStartLoc);
    }
    if (isOperator) {
      let prec = tokenOperatorPrecedence(op);
      if (prec > minPrec) {
        if (op === 35) {
          this.expectPlugin("pipelineOperator");
          if (this.prodParam.inFSharpPipelineDirectBody) {
            return left;
          }
        }
        const node = this.startNodeAt(leftStartLoc);
        node.left = left;
        node.operator = this.state.value;
        const logical = op === 37 || op === 38;
        const coalesce = op === 36;
        if (coalesce) {
          prec = tokenOperatorPrecedence(38);
        }
        this.next();
        node.right = this.parseExprOpRightExpr(op, prec);
        const finishedNode = this.finishNode(node, logical || coalesce ? "LogicalExpression" : "BinaryExpression");
        const nextOp = this.state.type;
        if (coalesce && (nextOp === 37 || nextOp === 38) || logical && nextOp === 36) {
          throw this.raise(Errors.MixingCoalesceWithLogical, this.state.startLoc);
        }
        return this.parseExprOp(finishedNode, leftStartLoc, minPrec);
      }
    }
    return left;
  }
  parseExprOpRightExpr(op, prec) {
    switch (op) {
      case 35:
        switch (this.getPluginOption("pipelineOperator", "proposal")) {
          case "hack":
            return this.withTopicBindingContext(() => {
              return this.parseHackPipeBody();
            });
          case "fsharp":
            return this.parseFSharpPipelineBody(prec);
        }
      default:
        return this.parseExprOpBaseRightExpr(op, prec);
    }
  }
  parseExprOpBaseRightExpr(op, prec) {
    const startLoc = this.state.startLoc;
    return this.parseExprOp(this.parseMaybeUnaryOrPrivate(), startLoc, tokenIsRightAssociative(op) ? prec - 1 : prec);
  }
  parseHackPipeBody() {
    const {
      startLoc
    } = this.state;
    const body = this.parseMaybeAssign();
    const requiredParentheses = UnparenthesizedPipeBodyDescriptions.has(body.type);
    if (requiredParentheses && !body.extra?.parenthesized) {
      this.raise(Errors.PipeUnparenthesizedBody, startLoc, {
        type: body.type
      });
    }
    if (!this.topicReferenceWasUsedInCurrentContext()) {
      this.raise(Errors.PipeTopicUnused, startLoc);
    }
    return body;
  }
  checkExponentialAfterUnary(node) {
    if (this.match(53)) {
      this.raise(Errors.UnexpectedTokenUnaryExponentiation, node.argument);
    }
  }
  parseMaybeUnary(refExpressionErrors, sawUnary) {
    const startLoc = this.state.startLoc;
    const isAwait = this.isContextual(93);
    if (isAwait && this.recordAwaitIfAllowed()) {
      this.next();
      const expr2 = this.parseAwait(startLoc);
      if (!sawUnary) this.checkExponentialAfterUnary(expr2);
      return expr2;
    }
    const update = this.match(30);
    const node = this.startNode();
    if (tokenIsPrefix(this.state.type)) {
      node.operator = this.state.value;
      node.prefix = true;
      this.state.canStartArrow = false;
      if (this.match(68)) {
        this.expectPlugin("throwExpressions");
      }
      const isDelete = this.match(85);
      this.next();
      node.argument = this.parseMaybeUnary(null, true);
      this.checkExpressionErrors(refExpressionErrors, true);
      if (this.state.strict && isDelete) {
        const arg = unwrapParenthesizedExpression(node.argument);
        if (arg.type === "Identifier") {
          this.raise(Errors.StrictDelete, node);
        } else if (this.hasPropertyAsPrivateName(arg)) {
          this.raise(Errors.DeletePrivateField, node);
        }
      }
      if (!update) {
        if (!sawUnary) {
          this.checkExponentialAfterUnary(node);
        }
        return this.finishNode(node, "UnaryExpression");
      }
    }
    const expr = this.parseUpdate(node, update, refExpressionErrors);
    if (isAwait) {
      const {
        type
      } = this.state;
      const startsExpr2 = this.hasPlugin("v8intrinsic") ? tokenCanStartExpression(type) : tokenCanStartExpression(type) && !this.match(50);
      if (startsExpr2 && !this.isAmbiguousPrefixOrIdentifier()) {
        this.raiseOverwrite(Errors.AwaitNotInAsyncContext, startLoc);
        return this.parseAwait(startLoc);
      }
    }
    return expr;
  }
  parseUpdate(node, update, refExpressionErrors) {
    if (update) {
      const result = this.finishNode(node, "UpdateExpression");
      this.checkLVal(result.argument, result);
      return result;
    }
    const startLoc = this.state.startLoc;
    let expr = this.parseExprSubscripts(refExpressionErrors);
    if (this.checkExpressionErrors(refExpressionErrors, false)) return expr;
    while (tokenIsPostfix(this.state.type) && !this.canInsertSemicolon()) {
      const node2 = this.startNodeAt(startLoc);
      node2.operator = this.state.value;
      node2.prefix = false;
      node2.argument = expr;
      this.next();
      this.checkLVal(expr, expr = this.finishNode(node2, "UpdateExpression"));
    }
    return expr;
  }
  parseExprSubscripts(refExpressionErrors) {
    const startLoc = this.state.startLoc;
    if (refExpressionErrors != null && (this.match(2) || this.match(0))) {
      const atomExpressionErrors = new ExpressionErrors();
      const expr2 = this.parseExprAtom(atomExpressionErrors);
      const result = this.parseSubscripts(expr2, startLoc);
      if (result !== expr2) {
        this.checkExpressionErrors(atomExpressionErrors, true);
      } else {
        refExpressionErrors.shorthandAssignLoc ??= atomExpressionErrors.shorthandAssignLoc;
        refExpressionErrors.doubleProtoLoc ??= atomExpressionErrors.doubleProtoLoc;
        refExpressionErrors.privateKeyLoc ??= atomExpressionErrors.privateKeyLoc;
        refExpressionErrors.optionalParametersLoc ??= atomExpressionErrors.optionalParametersLoc;
        refExpressionErrors.voidPatternLoc ??= atomExpressionErrors.voidPatternLoc;
      }
      return result;
    }
    const expr = this.parseExprAtom(refExpressionErrors);
    if (this.shouldExitDescending(expr)) {
      return expr;
    }
    return this.parseSubscripts(expr, startLoc);
  }
  parseSubscripts(base, startLoc, noCalls) {
    const state = {
      optionalChainMember: false,
      maybeAsyncArrow: this.atPossibleAsyncArrow(base),
      stop: false
    };
    do {
      base = this.parseSubscript(base, startLoc, noCalls, state);
      state.maybeAsyncArrow = false;
    } while (!state.stop);
    return base;
  }
  parseSubscript(base, startLoc, noCalls, state) {
    const {
      type
    } = this.state;
    if (!noCalls && type === 11) {
      return this.parseBind(base, startLoc, state);
    } else if (tokenIsTemplate(type)) {
      return this.parseTaggedTemplateExpression(base, startLoc, state);
    }
    let optional = false;
    if (type === 14) {
      if (noCalls) {
        this.raise(Errors.OptionalChainingNoNew, this.state.startLoc);
        if (this.lookaheadCharCode() === 40) {
          return this.stopParseSubscript(base, state);
        }
      }
      state.optionalChainMember = optional = true;
      this.next();
    }
    if (!noCalls && this.match(6)) {
      return this.parseCoverCallAndAsyncArrowHead(base, startLoc, state, optional);
    } else {
      const computed = this.eat(0);
      if (computed || optional || this.eat(12)) {
        return this.parseMember(base, startLoc, state, computed, optional);
      } else {
        return this.stopParseSubscript(base, state);
      }
    }
  }
  stopParseSubscript(base, state) {
    state.stop = true;
    return base;
  }
  parseMember(base, startLoc, state, computed, optional) {
    const node = this.startNodeAt(startLoc);
    node.object = base;
    node.computed = computed;
    if (computed) {
      node.property = this.parseExpression();
      this.expect(1);
    } else if (this.match(137)) {
      if (base.type === "Super") {
        this.raise(Errors.SuperPrivateField, startLoc);
      }
      this.classScope.usePrivateName(this.state.value, this.state.startLoc);
      node.property = this.parsePrivateName();
    } else {
      node.property = this.parseIdentifier(true);
    }
    if (state.optionalChainMember) {
      node.optional = optional;
      return this.finishNode(node, "OptionalMemberExpression");
    } else {
      return this.finishNode(node, "MemberExpression");
    }
  }
  parseBind(base, startLoc, state) {
    const node = this.startNodeAt(startLoc);
    node.object = base;
    this.next();
    const callee = this.parseNoCallExpr((base2) => {
      throw this.raise(Errors.UnsupportedBindRHS, base2);
    });
    if (callee.type === "Super" || callee.type === "Import") {
      throw this.raise(Errors.UnsupportedBindRHS, callee);
    }
    node.callee = callee;
    state.stop = true;
    return this.parseSubscripts(this.finishNode(node, "BindExpression"), startLoc, false);
  }
  parseCoverCallAndAsyncArrowHead(base, startLoc, state, optional) {
    let refExpressionErrors = null;
    this.next();
    const node = this.startNodeAt(startLoc);
    node.callee = base;
    const {
      maybeAsyncArrow,
      optionalChainMember
    } = state;
    if (maybeAsyncArrow) {
      this.expressionScope.enter(newAsyncArrowScope());
      refExpressionErrors = new ExpressionErrors();
    }
    if (optionalChainMember) {
      node.optional = optional;
    }
    if (optional) {
      node.arguments = this.parseCallExpressionArguments();
    } else {
      node.arguments = this.parseCallExpressionArguments(base.type !== "Super", node, refExpressionErrors);
    }
    let finishedNode = this.finishCallExpression(node, optionalChainMember);
    if (maybeAsyncArrow && this.shouldParseAsyncArrow() && !optional) {
      state.stop = true;
      this.checkDestructuringPrivate(refExpressionErrors);
      this.expressionScope.validateAsPattern();
      this.expressionScope.exit();
      finishedNode = this.parseAsyncArrowFromCallExpression(this.startNodeAt(startLoc), finishedNode);
    } else {
      if (maybeAsyncArrow) {
        this.checkExpressionErrors(refExpressionErrors, true);
        this.expressionScope.exit();
      }
      this.toReferencedList(node.arguments);
    }
    return finishedNode;
  }
  parseTaggedTemplateExpression(base, startLoc, state) {
    const node = this.startNodeAt(startLoc);
    node.tag = base;
    node.quasi = this.parseTemplate(true);
    if (state.optionalChainMember) {
      this.raise(Errors.OptionalChainingNoTemplate, startLoc);
    }
    return this.finishNode(node, "TaggedTemplateExpression");
  }
  atPossibleAsyncArrow(base) {
    return base.type === "Identifier" && base.name === "async" && this.state.lastTokEndLoc.index === base.end && !this.canInsertSemicolon() && base.end - base.start === 5 && this.state.canStartArrow;
  }
  finishCallExpression(node, optional) {
    if (node.callee.type === "Import") {
      if (node.arguments.length === 0 || node.arguments.length > 2) {
        this.raise(Errors.ImportCallArity, node);
      } else {
        for (const arg of node.arguments) {
          if (arg.type === "SpreadElement") {
            this.raise(Errors.ImportCallSpreadArgument, arg);
          }
        }
      }
    }
    return this.finishNode(node, optional ? "OptionalCallExpression" : "CallExpression");
  }
  parseCallExpressionArguments(allowPlaceholder, nodeForExtra, refExpressionErrors) {
    const elts = [];
    let first = true;
    while (!this.eat(7)) {
      if (first) {
        first = false;
      } else {
        this.expect(8);
        if (this.match(7)) {
          if (nodeForExtra) {
            this.addTrailingCommaExtraToNode(nodeForExtra);
          }
          this.next();
          break;
        }
      }
      elts.push(this.parseExprListItem(7, false, refExpressionErrors, allowPlaceholder));
    }
    return elts;
  }
  shouldParseAsyncArrow() {
    return this.match(15) && !this.canInsertSemicolon();
  }
  parseAsyncArrowFromCallExpression(node, call) {
    this.resetPreviousNodeTrailingComments(call);
    this.expect(15);
    this.parseArrowExpression(node, call.arguments, true, call.extra?.trailingCommaLoc);
    if (call.innerComments) {
      setInnerComments(node, call.innerComments);
    }
    if (call.callee.trailingComments) {
      setInnerComments(node, call.callee.trailingComments);
    }
    return node;
  }
  parseNoCallExpr(onUnparenthesizedImportExpression) {
    const startLoc = this.state.startLoc;
    const isImport = this.match(79);
    this.state.canStartArrow = false;
    const base = this.parseExprAtom();
    if (isImport && base.type === "ImportExpression") {
      onUnparenthesizedImportExpression(base);
    }
    return this.parseSubscripts(base, startLoc, true);
  }
  parseExprAtom(refExpressionErrors) {
    let node;
    let decorators = null;
    const {
      type
    } = this.state;
    switch (type) {
      case 75:
        return this.parseSuper();
      case 79:
        node = this.startNode();
        this.next();
        if (this.match(12)) {
          return this.parseImportMetaPropertyOrPhaseCallOrSyncCall(node);
        }
        if (this.match(6)) {
          if (this.optionFlags & 1024) {
            return this.parseImportCall(node);
          } else {
            return this.finishNode(node, "Import");
          }
        } else {
          this.raise(Errors.UnsupportedImport, this.state.lastTokStartLoc);
          return this.finishNode(node, "Import");
        }
      case 74:
        node = this.startNode();
        this.next();
        return this.finishNode(node, "ThisExpression");
      case 86: {
        return this.parseDo(this.startNode(), false);
      }
      case 52:
      case 27: {
        this.readRegexp();
        return this.parseRegExpLiteral(this.state.value);
      }
      case 134:
        return this.parseNumericLiteral(this.state.value);
      case 135:
        return this.parseBigIntLiteral(this.state.value);
      case 133:
        return this.parseStringLiteral(this.state.value);
      case 80:
        return this.parseNullLiteral();
      case 81:
        return this.parseBooleanLiteral(true);
      case 82:
        return this.parseBooleanLiteral(false);
      case 6: {
        return this.parseParenAndDistinguishExpression(this.state.canStartArrow);
      }
      case 0: {
        return this.parseArrayLike(1, refExpressionErrors);
      }
      case 2: {
        return this.parseObjectLike(4, false, refExpressionErrors);
      }
      case 64:
        return this.parseFunctionOrFunctionSent();
      case 22:
        decorators = this.parseDecorators();
      case 76:
        return this.parseClass(this.maybeTakeDecorators(decorators, this.startNode()), false);
      case 73:
        return this.parseNewOrNewTarget();
      case 21:
      case 20:
        return this.parseTemplate(false);
      case 11: {
        node = this.startNode();
        this.next();
        node.object = null;
        const callee = node.callee = this.parseNoCallExpr((base) => {
          throw this.raise(Errors.UnsupportedBind, base);
        });
        if (callee.type === "MemberExpression") {
          return this.finishNode(node, "BindExpression");
        } else {
          throw this.raise(Errors.UnsupportedBind, callee);
        }
      }
      case 137: {
        this.raise(Errors.PrivateInExpectedIn, this.state.startLoc, {
          identifierName: this.state.value
        });
        return this.parsePrivateName();
      }
      case 29: {
        return this.parseTopicReferenceThenEqualsSign(50, "%");
      }
      case 28: {
        return this.parseTopicReferenceThenEqualsSign(40, "^");
      }
      case 33:
      case 34: {
        return this.parseTopicReference("hack");
      }
      case 40:
      case 50:
      case 23: {
        const pipeProposal = this.getPluginOption("pipelineOperator", "proposal");
        if (pipeProposal) {
          return this.parseTopicReference(pipeProposal);
        }
        throw this.unexpected();
      }
      case 43: {
        const lookaheadCh = this.input.codePointAt(this.nextTokenStart());
        if (isIdentifierStart(lookaheadCh) || lookaheadCh === 62) {
          this.expectOnePlugin(["jsx", "flow", "typescript"]);
        }
        throw this.unexpected();
      }
      default:
        if (tokenIsIdentifier(type)) {
          if (this.isContextual(126) && this.lookaheadInLineCharCode() === 123) {
            return this.parseModuleExpression();
          }
          const {
            canStartArrow,
            containsEsc
          } = this.state;
          const id = this.parseIdentifier();
          if (!containsEsc && id.name === "async" && !this.canInsertSemicolon()) {
            const {
              type: type2
            } = this.state;
            if (type2 === 64) {
              this.resetPreviousNodeTrailingComments(id);
              this.next();
              return this.parseAsyncFunctionExpression(this.startNodeAtNode(id));
            } else if (tokenIsIdentifier(type2)) {
              if (canStartArrow && this.lookaheadCharCode() === 61) {
                return this.parseAsyncArrowUnaryFunction(this.startNodeAtNode(id));
              } else {
                return id;
              }
            } else if (type2 === 86) {
              this.resetPreviousNodeTrailingComments(id);
              return this.parseDo(this.startNodeAtNode(id), true);
            }
          }
          if (canStartArrow && this.match(15) && !this.canInsertSemicolon()) {
            this.next();
            return this.parseArrowExpression(this.startNodeAtNode(id), [id], false);
          }
          return id;
        } else {
          throw this.unexpected();
        }
    }
  }
  parseTopicReferenceThenEqualsSign(topicTokenType, topicTokenValue) {
    const pipeProposal = this.getPluginOption("pipelineOperator", "proposal");
    if (pipeProposal) {
      this.state.type = topicTokenType;
      this.state.value = topicTokenValue;
      this.state.pos--;
      this.state.end--;
      this.state.endLoc = createPositionWithColumnOffset(this.state.endLoc, -1);
      return this.parseTopicReference(pipeProposal);
    }
    throw this.unexpected();
  }
  parseTopicReference(pipeProposal) {
    const node = this.startNode();
    const startLoc = this.state.startLoc;
    const tokenType = this.state.type;
    this.next();
    return this.finishTopicReference(node, startLoc, pipeProposal, tokenType);
  }
  finishTopicReference(node, startLoc, pipeProposal, tokenType) {
    if (this.testTopicReferenceConfiguration(pipeProposal, startLoc, tokenType)) {
      if (!this.topicReferenceIsAllowedInCurrentContext()) {
        this.raise(Errors.PipeTopicUnbound, startLoc);
      }
      this.registerTopicReference();
      return this.finishNode(node, "TopicReference");
    } else {
      throw this.raise(Errors.PipeTopicUnconfiguredToken, startLoc, {
        token: tokenLabelName(tokenType)
      });
    }
  }
  testTopicReferenceConfiguration(pipeProposal, startLoc, tokenType) {
    switch (pipeProposal) {
      case "hack": {
        return this.hasPlugin(["pipelineOperator", {
          topicToken: tokenLabelName(tokenType)
        }]);
      }
      default:
        throw this.raise(Errors.PipeTopicRequiresHackPipes, startLoc);
    }
  }
  parseAsyncArrowUnaryFunction(node) {
    this.prodParam.enter(functionFlags(true, this.prodParam.hasYield));
    const params = [this.parseIdentifier()];
    this.prodParam.exit();
    if (this.hasPrecedingLineBreak()) {
      this.raise(Errors.LineTerminatorBeforeArrow, this.state.curPosition());
    }
    this.expect(15);
    return this.parseArrowExpression(node, params, true);
  }
  parseDo(node, isAsync) {
    this.expectPlugin("doExpressions");
    if (isAsync) {
      this.expectPlugin("asyncDoExpressions");
    }
    node.async = isAsync;
    this.next();
    const oldLabels = this.state.labels;
    this.state.labels = [];
    if (isAsync) {
      this.prodParam.enter(2);
      node.body = this.parseBlock();
      this.prodParam.exit();
    } else {
      node.body = this.parseBlock();
    }
    this.state.labels = oldLabels;
    return this.finishNode(node, "DoExpression");
  }
  parseSuper() {
    const node = this.startNode();
    this.next();
    if (this.match(6) && !this.scope.allowDirectSuper) {
      this.raise(Errors.SuperNotAllowed, node);
    } else if (!this.scope.allowSuper) {
      this.raise(Errors.UnexpectedSuper, node);
    }
    if (!this.match(6) && !this.match(0) && !this.match(12)) {
      this.raise(Errors.UnsupportedSuper, node);
    }
    return this.finishNode(node, "Super");
  }
  parsePrivateName() {
    const node = this.startNode();
    const id = this.startNodeAt(createPositionWithColumnOffset(this.state.startLoc, 1));
    const name = this.state.value;
    this.next();
    node.id = this.createIdentifier(id, name);
    return this.finishNode(node, "PrivateName");
  }
  parseFunctionOrFunctionSent() {
    const node = this.startNode();
    this.next();
    if (this.prodParam.hasYield && this.match(12)) {
      const meta = this.createIdentifier(this.startNodeAtNode(node), "function");
      this.next();
      if (this.match(100)) {
        this.expectPlugin("functionSent");
      } else if (!this.hasPlugin("functionSent")) {
        this.unexpected();
      }
      return this.parseMetaProperty(node, meta, "sent");
    }
    return this.parseFunction(node);
  }
  parseMetaProperty(node, meta, propertyName) {
    node.meta = meta;
    const containsEsc = this.state.containsEsc;
    node.property = this.parseIdentifier(true);
    if (node.property.name !== propertyName || containsEsc) {
      this.raise(Errors.UnsupportedMetaProperty, node.property, {
        target: meta.name,
        onlyValidPropertyName: propertyName
      });
    }
    return this.finishNode(node, "MetaProperty");
  }
  parseImportMetaPropertyOrPhaseCallOrSyncCall(node) {
    this.next();
    if (this.isContextual(102) || this.isContextual(94)) {
      const isSource = this.isContextual(102);
      this.expectPlugin(isSource ? "sourcePhaseImports" : "deferredImportEvaluation");
      this.next();
      node.phase = isSource ? "source" : "defer";
      return this.parseImportCall(node);
    } else if (this.isContextual(105)) {
      this.expectPlugin("importSync");
      this.next();
      node.sync = true;
      return this.parseImportCall(node);
    } else {
      const id = this.createIdentifierAt(this.startNodeAtNode(node), "import", this.state.lastTokStartLoc);
      if (this.isContextual(98)) {
        if (!this.inModule) {
          this.raise(Errors.ImportMetaOutsideModule, id);
        }
        this.sawUnambiguousESM = true;
      }
      return this.parseMetaProperty(node, id, "meta");
    }
  }
  parseLiteralAtNode(value, type, node) {
    this.addExtra(node, "rawValue", value);
    this.addExtra(node, "raw", this.input.slice(this.offsetToSourcePos(node.start), this.state.end));
    node.value = value;
    this.next();
    return this.finishNode(node, type);
  }
  parseLiteral(value, type) {
    const node = this.startNode();
    return this.parseLiteralAtNode(value, type, node);
  }
  parseStringLiteral(value) {
    return this.parseLiteral(value, "StringLiteral");
  }
  parseNumericLiteral(value) {
    return this.parseLiteral(value, "NumericLiteral");
  }
  parseBigIntLiteral(value) {
    let bigInt;
    try {
      bigInt = BigInt(value);
    } catch {
      bigInt = null;
    }
    const node = this.parseLiteral(bigInt, "BigIntLiteral");
    return node;
  }
  parseRegExpLiteral(value) {
    const node = this.startNode();
    this.addExtra(node, "raw", this.input.slice(this.offsetToSourcePos(node.start), this.state.end));
    node.pattern = value.pattern;
    node.flags = value.flags;
    this.next();
    return this.finishNode(node, "RegExpLiteral");
  }
  parseBooleanLiteral(value) {
    const node = this.startNode();
    node.value = value;
    this.next();
    return this.finishNode(node, "BooleanLiteral");
  }
  parseNullLiteral() {
    const node = this.startNode();
    this.next();
    return this.finishNode(node, "NullLiteral");
  }
  parseParenAndDistinguishExpression(canStartArrow) {
    const startLoc = this.state.startLoc;
    let val;
    this.next();
    this.expressionScope.enter(newArrowHeadScope());
    const innerStartLoc = this.state.startLoc;
    const exprList = [];
    const refExpressionErrors = new ExpressionErrors();
    let first = true;
    let spreadStartLoc;
    let optionalCommaStartLoc;
    while (!this.match(7)) {
      if (first) {
        first = false;
      } else {
        this.expect(8, refExpressionErrors.optionalParametersLoc === null ? null : refExpressionErrors.optionalParametersLoc);
        if (this.match(7)) {
          optionalCommaStartLoc = this.state.startLoc;
          break;
        }
      }
      if (this.match(17)) {
        const spreadNodeStartLoc = this.state.startLoc;
        spreadStartLoc = this.state.startLoc;
        exprList.push(this.parseParenItem(this.parseRestBinding(), spreadNodeStartLoc));
        if (!this.checkCommaAfterRest(41)) {
          break;
        }
      } else {
        exprList.push(this.parseMaybeAssignAllowInOrVoidPattern(7, refExpressionErrors, true));
      }
    }
    const innerEndLoc = this.state.lastTokEndLoc;
    this.expect(7);
    let arrowNode = this.startNodeAt(startLoc);
    if (canStartArrow && this.shouldParseArrow(exprList) && (arrowNode = this.parseArrow(arrowNode))) {
      this.checkDestructuringPrivate(refExpressionErrors);
      this.expressionScope.validateAsPattern();
      this.expressionScope.exit();
      this.parseArrowExpression(arrowNode, exprList, false);
      return arrowNode;
    }
    this.expressionScope.exit();
    if (!exprList.length) {
      this.unexpected(this.state.lastTokStartLoc);
    }
    if (optionalCommaStartLoc) this.unexpected(optionalCommaStartLoc);
    if (spreadStartLoc) this.unexpected(spreadStartLoc);
    this.checkExpressionErrors(refExpressionErrors, true);
    this.toReferencedList(exprList, true);
    if (exprList.length > 1) {
      val = this.startNodeAt(innerStartLoc);
      val.expressions = exprList;
      this.finishNode(val, "SequenceExpression");
      this.resetEndLocation(val, innerEndLoc);
    } else {
      val = exprList[0];
    }
    return this.wrapParenthesis(startLoc, val);
  }
  wrapParenthesis(startLoc, expression) {
    if (!(this.optionFlags & 2048)) {
      this.addExtra(expression, "parenthesized", true);
      this.addExtra(expression, "parenStart", startLoc.index);
      this.takeSurroundingComments(expression, startLoc.index, this.state.lastTokEndLoc.index);
      return expression;
    }
    const parenExpression = this.startNodeAt(startLoc);
    parenExpression.expression = expression;
    return this.finishNode(parenExpression, "ParenthesizedExpression");
  }
  shouldParseArrow(params) {
    return !this.canInsertSemicolon();
  }
  parseArrow(node) {
    if (this.eat(15)) {
      return node;
    }
  }
  parseParenItem(node, startLoc) {
    return node;
  }
  parseNewOrNewTarget() {
    const node = this.startNode();
    this.next();
    if (this.match(12)) {
      const meta = this.createIdentifier(this.startNodeAtNode(node), "new");
      this.next();
      const metaProp = this.parseMetaProperty(node, meta, "target");
      if (!this.scope.allowNewTarget) {
        this.raise(Errors.UnexpectedNewTarget, metaProp);
      }
      return metaProp;
    }
    return this.parseNew(node);
  }
  parseNew(node) {
    this.parseNewCallee(node);
    if (this.eat(6)) {
      const args = this.parseExprList(7);
      this.toReferencedList(args);
      node.arguments = args;
    } else {
      node.arguments = [];
    }
    return this.finishNode(node, "NewExpression");
  }
  parseNewCallee(node) {
    const callee = this.parseNoCallExpr((base) => {
      this.raise(Errors.ImportCallNotNewExpression, base, base);
    });
    node.callee = callee;
    if (callee.type === "Import") {
      this.raise(Errors.ImportCallNotNewExpression, callee);
    }
    if (callee.type === "Super") {
      this.raise(Errors.SuperCallNotNewExpression, callee);
    }
  }
  parseTemplateElement(isTagged) {
    const {
      start,
      startLoc,
      end,
      value
    } = this.state;
    const elemStart = start + 1;
    const elem = this.startNodeAt(createPositionWithColumnOffset(startLoc, 1));
    if (value === null) {
      if (!isTagged) {
        this.raise(Errors.InvalidEscapeSequenceTemplate, createPositionWithColumnOffset(this.state.firstInvalidTemplateEscapePos, 1));
      }
    }
    const isTail = this.match(20);
    const endOffset = isTail ? -1 : -2;
    const elemEnd = end + endOffset;
    elem.value = {
      raw: this.input.slice(elemStart, elemEnd).replace(/\r\n?/g, "\n"),
      cooked: value === null ? null : value.slice(1, endOffset)
    };
    elem.tail = isTail;
    this.next();
    const finishedNode = this.finishNode(elem, "TemplateElement");
    this.resetEndLocation(finishedNode, createPositionWithColumnOffset(this.state.lastTokEndLoc, endOffset));
    return finishedNode;
  }
  parseTemplate(isTagged) {
    const node = this.startNode();
    let curElt = this.parseTemplateElement(isTagged);
    const quasis = [curElt];
    const substitutions = [];
    while (!curElt.tail) {
      substitutions.push(this.parseTemplateSubstitution());
      this.readTemplateContinuation();
      quasis.push(curElt = this.parseTemplateElement(isTagged));
    }
    node.expressions = substitutions;
    node.quasis = quasis;
    return this.finishNode(node, "TemplateLiteral");
  }
  parseTemplateSubstitution() {
    return this.parseExpression();
  }
  parseObjectLike(close, isPattern, refExpressionErrors) {
    let sawProto = false;
    let first = true;
    const node = this.startNode();
    node.properties = [];
    this.next();
    while (!this.match(close)) {
      if (first) {
        first = false;
      } else {
        this.expect(8);
        if (this.match(close)) {
          this.addTrailingCommaExtraToNode(node);
          break;
        }
      }
      let prop;
      if (isPattern) {
        prop = this.parseBindingProperty();
      } else {
        prop = this.parsePropertyDefinition(refExpressionErrors);
        sawProto = this.checkProto(prop, sawProto, refExpressionErrors);
      }
      node.properties.push(prop);
    }
    this.next();
    const type = isPattern ? "ObjectPattern" : "ObjectExpression";
    return this.finishNode(node, type);
  }
  addTrailingCommaExtraToNode(node) {
    this.addExtra(node, "trailingComma", this.state.lastTokStartLoc.index);
    this.addExtra(node, "trailingCommaLoc", this.state.lastTokStartLoc, false);
  }
  maybeAsyncOrAccessorProp(prop) {
    return !prop.computed && prop.key.type === "Identifier" && (this.isLiteralPropertyName() || this.match(0) || this.match(51));
  }
  parsePropertyDefinition(refExpressionErrors) {
    const decorators = [];
    if (this.match(22)) {
      if (this.hasPlugin("decorators")) {
        this.raise(Errors.UnsupportedPropertyDecorator, this.state.startLoc);
      }
      while (this.match(22)) {
        decorators.push(this.parseDecorator());
      }
    }
    const prop = this.startNode();
    let isAsync = false;
    let isAccessor = false;
    let startLoc;
    if (this.match(17)) {
      if (decorators.length) this.unexpected();
      return this.parseSpread();
    }
    if (decorators.length) {
      prop.decorators = decorators;
    }
    prop.method = false;
    if (refExpressionErrors) {
      startLoc = this.state.startLoc;
    }
    let isGenerator = this.eat(51);
    this.parsePropertyNamePrefixOperator(prop);
    const containsEsc = this.state.containsEsc;
    this.parsePropertyName(prop, refExpressionErrors);
    if (!isGenerator && !containsEsc && this.maybeAsyncOrAccessorProp(prop)) {
      const {
        key
      } = prop;
      const keyName = key.name;
      if (keyName === "async" && !this.hasPrecedingLineBreak()) {
        isAsync = true;
        this.resetPreviousNodeTrailingComments(key);
        isGenerator = this.eat(51);
        this.parsePropertyName(prop);
      }
      if (keyName === "get" || keyName === "set") {
        isAccessor = true;
        this.resetPreviousNodeTrailingComments(key);
        prop.kind = keyName;
        if (this.match(51)) {
          isGenerator = true;
          this.raise(Errors.AccessorIsGenerator, this.state.curPosition(), {
            kind: keyName
          });
          this.next();
        }
        this.parsePropertyName(prop);
      }
    }
    return this.parseObjPropValue(prop, startLoc, isGenerator, isAsync, false, isAccessor, refExpressionErrors);
  }
  getGetterSetterExpectedParamCount(method) {
    return method.kind === "get" ? 0 : 1;
  }
  getObjectOrClassMethodParams(method) {
    return method.params;
  }
  checkGetterSetterParams(method) {
    const paramCount = this.getGetterSetterExpectedParamCount(method);
    const params = this.getObjectOrClassMethodParams(method);
    if (params.length !== paramCount) {
      this.raise(method.kind === "get" ? Errors.BadGetterArity : Errors.BadSetterArity, method);
    }
    if (method.kind === "set" && params[params.length - 1]?.type === "RestElement") {
      this.raise(Errors.BadSetterRestParameter, method);
    }
  }
  parseObjectMethod(prop, isGenerator, isAsync, isPattern, isAccessor) {
    if (isAccessor) {
      const finishedProp = this.parseMethod(prop, isGenerator, false, false, false, "ObjectMethod");
      this.checkGetterSetterParams(finishedProp);
      return finishedProp;
    }
    if (isAsync || isGenerator || this.match(6)) {
      if (isPattern) this.unexpected();
      prop.kind = "method";
      prop.method = true;
      return this.parseMethod(prop, isGenerator, isAsync, false, false, "ObjectMethod");
    }
  }
  parseObjectProperty(prop, startLoc, isPattern, refExpressionErrors) {
    prop.shorthand = false;
    if (this.eat(10)) {
      prop.value = isPattern ? this.parseMaybeDefault(this.state.startLoc) : this.parseMaybeAssignAllowInOrVoidPattern(4, refExpressionErrors);
      return this.finishObjectProperty(prop);
    }
    if (!prop.computed && prop.key.type === "Identifier") {
      this.checkReservedWord(prop.key.name, prop.key.start, true, false);
      if (isPattern) {
        prop.value = this.parseMaybeDefault(startLoc, this.cloneIdentifier(prop.key));
      } else if (this.match(25)) {
        const shorthandAssignLoc = this.state.startLoc;
        if (refExpressionErrors != null) {
          if (refExpressionErrors.shorthandAssignLoc === null) {
            refExpressionErrors.shorthandAssignLoc = shorthandAssignLoc;
          }
        } else {
          this.raise(Errors.InvalidCoverInitializedName, shorthandAssignLoc);
        }
        prop.value = this.parseMaybeDefault(startLoc, this.cloneIdentifier(prop.key));
      } else {
        prop.value = this.cloneIdentifier(prop.key);
      }
      prop.shorthand = true;
      return this.finishObjectProperty(prop);
    }
  }
  finishObjectProperty(node) {
    return this.finishNode(node, "ObjectProperty");
  }
  parseObjPropValue(prop, startLoc, isGenerator, isAsync, isPattern, isAccessor, refExpressionErrors) {
    const node = this.parseObjectMethod(prop, isGenerator, isAsync, isPattern, isAccessor) || this.parseObjectProperty(prop, startLoc, isPattern, refExpressionErrors);
    if (!node) this.unexpected();
    return node;
  }
  parsePropertyName(prop, refExpressionErrors) {
    if (this.eat(0)) {
      prop.computed = true;
      prop.key = this.parseMaybeAssignAllowIn();
      this.expect(1);
    } else {
      const {
        type,
        value
      } = this.state;
      let key;
      if (tokenIsKeywordOrIdentifier(type)) {
        key = this.parseIdentifier(true);
      } else {
        switch (type) {
          case 134:
            key = this.parseNumericLiteral(value);
            break;
          case 133:
            key = this.parseStringLiteral(value);
            break;
          case 135:
            key = this.parseBigIntLiteral(value);
            break;
          case 137: {
            const privateKeyLoc = this.state.startLoc;
            if (refExpressionErrors != null) {
              if (refExpressionErrors.privateKeyLoc === null) {
                refExpressionErrors.privateKeyLoc = privateKeyLoc;
              }
            } else {
              this.raise(Errors.UnexpectedPrivateField, privateKeyLoc);
            }
            key = this.parsePrivateName();
            break;
          }
          default:
            throw this.unexpected();
        }
      }
      prop.key = key;
      if (type !== 137) {
        prop.computed = false;
      }
    }
  }
  initFunction(node, isAsync) {
    node.id = null;
    node.generator = false;
    node.async = isAsync;
  }
  parseMethod(node, isGenerator, isAsync, isConstructor, allowDirectSuper, type, inClassScope = false) {
    this.initFunction(node, isAsync);
    node.generator = isGenerator;
    this.scope.enter(514 | 16 | (inClassScope ? 576 : 0) | (allowDirectSuper ? 32 : 0));
    this.prodParam.enter(functionFlags(isAsync, node.generator));
    this.parseFunctionParams(node, isConstructor);
    const finishedNode = this.parseFunctionBodyAndFinish(node, type, true);
    this.prodParam.exit();
    this.scope.exit();
    return finishedNode;
  }
  parseArrayLike(close, refExpressionErrors) {
    const node = this.startNode();
    this.next();
    node.elements = this.parseExprList(close, true, refExpressionErrors, node);
    return this.finishNode(node, "ArrayExpression");
  }
  parseArrowExpression(node, params, isAsync, trailingCommaLoc) {
    this.scope.enter(514 | 4);
    let flags = functionFlags(isAsync, false);
    const hasBlockBody = this.match(2);
    if (!hasBlockBody) {
      flags |= this.prodParam.currentFlags() & (8 | 16);
    }
    this.prodParam.enter(flags);
    this.initFunction(node, isAsync);
    if (params) {
      this.setArrowFunctionParameters(node, params, trailingCommaLoc);
    }
    this.parseFunctionBody(node, true);
    if (hasBlockBody) {
      this.state.regExpAllowedAt = this.state.lastTokEndLoc.index;
    }
    this.prodParam.exit();
    this.scope.exit();
    return this.finishNode(node, "ArrowFunctionExpression");
  }
  setArrowFunctionParameters(node, params, trailingCommaLoc) {
    this.toAssignableList(params, trailingCommaLoc, false);
    node.params = params;
  }
  parseFunctionBodyAndFinish(node, type, isMethod = false) {
    this.parseFunctionBody(node, false, isMethod);
    return this.finishNode(node, type);
  }
  parseFunctionBody(node, allowExpression, isMethod = false) {
    const isExpression = allowExpression && !this.match(2);
    this.expressionScope.enter(sharedExpressionScope);
    if (isExpression) {
      node.body = this.parseMaybeAssign();
      this.checkParams(node, false, allowExpression, false);
    } else {
      const oldStrict = this.state.strict;
      const oldLabels = this.state.labels;
      this.state.labels = [];
      this.prodParam.enter(this.prodParam.currentFlags() | 4);
      node.body = this.parseBlock(true, false, (hasStrictModeDirective) => {
        const nonSimple = !this.isSimpleParamList(node.params);
        if (hasStrictModeDirective && nonSimple) {
          this.raise(Errors.IllegalLanguageModeDirective, (node.kind === "method" || node.kind === "constructor") && !!node.key ? this.optionFlags & 256 ? node.key.loc.end : node.key : node);
        }
        const strictModeChanged = !oldStrict && this.state.strict;
        this.checkParams(node, !this.state.strict && !allowExpression && !isMethod && !nonSimple, allowExpression, strictModeChanged);
        if (node.id) {
          this.checkStrictBindReservedWord(node.id, 65, strictModeChanged);
        }
      });
      this.prodParam.exit();
      this.state.labels = oldLabels;
    }
    this.expressionScope.exit();
  }
  isSimpleParameter(node) {
    return node.type === "Identifier";
  }
  isSimpleParamList(params) {
    for (let i = 0, len = params.length; i < len; i++) {
      if (!this.isSimpleParameter(params[i])) return false;
    }
    return true;
  }
  checkParams(node, allowDuplicates, isArrowFunction, strictModeChanged = true) {
    const checkClashes = !allowDuplicates && /* @__PURE__ */ new Set();
    const formalParameters = {
      type: "FormalParameters"
    };
    for (const param of node.params) {
      this.checkLVal(param, formalParameters, 5, checkClashes, strictModeChanged);
    }
  }
  parseExprList(close, allowEmpty, refExpressionErrors, nodeForExtra) {
    const elts = [];
    let first = true;
    while (!this.eat(close)) {
      if (first) {
        first = false;
      } else {
        this.expect(8);
        if (this.match(close)) {
          if (nodeForExtra) {
            this.addTrailingCommaExtraToNode(nodeForExtra);
          }
          this.next();
          break;
        }
      }
      elts.push(this.parseExprListItem(close, allowEmpty, refExpressionErrors));
    }
    return elts;
  }
  parseExprListItem(close, allowEmpty, refExpressionErrors, allowPlaceholder) {
    let elt;
    if (this.match(8)) {
      if (!allowEmpty) {
        this.raise(Errors.UnexpectedToken, this.state.curPosition(), {
          unexpected: ","
        });
      }
      elt = null;
    } else if (this.match(17)) {
      const spreadNodeStartLoc = this.state.startLoc;
      elt = this.parseParenItem(this.parseSpread(refExpressionErrors), spreadNodeStartLoc);
    } else if (this.match(13)) {
      this.expectPlugin("partialApplication");
      if (!allowPlaceholder) {
        this.raise(Errors.UnexpectedArgumentPlaceholder, this.state.startLoc);
      }
      const node = this.startNode();
      this.next();
      elt = this.finishNode(node, "ArgumentPlaceholder");
    } else {
      elt = this.parseMaybeAssignAllowInOrVoidPattern(close, refExpressionErrors, true);
    }
    return elt;
  }
  parseIdentifier(liberal) {
    const node = this.startNode();
    const name = this.parseIdentifierName(liberal);
    return this.createIdentifier(node, name);
  }
  createIdentifier(node, name) {
    node.name = name;
    if (this.optionFlags & 256) {
      node.loc.identifierName = name;
    }
    return this.finishNode(node, "Identifier");
  }
  createIdentifierAt(node, name, endLoc) {
    node.name = name;
    if (this.optionFlags & 256) {
      node.loc.identifierName = name;
    }
    return this.finishNodeAt(node, "Identifier", endLoc);
  }
  parseIdentifierName(liberal) {
    let name;
    const {
      start,
      type
    } = this.state;
    if (tokenIsKeywordOrIdentifier(type)) {
      name = this.state.value;
    } else {
      this.unexpected();
    }
    const tokenIsKeyword2 = tokenKeywordOrIdentifierIsKeyword(type);
    if (liberal) {
      if (tokenIsKeyword2) {
        this.replaceToken(131);
      }
    } else {
      this.checkReservedWord(name, this.sourceToOffsetPos(start), tokenIsKeyword2, false);
    }
    this.next();
    return name;
  }
  checkReservedWord(word, startLoc, checkKeywords, isBinding) {
    if (word.length > 10) {
      return;
    }
    if (!canBeReservedWord(word)) {
      return;
    }
    if (checkKeywords && isKeyword(word)) {
      this.raise(Errors.UnexpectedKeyword, startLoc, {
        keyword: word
      });
      return;
    }
    const reservedTest = !this.state.strict ? isReservedWord : isBinding ? isStrictBindReservedWord : isStrictReservedWord;
    if (reservedTest(word, this.inModule)) {
      this.raise(Errors.UnexpectedReservedWord, startLoc, {
        reservedWord: word
      });
      return;
    } else if (word === "yield") {
      if (this.prodParam.hasYield) {
        this.raise(Errors.YieldBindingIdentifier, startLoc);
        return;
      }
    } else if (word === "await") {
      if (this.prodParam.hasAwait) {
        this.raise(Errors.AwaitBindingIdentifier, startLoc);
        return;
      }
      if (this.scope.inStaticBlock) {
        this.raise(Errors.AwaitBindingIdentifierInStaticBlock, startLoc);
        return;
      }
      this.expressionScope.recordAsyncArrowParametersError(startLoc);
    } else if (word === "arguments") {
      if (this.scope.inClassAndNotInNonArrowFunction) {
        this.raise(Errors.ArgumentsInClass, startLoc);
        return;
      }
    }
  }
  recordAwaitIfAllowed() {
    const isAwaitAllowed = this.prodParam.hasAwait;
    if (isAwaitAllowed && !this.scope.inFunction) {
      this.state.hasTopLevelAwait = true;
    }
    return isAwaitAllowed;
  }
  parseAwait(startLoc, soloAwait) {
    const startIndex = startLoc.index;
    const node = this.startNodeAt(startLoc);
    this.expressionScope.recordParameterInitializerError(Errors.AwaitExpressionFormalParameter, startIndex);
    if (this.eat(51)) {
      this.raise(Errors.ObsoleteAwaitStar, startLoc);
    }
    if (!this.scope.inFunction && !(this.optionFlags & 1)) {
      if (this.isAmbiguousPrefixOrIdentifier()) {
        this.ambiguousScriptDifferentAst = true;
      } else {
        this.sawUnambiguousESM = true;
      }
    }
    if (!soloAwait) {
      this.state.canStartArrow = false;
      node.argument = this.parseMaybeUnary(null, true);
    }
    return this.finishNode(node, "AwaitExpression");
  }
  isAmbiguousPrefixOrIdentifier() {
    if (this.hasPrecedingLineBreak()) return true;
    const {
      type
    } = this.state;
    return type === 49 || type === 6 || type === 0 || tokenIsTemplate(type) || type === 99 && !this.state.containsEsc || type === 136 || type === 52 || this.hasPlugin("v8intrinsic") && type === 50;
  }
  parseYield(startLoc) {
    const node = this.startNodeAt(startLoc);
    this.expressionScope.recordParameterInitializerError(Errors.YieldInParameter, startLoc.index);
    let delegating = false;
    let argument = null;
    if (!this.hasPrecedingLineBreak()) {
      delegating = this.eat(51);
      switch (this.state.type) {
        case 9:
        case 138:
        case 4:
        case 7:
        case 1:
        case 5:
        case 10:
        case 8:
          if (!delegating) break;
        case 54:
          if (this.options.annexB && !delegating) break;
        default:
          argument = this.parseMaybeAssign();
      }
    }
    if (!argument) {
      this.state.regExpAllowedAt = this.state.lastTokEndLoc.index;
    }
    node.delegate = delegating;
    node.argument = argument;
    return this.finishNode(node, "YieldExpression");
  }
  parseImportCall(node) {
    this.next();
    const args = this.parseCallExpressionArguments();
    if (args.length === 0 || args.length > 2) {
      this.raise(Errors.ImportCallArity, node, node);
    } else {
      for (const arg of args) {
        if (arg.type === "SpreadElement") {
          this.raise(Errors.ImportCallSpreadArgument, arg, node);
        }
      }
    }
    node.source = args[0];
    node.options = args[1] ?? null;
    return this.finishNode(node, "ImportExpression");
  }
  withTopicBindingContext(callback) {
    const oldInHackPipelineBody = this.state.inHackPipelineBody;
    this.state.inHackPipelineBody = true;
    const oldSeenTopicReference = this.state.seenTopicReference;
    this.state.seenTopicReference = false;
    try {
      return callback();
    } finally {
      this.state.inHackPipelineBody = oldInHackPipelineBody;
      this.state.seenTopicReference = oldSeenTopicReference;
    }
  }
  allowInAnd(callback) {
    const flags = this.prodParam.currentFlags();
    const prodParamToSet = (8 | 16) & ~flags;
    if (prodParamToSet) {
      this.prodParam.enter(flags | 8 | 16);
      try {
        return callback();
      } finally {
        this.prodParam.exit();
      }
    }
    return callback();
  }
  disallowInAnd(callback) {
    const flags = this.prodParam.currentFlags();
    const prodParamToClear = 8 & flags;
    const prodParamToSet = 16 & ~flags;
    if (prodParamToClear || prodParamToSet) {
      this.prodParam.enter(flags & -9 | 16);
      try {
        return callback();
      } finally {
        this.prodParam.exit();
      }
    }
    return callback();
  }
  registerTopicReference() {
    this.state.seenTopicReference = true;
  }
  topicReferenceIsAllowedInCurrentContext() {
    return this.state.inHackPipelineBody;
  }
  topicReferenceWasUsedInCurrentContext() {
    return this.state.seenTopicReference;
  }
  parseFSharpPipelineBody(prec) {
    const startLoc = this.state.startLoc;
    this.prodParam.enter(this.prodParam.currentFlags() & -17);
    let ret;
    if (this.isContextual(93) && this.recordAwaitIfAllowed()) {
      this.next();
      ret = this.parseAwait(startLoc, true);
      const nextOp = this.state.type;
      if (nextOp !== 35 && this.isBinaryOperator(nextOp)) {
        this.raise(Errors.PipelineUnparenthesized, startLoc);
      }
    } else {
      this.state.canStartArrow = true;
      ret = this.parseExprOp(this.parseMaybeUnaryOrPrivate(), startLoc, prec);
    }
    this.prodParam.exit();
    return ret;
  }
  parseModuleExpression() {
    this.expectPlugin("moduleBlocks");
    const node = this.startNode();
    this.next();
    if (!this.match(2)) {
      this.unexpected(null, 2);
    }
    const program = this.startNodeAt(this.state.endLoc);
    this.next();
    const revertScopes = this.initializeScopes(true);
    this.enterInitialScopes();
    try {
      node.body = this.parseProgram(program, 4, "module");
    } finally {
      revertScopes();
    }
    return this.finishNode(node, "ModuleExpression");
  }
  parseVoidPattern(refExpressionErrors) {
    this.expectPlugin("discardBinding");
    const node = this.startNode();
    if (refExpressionErrors != null) {
      refExpressionErrors.voidPatternLoc = this.state.startLoc;
    }
    this.next();
    return this.finishNode(node, "VoidPattern");
  }
  parseMaybeAssignAllowInOrVoidPattern(close, refExpressionErrors, isParenItem) {
    if (refExpressionErrors != null && this.match(84)) {
      const nextCode = this.lookaheadCharCode();
      if (nextCode === 44 || nextCode === (close === 1 ? 93 : close === 4 ? 125 : 41) || nextCode === 61) {
        return this.parseMaybeDefault(this.state.startLoc, this.parseVoidPattern(refExpressionErrors));
      }
    }
    return this.parseMaybeAssignAllowIn(refExpressionErrors, isParenItem);
  }
  parsePropertyNamePrefixOperator(prop) {
  }
};
var loopLabel = {
  kind: 1
};
var switchLabel = {
  kind: 2
};
var loneSurrogate = /[\uD800-\uDFFF]/u;
var keywordRelationalOperator = /in(?:stanceof)?/y;
var keywordLikeWord = /[a-z]{2,10}/y;
function createExportedTokens(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const {
      type
    } = token;
    if (typeof type === "number") {
      token.type = getExportedToken(type);
    }
  }
  return tokens;
}
var StatementParser = class extends ExpressionParser {
  parseTopLevel(file, program) {
    file.program = this.parseProgram(program, 138, this.options.sourceType === "module" ? "module" : "script");
    file.comments = this.comments;
    if (this.optionFlags & 512) {
      file.tokens = createExportedTokens(this.tokens);
    }
    return this.finishNode(file, "File");
  }
  parseProgram(program, end, sourceType) {
    program.sourceType = sourceType;
    program.interpreter = this.parseInterpreterDirective();
    this.parseBlockBody(program, true, true, end);
    if (this.inModule) {
      if (!(this.optionFlags & 64) && this.scope.undefinedExports.size > 0) {
        for (const [localName, at] of Array.from(this.scope.undefinedExports)) {
          this.raise(Errors.ModuleExportUndefined, at, {
            localName
          });
        }
      }
      this.addExtra(program, "topLevelAwait", this.state.hasTopLevelAwait);
    }
    let finishedProgram;
    if (end === 138) {
      finishedProgram = this.finishNode(program, "Program");
    } else {
      finishedProgram = this.finishNodeAt(program, "Program", createPositionWithColumnOffset(this.state.startLoc, -1));
    }
    return finishedProgram;
  }
  stmtToDirective(stmt) {
    const directive = this.castNodeTo(stmt, "Directive");
    const directiveLiteral = this.castNodeTo(stmt.expression, "DirectiveLiteral");
    const expressionValue = directiveLiteral.value;
    const raw = this.input.slice(this.offsetToSourcePos(directiveLiteral.start), this.offsetToSourcePos(directiveLiteral.end));
    const val = directiveLiteral.value = raw.slice(1, -1);
    this.addExtra(directiveLiteral, "raw", raw);
    this.addExtra(directiveLiteral, "rawValue", val);
    this.addExtra(directiveLiteral, "expressionValue", expressionValue);
    directive.value = directiveLiteral;
    delete stmt.expression;
    return directive;
  }
  parseInterpreterDirective() {
    if (!this.match(24)) {
      return null;
    }
    const node = this.startNode();
    node.value = this.state.value;
    this.next();
    return this.finishNode(node, "InterpreterDirective");
  }
  isLet() {
    if (!this.isContextual(97)) {
      return false;
    }
    return this.hasFollowingBindingAtom();
  }
  isUsing() {
    if (!this.isContextual(106)) {
      return false;
    }
    return this.nextTokenIsIdentifierOnSameLine();
  }
  isForUsing() {
    if (!this.isContextual(106)) {
      return false;
    }
    const next = this.nextTokenInLineStart();
    const nextCh = this.codePointAtPos(next);
    if (this.isUnparsedContextual(next, "of")) {
      const nextCharAfterOf = this.lookaheadCharCodeSince(next + 2);
      if (nextCharAfterOf !== 61 && nextCharAfterOf !== 58 && nextCharAfterOf !== 59) {
        return false;
      }
    }
    if (this.chStartsBindingIdentifier(nextCh, next) || this.isUnparsedContextual(next, "void")) {
      return true;
    }
    return false;
  }
  nextTokenIsIdentifierOnSameLine() {
    const next = this.nextTokenInLineStart();
    const nextCh = this.codePointAtPos(next);
    return this.chStartsBindingIdentifier(nextCh, next);
  }
  isAwaitUsing() {
    if (!this.isContextual(93)) {
      return false;
    }
    let next = this.nextTokenInLineStart();
    if (this.isUnparsedContextual(next, "using")) {
      next = this.nextTokenInLineStartSince(next + 5);
      const nextCh = this.codePointAtPos(next);
      if (this.chStartsBindingIdentifier(nextCh, next)) {
        return true;
      }
    }
    return false;
  }
  chStartsBindingIdentifier(ch, pos) {
    if (isIdentifierStart(ch)) {
      keywordRelationalOperator.lastIndex = pos;
      if (keywordRelationalOperator.test(this.input)) {
        const endCh = this.codePointAtPos(keywordRelationalOperator.lastIndex);
        if (!isIdentifierChar(endCh) && endCh !== 92) {
          return false;
        }
      }
      return true;
    } else if (ch === 92) {
      return true;
    } else {
      return false;
    }
  }
  isReservedWordOnNewLineAfterLet(pos) {
    if (!hasNewLine(this.input, this.state.end, pos)) {
      return false;
    }
    keywordLikeWord.lastIndex = pos;
    if (!keywordLikeWord.test(this.input)) {
      return false;
    }
    const end = keywordLikeWord.lastIndex;
    const endCh = this.codePointAtPos(end);
    if (isIdentifierChar(endCh) || endCh === 92) {
      return false;
    }
    const word = this.input.slice(pos, end);
    return isKeyword(word) || isReservedWord(word, false);
  }
  chStartsBindingPattern(ch) {
    return ch === 91 || ch === 123;
  }
  hasFollowingBindingAtom() {
    const next = this.nextTokenStart();
    const nextCh = this.codePointAtPos(next);
    return this.chStartsBindingPattern(nextCh) || this.chStartsBindingIdentifier(nextCh, next);
  }
  hasInLineFollowingBindingIdentifierOrBrace() {
    const next = this.nextTokenInLineStart();
    const nextCh = this.codePointAtPos(next);
    return nextCh === 123 || this.chStartsBindingIdentifier(nextCh, next);
  }
  allowsUsing() {
    return (this.scope.inModule || !this.scope.inTopLevel) && !this.scope.inBareCaseStatement;
  }
  parseModuleItem() {
    return this.parseStatementLike(1 | 2 | 4 | 8);
  }
  parseStatementListItem() {
    return this.parseStatementLike(2 | 4 | (!this.options.annexB || this.state.strict ? 0 : 8));
  }
  parseStatementOrSloppyAnnexBFunctionDeclaration(allowLabeledFunction = false) {
    let flags = 0;
    if (this.options.annexB && !this.state.strict) {
      flags |= 4;
      if (allowLabeledFunction) {
        flags |= 8;
      }
    }
    return this.parseStatementLike(flags);
  }
  parseStatement() {
    return this.parseStatementLike(0);
  }
  parseStatementLike(flags) {
    let decorators = null;
    if (this.match(22)) {
      decorators = this.parseDecorators(true);
    }
    return this.parseStatementContent(flags, decorators);
  }
  parseStatementContent(flags, decorators) {
    const startType = this.state.type;
    const node = this.startNode();
    const allowDeclaration = !!(flags & 2);
    const allowFunctionDeclaration = !!(flags & 4);
    const topLevel = flags & 1;
    switch (startType) {
      case 56:
        return this.parseBreakContinueStatement(node, true);
      case 59:
        return this.parseBreakContinueStatement(node, false);
      case 60:
        return this.parseDebuggerStatement(node);
      case 86:
        return this.parseDoWhileStatement(node);
      case 87:
        return this.parseForStatement(node);
      case 64:
        if (this.lookaheadCharCode() === 46) break;
        if (!allowFunctionDeclaration) {
          this.raise(this.state.strict ? Errors.StrictFunction : this.options.annexB ? Errors.SloppyFunctionAnnexB : Errors.SloppyFunction, this.state.startLoc);
        }
        return this.parseFunctionStatement(node, false, flags);
      case 76:
        if (!allowDeclaration) this.unexpected();
        return this.parseClass(this.maybeTakeDecorators(decorators, node), true);
      case 104:
        if (!this.state.containsEsc && this.nextTokenIsIdentifierOnSameLine()) {
          this.expectPlugin("structs");
          if (!allowDeclaration) this.unexpected();
          return this.parseStructDeclaration(node, false);
        }
        break;
      case 65:
        return this.parseIfStatement(node);
      case 66:
        return this.parseReturnStatement(node);
      case 67:
        return this.parseSwitchStatement(node);
      case 68:
        return this.parseThrowStatement(node);
      case 69:
        return this.parseTryStatement(node);
      case 93:
        if (this.isAwaitUsing()) {
          if (!this.allowsUsing()) {
            this.raise(Errors.UnexpectedUsingDeclaration, node);
          } else if (!allowDeclaration) {
            this.raise(Errors.UnexpectedLexicalDeclaration, node);
          } else if (!this.recordAwaitIfAllowed()) {
            this.raise(Errors.AwaitUsingNotInAsyncContext, node);
          }
          this.next();
          return this.parseVarStatement(node, "await using");
        }
        break;
      case 106:
        if (this.state.containsEsc || !this.hasInLineFollowingBindingIdentifierOrBrace()) {
          break;
        }
        if (!this.allowsUsing()) {
          this.raise(Errors.UnexpectedUsingDeclaration, this.state.startLoc);
        } else if (!allowDeclaration) {
          this.raise(Errors.UnexpectedLexicalDeclaration, this.state.startLoc);
        }
        return this.parseVarStatement(node, "using");
      case 97: {
        if (this.state.containsEsc) {
          break;
        }
        const next = this.nextTokenStart();
        const nextCh = this.codePointAtPos(next);
        if (nextCh !== 91) {
          if (!allowDeclaration && this.hasFollowingLineBreak()) break;
          if (!this.chStartsBindingIdentifier(nextCh, next) && nextCh !== 123) {
            break;
          }
          if (this.isReservedWordOnNewLineAfterLet(next)) break;
        }
      }
      case 71: {
        if (!allowDeclaration) {
          this.raise(Errors.UnexpectedLexicalDeclaration, this.state.startLoc);
        }
      }
      case 70: {
        const kind = this.state.value;
        return this.parseVarStatement(node, kind);
      }
      case 88:
        return this.parseWhileStatement(node);
      case 72:
        return this.parseWithStatement(node);
      case 2:
        return this.parseBlock();
      case 9:
        return this.parseEmptyStatement(node);
      case 79: {
        const nextTokenCharCode = this.lookaheadCharCode();
        if (nextTokenCharCode === 40 || nextTokenCharCode === 46) {
          break;
        }
      }
      case 78: {
        if (!(this.optionFlags & 8) && !topLevel) {
          this.raise(Errors.UnexpectedImportExport, this.state.startLoc);
        }
        this.next();
        let result;
        if (startType === 79) {
          result = this.parseImport(node);
        } else {
          result = this.parseExport(node, decorators);
        }
        this.assertModuleNodeAllowed(result);
        return result;
      }
      default: {
        if (this.isAsyncFunction()) {
          if (!allowDeclaration) {
            this.raise(Errors.AsyncFunctionInSingleStatementContext, this.state.startLoc);
          }
          this.next();
          return this.parseFunctionStatement(node, true, flags);
        }
      }
    }
    const maybeName = this.state.value;
    if (startType === 89 && this.lookahead().type === 10) {
      const label = this.parseIdentifier(true);
      this.next();
      return this.parseLabeledStatement(node, maybeName, label, flags);
    }
    const expr = this.parseExpression();
    if (tokenIsIdentifier(startType) && expr.type === "Identifier" && this.eat(10)) {
      return this.parseLabeledStatement(node, maybeName, expr, flags);
    } else {
      return this.parseExpressionStatement(node, expr, flags);
    }
  }
  assertModuleNodeAllowed(node) {
    if (!(this.optionFlags & 8) && !this.inModule) {
      this.raise(Errors.ImportOutsideModule, node);
    }
  }
  maybeTakeDecorators(maybeDecorators, classNode, exportNode) {
    if (maybeDecorators) {
      if (classNode.decorators?.length) {
        this.raise(Errors.DecoratorsBeforeAfterExport, classNode.decorators[0]);
        classNode.decorators.unshift(...maybeDecorators);
      } else {
        classNode.decorators = maybeDecorators;
      }
      this.resetStartLocationFromNode(classNode, maybeDecorators[0]);
      if (exportNode) this.resetStartLocationFromNode(exportNode, classNode);
    }
    return classNode;
  }
  canHaveLeadingDecorator() {
    return this.match(76);
  }
  parseDecorators(allowExport) {
    const decorators = [];
    do {
      decorators.push(this.parseDecorator());
    } while (this.match(22));
    if (this.match(78)) {
      if (!allowExport) {
        this.unexpected();
      }
    } else if (!this.canHaveLeadingDecorator()) {
      throw this.raise(Errors.UnexpectedLeadingDecorator, this.state.startLoc);
    }
    return decorators;
  }
  parseDecorator() {
    this.expectOnePlugin(["decorators", "decorators-legacy"]);
    const node = this.startNode();
    this.next();
    if (this.hasPlugin("decorators")) {
      const startLoc = this.state.startLoc;
      let expr;
      if (this.match(6)) {
        const startLoc2 = this.state.startLoc;
        this.next();
        expr = this.parseExpression();
        this.expect(7);
        expr = this.wrapParenthesis(startLoc2, expr);
        const paramsStartLoc = this.state.startLoc;
        node.expression = this.parseMaybeDecoratorArguments(expr, startLoc2);
        if (node.expression !== expr) {
          this.raise(Errors.DecoratorArgumentsOutsideParentheses, paramsStartLoc);
        }
      } else {
        expr = this.parseIdentifier(false);
        while (this.eat(12)) {
          const node2 = this.startNodeAt(startLoc);
          node2.object = expr;
          if (this.match(137)) {
            this.classScope.usePrivateName(this.state.value, this.state.startLoc);
            node2.property = this.parsePrivateName();
          } else {
            node2.property = this.parseIdentifier(true);
          }
          node2.computed = false;
          expr = this.finishNode(node2, "MemberExpression");
        }
        node.expression = this.parseMaybeDecoratorArguments(expr, startLoc);
      }
    } else {
      this.state.canStartArrow = false;
      node.expression = this.parseExprSubscripts();
    }
    return this.finishNode(node, "Decorator");
  }
  parseMaybeDecoratorArguments(expr, startLoc) {
    if (this.eat(6)) {
      const node = this.startNodeAt(startLoc);
      node.callee = expr;
      node.arguments = this.parseCallExpressionArguments();
      this.toReferencedList(node.arguments);
      return this.finishNode(node, "CallExpression");
    }
    return expr;
  }
  parseBreakContinueStatement(node, isBreak) {
    this.next();
    if (this.isLineTerminator()) {
      node.label = null;
    } else {
      node.label = this.parseIdentifier(this.match(89));
      this.semicolon();
    }
    this.verifyBreakContinue(node, isBreak);
    return this.finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement");
  }
  verifyBreakContinue(node, isBreak) {
    let i;
    for (i = 0; i < this.state.labels.length; ++i) {
      const lab = this.state.labels[i];
      if (node.label == null || lab.name === node.label.name) {
        if (lab.kind != null && (isBreak || lab.kind === 1)) {
          break;
        }
        if (node.label && isBreak) break;
      }
    }
    if (i === this.state.labels.length) {
      const type = isBreak ? "BreakStatement" : "ContinueStatement";
      this.raise(Errors.IllegalBreakContinue, node, {
        type
      });
    }
  }
  parseDebuggerStatement(node) {
    this.next();
    this.semicolon();
    return this.finishNode(node, "DebuggerStatement");
  }
  parseHeaderExpression() {
    this.expect(6);
    const val = this.parseExpression();
    this.expect(7);
    return val;
  }
  parseDoWhileStatement(node) {
    this.next();
    this.state.labels.push(loopLabel);
    node.body = this.parseStatement();
    this.state.labels.pop();
    this.expect(88);
    node.test = this.parseHeaderExpression();
    this.eat(9);
    return this.finishNode(node, "DoWhileStatement");
  }
  parseForStatement(node) {
    this.next();
    this.state.labels.push(loopLabel);
    let awaitAt = null;
    if (this.isContextual(93) && this.recordAwaitIfAllowed()) {
      awaitAt = this.state.startLoc;
      this.next();
    }
    this.scope.enter(0);
    this.expect(6);
    if (this.match(9)) {
      if (awaitAt !== null) {
        this.unexpected(awaitAt);
      }
      return this.parseFor(node, null);
    }
    const startsWithLet = this.isContextual(97);
    {
      const startsWithAwaitUsing = this.isAwaitUsing();
      const starsWithUsingDeclaration = startsWithAwaitUsing || this.isForUsing();
      const isLetOrUsing = startsWithLet && this.hasFollowingBindingAtom() || starsWithUsingDeclaration;
      if (this.match(70) || this.match(71) || isLetOrUsing) {
        const initNode = this.startNode();
        let kind;
        if (startsWithAwaitUsing) {
          kind = "await using";
          if (!this.recordAwaitIfAllowed()) {
            this.raise(Errors.AwaitUsingNotInAsyncContext, this.state.startLoc);
          }
          this.next();
        } else {
          kind = this.state.value;
        }
        this.next();
        this.parseVar(initNode, true, kind);
        const init2 = this.finishNode(initNode, "VariableDeclaration");
        const isForIn = this.match(54);
        if (isForIn && starsWithUsingDeclaration) {
          this.raise(Errors.ForInUsing, init2);
        }
        if ((isForIn || this.isContextual(99)) && init2.declarations.length === 1) {
          return this.parseForX(node, init2, awaitAt);
        }
        if (awaitAt !== null) {
          this.unexpected(awaitAt);
        }
        return this.parseFor(node, init2);
      }
    }
    const startsWithAsync = this.isContextual(92);
    const refExpressionErrors = new ExpressionErrors();
    const init = this.parseExpression(true, refExpressionErrors);
    const isForOf = this.isContextual(99);
    if (isForOf) {
      if (startsWithLet) {
        this.raise(Errors.ForOfLet, init);
      }
      if (awaitAt === null && startsWithAsync && init.type === "Identifier") {
        this.raise(Errors.ForOfAsync, init);
      }
    }
    if (isForOf || this.match(54)) {
      this.checkDestructuringPrivate(refExpressionErrors);
      this.toAssignable(init, true);
      const type = isForOf ? "ForOfStatement" : "ForInStatement";
      this.checkLVal(init, {
        type
      });
      return this.parseForX(node, init, awaitAt);
    } else {
      this.checkExpressionErrors(refExpressionErrors, true);
    }
    if (awaitAt !== null) {
      this.unexpected(awaitAt);
    }
    return this.parseFor(node, init);
  }
  parseFunctionStatement(node, isAsync, statementFlags) {
    this.next();
    let flags = 1 | (isAsync ? 8 : 0);
    if (!(statementFlags & 2) && statementFlags & 4) {
      flags |= 16;
      if (!(statementFlags & 8)) {
        flags |= 2;
      }
    }
    return this.parseFunction(node, flags);
  }
  parseIfStatement(node) {
    this.next();
    node.test = this.parseHeaderExpression();
    node.consequent = this.parseStatementOrSloppyAnnexBFunctionDeclaration();
    node.alternate = this.eat(62) ? this.parseStatementOrSloppyAnnexBFunctionDeclaration() : null;
    return this.finishNode(node, "IfStatement");
  }
  parseReturnStatement(node) {
    if (!this.prodParam.hasReturn) {
      this.raise(Errors.IllegalReturn, this.state.startLoc);
    }
    this.next();
    if (this.isLineTerminator()) {
      node.argument = null;
    } else {
      node.argument = this.parseExpression();
      this.semicolon();
    }
    return this.finishNode(node, "ReturnStatement");
  }
  parseSwitchStatement(node) {
    this.next();
    node.discriminant = this.parseHeaderExpression();
    const cases = node.cases = [];
    this.expect(2);
    this.state.labels.push(switchLabel);
    this.scope.enter(256);
    let cur;
    for (let sawDefault; !this.match(4); ) {
      if (this.match(57) || this.match(61)) {
        const isCase = this.match(57);
        if (cur) this.finishNode(cur, "SwitchCase");
        cases.push(cur = this.startNode());
        cur.consequent = [];
        this.next();
        if (isCase) {
          cur.test = this.parseExpression();
        } else {
          if (sawDefault) {
            this.raise(Errors.MultipleDefaultsInSwitch, this.state.lastTokStartLoc);
          }
          sawDefault = true;
          cur.test = null;
        }
        this.expect(10);
      } else {
        if (cur) {
          cur.consequent.push(this.parseStatementListItem());
        } else {
          this.unexpected();
        }
      }
    }
    this.scope.exit();
    if (cur) this.finishNode(cur, "SwitchCase");
    this.next();
    this.state.labels.pop();
    return this.finishNode(node, "SwitchStatement");
  }
  parseThrowStatement(node) {
    this.next();
    if (this.hasPrecedingLineBreak()) {
      this.raise(Errors.NewlineAfterThrow, this.state.lastTokEndLoc);
    }
    node.argument = this.parseExpression();
    this.semicolon();
    return this.finishNode(node, "ThrowStatement");
  }
  parseCatchClauseParam() {
    const param = this.parseBindingAtom();
    this.scope.enter(this.options.annexB && param.type === "Identifier" ? 8 : 0);
    this.checkLVal(param, {
      type: "CatchClause"
    }, 9);
    return param;
  }
  parseTryStatement(node) {
    this.next();
    node.block = this.parseBlock();
    node.handler = null;
    if (this.match(58)) {
      const clause = this.startNode();
      this.next();
      if (this.match(6)) {
        this.expect(6);
        clause.param = this.parseCatchClauseParam();
        this.expect(7);
      } else {
        clause.param = null;
        this.scope.enter(0);
      }
      clause.body = this.parseBlock(false, false);
      this.scope.exit();
      node.handler = this.finishNode(clause, "CatchClause");
    }
    node.finalizer = this.eat(63) ? this.parseBlock() : null;
    if (!node.handler && !node.finalizer) {
      this.raise(Errors.NoCatchOrFinally, node);
    }
    return this.finishNode(node, "TryStatement");
  }
  parseVarStatement(node, kind, allowMissingInitializer = false) {
    this.next();
    this.parseVar(node, false, kind, allowMissingInitializer);
    this.semicolon();
    return this.finishNode(node, "VariableDeclaration");
  }
  parseWhileStatement(node) {
    this.next();
    node.test = this.parseHeaderExpression();
    this.state.labels.push(loopLabel);
    node.body = this.parseStatement();
    this.state.labels.pop();
    return this.finishNode(node, "WhileStatement");
  }
  parseWithStatement(node) {
    if (this.state.strict) {
      this.raise(Errors.StrictWith, this.state.startLoc);
    }
    this.next();
    node.object = this.parseHeaderExpression();
    node.body = this.parseStatement();
    return this.finishNode(node, "WithStatement");
  }
  parseEmptyStatement(node) {
    this.next();
    return this.finishNode(node, "EmptyStatement");
  }
  parseLabeledStatement(node, maybeName, expr, flags) {
    for (const label of this.state.labels) {
      if (label.name === maybeName) {
        this.raise(Errors.LabelRedeclaration, expr, {
          labelName: maybeName
        });
      }
    }
    const kind = tokenIsLoop(this.state.type) ? 1 : this.match(67) ? 2 : null;
    for (let i = this.state.labels.length - 1; i >= 0; i--) {
      const label = this.state.labels[i];
      if (label.statementStart === node.start) {
        label.statementStart = this.sourceToOffsetPos(this.state.start);
        label.kind = kind;
      } else {
        break;
      }
    }
    this.state.labels.push({
      name: maybeName,
      kind,
      statementStart: this.sourceToOffsetPos(this.state.start)
    });
    node.body = flags & 8 ? this.parseStatementOrSloppyAnnexBFunctionDeclaration(true) : this.parseStatement();
    this.state.labels.pop();
    node.label = expr;
    return this.finishNode(node, "LabeledStatement");
  }
  parseExpressionStatement(node, expr, _flags) {
    node.expression = expr;
    this.semicolon();
    return this.finishNode(node, "ExpressionStatement");
  }
  parseBlock(allowDirectives = false, createNewLexicalScope = true, afterBlockParse) {
    const node = this.startNode();
    if (allowDirectives) {
      this.state.strictErrors.clear();
    }
    this.expect(2);
    if (createNewLexicalScope) {
      this.scope.enter(0);
    }
    this.parseBlockBody(node, allowDirectives, false, 4, afterBlockParse);
    if (createNewLexicalScope) {
      this.scope.exit();
    }
    return this.finishNode(node, "BlockStatement");
  }
  isValidDirective(stmt) {
    return stmt.type === "ExpressionStatement" && stmt.expression.type === "StringLiteral" && !stmt.expression.extra.parenthesized;
  }
  parseBlockBody(node, allowDirectives, topLevel, end, afterBlockParse) {
    const body = node.body = [];
    const directives = node.directives = [];
    this.parseBlockOrModuleBlockBody(body, allowDirectives ? directives : void 0, topLevel, end, afterBlockParse);
  }
  parseBlockOrModuleBlockBody(body, directives, topLevel, end, afterBlockParse) {
    const oldStrict = this.state.strict;
    let hasStrictModeDirective = false;
    let parsedNonDirective = false;
    while (!this.match(end)) {
      const stmt = topLevel ? this.parseModuleItem() : this.parseStatementListItem();
      if (directives && !parsedNonDirective) {
        if (this.isValidDirective(stmt)) {
          const directive = this.stmtToDirective(stmt);
          directives.push(directive);
          if (!hasStrictModeDirective && directive.value.value === "use strict") {
            hasStrictModeDirective = true;
            this.setStrict(true);
          }
          continue;
        }
        parsedNonDirective = true;
        this.state.strictErrors.clear();
      }
      body.push(stmt);
    }
    afterBlockParse?.call(this, hasStrictModeDirective);
    if (!oldStrict) {
      this.setStrict(false);
    }
    this.next();
  }
  parseFor(node, init) {
    node.init = init;
    this.semicolon(false);
    node.test = this.match(9) ? null : this.parseExpression();
    this.semicolon(false);
    node.update = this.match(7) ? null : this.parseExpression();
    this.expect(7);
    node.body = this.parseStatement();
    this.scope.exit();
    this.state.labels.pop();
    return this.finishNode(node, "ForStatement");
  }
  parseForX(node, init, awaitAt) {
    const isForIn = this.match(54);
    this.next();
    if (isForIn) {
      if (awaitAt !== null) this.unexpected(awaitAt);
    } else {
      node.await = awaitAt !== null;
    }
    if (init.type === "VariableDeclaration" && init.declarations[0].init != null && (!isForIn || !this.options.annexB || this.state.strict || init.kind !== "var" || init.declarations[0].id.type !== "Identifier")) {
      this.raise(Errors.ForInOfLoopInitializer, init, {
        type: isForIn ? "ForInStatement" : "ForOfStatement"
      });
    }
    if (init.type === "AssignmentPattern") {
      this.raise(Errors.InvalidLhs, init, {
        ancestor: {
          type: "ForStatement"
        }
      });
    }
    node.left = init;
    node.right = isForIn ? this.parseExpression() : this.parseMaybeAssignAllowIn();
    this.expect(7);
    node.body = this.parseStatement();
    this.scope.exit();
    this.state.labels.pop();
    return this.finishNode(node, isForIn ? "ForInStatement" : "ForOfStatement");
  }
  parseVar(node, isFor, kind, allowMissingInitializer = false) {
    const declarations = node.declarations = [];
    node.kind = kind;
    for (; ; ) {
      const decl = this.startNode();
      this.parseVarId(decl, kind);
      decl.init = !this.eat(25) ? null : isFor ? this.parseMaybeAssignDisallowIn() : this.parseMaybeAssignAllowIn();
      if (decl.init === null && !allowMissingInitializer && !(isFor && declarations.length === 0 && (this.match(54) || this.isContextual(99)))) {
        if (decl.id.type !== "Identifier") {
          this.raise(Errors.DeclarationMissingInitializer, this.state.lastTokEndLoc, {
            kind: "destructuring"
          });
        } else if (kind === "const" || kind === "using" || kind === "await using") {
          this.raise(Errors.DeclarationMissingInitializer, this.state.lastTokEndLoc, {
            kind
          });
        }
      }
      declarations.push(this.finishNode(decl, "VariableDeclarator"));
      if (!this.eat(8)) break;
    }
    return node;
  }
  parseVarId(decl, kind) {
    const id = this.parseBindingAtom();
    if (kind === "using" || kind === "await using") {
      if (id.type === "ArrayPattern" || id.type === "ObjectPattern") {
        this.raise(Errors.UsingDeclarationHasBindingPattern, id);
      }
    } else {
      if (id.type === "VoidPattern") {
        this.raise(Errors.UnexpectedVoidPattern, id);
      }
    }
    this.checkLVal(id, {
      type: "VariableDeclarator"
    }, kind === "var" ? 5 : 8201);
    decl.id = id;
  }
  parseAsyncFunctionExpression(node) {
    return this.parseFunction(node, 8);
  }
  parseFunction(node, flags = 0) {
    const isDeclaration = !!(flags & 1);
    const requireId = isDeclaration && !(flags & 4);
    const isAsync = !!(flags & 8);
    this.initFunction(node, isAsync);
    if (this.match(51)) {
      if (flags & 16) {
        this.raise(Errors.GeneratorInSingleStatementContext, this.state.startLoc);
      }
      this.next();
      node.generator = true;
    }
    if (isDeclaration) {
      node.id = this.parseFunctionId(requireId);
    }
    this.scope.enter(514);
    this.prodParam.enter(functionFlags(isAsync, node.generator));
    if (!isDeclaration && tokenIsIdentifier(this.state.type)) {
      this.expressionScope.enter(sharedExpressionScope);
      node.id = this.parseFunctionId();
      this.expressionScope.exit();
    }
    this.parseFunctionParams(node, false);
    this.parseFunctionBodyAndFinish(node, isDeclaration ? "FunctionDeclaration" : "FunctionExpression");
    this.prodParam.exit();
    this.scope.exit();
    if (isDeclaration && !(flags & 2)) {
      this.registerFunctionStatementId(node);
    }
    return node;
  }
  parseFunctionId(requireId) {
    return requireId || tokenIsIdentifier(this.state.type) ? this.parseIdentifier() : null;
  }
  parseFunctionParams(node, isConstructor) {
    this.expect(6);
    this.expressionScope.enter(parameterDeclarationScope);
    node.params = this.parseBindingList(7, 41, 2 | (isConstructor ? 4 : 0));
    this.expressionScope.exit();
  }
  registerFunctionStatementId(node) {
    if (!node.id) return;
    this.scope.declareName(node.id.name, !this.options.annexB || this.state.strict || node.generator || node.async ? this.scope.treatFunctionsAsVar ? 5 : 8201 : 17, node.id.start);
  }
  parseClass(node, isStatement, optionalId) {
    this.next();
    const oldStrict = this.state.strict;
    this.state.strict = true;
    this.parseClassId(node, isStatement, optionalId);
    this.parseClassSuper(node);
    node.body = this.parseClassBody(!!node.superClass, oldStrict);
    return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression");
  }
  isClassProperty() {
    return this.match(25) || this.match(9) || this.match(4);
  }
  isClassMethod() {
    return this.match(6);
  }
  nameIsConstructor(key) {
    return key.type === "Identifier" && key.name === "constructor" || key.type === "StringLiteral" && key.value === "constructor";
  }
  isNonstaticConstructor(method) {
    return !method.computed && !method.static && this.nameIsConstructor(method.key);
  }
  parseClassBody(hadSuperClass, oldStrict) {
    this.classScope.enter();
    const state = {
      hadConstructor: false,
      hadSuperClass
    };
    let decorators = [];
    const classBody = this.startNode();
    classBody.body = [];
    this.expect(2);
    while (!this.match(4)) {
      if (this.eat(9)) {
        if (decorators.length > 0) {
          throw this.raise(Errors.DecoratorSemicolon, this.state.lastTokEndLoc);
        }
        continue;
      }
      if (this.match(22)) {
        decorators.push(this.parseDecorator());
        continue;
      }
      const member = this.startNode();
      if (decorators.length) {
        member.decorators = decorators;
        this.resetStartLocationFromNode(member, decorators[0]);
        decorators = [];
      }
      this.parseClassMember(classBody, member, state);
    }
    this.state.strict = oldStrict;
    this.next();
    if (decorators.length) {
      throw this.raise(Errors.TrailingDecorator, this.state.startLoc);
    }
    this.classScope.exit();
    return this.finishNode(classBody, "ClassBody");
  }
  parseClassMemberFromModifier(classBody, member) {
    const key = this.parseIdentifier(true);
    if (this.isClassMethod()) {
      const method = member;
      method.kind = "method";
      method.computed = false;
      method.key = key;
      method.static = false;
      this.pushClassMethod(classBody, method, false, false, false, false);
      return true;
    } else if (this.isClassProperty()) {
      const prop = member;
      prop.computed = false;
      prop.key = key;
      prop.static = false;
      classBody.body.push(this.parseClassProperty(prop));
      return true;
    }
    this.resetPreviousNodeTrailingComments(key);
    return false;
  }
  parseClassMember(classBody, member, state) {
    const isStatic = this.isContextual(103);
    if (isStatic) {
      if (this.parseClassMemberFromModifier(classBody, member)) {
        return;
      }
      if (this.eat(2)) {
        this.parseClassStaticBlock(classBody, member);
        return;
      }
    }
    this.parseClassMemberWithIsStatic(classBody, member, state, isStatic);
  }
  parseClassMemberWithIsStatic(classBody, member, state, isStatic) {
    const publicMethod = member;
    const privateMethod = member;
    const publicProp = member;
    const privateProp = member;
    const accessorProp = member;
    const method = publicMethod;
    const publicMember = publicMethod;
    member.static = isStatic;
    this.parsePropertyNamePrefixOperator(member);
    if (this.eat(51)) {
      method.kind = "method";
      const isPrivateName = this.match(137);
      this.parseClassElementName(method);
      this.parsePostMemberNameModifiers(method);
      if (isPrivateName) {
        this.pushClassPrivateMethod(classBody, privateMethod, true, false);
        return;
      }
      if (this.isNonstaticConstructor(publicMethod)) {
        this.raise(Errors.ConstructorIsGenerator, publicMethod.key);
      }
      this.pushClassMethod(classBody, publicMethod, true, false, false, false);
      return;
    }
    const isContextual = !this.state.containsEsc && tokenIsIdentifier(this.state.type);
    const key = this.parseClassElementName(member);
    const maybeContextualKw = isContextual ? key.name : null;
    const isPrivate = this.isPrivateName(key);
    const maybeQuestionTokenStartLoc = this.state.startLoc;
    this.parsePostMemberNameModifiers(publicMember);
    if (this.isClassMethod()) {
      method.kind = "method";
      if (isPrivate) {
        this.pushClassPrivateMethod(classBody, privateMethod, false, false);
        return;
      }
      const isConstructor = this.isNonstaticConstructor(publicMethod);
      let allowsDirectSuper = false;
      if (isConstructor) {
        publicMethod.kind = "constructor";
        if (publicMethod.decorators && publicMethod.decorators.length > 0) {
          this.raise(Errors.DecoratorConstructor, member);
        }
        if (state.hadConstructor && !this.hasPlugin("typescript")) {
          this.raise(Errors.DuplicateConstructor, key);
        }
        if (isConstructor && this.hasPlugin("typescript") && member.override) {
          this.raise(Errors.OverrideOnConstructor, key);
        }
        state.hadConstructor = true;
        allowsDirectSuper = state.hadSuperClass;
      }
      this.pushClassMethod(classBody, publicMethod, false, false, isConstructor, allowsDirectSuper);
    } else if (this.isClassProperty()) {
      if (isPrivate) {
        this.pushClassPrivateProperty(classBody, privateProp);
      } else {
        this.pushClassProperty(classBody, publicProp);
      }
    } else if (maybeContextualKw === "async" && !this.isLineTerminator()) {
      this.resetPreviousNodeTrailingComments(key);
      const isGenerator = this.eat(51);
      if (publicMember.optional) {
        this.unexpected(maybeQuestionTokenStartLoc);
      }
      method.kind = "method";
      const isPrivate2 = this.match(137);
      this.parseClassElementName(method);
      this.parsePostMemberNameModifiers(publicMember);
      if (isPrivate2) {
        this.pushClassPrivateMethod(classBody, privateMethod, isGenerator, true);
      } else {
        if (this.isNonstaticConstructor(publicMethod)) {
          this.raise(Errors.ConstructorIsAsync, publicMethod.key);
        }
        this.pushClassMethod(classBody, publicMethod, isGenerator, true, false, false);
      }
    } else if ((maybeContextualKw === "get" || maybeContextualKw === "set") && !(this.match(51) && this.isLineTerminator())) {
      this.resetPreviousNodeTrailingComments(key);
      method.kind = maybeContextualKw;
      const isPrivate2 = this.match(137);
      this.parseClassElementName(publicMethod);
      if (isPrivate2) {
        this.pushClassPrivateMethod(classBody, privateMethod, false, false);
      } else {
        if (this.isNonstaticConstructor(publicMethod)) {
          this.raise(Errors.ConstructorIsAccessor, publicMethod.key);
        }
        this.pushClassMethod(classBody, publicMethod, false, false, false, false);
      }
      this.checkGetterSetterParams(publicMethod);
    } else if (maybeContextualKw === "accessor" && !this.isLineTerminator()) {
      this.expectPlugin("decoratorAutoAccessors");
      this.resetPreviousNodeTrailingComments(key);
      const isPrivate2 = this.match(137);
      this.parseClassElementName(publicProp);
      this.pushClassAccessorProperty(classBody, accessorProp, isPrivate2);
    } else if (this.isLineTerminator()) {
      if (isPrivate) {
        this.pushClassPrivateProperty(classBody, privateProp);
      } else {
        this.pushClassProperty(classBody, publicProp);
      }
    } else {
      this.unexpected();
    }
  }
  parseClassElementName(member) {
    const {
      type,
      value
    } = this.state;
    if ((type === 131 || type === 133) && member.static && value === "prototype") {
      this.raise(Errors.StaticPrototype, this.state.startLoc);
    }
    if (type === 137) {
      if (value === "constructor") {
        this.raise(Errors.ConstructorClassPrivateField, this.state.startLoc);
      }
      const key = this.parsePrivateName();
      member.key = key;
      return key;
    }
    this.parsePropertyName(member);
    return member.key;
  }
  parseClassStaticBlock(classBody, member) {
    this.scope.enter(576 | 128 | 16);
    const oldLabels = this.state.labels;
    this.state.labels = [];
    this.prodParam.enter(0);
    const body = member.body = [];
    this.parseBlockOrModuleBlockBody(body, void 0, false, 4);
    this.prodParam.exit();
    this.scope.exit();
    this.state.labels = oldLabels;
    classBody.body.push(this.finishNode(member, "StaticBlock"));
    if (member.decorators?.length) {
      this.raise(Errors.DecoratorStaticBlock, member);
    }
  }
  pushClassProperty(classBody, prop) {
    if (!prop.computed && this.nameIsConstructor(prop.key)) {
      this.raise(Errors.ConstructorClassField, prop.key);
    }
    classBody.body.push(this.parseClassProperty(prop));
  }
  pushClassPrivateProperty(classBody, prop) {
    const node = this.parseClassPrivateProperty(prop);
    classBody.body.push(node);
    this.classScope.declarePrivateName(this.getPrivateNameSV(node.key), 0, node.key.start);
  }
  pushClassAccessorProperty(classBody, prop, isPrivate) {
    if (!isPrivate && !prop.computed && this.nameIsConstructor(prop.key)) {
      this.raise(Errors.ConstructorClassField, prop.key);
    }
    const node = this.parseClassAccessorProperty(prop);
    classBody.body.push(node);
    if (isPrivate) {
      this.classScope.declarePrivateName(this.getPrivateNameSV(node.key), 0, node.key.start);
    }
  }
  pushClassMethod(classBody, method, isGenerator, isAsync, isConstructor, allowsDirectSuper) {
    classBody.body.push(this.parseMethod(method, isGenerator, isAsync, isConstructor, allowsDirectSuper, "ClassMethod", true));
  }
  pushClassPrivateMethod(classBody, method, isGenerator, isAsync) {
    const node = this.parseMethod(method, isGenerator, isAsync, false, false, "ClassPrivateMethod", true);
    classBody.body.push(node);
    const kind = node.kind === "get" ? node.static ? 6 : 2 : node.kind === "set" ? node.static ? 5 : 1 : 0;
    this.declareClassPrivateMethodInScope(node, kind);
  }
  declareClassPrivateMethodInScope(node, kind) {
    this.classScope.declarePrivateName(this.getPrivateNameSV(node.key), kind, node.key.start);
  }
  parsePostMemberNameModifiers(methodOrProp) {
  }
  parseClassPrivateProperty(node) {
    this.parseInitializer(node);
    this.semicolon();
    return this.finishNode(node, "ClassPrivateProperty");
  }
  parseClassProperty(node) {
    this.parseInitializer(node);
    this.semicolon();
    return this.finishNode(node, "ClassProperty");
  }
  parseClassAccessorProperty(node) {
    this.parseInitializer(node);
    this.semicolon();
    return this.finishNode(node, "ClassAccessorProperty");
  }
  parseInitializer(node) {
    this.scope.enter(576 | 16);
    this.expressionScope.enter(sharedExpressionScope);
    this.prodParam.enter(0);
    node.value = this.eat(25) ? this.parseMaybeAssignAllowIn() : null;
    this.expressionScope.exit();
    this.prodParam.exit();
    this.scope.exit();
  }
  parseClassId(node, isStatement, optionalId, bindingType = 8331) {
    if (tokenIsIdentifier(this.state.type)) {
      node.id = this.parseIdentifier();
      this.checkStrictBindReservedWord(node.id, bindingType);
      if (isStatement) {
        this.declareNameFromIdentifier(node.id, bindingType);
      }
    } else {
      if (optionalId || !isStatement) {
        node.id = null;
      } else {
        throw this.raise(Errors.MissingClassName, this.state.startLoc);
      }
    }
  }
  parseClassSuper(node) {
    if (this.eat(77)) {
      this.state.canStartArrow = false;
      node.superClass = this.parseExprSubscripts();
    } else {
      node.superClass = null;
    }
  }
  parseStructDeclaration(node, optionalId) {
    this.next();
    const oldStrict = this.state.strict;
    this.state.strict = true;
    this.parseClassId(node, true, optionalId);
    this.parseClassSuper(node);
    node.body = this.parseStructBody(!!node.superClass, oldStrict);
    return this.finishNode(node, "StructDeclaration");
  }
  parseStructBody(hadSuperClass, oldStrict) {
    this.classScope.enter();
    const state = {
      hadConstructor: false,
      hadSuperClass
    };
    const structBody = this.startNode();
    structBody.body = [];
    this.expect(2);
    while (!this.match(4)) {
      if (this.eat(9)) {
        continue;
      }
      const member = this.startNode();
      this.parseClassMember(structBody, member, state);
    }
    this.state.strict = oldStrict;
    this.next();
    this.classScope.exit();
    return this.finishNode(structBody, "StructBody");
  }
  parseExport(node, decorators) {
    const maybeDefaultIdentifier = this.parseMaybeImportPhase(node, true);
    const hasDefault = this.maybeParseExportDefaultSpecifier(node, maybeDefaultIdentifier);
    const parseAfterDefault = !hasDefault || this.eat(8);
    const hasStar = parseAfterDefault && this.eatExportStar(node);
    const hasNamespace = hasStar && this.maybeParseExportNamespaceSpecifier(node);
    const parseAfterNamespace = parseAfterDefault && !hasNamespace;
    if (hasStar && !hasNamespace) {
      if (hasDefault) this.unexpected();
      if (decorators) {
        throw this.raise(Errors.UnsupportedDecoratorExport, node);
      }
      if (node.phase === "defer") {
        this.raise(Errors.DeferExportInvalidAll, node);
      }
      this.parseExportFrom(node, true);
      this.sawUnambiguousESM = true;
      return this.finishNode(node, "ExportAllDeclaration");
    }
    const hasSpecifiers = parseAfterNamespace && this.maybeParseExportNamedSpecifiers(node);
    const isFromRequired = hasDefault || hasStar || node.phase === "defer" || hasSpecifiers && node.specifiers[0]?.type === "ExportNamespaceSpecifier";
    if (hasDefault && parseAfterDefault && !hasStar && !hasSpecifiers) {
      this.unexpected(null, 2);
    }
    let hasDeclaration;
    if (isFromRequired || hasSpecifiers) {
      hasDeclaration = false;
      if (decorators) {
        throw this.raise(Errors.UnsupportedDecoratorExport, node);
      }
      this.parseExportFrom(node, isFromRequired);
    } else {
      hasDeclaration = this.maybeParseExportDeclaration(node);
    }
    if (isFromRequired || hasSpecifiers || hasDeclaration) {
      const node2 = node;
      this.checkNamedExport(node2, !!node2.source);
      if (node2.declaration?.type === "ClassDeclaration") {
        this.maybeTakeDecorators(decorators, node2.declaration, node2);
      } else if (decorators) {
        throw this.raise(Errors.UnsupportedDecoratorExport, node);
      }
      if (this.hasPlugin("deferredReexports")) node2.phase ??= null;
      this.sawUnambiguousESM = true;
      return this.finishNode(node2, "ExportNamedDeclaration");
    }
    if (this.eat(61)) {
      const node2 = node;
      const decl = this.parseExportDefaultExpression();
      node2.declaration = decl;
      if (decl.type === "ClassDeclaration") {
        this.maybeTakeDecorators(decorators, decl, node2);
      } else if (decorators) {
        throw this.raise(Errors.UnsupportedDecoratorExport, node);
      }
      this.checkDuplicateExports(node, "default");
      if (this.hasPlugin("exportDefaultFrom")) {
        if (decl.type === "Identifier" && decl.name === "from" && decl.end - decl.start === 4 && !decl.extra?.parenthesized) {
          this.raise(Errors.ExportDefaultFromAsIdentifier, decl);
        }
      }
      this.sawUnambiguousESM = true;
      return this.finishNode(node2, "ExportDefaultDeclaration");
    }
    throw this.unexpected(null, 2);
  }
  eatExportStar(_) {
    return this.eat(51);
  }
  maybeParseExportDefaultSpecifier(node, maybeDefaultIdentifier) {
    if (maybeDefaultIdentifier || this.isExportDefaultSpecifier()) {
      this.expectPlugin("exportDefaultFrom", maybeDefaultIdentifier?.start);
      const id = maybeDefaultIdentifier || this.parseIdentifier(true);
      const specifier = this.startNodeAtNode(id);
      specifier.exported = id;
      node.specifiers = [this.finishNode(specifier, "ExportDefaultSpecifier")];
      return true;
    }
    return false;
  }
  maybeParseExportNamespaceSpecifier(node) {
    if (this.isContextual(90)) {
      node.specifiers ??= [];
      const specifier = this.startNodeAt(this.state.lastTokStartLoc);
      this.next();
      specifier.exported = this.parseModuleExportName();
      node.specifiers.push(this.finishNode(specifier, "ExportNamespaceSpecifier"));
      return true;
    }
    return false;
  }
  maybeParseExportNamedSpecifiers(node) {
    if (this.match(2)) {
      const node2 = node;
      if (!node2.specifiers) node2.specifiers = [];
      const isTypeExport = node2.exportKind === "type";
      const startLoc = this.state.startLoc;
      this.setLoc(startLoc);
      const specifiers = this.parseExportSpecifiers(isTypeExport);
      if (this.isContextual(90) && !this.hasPrecedingLineBreak()) {
        this.expectPlugin("namespaceImportFilter");
        const specifier = this.startNodeAt(startLoc);
        specifier.exportsFilter = this.toNamespaceExportsFilter(specifiers);
        this.next();
        specifier.exported = this.parseModuleExportName();
        node2.specifiers.push(this.finishNode(specifier, "ExportNamespaceSpecifier"));
      } else {
        node2.specifiers.push(...specifiers);
      }
      node2.source = null;
      node2.attributes = [];
      node2.declaration = null;
      return true;
    }
    return false;
  }
  maybeParseExportDeclaration(node) {
    if (this.shouldParseExportDeclaration()) {
      node.specifiers = [];
      node.source = null;
      node.attributes = [];
      node.declaration = this.parseExportDeclaration(node);
      return true;
    }
    return false;
  }
  isAsyncFunction() {
    if (!this.isContextual(92)) return false;
    const next = this.nextTokenInLineStart();
    return this.isUnparsedContextual(next, "function");
  }
  parseExportDefaultExpression() {
    const expr = this.startNode();
    if (this.match(64)) {
      this.next();
      return this.parseFunction(expr, 1 | 4);
    } else if (this.isAsyncFunction()) {
      this.next();
      this.next();
      return this.parseFunction(expr, 1 | 4 | 8);
    }
    if (this.match(76)) {
      return this.parseClass(expr, true, true);
    }
    if (this.isContextual(104)) {
      const next = this.nextTokenInLineStart();
      const nextCh = this.codePointAtPos(next);
      if (nextCh === 123 || this.chStartsBindingIdentifier(nextCh, next)) {
        this.expectPlugin("structs");
        return this.parseStructDeclaration(expr, true);
      }
    }
    if (this.match(22)) {
      return this.parseClass(this.maybeTakeDecorators(this.parseDecorators(false), this.startNode()), true, true);
    }
    if (this.match(71) || this.match(70) || this.isLet() && !this.isReservedWordOnNewLineAfterLet(this.nextTokenStart()) || this.isUsing() || this.isAwaitUsing()) {
      throw this.raise(Errors.UnsupportedDefaultExport, this.state.startLoc);
    }
    const res = this.parseMaybeAssignAllowIn();
    this.semicolon();
    return res;
  }
  parseExportDeclaration(node) {
    if (this.match(76)) {
      const node2 = this.parseClass(this.startNode(), true, false);
      return node2;
    }
    if (this.isContextual(104) && this.nextTokenIsIdentifierOnSameLine()) {
      this.expectPlugin("structs");
      const node2 = this.parseStructDeclaration(this.startNode(), false);
      return node2;
    }
    if (this.isContextual(97)) {
      return this.parseVarStatement(this.startNode(), "let");
    }
    return this.parseStatementListItem();
  }
  isExportDefaultSpecifier() {
    const {
      type
    } = this.state;
    if (tokenIsIdentifier(type)) {
      if (type === 92 && !this.state.containsEsc || type === 97) {
        return false;
      }
      if ((type === 129 || type === 128 || type === 104) && !this.state.containsEsc) {
        const next2 = this.nextTokenStart();
        const nextChar = this.input.charCodeAt(next2);
        if (nextChar === 123 || this.chStartsBindingIdentifier(nextChar, next2) && !this.isUnparsedContextual(next2, "from")) {
          if (type !== 104) {
            this.expectOnePlugin(["flow", "typescript"]);
          }
          return false;
        }
      }
    } else if (!this.match(61)) {
      return false;
    }
    const next = this.nextTokenStart();
    const hasFrom = this.isUnparsedContextual(next, "from");
    if (this.input.charCodeAt(next) === 44 || tokenIsIdentifier(this.state.type) && hasFrom) {
      return true;
    }
    if (this.match(61) && hasFrom) {
      const nextAfterFrom = this.input.charCodeAt(this.hasPlugin("exportDefaultFrom") ? this.nextTokenStartSince(next + 4) : this.nextTokenInLineStartSince(next + 4));
      return nextAfterFrom === 34 || nextAfterFrom === 39;
    }
    return false;
  }
  parseExportFrom(node, expect) {
    if (this.eatContextual(95)) {
      node.source = this.parseImportSource();
      this.maybeParseImportAttributes(node);
    } else if (expect) {
      this.unexpected(null, 95);
    }
    this.semicolon();
  }
  shouldParseExportDeclaration() {
    const {
      type
    } = this.state;
    if (type === 22) {
      this.expectOnePlugin(["decorators", "decorators-legacy"]);
      if (this.hasPlugin("decorators")) {
        return true;
      }
    }
    if (this.isUsing()) {
      this.raise(Errors.UsingDeclarationExport, this.state.startLoc);
      return true;
    }
    if (this.isAwaitUsing()) {
      this.raise(Errors.UsingDeclarationExport, this.state.startLoc);
      return true;
    }
    return type === 70 || type === 71 || type === 64 || type === 76 || this.isLet() || this.isAsyncFunction() || this.isContextual(104) && this.nextTokenIsIdentifierOnSameLine();
  }
  checkNamedExport(node, isFrom) {
    if (node.specifiers?.length) {
      for (const specifier of node.specifiers) {
        const {
          exported
        } = specifier;
        const exportName = exported.type === "Identifier" ? exported.name : exported.value;
        this.checkDuplicateExports(specifier, exportName);
        if (!isFrom && specifier.type === "ExportSpecifier") {
          const {
            local
          } = specifier;
          if (local.type !== "Identifier") {
            this.raise(Errors.ExportBindingIsString, specifier, {
              localName: local.value,
              exportName
            });
          } else {
            this.checkReservedWord(local.name, local.start, true, false);
            this.scope.checkLocalExport(local);
          }
        }
      }
    } else if (node.declaration) {
      const decl = node.declaration;
      if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration" || decl.type === "StructDeclaration") {
        const {
          id
        } = decl;
        if (!id) throw new Error("Assertion failure");
        this.checkDuplicateExports(node, id.name);
      } else if (decl.type === "VariableDeclaration") {
        for (const declaration of decl.declarations) {
          this.checkDeclaration(declaration.id);
        }
      }
    }
  }
  checkDeclaration(node) {
    if (node.type === "Identifier") {
      this.checkDuplicateExports(node, node.name);
    } else if (node.type === "ObjectPattern") {
      for (const prop of node.properties) {
        this.checkDeclaration(prop);
      }
    } else if (node.type === "ArrayPattern") {
      for (const elem of node.elements) {
        if (elem) {
          this.checkDeclaration(elem);
        }
      }
    } else if (node.type === "ObjectProperty") {
      this.checkDeclaration(node.value);
    } else if (node.type === "RestElement") {
      this.checkDeclaration(node.argument);
    } else if (node.type === "AssignmentPattern") {
      this.checkDeclaration(node.left);
    }
  }
  checkDuplicateExports(node, exportName) {
    if (this.exportedIdentifiers.has(exportName)) {
      if (exportName === "default") {
        this.raise(Errors.DuplicateDefaultExport, node);
      } else {
        this.raise(Errors.DuplicateExport, node, {
          exportName
        });
      }
    }
    this.exportedIdentifiers.add(exportName);
  }
  parseExportSpecifiers(isInTypeExport) {
    const nodes = [];
    let first = true;
    this.expect(2);
    while (!this.eat(4)) {
      if (first) {
        first = false;
      } else {
        this.expect(8);
        if (this.eat(4)) break;
      }
      const isMaybeTypeOnly = this.isContextual(129);
      const isString = this.match(133);
      const node = this.startNode();
      node.local = this.parseModuleExportName();
      nodes.push(this.parseExportSpecifier(node, isString, isInTypeExport, isMaybeTypeOnly));
    }
    return nodes;
  }
  parseExportSpecifier(node, isString, isInTypeExport, isMaybeTypeOnly) {
    if (this.eatContextual(90)) {
      node.exported = this.parseModuleExportName();
    } else if (isString) {
      node.exported = this.cloneStringLiteral(node.local);
    } else if (!node.exported) {
      node.exported = this.cloneIdentifier(node.local);
    }
    return this.finishNode(node, "ExportSpecifier");
  }
  parseModuleExportName() {
    if (this.match(133)) {
      const result = this.parseStringLiteral(this.state.value);
      const surrogate = loneSurrogate.exec(result.value);
      if (surrogate) {
        this.raise(Errors.ModuleExportNameHasLoneSurrogate, result, {
          surrogateCharCode: surrogate[0].charCodeAt(0)
        });
      }
      return result;
    }
    return this.parseIdentifier(true);
  }
  toNamespaceExportsFilter(specifiers) {
    const seen = /* @__PURE__ */ new Set();
    return specifiers.map((specifier) => {
      let name, alias, kind;
      if (specifier.type === "ImportSpecifier") {
        ({
          imported: name,
          local: alias,
          importKind: kind
        } = specifier);
      } else {
        ({
          local: name,
          exported: alias,
          exportKind: kind
        } = specifier);
      }
      const nameString = name.type === "Identifier" ? name.name : this.isStringModuleExportName(name) ? name.value : null;
      if (nameString !== null) {
        if (seen.has(nameString)) {
          this.raise(Errors.FilteredNamespaceDuplicateName, name, {
            name: nameString
          });
        }
        seen.add(nameString);
      }
      let invalid = false;
      if (alias.start !== name.start) {
        this.raise(Errors.FilteredNamespaceRename, alias);
        invalid = true;
      }
      if (kind === "type" || kind === "typeof") {
        this.raise(Errors.FilteredNamespaceTypeModifier, specifier);
        invalid = true;
      }
      if (invalid) {
        return specifier;
      }
      this.replaceNodeInPendingComments(specifier, name);
      return name;
    });
  }
  checkImportPhase(node) {
    if (node.phase == null) {
      return;
    }
    const {
      specifiers
    } = node;
    const singleBindingType = specifiers.length === 1 ? specifiers[0].type : null;
    if (node.phase === "source") {
      if (singleBindingType !== "ImportDefaultSpecifier") {
        this.raise(Errors.SourcePhaseImportRequiresDefault, node);
      }
    } else if (node.phase === "defer") {
      if (singleBindingType !== "ImportNamespaceSpecifier") {
        this.raise(Errors.DeferImportRequiresNamespace, node);
      }
    }
  }
  isPotentialImportPhase(isExport) {
    if (isExport) {
      if (!this.isContextual(94)) return false;
      const ch = this.lookaheadCharCode();
      return ch === 123 || ch === 42;
    }
    return this.isContextual(102) || this.isContextual(94);
  }
  applyImportPhase(node, isExport, phase, loc) {
    if (isExport) {
      if (phase === "defer") {
        this.expectPlugin("deferredReexports", loc);
        node.phase = "defer";
      }
      return;
    }
    if (phase === "source") {
      this.expectPlugin("sourcePhaseImports", loc);
      node.phase = "source";
    } else if (phase === "defer") {
      this.expectPlugin("deferredImportEvaluation", loc);
      node.phase = "defer";
    } else if (this.hasPlugin("sourcePhaseImports") || this.hasPlugin("deferredImportEvaluation")) {
      node.phase = null;
    }
  }
  parseMaybeImportPhase(node, isExport) {
    if (!this.isPotentialImportPhase(isExport)) {
      this.applyImportPhase(node, isExport, null);
      return null;
    }
    const phaseIdentifier = this.startNode();
    const phaseIdentifierName = this.parseIdentifierName(true);
    const {
      type
    } = this.state;
    const isImportPhase = tokenIsKeywordOrIdentifier(type) ? type !== 95 || this.lookaheadCharCode() === 102 : type !== 8;
    if (isImportPhase) {
      this.applyImportPhase(node, isExport, phaseIdentifierName, phaseIdentifier.start);
      return null;
    } else {
      this.applyImportPhase(node, isExport, null);
      return this.createIdentifier(phaseIdentifier, phaseIdentifierName);
    }
  }
  isPrecedingIdImportPhase(phase) {
    const {
      type
    } = this.state;
    return tokenIsIdentifier(type) ? type !== 95 || this.lookaheadCharCode() === 102 : type !== 8;
  }
  parseImport(node) {
    if (this.match(133)) {
      return this.parseImportSourceAndAttributes(node);
    }
    return this.parseImportSpecifiersAndAfter(node, this.parseMaybeImportPhase(node, false));
  }
  parseImportSpecifiersAndAfter(node, maybeDefaultIdentifier) {
    node.specifiers = [];
    const hasDefault = this.maybeParseDefaultImportSpecifier(node, maybeDefaultIdentifier);
    const parseNext = !hasDefault || this.eat(8);
    const hasStar = parseNext && this.maybeParseStarImportSpecifier(node);
    if (parseNext && !hasStar) this.parseNamedOrFilteredImportSpecifiers(node);
    this.expectContextual(95);
    return this.parseImportSourceAndAttributes(node);
  }
  parseImportSourceAndAttributes(node) {
    node.specifiers ??= [];
    node.source = this.parseImportSource();
    this.maybeParseImportAttributes(node);
    this.checkImportPhase(node);
    this.semicolon();
    this.sawUnambiguousESM = true;
    return this.finishNode(node, "ImportDeclaration");
  }
  parseImportSource() {
    if (!this.match(133)) this.unexpected();
    return this.parseExprAtom();
  }
  parseImportSpecifierLocal(node, specifier, type) {
    specifier.local = this.parseIdentifier();
    node.specifiers.push(this.finishImportSpecifier(specifier, type));
  }
  finishImportSpecifier(specifier, type) {
    this.checkLVal(specifier.local, {
      type
    }, 8201);
    return this.finishNode(specifier, type);
  }
  parseImportAttributes() {
    this.expect(2);
    const attrs = [];
    const attrNames = /* @__PURE__ */ new Set();
    do {
      if (this.match(4)) {
        break;
      }
      const node = this.startNode();
      const keyName = this.state.value;
      if (attrNames.has(keyName)) {
        this.raise(Errors.ModuleAttributesWithDuplicateKeys, this.state.startLoc, {
          key: keyName
        });
      }
      attrNames.add(keyName);
      if (this.match(133)) {
        node.key = this.parseStringLiteral(keyName);
      } else {
        node.key = this.parseIdentifier(true);
      }
      this.expect(10);
      if (!this.match(133)) {
        throw this.raise(Errors.ModuleAttributeInvalidValue, this.state.startLoc);
      }
      node.value = this.parseStringLiteral(this.state.value);
      attrs.push(this.finishNode(node, "ImportAttribute"));
    } while (this.eat(8));
    this.expect(4);
    return attrs;
  }
  maybeParseImportAttributes(node) {
    let attributes;
    if (this.match(72)) {
      if (this.hasPrecedingLineBreak() && this.lookaheadCharCode() === 40) {
        return;
      }
      this.next();
      attributes = this.parseImportAttributes();
    } else {
      attributes = [];
    }
    node.attributes = attributes;
  }
  maybeParseDefaultImportSpecifier(node, maybeDefaultIdentifier) {
    if (maybeDefaultIdentifier) {
      const specifier = this.startNodeAtNode(maybeDefaultIdentifier);
      specifier.local = maybeDefaultIdentifier;
      node.specifiers.push(this.finishImportSpecifier(specifier, "ImportDefaultSpecifier"));
      return true;
    } else if (tokenIsKeywordOrIdentifier(this.state.type)) {
      this.parseImportSpecifierLocal(node, this.startNode(), "ImportDefaultSpecifier");
      return true;
    }
    return false;
  }
  maybeParseStarImportSpecifier(node) {
    if (this.match(51)) {
      const specifier = this.startNode();
      this.next();
      this.expectContextual(90);
      this.parseImportSpecifierLocal(node, specifier, "ImportNamespaceSpecifier");
      return true;
    }
    return false;
  }
  parseNamedOrFilteredImportSpecifiers(node) {
    const startLoc = this.state.startLoc;
    this.setLoc(startLoc);
    const specifiersStart = node.specifiers.length;
    this.parseNamedImportSpecifiers(node);
    if (this.isContextual(90)) {
      this.expectPlugin("namespaceImportFilter");
      const specifier = this.startNodeAt(startLoc);
      specifier.exportsFilter = this.toNamespaceExportsFilter(node.specifiers.splice(specifiersStart));
      this.next();
      this.parseImportSpecifierLocal(node, specifier, "ImportNamespaceSpecifier");
      return;
    }
    const isInTypeOnlyImport = node.importKind === "type" || node.importKind === "typeof";
    for (let i = specifiersStart; i < node.specifiers.length; i++) {
      this.checkImportSpecifier(node.specifiers[i], isInTypeOnlyImport);
    }
  }
  parseNamedImportSpecifiers(node) {
    let first = true;
    this.expect(2);
    while (!this.eat(4)) {
      if (first) {
        first = false;
      } else {
        if (this.eat(10)) {
          throw this.raise(Errors.DestructureNamedImport, this.state.startLoc);
        }
        this.expect(8);
        if (this.eat(4)) break;
      }
      const specifier = this.startNode();
      const importedIsString = this.match(133);
      const isMaybeTypeOnly = this.isContextual(129);
      specifier.imported = this.parseModuleExportName();
      const importSpecifier = this.parseImportSpecifier(specifier, importedIsString, node.importKind === "type" || node.importKind === "typeof", isMaybeTypeOnly);
      node.specifiers.push(importSpecifier);
    }
  }
  parseImportSpecifier(specifier, importedIsString, isInTypeOnlyImport, isMaybeTypeOnly) {
    if (this.eatContextual(90)) {
      specifier.local = this.parseIdentifier();
    } else {
      specifier.local ??= this.cloneIdentifier(specifier.imported);
    }
    return this.finishNode(specifier, "ImportSpecifier");
  }
  checkImportSpecifier(specifier, isInTypeOnlyImport, bindingType = 8201, checkReservedWord = true) {
    const {
      imported,
      local
    } = specifier;
    if (this.isStringModuleExportName(local)) {
      throw this.raise(Errors.ImportBindingIsString, specifier, {
        importName: imported.value
      });
    }
    if (checkReservedWord && local.start === imported.start) {
      this.checkReservedWord(local.name, local.start, true, true);
    }
    this.checkLVal(local, {
      type: "ImportSpecifier"
    }, bindingType);
  }
  isStringModuleExportName(node) {
    return node.type === "StringLiteral" || node.type === "Literal";
  }
  isThisParam(param) {
    return param.type === "Identifier" && param.name === "this";
  }
};
var keywordAndTSRelationalOperator = /in(?:stanceof)?|as|satisfies/y;
function nonNull(x) {
  if (x == null) {
    throw new Error(`Unexpected ${x} value.`);
  }
  return x;
}
function assert(x) {
  if (!x) {
    throw new Error("Assert fail");
  }
}
var TSErrorTemplates = {
  AbstractMethodHasImplementation: ({
    methodName
  }) => `Method '${methodName}' cannot have an implementation because it is marked abstract.`,
  AbstractPropertyHasInitializer: ({
    propertyName
  }) => `Property '${propertyName}' cannot have an initializer because it is marked abstract.`,
  AccessorCannotBeOptional: "An 'accessor' property cannot be declared optional.",
  AccessorCannotDeclareThisParameter: "'get' and 'set' accessors cannot declare 'this' parameters.",
  AccessorCannotHaveTypeParameters: "An accessor cannot have type parameters.",
  ClassMethodHasDeclare: "Class methods cannot have the 'declare' modifier.",
  ClassMethodHasReadonly: "Class methods cannot have the 'readonly' modifier.",
  ConstInitializerMustBeStringOrNumericLiteralOrLiteralEnumReference: "A 'const' initializer in an ambient context must be a string or numeric literal or literal enum reference.",
  ConstructorHasTypeParameters: "Type parameters cannot appear on a constructor declaration.",
  DeclaratorDefiniteAssertionRequiresTypeAnnotation: "Declarations with definite assignment assertions must also have type annotations.",
  DeclaratorDefiniteAssertionWithInitializer: "Declarations with initializers cannot also have definite assignment assertions.",
  DeclareAccessor: ({
    kind
  }) => `'declare' is not allowed in ${kind}ters.`,
  DeclareClassFieldHasInitializer: "Initializers are not allowed in ambient contexts.",
  DeclareFunctionHasImplementation: "An implementation cannot be declared in ambient contexts.",
  DecoratorAbstractMethod: ({
    kind
  }) => `Decorators can't be used with ${kind.startsWith("a") ? "an" : "a"} ${kind}.`,
  DuplicateAccessibilityModifier: ({
    modifier
  }) => `Accessibility modifier already seen: '${modifier}'.`,
  DuplicateModifier: ({
    modifier
  }) => `Duplicate modifier: '${modifier}'.`,
  EmptyHeritageClauseType: ({
    token
  }) => `'${token}' list cannot be empty.`,
  EmptyNamespaceName: "Namespace must be given a name.",
  EmptyTypeArguments: "Type argument list cannot be empty.",
  EmptyTypeParameters: "Type parameter list cannot be empty.",
  ExpectedAmbientAfterExportDeclare: "'export declare' must be followed by an ambient declaration.",
  ExportAssignmentInTSNamespace: "An export assignment cannot be used in a namespace.",
  ExportInTSNamespace: "Export declarations are not permitted in a namespace.",
  ImportAliasHasImportType: "An import alias can not use 'import type'.",
  ImportInTSNamespace: "Import declarations in a namespace cannot reference a module.",
  IncompatibleModifiers: ({
    modifiers
  }) => `'${modifiers[0]}' modifier cannot be used with '${modifiers[1]}' modifier.`,
  IndexSignatureHasAbstract: "Index signatures cannot have the 'abstract' modifier.",
  IndexSignatureHasAccessibility: ({
    modifier
  }) => `Index signatures cannot have an accessibility modifier ('${modifier}').`,
  IndexSignatureHasDeclare: "Index signatures cannot have the 'declare' modifier.",
  IndexSignatureHasOverride: "'override' modifier cannot appear on an index signature.",
  IndexSignatureHasStatic: "Index signatures cannot have the 'static' modifier.",
  InitializerNotAllowedInAmbientContext: "Initializers are not allowed in ambient contexts.",
  InlineModuleDeclarationMustUseString: "`module ... {}` declarations must have a string name. Use `namespace ... {}` instead.",
  InvalidHeritageClauseType: ({
    token
  }) => `'${token}' list can only include identifiers or qualified-names with optional type arguments.`,
  InvalidModifierOnAwaitUsingDeclaration: (modifier) => `'${modifier}' modifier cannot appear on an await using declaration.`,
  InvalidModifierOnTypeMember: ({
    modifier
  }) => `'${modifier}' modifier cannot appear on a type member.`,
  InvalidModifierOnTypeParameter: ({
    modifier
  }) => `'${modifier}' modifier cannot appear on a type parameter.`,
  InvalidModifierOnTypeParameterPositions: ({
    modifier
  }) => `'${modifier}' modifier can only appear on a type parameter of a class, interface or type alias.`,
  InvalidModifierOnUsingDeclaration: (modifier) => `'${modifier}' modifier cannot appear on a using declaration.`,
  InvalidModifiersOrder: ({
    orderedModifiers
  }) => `'${orderedModifiers[0]}' modifier must precede '${orderedModifiers[1]}' modifier.`,
  InvalidNamespaceName: (value) => `Namespace name cannot be '${value}'.`,
  InvalidPropertyAccessAfterInstantiationExpression: "Invalid property access after an instantiation expression. You can either wrap the instantiation expression in parentheses, or delete the type arguments.",
  InvalidTupleMemberLabel: "Tuple members must be labeled with a simple identifier.",
  MissingInterfaceName: "'interface' declarations must be followed by an identifier.",
  NamespaceExportInTSNamespace: "Global module exports may only appear at top level.",
  NonAbstractClassHasAbstractMethod: "Abstract methods can only appear within an abstract class.",
  NonClassMethodPropertyHasAbstractModifier: "'abstract' modifier can only appear on a class, method, or property declaration.",
  OptionalTypeBeforeRequired: "A required element cannot follow an optional element.",
  OverrideNotInSubClass: "This member cannot have an 'override' modifier because its containing class does not extend another class.",
  PatternIsOptional: "A binding pattern parameter cannot be optional in an implementation signature.",
  PrivateElementHasAbstract: "Private elements cannot have the 'abstract' modifier.",
  PrivateElementHasAccessibility: ({
    modifier
  }) => `Private elements cannot have an accessibility modifier ('${modifier}').`,
  ReadonlyForMethodSignature: "'readonly' modifier can only appear on a property declaration or index signature.",
  ReservedArrowTypeParam: "This syntax is reserved in files with the .mts or .cts extension. Add a trailing comma, as in `<T,>() => ...`.",
  ReservedTypeAssertion: "This syntax is reserved in files with the .mts or .cts extension. Use an `as` expression instead.",
  SetAccessorCannotHaveOptionalParameter: "A 'set' accessor cannot have an optional parameter.",
  SetAccessorCannotHaveRestParameter: "A 'set' accessor cannot have rest parameter.",
  SetAccessorCannotHaveReturnType: "A 'set' accessor cannot have a return type annotation.",
  SingleTypeParameterWithoutTrailingComma: ({
    typeParameterName
  }) => `Single type parameter ${typeParameterName} should have a trailing comma. Example usage: <${typeParameterName},>.`,
  StaticBlockCannotHaveModifier: "Static class blocks cannot have any modifier.",
  TupleOptionalAfterType: "A labeled tuple optional element must be declared using a question mark after the name and before the colon (`name?: type`), rather than after the type (`name: type?`).",
  TypeAnnotationAfterAssign: "Type annotations must come before default assignments, e.g. instead of `age = 25: number` use `age: number = 25`.",
  TypeImportCannotSpecifyDefaultAndNamed: "A type-only import can specify a default import or named bindings, but not both.",
  TypeModifierIsUsedInTypeExports: "The 'type' modifier cannot be used on a named export when 'export type' is used on its export statement.",
  TypeModifierIsUsedInTypeImports: "The 'type' modifier cannot be used on a named import when 'import type' is used on its import statement.",
  UnexpectedParameterInitializer: "A parameter initializer is only allowed in a function or constructor implementation.",
  UnexpectedParameterModifier: "A parameter property is only allowed in a constructor implementation.",
  UnexpectedReadonly: "'readonly' type modifier is only permitted on array and tuple literal types.",
  UnexpectedTypeAnnotation: "Did not expect a type annotation here.",
  UnexpectedTypeCastInParameter: "Unexpected type cast in parameter position.",
  UnexpectedTypeDeclaration: (type) => `'${type}' declarations can only be declared inside a block.`,
  UnsupportedImportTypeArgument: "Argument in a type import must be a string literal.",
  UnsupportedParameterPropertyKind: "A parameter property may not be declared using a binding pattern.",
  UnsupportedSignatureParameterKind: ({
    type
  }) => `Name in a signature must be an Identifier, ObjectPattern or ArrayPattern, instead got ${type}.`,
  UsingDeclarationInAmbientContext: (kind) => `'${kind}' declarations are not allowed in ambient contexts.`
};
var TSErrors = ParseErrorEnum`typescript`(TSErrorTemplates);
function keywordTypeFromName(value) {
  switch (value) {
    case "any":
      return "TSAnyKeyword";
    case "boolean":
      return "TSBooleanKeyword";
    case "bigint":
      return "TSBigIntKeyword";
    case "never":
      return "TSNeverKeyword";
    case "number":
      return "TSNumberKeyword";
    case "object":
      return "TSObjectKeyword";
    case "string":
      return "TSStringKeyword";
    case "symbol":
      return "TSSymbolKeyword";
    case "undefined":
      return "TSUndefinedKeyword";
    case "unknown":
      return "TSUnknownKeyword";
    default:
      return void 0;
  }
}
function tsIsAccessModifier(modifier) {
  return modifier === "private" || modifier === "public" || modifier === "protected";
}
function tsIsVarianceAnnotations(modifier) {
  return modifier === "in" || modifier === "out";
}
function tsIsEntityName(node) {
  if (node.extra?.parenthesized) {
    return false;
  }
  switch (node.type) {
    case "Identifier":
      return true;
    case "MemberExpression":
      return !node.computed && tsIsEntityName(node.object);
    case "TSInstantiationExpression":
      return tsIsEntityName(node.expression);
    default:
      return false;
  }
}
function tsIsTypeCast(node) {
  switch (node.type) {
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
      return true;
    default:
      return false;
  }
}
var ClassMemberModifiers = buildModifiersMap(["declare", "private", "public", "protected", "override", "abstract", "readonly", "static"], ["in", "out"]);
var IndexSignatureModifiers = buildModifiersMap(["readonly"], ["declare", "abstract", "private", "protected", "public", "static", "override"]);
var BindingElementModifiers = buildModifiersMap(["public", "private", "protected", "override", "readonly"]);
var AccessModifiers = buildModifiersMap(["private", "public", "protected"]);
var typescript = (superClass) => class TypeScriptParserMixin extends superClass {
  getScopeHandler() {
    return TypeScriptScopeHandler;
  }
  tsIsIdentifier() {
    return tokenIsIdentifier(this.state.type);
  }
  tsTokenCanFollowModifier() {
    return this.match(0) || this.match(2) || this.match(51) || this.match(17) || this.match(137) || this.isLiteralPropertyName();
  }
  tsNextTokenOnSameLineAndCanFollowModifier() {
    this.next();
    if (this.hasPrecedingLineBreak()) {
      return false;
    }
    return this.tsTokenCanFollowModifier();
  }
  tsNextTokenCanFollowModifier() {
    if (this.match(103)) {
      this.next();
      return this.tsTokenCanFollowModifier();
    }
    return this.tsNextTokenOnSameLineAndCanFollowModifier();
  }
  tsParseModifier(modifiers, stopOnStartOfClassStaticBlock, hasSeenStaticModifier) {
    if (!tokenIsIdentifier(this.state.type) && this.state.type !== 54 && this.state.type !== 71) {
      return void 0;
    }
    const modifier = this.state.value;
    if (modifiers.has(modifier)) {
      if (hasSeenStaticModifier && this.match(103)) {
        return void 0;
      }
      if (stopOnStartOfClassStaticBlock && this.tsIsStartOfStaticBlocks()) {
        return void 0;
      }
      const escapedKeywordLoc = this.state.containsEsc && !tokenIsIdentifier(this.state.type) ? this.state.startLoc : null;
      if (escapedKeywordLoc) this.state.containsEsc = false;
      if (this.tsTryParse(this.tsNextTokenCanFollowModifier.bind(this))) {
        if (escapedKeywordLoc) {
          this.raise(Errors.InvalidEscapedReservedWord, escapedKeywordLoc, {
            reservedWord: modifier
          });
        }
        return modifier;
      }
      if (escapedKeywordLoc) this.state.containsEsc = true;
    }
    return void 0;
  }
  tsParseModifiers(modifiers, errorTemplate = TSErrors.InvalidModifierOnTypeMember, modified, stopOnStartOfClassStaticBlock = false) {
    const enforceOrder = (loc, modifier, before, after) => {
      if (modifier === before && modified[after]) {
        this.raise(TSErrors.InvalidModifiersOrder, loc, {
          orderedModifiers: [before, after]
        });
      }
    };
    const incompatible = (loc, modifier, mod1, mod2) => {
      if (modified[mod1] && modifier === mod2 || modified[mod2] && modifier === mod1) {
        this.raise(TSErrors.IncompatibleModifiers, loc, {
          modifiers: [mod1, mod2]
        });
      }
    };
    for (; ; ) {
      const {
        startLoc
      } = this.state;
      const modifier = this.tsParseModifier(modifiers, stopOnStartOfClassStaticBlock, modified.static);
      if (!modifier) break;
      if (tsIsAccessModifier(modifier)) {
        if (modified.accessibility) {
          this.raise(TSErrors.DuplicateAccessibilityModifier, startLoc, {
            modifier
          });
        } else {
          enforceOrder(startLoc, modifier, modifier, "override");
          enforceOrder(startLoc, modifier, modifier, "static");
          enforceOrder(startLoc, modifier, modifier, "readonly");
          modified.accessibility = modifier;
        }
      } else if (tsIsVarianceAnnotations(modifier)) {
        if (modified[modifier]) {
          this.raise(TSErrors.DuplicateModifier, startLoc, {
            modifier
          });
        }
        modified[modifier] = true;
        enforceOrder(startLoc, modifier, "in", "out");
      } else {
        if (Object.hasOwn(modified, modifier)) {
          this.raise(TSErrors.DuplicateModifier, startLoc, {
            modifier
          });
        } else {
          enforceOrder(startLoc, modifier, "static", "readonly");
          enforceOrder(startLoc, modifier, "static", "override");
          enforceOrder(startLoc, modifier, "override", "readonly");
          enforceOrder(startLoc, modifier, "abstract", "override");
          incompatible(startLoc, modifier, "declare", "override");
          incompatible(startLoc, modifier, "static", "abstract");
        }
        modified[modifier] = true;
      }
      if (!modifiers.get(modifier)) {
        this.raise(errorTemplate, startLoc, {
          modifier
        });
      }
    }
  }
  tsIsListTerminator(kind) {
    switch (kind) {
      case "EnumMembers":
      case "TypeMembers":
        return this.match(4);
      case "HeritageClauseElement":
        return this.match(2);
      case "TupleElementTypes":
        return this.match(1);
      case "TypeParametersOrArguments":
        return this.match(44);
    }
  }
  tsParseList(kind, parseElement) {
    const result = [];
    while (!this.tsIsListTerminator(kind)) {
      result.push(parseElement());
    }
    return result;
  }
  tsParseDelimitedList(kind, parseElement, refTrailingCommaPos) {
    return nonNull(this.tsParseDelimitedListWorker(kind, parseElement, true, refTrailingCommaPos));
  }
  tsParseDelimitedListWorker(kind, parseElement, expectSuccess, refTrailingCommaPos) {
    const result = [];
    let trailingCommaPos = -1;
    for (; ; ) {
      if (this.tsIsListTerminator(kind)) {
        break;
      }
      trailingCommaPos = -1;
      const element = parseElement();
      if (element == null) {
        return void 0;
      }
      result.push(element);
      if (this.eat(8)) {
        trailingCommaPos = this.state.lastTokStartLoc.index;
        continue;
      }
      if (this.tsIsListTerminator(kind)) {
        break;
      }
      if (expectSuccess) {
        this.expect(8);
      }
      return void 0;
    }
    if (refTrailingCommaPos) {
      refTrailingCommaPos.value = trailingCommaPos;
    }
    return result;
  }
  tsParseBracketedList(kind, parseElement, bracket, skipFirstToken, refTrailingCommaPos) {
    if (!skipFirstToken) {
      if (bracket) {
        this.expect(0);
      } else {
        this.expect(43);
      }
    }
    const result = this.tsParseDelimitedList(kind, parseElement, refTrailingCommaPos);
    if (bracket) {
      this.expect(1);
    } else {
      this.expect(44);
    }
    return result;
  }
  tsParseImportType() {
    const node = this.startNode();
    this.expect(79);
    this.expect(6);
    if (!this.match(133)) {
      this.raise(TSErrors.UnsupportedImportTypeArgument, this.state.startLoc);
      node.source = this.tsParseNonConditionalType();
    } else {
      node.source = this.parseStringLiteral(this.state.value);
    }
    if (this.eat(8)) {
      node.options = this.tsParseImportTypeOptions();
    } else {
      node.options = null;
    }
    this.expect(7);
    if (this.eat(12)) {
      node.qualifier = this.tsParseEntityName(1 | 2);
    }
    if (this.match(43)) {
      node.typeArguments = this.tsParseTypeArguments();
    }
    return this.finishNode(node, "TSImportType");
  }
  tsParseImportTypeOptions() {
    const node = this.startNode();
    this.expect(2);
    const withProperty = this.startNode();
    if (this.isContextual(72)) {
      withProperty.method = false;
      withProperty.key = this.parseIdentifier(true);
      withProperty.computed = false;
      withProperty.shorthand = false;
    } else {
      this.unexpected(null, 72);
    }
    this.expect(10);
    withProperty.value = this.tsParseImportTypeWithPropertyValue();
    node.properties = [this.finishObjectProperty(withProperty)];
    this.eat(8);
    this.expect(4);
    return this.finishNode(node, "ObjectExpression");
  }
  tsParseImportTypeWithPropertyValue() {
    const node = this.startNode();
    const properties = [];
    this.expect(2);
    while (!this.match(4)) {
      const type = this.state.type;
      if (tokenIsIdentifier(type) || type === 133) {
        properties.push(super.parsePropertyDefinition(null));
      } else {
        this.unexpected();
      }
      this.eat(8);
    }
    node.properties = properties;
    this.next();
    return this.finishNode(node, "ObjectExpression");
  }
  tsParseEntityName(flags) {
    let entity;
    if (flags & 1 && this.match(74)) {
      if (flags & 2) {
        entity = this.parseIdentifier(true);
      } else {
        const node = this.startNode();
        this.next();
        entity = this.finishNode(node, "ThisExpression");
      }
    } else {
      entity = this.parseIdentifier(!!(flags & 1));
    }
    while (this.eat(12)) {
      const node = this.startNodeAtNode(entity);
      node.left = entity;
      node.right = this.parseIdentifier(!!(flags & 1));
      entity = this.finishNode(node, "TSQualifiedName");
    }
    return entity;
  }
  tsParseTypeReference() {
    const node = this.startNode();
    node.typeName = this.tsParseEntityName(1);
    if (!this.hasPrecedingLineBreak() && this.match(43)) {
      node.typeArguments = this.tsParseTypeArguments();
    }
    return this.finishNode(node, "TSTypeReference");
  }
  tsParseThisTypePredicate(lhs) {
    this.next();
    const node = this.startNodeAtNode(lhs);
    node.parameterName = lhs;
    node.typeAnnotation = this.tsParseTypeAnnotation(false);
    node.asserts = false;
    return this.finishNode(node, "TSTypePredicate");
  }
  tsParseThisTypeNode() {
    const node = this.startNode();
    this.next();
    return this.finishNode(node, "TSThisType");
  }
  tsParseTypeQuery() {
    const node = this.startNode();
    this.expect(83);
    if (this.match(79)) {
      node.exprName = this.tsParseImportType();
    } else {
      node.exprName = this.tsParseEntityName(1);
    }
    if (!this.hasPrecedingLineBreak() && this.match(43)) {
      node.typeArguments = this.tsParseTypeArguments();
    }
    return this.finishNode(node, "TSTypeQuery");
  }
  tsParseInOutModifiers = this.tsParseModifiers.bind(this, buildModifiersMap(["in", "out"], ["const", "public", "private", "protected", "readonly", "declare", "abstract", "override"]), TSErrors.InvalidModifierOnTypeParameter);
  tsParseConstModifier = this.tsParseModifiers.bind(this, buildModifiersMap(["const"], ["in", "out"]), TSErrors.InvalidModifierOnTypeParameterPositions);
  tsParseInOutConstModifiers = this.tsParseModifiers.bind(this, buildModifiersMap(["in", "out", "const"], ["public", "private", "protected", "readonly", "declare", "abstract", "override"]), TSErrors.InvalidModifierOnTypeParameter);
  tsParseTypeParameter(parseModifiers) {
    const node = this.startNode();
    parseModifiers(node);
    node.name = this.tsParseTypeParameterName();
    node.constraint = this.tsEatThenParseType(77);
    node.default = this.tsEatThenParseType(25);
    return this.finishNode(node, "TSTypeParameter");
  }
  tsTryParseTypeParameters(parseModifiers) {
    if (this.match(43)) {
      return this.tsParseTypeParameters(parseModifiers);
    }
  }
  tsParseTypeParameters(parseModifiers) {
    const node = this.startNode();
    if (this.match(43) || this.match(141)) {
      this.next();
    } else {
      this.unexpected();
    }
    const refTrailingCommaPos = {
      value: -1
    };
    node.params = this.tsParseBracketedList("TypeParametersOrArguments", this.tsParseTypeParameter.bind(this, parseModifiers), false, true, refTrailingCommaPos);
    if (node.params.length === 0) {
      this.raise(TSErrors.EmptyTypeParameters, node);
    }
    if (refTrailingCommaPos.value !== -1) {
      this.addExtra(node, "trailingComma", refTrailingCommaPos.value);
    }
    return this.finishNode(node, "TSTypeParameterDeclaration");
  }
  tsFillSignature(returnToken, signature) {
    const returnTokenRequired = returnToken === 15;
    const paramsKey = "params";
    const returnTypeKey = "returnType";
    signature.typeParameters = this.tsTryParseTypeParameters(this.tsParseConstModifier);
    this.expect(6);
    signature[paramsKey] = this.tsParseBindingListForSignature();
    if (returnTokenRequired) {
      signature[returnTypeKey] = this.tsParseTypeOrTypePredicateAnnotation(returnToken);
    } else if (this.match(returnToken)) {
      signature[returnTypeKey] = this.tsParseTypeOrTypePredicateAnnotation(returnToken);
    }
  }
  tsParseBindingListForSignature() {
    const list = super.parseBindingList(7, 41, 2);
    for (const pattern of list) {
      const {
        type
      } = pattern;
      if (type === "AssignmentPattern" || type === "TSParameterProperty") {
        this.raise(TSErrors.UnsupportedSignatureParameterKind, pattern, {
          type
        });
      }
    }
    return list;
  }
  tsParseTypeMemberSemicolon() {
    if (!this.eat(8) && !this.isLineTerminator()) {
      this.expect(9);
    }
  }
  tsParseSignatureMember(kind, node) {
    this.tsFillSignature(10, node);
    this.tsParseTypeMemberSemicolon();
    return this.finishNode(node, kind);
  }
  tsIsUnambiguouslyIndexSignature() {
    this.next();
    if (tokenIsIdentifier(this.state.type)) {
      this.next();
      return this.match(10);
    }
    return false;
  }
  tsTryParseIndexSignature(node) {
    if (!(this.match(0) && this.tsLookAhead(this.tsIsUnambiguouslyIndexSignature.bind(this)))) {
      return;
    }
    this.expect(0);
    const id = this.parseIdentifier();
    id.typeAnnotation = this.tsParseTypeAnnotation();
    this.resetEndLocation(id);
    this.expect(1);
    node.parameters = [id];
    const type = this.tsTryParseTypeAnnotation();
    if (type) node.typeAnnotation = type;
    this.tsParseTypeMemberSemicolon();
    return this.finishNode(node, "TSIndexSignature");
  }
  tsParsePropertyOrMethodSignature(node, readonly) {
    if (this.eat(13)) node.optional = true;
    if (this.match(6) || this.match(43)) {
      if (readonly) {
        this.raise(TSErrors.ReadonlyForMethodSignature, node);
      }
      const method = node;
      if (method.kind && this.match(43)) {
        this.raise(TSErrors.AccessorCannotHaveTypeParameters, this.state.curPosition());
      }
      this.tsFillSignature(10, method);
      this.tsParseTypeMemberSemicolon();
      if (method.kind === "get") {
        if (method.params.length > 0) {
          this.raise(Errors.BadGetterArity, this.state.curPosition());
          if (this.isThisParam(method.params[0])) {
            this.raise(TSErrors.AccessorCannotDeclareThisParameter, this.state.curPosition());
          }
        }
      } else if (method.kind === "set") {
        if (method.params.length !== 1) {
          this.raise(Errors.BadSetterArity, this.state.curPosition());
        } else {
          const firstParameter = method.params[0];
          if (this.isThisParam(firstParameter)) {
            this.raise(TSErrors.AccessorCannotDeclareThisParameter, this.state.curPosition());
          }
          if (firstParameter.type === "Identifier" && firstParameter.optional) {
            this.raise(TSErrors.SetAccessorCannotHaveOptionalParameter, this.state.curPosition());
          }
          if (firstParameter.type === "RestElement") {
            this.raise(TSErrors.SetAccessorCannotHaveRestParameter, this.state.curPosition());
          }
        }
        if (method.returnType) {
          this.raise(TSErrors.SetAccessorCannotHaveReturnType, method.returnType);
        }
      } else {
        method.kind = "method";
      }
      return this.finishNode(method, "TSMethodSignature");
    } else {
      const property = node;
      if (readonly) property.readonly = true;
      const type = this.tsTryParseTypeAnnotation();
      if (type) property.typeAnnotation = type;
      this.tsParseTypeMemberSemicolon();
      return this.finishNode(property, "TSPropertySignature");
    }
  }
  tsParseTypeMember() {
    const node = this.startNode();
    if (this.match(6) || this.match(43)) {
      return this.tsParseSignatureMember("TSCallSignatureDeclaration", node);
    }
    if (this.match(73)) {
      const id = this.startNode();
      this.next();
      if (this.match(6) || this.match(43)) {
        return this.tsParseSignatureMember("TSConstructSignatureDeclaration", node);
      } else {
        node.key = this.createIdentifier(id, "new");
        return this.tsParsePropertyOrMethodSignature(node, false);
      }
    }
    this.tsParseModifiers(IndexSignatureModifiers, void 0, node);
    const idx = this.tsTryParseIndexSignature(node);
    if (idx) {
      return idx;
    }
    super.parsePropertyName(node);
    if (!node.computed && node.key.type === "Identifier" && (node.key.name === "get" || node.key.name === "set") && this.tsTokenCanFollowModifier()) {
      node.kind = node.key.name;
      super.parsePropertyName(node);
      if (!this.match(6) && !this.match(43)) {
        this.unexpected(null, 6);
      }
    }
    return this.tsParsePropertyOrMethodSignature(node, !!node.readonly);
  }
  tsParseTypeLiteral() {
    const node = this.startNode();
    node.members = this.tsParseObjectTypeMembers();
    return this.finishNode(node, "TSTypeLiteral");
  }
  tsParseObjectTypeMembers() {
    this.expect(2);
    const members = this.tsParseList("TypeMembers", this.tsParseTypeMember.bind(this));
    this.expect(4);
    return members;
  }
  tsIsStartOfMappedType() {
    this.next();
    if (this.eat(49)) {
      return this.isContextual(121);
    }
    if (this.isContextual(121)) {
      this.next();
    }
    if (!this.match(0)) {
      return false;
    }
    this.next();
    if (!this.tsIsIdentifier()) {
      return false;
    }
    this.next();
    return this.match(54);
  }
  tsParseMappedType() {
    const node = this.startNode();
    this.expect(2);
    if (this.match(49)) {
      node.readonly = this.state.value;
      this.next();
      this.expectContextual(121);
    } else if (this.eatContextual(121)) {
      node.readonly = true;
    }
    this.expect(0);
    node.key = this.tsParseTypeParameterName();
    node.constraint = this.tsExpectThenParseType(54);
    node.nameType = this.eatContextual(90) ? this.tsParseType() : null;
    this.expect(1);
    if (this.match(49)) {
      node.optional = this.state.value;
      this.next();
      this.expect(13);
    } else if (this.eat(13)) {
      node.optional = true;
    }
    node.typeAnnotation = this.tsTryParseType();
    this.semicolon();
    this.expect(4);
    return this.finishNode(node, "TSMappedType");
  }
  tsParseTupleType() {
    const node = this.startNode();
    node.elementTypes = this.tsParseBracketedList("TupleElementTypes", this.tsParseTupleElementType.bind(this), true, false);
    let seenOptionalElement = false;
    node.elementTypes.forEach((elementNode) => {
      const {
        type
      } = elementNode;
      if (seenOptionalElement && type !== "TSRestType" && type !== "TSOptionalType" && !(type === "TSNamedTupleMember" && elementNode.optional)) {
        this.raise(TSErrors.OptionalTypeBeforeRequired, elementNode);
      }
      seenOptionalElement ||= type === "TSNamedTupleMember" && elementNode.optional || type === "TSOptionalType";
    });
    return this.finishNode(node, "TSTupleType");
  }
  tsParseTupleElementType() {
    const restStartLoc = this.state.startLoc;
    const rest = this.eat(17);
    const {
      startLoc
    } = this.state;
    let labeled;
    let label;
    let optional;
    let type;
    const isWord = tokenIsKeywordOrIdentifier(this.state.type);
    const chAfterWord = isWord ? this.lookaheadCharCode() : null;
    if (chAfterWord === 58) {
      labeled = true;
      optional = false;
      label = this.parseIdentifier(true);
      this.expect(10);
      type = this.tsParseType();
    } else if (chAfterWord === 63) {
      optional = true;
      const wordName = this.state.value;
      const typeOrLabel = this.tsParseNonArrayType();
      if (this.lookaheadCharCode() === 58) {
        labeled = true;
        label = this.createIdentifier(this.startNodeAt(startLoc), wordName);
        this.expect(13);
        this.expect(10);
        type = this.tsParseType();
      } else {
        labeled = false;
        type = typeOrLabel;
        this.expect(13);
      }
    } else {
      type = this.tsParseType();
      optional = this.eat(13);
      labeled = this.eat(10);
    }
    if (labeled) {
      let labeledNode;
      if (label) {
        labeledNode = this.startNodeAt(startLoc);
        labeledNode.optional = optional;
        labeledNode.label = label;
        labeledNode.elementType = type;
        if (this.eat(13)) {
          labeledNode.optional = true;
          this.raise(TSErrors.TupleOptionalAfterType, this.state.lastTokStartLoc);
        }
      } else {
        labeledNode = this.startNodeAt(startLoc);
        labeledNode.optional = optional;
        this.raise(TSErrors.InvalidTupleMemberLabel, type);
        labeledNode.label = type;
        labeledNode.elementType = this.tsParseType();
      }
      type = this.finishNode(labeledNode, "TSNamedTupleMember");
    } else if (optional) {
      const optionalTypeNode = this.startNodeAt(startLoc);
      optionalTypeNode.typeAnnotation = type;
      type = this.finishNode(optionalTypeNode, "TSOptionalType");
    }
    if (rest) {
      const restNode = this.startNodeAt(restStartLoc);
      restNode.typeAnnotation = type;
      type = this.finishNode(restNode, "TSRestType");
    }
    return type;
  }
  tsParseParenthesizedType() {
    const node = this.startNode();
    this.expect(6);
    node.typeAnnotation = this.tsParseType();
    this.expect(7);
    return this.finishNode(node, "TSParenthesizedType");
  }
  tsParseFunctionOrConstructorType(type, abstract) {
    const node = this.startNode();
    if (type === "TSConstructorType") {
      node.abstract = !!abstract;
      if (abstract) this.next();
      this.next();
    }
    this.tsInAllowConditionalTypesContext(() => this.tsFillSignature(15, node));
    return this.finishNode(node, type);
  }
  tsParseLiteralTypeNode() {
    const node = this.startNode();
    switch (this.state.type) {
      case 134:
      case 135:
      case 133:
      case 81:
      case 82:
        node.literal = super.parseExprAtom();
        break;
      default:
        this.unexpected();
    }
    return this.finishNode(node, "TSLiteralType");
  }
  tsParseTemplateLiteralType() {
    const startLoc = this.state.startLoc;
    let curElt = this.parseTemplateElement(false);
    const quasis = [curElt];
    if (curElt.tail) {
      const node = this.startNodeAt(startLoc);
      const literal = this.startNodeAt(startLoc);
      literal.expressions = [];
      literal.quasis = quasis;
      node.literal = this.finishNode(literal, "TemplateLiteral");
      return this.finishNode(node, "TSLiteralType");
    } else {
      const substitutions = [];
      while (!curElt.tail) {
        substitutions.push(this.tsParseType());
        this.readTemplateContinuation();
        quasis.push(curElt = this.parseTemplateElement(false));
      }
      const node = this.startNodeAt(startLoc);
      node.types = substitutions;
      node.quasis = quasis;
      return this.finishNode(node, "TSTemplateLiteralType");
    }
  }
  parseTemplateSubstitution() {
    if (this.state.inType) return this.tsParseType();
    return super.parseTemplateSubstitution();
  }
  tsParseThisTypeOrThisTypePredicate() {
    const thisKeyword = this.tsParseThisTypeNode();
    if (this.isContextual(115) && !this.hasPrecedingLineBreak()) {
      return this.tsParseThisTypePredicate(thisKeyword);
    } else {
      return thisKeyword;
    }
  }
  tsParseNonArrayType() {
    switch (this.state.type) {
      case 133:
      case 134:
      case 135:
      case 81:
      case 82:
        return this.tsParseLiteralTypeNode();
      case 49:
        if (this.state.value === "-") {
          const node = this.startNode();
          const nextToken = this.lookahead();
          if (nextToken.type !== 134 && nextToken.type !== 135) {
            this.unexpected();
          }
          node.literal = this.parseMaybeUnary();
          return this.finishNode(node, "TSLiteralType");
        }
        break;
      case 74:
        return this.tsParseThisTypeOrThisTypePredicate();
      case 83:
        return this.tsParseTypeQuery();
      case 79:
        return this.tsParseImportType();
      case 2:
        return this.tsLookAhead(this.tsIsStartOfMappedType.bind(this)) ? this.tsParseMappedType() : this.tsParseTypeLiteral();
      case 0:
        return this.tsParseTupleType();
      case 6:
        if (!(this.optionFlags & 2048)) {
          const startLoc = this.state.startLoc;
          this.next();
          const type = this.tsParseType();
          this.expect(7);
          this.addExtra(type, "parenthesized", true);
          this.addExtra(type, "parenStart", startLoc.index);
          return type;
        }
        return this.tsParseParenthesizedType();
      case 21:
      case 20:
        return this.tsParseTemplateLiteralType();
      default: {
        const {
          type
        } = this.state;
        if (tokenIsIdentifier(type) || type === 84 || type === 80) {
          const nodeType = type === 84 ? "TSVoidKeyword" : type === 80 ? "TSNullKeyword" : keywordTypeFromName(this.state.value);
          if (nodeType !== void 0 && this.lookaheadCharCode() !== 46) {
            const node = this.startNode();
            this.next();
            return this.finishNode(node, nodeType);
          }
          return this.tsParseTypeReference();
        }
      }
    }
    throw this.unexpected();
  }
  tsParseArrayTypeOrHigher() {
    const {
      startLoc
    } = this.state;
    let type = this.tsParseNonArrayType();
    while (!this.hasPrecedingLineBreak() && this.eat(0)) {
      if (this.match(1)) {
        const node = this.startNodeAt(startLoc);
        node.elementType = type;
        this.expect(1);
        type = this.finishNode(node, "TSArrayType");
      } else {
        const node = this.startNodeAt(startLoc);
        node.objectType = type;
        node.indexType = this.tsParseType();
        this.expect(1);
        type = this.finishNode(node, "TSIndexedAccessType");
      }
    }
    return type;
  }
  tsParseTypeOperator() {
    const node = this.startNode();
    const operator = this.state.value;
    this.next();
    node.operator = operator;
    node.typeAnnotation = this.tsParseTypeOperatorOrHigher();
    if (operator === "readonly") {
      this.tsCheckTypeAnnotationForReadOnly(node);
    }
    return this.finishNode(node, "TSTypeOperator");
  }
  tsCheckTypeAnnotationForReadOnly(node) {
    switch (node.typeAnnotation.type) {
      case "TSTupleType":
      case "TSArrayType":
        return;
      default:
        this.raise(TSErrors.UnexpectedReadonly, node);
    }
  }
  tsParseInferType() {
    const node = this.startNode();
    this.expectContextual(114);
    const typeParameter = this.startNode();
    typeParameter.name = this.tsParseTypeParameterName();
    typeParameter.constraint = this.tsTryParse(() => this.tsParseConstraintForInferType());
    node.typeParameter = this.finishNode(typeParameter, "TSTypeParameter");
    return this.finishNode(node, "TSInferType");
  }
  tsParseConstraintForInferType() {
    if (this.eat(77)) {
      const constraint = this.tsInDisallowConditionalTypesContext(() => this.tsParseType());
      if (this.state.inDisallowConditionalTypesContext || !this.match(13)) {
        return constraint;
      }
    }
  }
  tsParseTypeOperatorOrHigher() {
    const isTypeOperator = tokenIsTSTypeOperator(this.state.type) && !this.state.containsEsc;
    return isTypeOperator ? this.tsParseTypeOperator() : this.isContextual(114) ? this.tsParseInferType() : this.tsInAllowConditionalTypesContext(() => this.tsParseArrayTypeOrHigher());
  }
  tsParseUnionOrIntersectionType(kind, parseConstituentType, operator) {
    const node = this.startNode();
    const hasLeadingOperator = this.eat(operator);
    const types2 = [];
    do {
      types2.push(parseConstituentType());
    } while (this.eat(operator));
    if (types2.length === 1 && !hasLeadingOperator) {
      return types2[0];
    }
    node.types = types2;
    return this.finishNode(node, kind);
  }
  tsParseIntersectionTypeOrHigher() {
    return this.tsParseUnionOrIntersectionType("TSIntersectionType", this.tsParseTypeOperatorOrHigher.bind(this), 41);
  }
  tsParseUnionTypeOrHigher() {
    return this.tsParseUnionOrIntersectionType("TSUnionType", this.tsParseIntersectionTypeOrHigher.bind(this), 39);
  }
  tsIsStartOfFunctionType() {
    if (this.match(43)) {
      return true;
    }
    return this.match(6) && this.tsLookAhead(this.tsIsUnambiguouslyStartOfFunctionType.bind(this));
  }
  tsSkipParameterStart() {
    if (tokenIsIdentifier(this.state.type) || this.match(74)) {
      this.next();
      return true;
    }
    const isObjectPattern = this.match(2);
    if (isObjectPattern || this.match(0)) {
      if (!isObjectPattern) this.next();
      const {
        errors
      } = this.state;
      const previousErrorCount = errors.length;
      const scopeStacksSnapshot = this.snapshotScopeStacks();
      try {
        if (isObjectPattern) {
          this.parseObjectLike(4, true);
        } else {
          super.parseBindingList(1, 93, 1);
        }
        return errors.length === previousErrorCount;
      } catch {
        this.restoreScopeStacks(scopeStacksSnapshot);
        return false;
      }
    }
    return false;
  }
  tsIsUnambiguouslyStartOfFunctionType() {
    this.next();
    if (this.match(7) || this.match(17)) {
      return true;
    }
    if (this.tsSkipParameterStart()) {
      if (this.match(10) || this.match(8) || this.match(13) || this.match(25)) {
        return true;
      }
      if (this.match(7)) {
        this.next();
        if (this.match(15)) {
          return true;
        }
      }
    }
    return false;
  }
  tsParseTypeOrTypePredicateAnnotation(returnToken) {
    return this.tsInType(() => {
      const t = this.startNode();
      this.expect(returnToken);
      const node = this.startNode();
      const asserts = !!this.tsTryParse(this.tsParseTypePredicateAsserts.bind(this));
      if (asserts && this.match(74)) {
        let thisTypePredicate = this.tsParseThisTypeOrThisTypePredicate();
        if (thisTypePredicate.type === "TSThisType") {
          node.parameterName = thisTypePredicate;
          node.asserts = true;
          node.typeAnnotation = null;
          thisTypePredicate = this.finishNode(node, "TSTypePredicate");
        } else {
          this.resetStartLocationFromNode(thisTypePredicate, node);
          thisTypePredicate.asserts = true;
        }
        t.typeAnnotation = thisTypePredicate;
        return this.finishNode(t, "TSTypeAnnotation");
      }
      const typePredicateVariable = this.tsIsIdentifier() && this.tsTryParse(this.tsParseTypePredicatePrefix.bind(this));
      if (!typePredicateVariable) {
        if (!asserts) {
          return this.tsParseTypeAnnotation(false, t);
        }
        node.parameterName = this.parseIdentifier();
        node.asserts = asserts;
        node.typeAnnotation = null;
        t.typeAnnotation = this.finishNode(node, "TSTypePredicate");
        return this.finishNode(t, "TSTypeAnnotation");
      }
      const type = this.tsParseTypeAnnotation(false);
      node.parameterName = typePredicateVariable;
      node.typeAnnotation = type;
      node.asserts = asserts;
      t.typeAnnotation = this.finishNode(node, "TSTypePredicate");
      return this.finishNode(t, "TSTypeAnnotation");
    });
  }
  tsTryParseTypeOrTypePredicateAnnotation() {
    if (this.match(10)) {
      return this.tsParseTypeOrTypePredicateAnnotation(10);
    }
  }
  tsTryParseTypeAnnotation() {
    if (this.match(10)) {
      return this.tsParseTypeAnnotation();
    }
  }
  tsTryParseType() {
    return this.tsEatThenParseType(10);
  }
  tsParseTypePredicatePrefix() {
    const id = this.parseIdentifier();
    if (this.isContextual(115) && !this.hasPrecedingLineBreak()) {
      this.next();
      return id;
    }
  }
  tsParseTypePredicateAsserts() {
    if (this.state.type !== 108) {
      return false;
    }
    const containsEsc = this.state.containsEsc;
    this.next();
    if (!tokenIsIdentifier(this.state.type) && !this.match(74)) {
      return false;
    }
    if (containsEsc) {
      this.raise(Errors.InvalidEscapedReservedWord, this.state.lastTokStartLoc, {
        reservedWord: "asserts"
      });
    }
    return true;
  }
  tsParseTypeAnnotation(eatColon = true, t = this.startNode()) {
    this.tsInType(() => {
      if (eatColon) this.expect(10);
      t.typeAnnotation = this.tsParseType();
    });
    return this.finishNode(t, "TSTypeAnnotation");
  }
  tsParseType() {
    assert(this.state.inType);
    const type = this.tsParseNonConditionalType();
    if (this.state.inDisallowConditionalTypesContext || this.hasPrecedingLineBreak() || !this.eat(77)) {
      return type;
    }
    const node = this.startNodeAtNode(type);
    node.checkType = type;
    node.extendsType = this.tsInDisallowConditionalTypesContext(() => this.tsParseNonConditionalType());
    this.expect(13);
    node.trueType = this.tsInAllowConditionalTypesContext(() => this.tsParseType());
    this.expect(10);
    node.falseType = this.tsInAllowConditionalTypesContext(() => this.tsParseType());
    return this.finishNode(node, "TSConditionalType");
  }
  isAbstractConstructorSignature() {
    return this.isContextual(123) && this.isLookaheadContextual("new");
  }
  tsParseNonConditionalType() {
    if (this.tsIsStartOfFunctionType()) {
      return this.tsParseFunctionOrConstructorType("TSFunctionType");
    }
    if (this.match(73)) {
      return this.tsParseFunctionOrConstructorType("TSConstructorType");
    } else if (this.isAbstractConstructorSignature()) {
      return this.tsParseFunctionOrConstructorType("TSConstructorType", true);
    }
    return this.tsParseUnionTypeOrHigher();
  }
  tsParseTypeAssertion() {
    if (this.getPluginOption("typescript", "disallowAmbiguousJSXLike")) {
      this.raise(TSErrors.ReservedTypeAssertion, this.state.startLoc);
    }
    const node = this.startNode();
    node.typeAnnotation = this.tsInType(() => {
      this.next();
      return this.match(71) ? this.tsParseTypeReference() : this.tsParseType();
    });
    this.expect(44);
    this.state.canStartArrow = false;
    node.expression = this.parseMaybeUnary();
    return this.finishNode(node, "TSTypeAssertion");
  }
  tsParseHeritageClause(token) {
    const originalStartLoc = this.state.startLoc;
    const delimitedList = this.tsParseDelimitedList("HeritageClauseElement", () => {
      const expression = (this.state.canStartArrow = false, super.parseExprSubscripts());
      if (!tsIsEntityName(expression)) {
        this.raise(TSErrors.InvalidHeritageClauseType, expression.start, {
          token
        });
      }
      const nodeType = token === "extends" ? "TSInterfaceHeritage" : "TSClassImplements";
      if (expression.type === "TSInstantiationExpression") {
        expression.type = nodeType;
        return expression;
      }
      const node = this.startNodeAtNode(expression);
      node.expression = expression;
      if (this.match(43) || this.match(47)) {
        node.typeArguments = this.tsParseTypeArgumentsInExpression();
      }
      return this.finishNode(node, nodeType);
    });
    if (!delimitedList.length) {
      this.raise(TSErrors.EmptyHeritageClauseType, originalStartLoc, {
        token
      });
    }
    return delimitedList;
  }
  tsParseInterfaceDeclaration(node, properties = {}) {
    if (this.hasFollowingLineBreak()) return null;
    this.expectContextual(128);
    if (properties.declare) node.declare = true;
    if (tokenIsIdentifier(this.state.type)) {
      node.id = this.parseIdentifier();
      this.checkIdentifier(node.id, 130);
    } else {
      node.id = null;
      this.raise(TSErrors.MissingInterfaceName, this.state.startLoc);
    }
    node.typeParameters = this.tsTryParseTypeParameters(this.tsParseInOutConstModifiers);
    if (this.eat(77)) {
      node.extends = this.tsParseHeritageClause("extends");
    }
    const body = this.startNode();
    body.body = this.tsInType(this.tsParseObjectTypeMembers.bind(this));
    node.body = this.finishNode(body, "TSInterfaceBody");
    return this.finishNode(node, "TSInterfaceDeclaration");
  }
  tsParseTypeAliasDeclaration(node) {
    node.id = this.parseIdentifier();
    this.checkIdentifier(node.id, 2);
    node.typeAnnotation = this.tsInType(() => {
      node.typeParameters = this.tsTryParseTypeParameters(this.tsParseInOutModifiers);
      this.expect(25);
      if (this.isContextual(113) && this.lookaheadCharCode() !== 46) {
        const node2 = this.startNode();
        this.next();
        return this.finishNode(node2, "TSIntrinsicKeyword");
      }
      return this.tsParseType();
    });
    this.semicolon();
    return this.finishNode(node, "TSTypeAliasDeclaration");
  }
  tsInTopLevelContext(cb) {
    if (this.curContext() !== types.brace) {
      const oldContext = this.state.context;
      this.state.context = [oldContext[0]];
      try {
        return cb();
      } finally {
        this.state.context = oldContext;
      }
    } else {
      return cb();
    }
  }
  tsInType(cb) {
    const oldInType = this.state.inType;
    this.state.inType = true;
    try {
      return cb();
    } finally {
      this.state.inType = oldInType;
    }
  }
  tsInDisallowConditionalTypesContext(cb) {
    const oldInDisallowConditionalTypesContext = this.state.inDisallowConditionalTypesContext;
    this.state.inDisallowConditionalTypesContext = true;
    try {
      return cb();
    } finally {
      this.state.inDisallowConditionalTypesContext = oldInDisallowConditionalTypesContext;
    }
  }
  tsInAllowConditionalTypesContext(cb) {
    const oldInDisallowConditionalTypesContext = this.state.inDisallowConditionalTypesContext;
    this.state.inDisallowConditionalTypesContext = false;
    try {
      return cb();
    } finally {
      this.state.inDisallowConditionalTypesContext = oldInDisallowConditionalTypesContext;
    }
  }
  tsEatThenParseType(token) {
    if (this.match(token)) {
      return this.tsNextThenParseType();
    }
  }
  tsExpectThenParseType(token) {
    return this.tsInType(() => {
      this.expect(token);
      return this.tsParseType();
    });
  }
  tsNextThenParseType() {
    return this.tsInType(() => {
      this.next();
      return this.tsParseType();
    });
  }
  tsParseEnumMember() {
    const node = this.startNode();
    node.id = this.match(133) ? super.parseStringLiteral(this.state.value) : this.parseIdentifier(true);
    if (this.eat(25)) {
      node.initializer = super.parseMaybeAssignAllowIn();
    }
    return this.finishNode(node, "TSEnumMember");
  }
  tsParseEnumDeclaration(node, properties = {}) {
    if (properties.const) node.const = true;
    if (properties.declare) node.declare = true;
    this.expectContextual(125);
    node.id = this.parseIdentifier();
    this.checkIdentifier(node.id, node.const ? 8971 : 8459);
    node.body = this.tsParseEnumBody();
    return this.finishNode(node, "TSEnumDeclaration");
  }
  tsParseEnumBody() {
    const node = this.startNode();
    this.expect(2);
    node.members = this.tsParseDelimitedList("EnumMembers", this.tsParseEnumMember.bind(this));
    this.expect(4);
    return this.finishNode(node, "TSEnumBody");
  }
  tsParseModuleBlock(isGlobal) {
    const node = this.startNode();
    if (!isGlobal) {
      this.scope.enter(0);
    }
    this.expect(2);
    super.parseBlockOrModuleBlockBody(node.body = [], void 0, true, 4);
    if (!isGlobal) {
      this.scope.exit();
    }
    return this.finishNode(node, "TSModuleBlock");
  }
  tsParseNamespaceDeclaration(node) {
    node.id = this.tsParseEntityName(0);
    if (node.id.type === "Identifier") {
      this.checkIdentifier(node.id, 1024);
    }
    this.scope.enter(2048);
    this.prodParam.enter(0);
    node.body = this.tsParseModuleBlock(false);
    this.prodParam.exit();
    this.scope.exit();
    return this.finishNode(node, "TSModuleDeclaration");
  }
  tsParseAmbientExternalModuleDeclaration(node) {
    const isGlobal = this.isContextual(111);
    if (isGlobal) {
      node.kind = "global";
      node.id = this.parseIdentifier();
    } else {
      node.kind = "module";
      const {
        type,
        value
      } = this.state;
      if (type === 133) {
        node.id = super.parseStringLiteral(value);
      } else if (tokenIsIdentifier(type)) {
        this.raise(TSErrors.InlineModuleDeclarationMustUseString, this.state.startLoc);
        node.id = this.tsParseEntityName(0);
      } else if (type === 2) {
        this.raise(TSErrors.EmptyNamespaceName, this.state.startLoc);
      } else {
        this.raise(TSErrors.InvalidNamespaceName, this.state.startLoc, value);
        node.id = super.parseExprAtom();
      }
    }
    if (this.match(2)) {
      if (!isGlobal) {
        this.scope.enter(1024);
      }
      this.prodParam.enter(0);
      node.body = this.tsParseModuleBlock(isGlobal);
      this.prodParam.exit();
      if (!isGlobal) {
        this.scope.exit();
      }
    } else {
      this.semicolon();
    }
    return this.finishNode(node, "TSModuleDeclaration");
  }
  tsParseImportEqualsDeclaration(node, maybeDefaultIdentifier) {
    node.id = maybeDefaultIdentifier || this.parseIdentifier();
    this.checkIdentifier(node.id, 4096);
    this.expect(25);
    const moduleReference = this.tsParseModuleReference();
    if (node.importKind === "type" && moduleReference.type !== "TSExternalModuleReference") {
      this.raise(TSErrors.ImportAliasHasImportType, moduleReference);
    }
    node.moduleReference = moduleReference;
    this.semicolon();
    return this.finishNode(node, "TSImportEqualsDeclaration");
  }
  tsIsExternalModuleReference() {
    return this.isContextual(118) && this.lookaheadCharCode() === 40;
  }
  tsParseModuleReference() {
    return this.tsIsExternalModuleReference() ? this.tsParseExternalModuleReference() : this.tsParseEntityName(0);
  }
  tsParseExternalModuleReference() {
    const node = this.startNode();
    this.expectContextual(118);
    this.expect(6);
    if (!this.match(133)) {
      this.unexpected();
    }
    node.expression = super.parseExprAtom();
    this.expect(7);
    this.sawUnambiguousESM = true;
    return this.finishNode(node, "TSExternalModuleReference");
  }
  tsLookAhead(f) {
    const state = this.state.clone();
    const res = f();
    this.state = state;
    return res;
  }
  tsTryParseAndCatch(f) {
    const result = this.tryParse((abort) => f() || abort());
    if (result.aborted || !result.node) return;
    if (result.error) this.state = result.failState;
    return result.node;
  }
  tsTryParse(f) {
    const state = this.state.clone();
    const result = f();
    if (result !== void 0 && result !== false) {
      return result;
    }
    this.state = state;
  }
  tsTryParseDeclare(node) {
    if (this.isLineTerminator()) {
      return;
    }
    const startType = this.state.type;
    return this.tsInAmbientContext(() => {
      switch (startType) {
        case 64:
          node.declare = true;
          return super.parseFunctionStatement(node, false, 2);
        case 76:
          node.declare = true;
          return this.parseClass(node, true, false);
        case 125:
          return this.tsParseEnumDeclaration(node, {
            declare: true
          });
        case 111:
          return this.tsParseAmbientExternalModuleDeclaration(node);
        case 97:
          if (this.state.containsEsc) {
            return;
          }
        case 71:
        case 70:
          if (!this.match(71) || !this.isLookaheadContextual("enum")) {
            node.declare = true;
            return this.parseVarStatement(node, this.state.value, true);
          }
          this.expect(71);
          return this.tsParseEnumDeclaration(node, {
            const: true,
            declare: true
          });
        case 106:
          if (this.isUsing()) {
            this.raise(TSErrors.InvalidModifierOnUsingDeclaration, this.state.startLoc, "declare");
            node.declare = true;
            return this.parseVarStatement(node, "using", true);
          }
          break;
        case 93:
          if (this.isAwaitUsing()) {
            this.raise(TSErrors.InvalidModifierOnAwaitUsingDeclaration, this.state.startLoc, "declare");
            node.declare = true;
            this.next();
            return this.parseVarStatement(node, "await using", true);
          }
          break;
        case 128: {
          const result = this.tsParseInterfaceDeclaration(node, {
            declare: true
          });
          if (result) return result;
        }
        default:
          if (tokenIsIdentifier(startType)) {
            return this.tsParseDeclaration(node, this.state.type, true, null);
          }
      }
    });
  }
  tsTryParseExportDeclaration() {
    return this.tsParseDeclaration(this.startNode(), this.state.type, true, null);
  }
  tsParseDeclaration(node, type, next, decorators) {
    switch (type) {
      case 123:
        if (this.tsCheckLineTerminator(next) && (this.match(76) || tokenIsIdentifier(this.state.type))) {
          return this.tsParseAbstractDeclaration(node, decorators);
        }
        break;
      case 126:
        if (this.tsCheckLineTerminator(next)) {
          return this.tsParseAmbientExternalModuleDeclaration(node);
        }
        break;
      case 127:
        if (this.tsCheckLineTerminator(next) && tokenIsIdentifier(this.state.type)) {
          node.kind = "namespace";
          return this.tsParseNamespaceDeclaration(node);
        }
        break;
      case 129:
        if (this.tsCheckLineTerminator(next) && tokenIsIdentifier(this.state.type)) {
          return this.tsParseTypeAliasDeclaration(node);
        }
        break;
    }
  }
  tsCheckLineTerminator(next) {
    if (next) {
      if (this.hasFollowingLineBreak()) return false;
      this.next();
      return true;
    }
    return !this.isLineTerminator();
  }
  tsTryParseGenericAsyncArrowFunction(startLoc) {
    if (!this.match(43)) return;
    const res = this.tsTryParseAndCatch(() => {
      const node = this.startNodeAt(startLoc);
      node.typeParameters = this.tsParseTypeParameters(this.tsParseConstModifier);
      super.parseFunctionParams(node);
      node.returnType = this.tsTryParseTypeOrTypePredicateAnnotation();
      this.expect(15);
      return node;
    });
    if (!res) return;
    return super.parseArrowExpression(res, null, true);
  }
  tsParseTypeArgumentsInExpression() {
    if (this.reScan_lt() !== 43) return;
    return this.tsParseTypeArguments();
  }
  tsParseTypeArguments() {
    const node = this.startNode();
    node.params = this.tsInType(() => this.tsInTopLevelContext(() => {
      this.expect(43);
      return this.tsParseDelimitedList("TypeParametersOrArguments", this.tsParseType.bind(this));
    }));
    if (node.params.length === 0) {
      this.raise(TSErrors.EmptyTypeArguments, node);
    } else if (!this.state.inType && this.curContext() === types.brace) {
      this.reScan_lt_gt();
    }
    this.expect(44);
    return this.finishNode(node, "TSTypeParameterInstantiation");
  }
  tsIsDeclarationStart() {
    return tokenIsTSDeclarationStart(this.state.type);
  }
  isExportDefaultSpecifier() {
    if (this.tsIsDeclarationStart()) return false;
    return super.isExportDefaultSpecifier();
  }
  parseBindingElement(flags, decorators) {
    const startLoc = decorators.length ? null : this.state.startLoc;
    const modified = {};
    this.tsParseModifiers(BindingElementModifiers, void 0, modified);
    const accessibility = modified.accessibility;
    const override = modified.override;
    const readonly = modified.readonly;
    if (!(flags & 4) && (accessibility || readonly || override)) {
      this.raise(TSErrors.UnexpectedParameterModifier, startLoc || decorators[0]);
    }
    const startLoc2 = this.state.startLoc;
    const left = this.parseMaybeDefault(startLoc2);
    if (flags & 2) {
      this.parseFunctionParamType(left);
    }
    const elt = this.parseMaybeDefault(startLoc2, left);
    if (accessibility || readonly || override) {
      const pp = startLoc ? this.startNodeAt(startLoc) : this.startNodeAtNode(decorators[0]);
      if (decorators.length) {
        pp.decorators = decorators;
      }
      if (accessibility) pp.accessibility = accessibility;
      if (readonly) pp.readonly = readonly;
      if (override) pp.override = override;
      if (elt.type !== "Identifier" && elt.type !== "AssignmentPattern") {
        this.raise(TSErrors.UnsupportedParameterPropertyKind, startLoc || decorators[0]);
      }
      pp.parameter = elt;
      return this.finishNode(pp, "TSParameterProperty");
    }
    if (decorators.length) {
      left.decorators = decorators;
    }
    return elt;
  }
  isSimpleParameter(node) {
    return node.type === "TSParameterProperty" && super.isSimpleParameter(node.parameter) || super.isSimpleParameter(node);
  }
  tsDisallowOptionalPattern(node) {
    for (const param of node.params) {
      if (param.type !== "Identifier" && param.optional && !this.state.isAmbientContext) {
        this.raise(TSErrors.PatternIsOptional, param);
      }
    }
  }
  setArrowFunctionParameters(node, params, trailingCommaLoc) {
    super.setArrowFunctionParameters(node, params, trailingCommaLoc);
    this.tsDisallowOptionalPattern(node);
  }
  parseFunctionBodyAndFinish(node, type, isMethod = false) {
    if (this.match(10)) {
      node.returnType = this.tsParseTypeOrTypePredicateAnnotation(10);
    }
    const bodilessType = type === "FunctionDeclaration" ? "TSDeclareFunction" : type === "ClassMethod" || type === "ClassPrivateMethod" ? "TSDeclareMethod" : void 0;
    if (bodilessType && !this.match(2) && this.isLineTerminator()) {
      if (bodilessType === "TSDeclareMethod" && node.kind === "constructor") {
        for (const param of node.params) {
          if (param.type === "TSParameterProperty") {
            this.raise(TSErrors.UnexpectedParameterModifier, param);
          } else if (param.type === "AssignmentPattern") {
            this.raise(TSErrors.UnexpectedParameterInitializer, param);
          }
        }
      } else {
        for (const param of node.params) {
          if (param.type === "AssignmentPattern") {
            this.raise(TSErrors.UnexpectedParameterInitializer, param);
          }
        }
      }
      return this.finishNode(node, bodilessType);
    }
    if (bodilessType && this.state.isAmbientContext) {
      this.raise(TSErrors.DeclareFunctionHasImplementation, this.state.startLoc);
      if (bodilessType === "TSDeclareFunction" && node.declare) {
        return super.parseFunctionBodyAndFinish(node, bodilessType, isMethod);
      }
    }
    this.tsDisallowOptionalPattern(node);
    return super.parseFunctionBodyAndFinish(node, type, isMethod);
  }
  registerFunctionStatementId(node) {
    if (!node.body && node.id) {
      this.checkIdentifier(node.id, 1024);
    } else {
      super.registerFunctionStatementId(node);
    }
  }
  tsCheckForInvalidTypeCasts(items) {
    items.forEach((node) => {
      if (node?.type === "TSTypeCastExpression") {
        this.raise(TSErrors.UnexpectedTypeAnnotation, node.typeAnnotation);
      }
    });
  }
  toReferencedList(exprList, isInParens) {
    this.tsCheckForInvalidTypeCasts(exprList);
    return exprList;
  }
  parseArrayLike(close, refExpressionErrors) {
    const node = super.parseArrayLike(close, refExpressionErrors);
    if (node.type === "ArrayExpression") {
      this.tsCheckForInvalidTypeCasts(node.elements);
    }
    return node;
  }
  parseSubscript(base, startLoc, noCalls, state) {
    if (!this.hasPrecedingLineBreak() && this.match(31)) {
      this.state.canStartJSXElement = false;
      this.next();
      const nonNullExpression = this.startNodeAt(startLoc);
      nonNullExpression.expression = base;
      return this.finishNode(nonNullExpression, "TSNonNullExpression");
    }
    let isOptionalCall = false;
    if (this.match(14) && this.lookaheadCharCode() === 60) {
      if (noCalls) {
        state.stop = true;
        return base;
      }
      state.optionalChainMember = isOptionalCall = true;
      this.next();
    }
    if (this.match(43) || this.match(47)) {
      let missingParenErrorLoc;
      const result = this.tsTryParseAndCatch(() => {
        if (!noCalls && this.atPossibleAsyncArrow(base)) {
          const asyncArrowFn = this.tsTryParseGenericAsyncArrowFunction(startLoc);
          if (asyncArrowFn) {
            state.stop = true;
            return asyncArrowFn;
          }
        }
        const typeArguments = this.tsParseTypeArgumentsInExpression();
        if (!typeArguments) return;
        if (isOptionalCall && !this.match(6)) {
          missingParenErrorLoc = this.state.curPosition();
          return;
        }
        if (tokenIsTemplate(this.state.type)) {
          const result2 = super.parseTaggedTemplateExpression(base, startLoc, state);
          result2.typeArguments = typeArguments;
          return result2;
        }
        if (!noCalls && this.eat(6)) {
          const node2 = this.startNodeAt(startLoc);
          node2.callee = base;
          node2.arguments = this.parseCallExpressionArguments();
          this.tsCheckForInvalidTypeCasts(node2.arguments);
          node2.typeArguments = typeArguments;
          if (state.optionalChainMember) {
            node2.optional = isOptionalCall;
          }
          return this.finishCallExpression(node2, state.optionalChainMember);
        }
        const tokenType = this.state.type;
        if (tokenType === 44 || tokenType === 48 || tokenType !== 6 && tokenType !== 90 && tokenType !== 119 && tokenCanStartExpression(tokenType) && !this.hasPrecedingLineBreak()) {
          return;
        }
        const node = this.startNodeAt(startLoc);
        node.expression = base;
        node.typeArguments = typeArguments;
        return this.finishNode(node, "TSInstantiationExpression");
      });
      if (missingParenErrorLoc) {
        this.unexpected(missingParenErrorLoc, 6);
      }
      if (result) {
        if (result.type === "TSInstantiationExpression") {
          if (this.match(12) || this.match(14) && this.lookaheadCharCode() !== 40) {
            this.raise(TSErrors.InvalidPropertyAccessAfterInstantiationExpression, this.state.startLoc);
          }
          if (!this.match(12) && !this.match(14)) {
            result.expression = super.stopParseSubscript(base, state);
          }
        }
        return result;
      }
    }
    return super.parseSubscript(base, startLoc, noCalls, state);
  }
  parseNewCallee(node) {
    super.parseNewCallee(node);
    const {
      callee
    } = node;
    if (callee.type === "TSInstantiationExpression" && !callee.extra?.parenthesized) {
      node.typeArguments = callee.typeArguments;
      node.callee = callee.expression;
    }
  }
  parseExprOp(left, leftStartLoc, minPrec) {
    let isSatisfies;
    if (tokenOperatorPrecedence(54) > minPrec && !this.hasPrecedingLineBreak() && (this.isContextual(90) || (isSatisfies = this.isContextual(119)))) {
      const node = this.startNodeAt(leftStartLoc);
      node.expression = left;
      node.typeAnnotation = this.tsInType(() => {
        this.next();
        if (this.match(71)) {
          if (isSatisfies) {
            this.raise(Errors.UnexpectedKeyword, this.state.startLoc, {
              keyword: "const"
            });
          }
          return this.tsParseTypeReference();
        }
        return this.tsParseType();
      });
      const result = this.finishNode(node, isSatisfies ? "TSSatisfiesExpression" : "TSAsExpression");
      this.reScan_lt_gt();
      return this.parseExprOp(result, leftStartLoc, minPrec);
    }
    return super.parseExprOp(left, leftStartLoc, minPrec);
  }
  checkReservedWord(word, startLoc, checkKeywords, isBinding) {
    if (!this.state.isAmbientContext) {
      super.checkReservedWord(word, startLoc, checkKeywords, isBinding);
    }
  }
  checkDuplicateExports() {
  }
  isPotentialImportPhase(isExport) {
    if (super.isPotentialImportPhase(isExport)) return true;
    if (this.isContextual(129)) {
      const ch = this.lookaheadCharCode();
      return isExport ? ch === 123 || ch === 42 : ch !== 61;
    }
    return !isExport && this.isContextual(83);
  }
  applyImportPhase(node, isExport, phase, loc) {
    super.applyImportPhase(node, isExport, phase, loc);
    if (isExport) {
      node.exportKind = phase === "type" ? "type" : "value";
    } else {
      node.importKind = phase === "type" || phase === "typeof" ? phase : "value";
    }
  }
  parseImport(node) {
    if (this.match(133)) {
      node.importKind = "value";
      if (this.scope.inTSNamespace) {
        this.raise(TSErrors.ImportInTSNamespace, node);
      }
      return super.parseImport(node);
    }
    let importNode;
    if (tokenIsIdentifier(this.state.type) && this.lookaheadCharCode() === 61) {
      node.importKind = "value";
      const result = this.tsParseImportEqualsDeclaration(node);
      if (this.scope.inTSNamespace && result.moduleReference.type === "TSExternalModuleReference") {
        this.raise(TSErrors.ImportInTSNamespace, node);
      }
      return result;
    } else if (this.isContextual(129)) {
      const maybeDefaultIdentifier = this.parseMaybeImportPhase(node, false);
      if (this.lookaheadCharCode() === 61) {
        if (this.scope.inTSNamespace) {
          this.raise(TSErrors.ImportInTSNamespace, node);
        }
        return this.tsParseImportEqualsDeclaration(node, maybeDefaultIdentifier);
      } else {
        importNode = super.parseImportSpecifiersAndAfter(node, maybeDefaultIdentifier);
      }
    } else {
      importNode = super.parseImport(node);
    }
    if (importNode.importKind === "type" && importNode.specifiers.length > 1 && importNode.specifiers[0].type === "ImportDefaultSpecifier") {
      this.raise(TSErrors.TypeImportCannotSpecifyDefaultAndNamed, importNode);
    } else if (this.scope.inTSNamespace) {
      this.raise(TSErrors.ImportInTSNamespace, importNode);
    }
    return importNode;
  }
  parseExport(node, decorators) {
    if (this.match(79)) {
      const nodeImportEquals = this.startNode();
      this.next();
      let maybeDefaultIdentifier = null;
      if (this.isContextual(129) && this.isPotentialImportPhase(false)) {
        maybeDefaultIdentifier = this.parseMaybeImportPhase(nodeImportEquals, false);
      } else {
        nodeImportEquals.importKind = "value";
      }
      const declaration = this.tsParseImportEqualsDeclaration(nodeImportEquals, maybeDefaultIdentifier);
      node.attributes = [];
      node.declaration = declaration;
      node.exportKind = "value";
      node.source = null;
      node.specifiers = [];
      return this.finishNode(node, "ExportNamedDeclaration");
    } else if (this.eat(25)) {
      const assign = node;
      assign.expression = super.parseExpression();
      this.semicolon();
      this.sawUnambiguousESM = true;
      if (this.scope.inTSNamespace) {
        this.raise(TSErrors.ExportAssignmentInTSNamespace, assign);
      }
      return this.finishNode(assign, "TSExportAssignment");
    } else if (this.eatContextual(90)) {
      const decl = node;
      this.expectContextual(127);
      decl.id = this.parseIdentifier();
      this.checkIdentifier(decl.id, 8201);
      this.semicolon();
      if (this.scope.inTSNamespace) {
        this.raise(TSErrors.NamespaceExportInTSNamespace, decl);
      }
      return this.finishNode(decl, "TSNamespaceExportDeclaration");
    } else {
      const result = super.parseExport(node, decorators);
      if (this.scope.inTSNamespace && (result.type !== "ExportNamedDeclaration" || result.source || !result.declaration && !this.state.isAmbientContext)) {
        this.raise(TSErrors.ExportInTSNamespace, result);
      }
      return result;
    }
  }
  isAbstractClass() {
    return this.isContextual(123) && this.isLookaheadContextual("class");
  }
  parseExportDefaultExpression() {
    if (this.isAbstractClass()) {
      const cls = this.startNode();
      this.next();
      cls.abstract = true;
      return this.parseClass(cls, true, true);
    }
    if (this.match(128)) {
      const result = this.tsParseInterfaceDeclaration(this.startNode());
      if (result) return result;
    }
    return super.parseExportDefaultExpression();
  }
  parseVarStatement(node, kind, allowMissingInitializer = false) {
    const {
      isAmbientContext
    } = this.state;
    const declaration = super.parseVarStatement(node, kind, allowMissingInitializer || isAmbientContext);
    if (isAmbientContext && !node.declare && (kind === "using" || kind === "await using")) {
      this.raiseOverwrite(TSErrors.UsingDeclarationInAmbientContext, node, kind);
      return declaration;
    }
    for (const declarator of declaration.declarations) {
      const {
        id,
        init,
        definite
      } = declarator;
      if (definite) {
        if (init) {
          this.raise(TSErrors.DeclaratorDefiniteAssertionWithInitializer, id);
        } else if (!id.typeAnnotation) {
          this.raise(TSErrors.DeclaratorDefiniteAssertionRequiresTypeAnnotation, id);
        }
      }
      if (isAmbientContext && init) {
        if (kind === "var" || kind === "let" || !!id.typeAnnotation) {
          this.raise(TSErrors.InitializerNotAllowedInAmbientContext, init);
        } else if (!isValidAmbientConstInitializer(init, this.hasPlugin("estree"))) {
          this.raise(TSErrors.ConstInitializerMustBeStringOrNumericLiteralOrLiteralEnumReference, init);
        }
      }
    }
    return declaration;
  }
  parseStatementContent(flags, decorators) {
    const allowDeclaration = !!(flags & 2);
    if (!this.state.containsEsc) {
      switch (this.state.type) {
        case 71: {
          if (this.isLookaheadContextual("enum")) {
            const node = this.startNode();
            this.next();
            return this.tsParseEnumDeclaration(node, {
              const: true
            });
          }
          break;
        }
        case 123:
        case 124: {
          if (this.nextTokenIsIdentifierAndNotTSRelationalOperatorOnSameLine()) {
            const token = this.state.type;
            const node = this.startNode();
            this.next();
            const declaration = token === 124 ? this.tsTryParseDeclare(node) : this.tsParseAbstractDeclaration(node, decorators);
            if (declaration) {
              if (token === 124) {
                declaration.declare = true;
              }
              return declaration;
            } else {
              node.expression = this.createIdentifier(this.startNodeAtNode(node), token === 124 ? "declare" : "abstract");
              this.semicolon(false);
              return this.finishNode(node, "ExpressionStatement");
            }
          }
          break;
        }
        case 125:
          return this.tsParseEnumDeclaration(this.startNode());
        case 111: {
          const nextCh = this.lookaheadCharCode();
          if (nextCh === 123) {
            const node = this.startNode();
            return this.tsParseAmbientExternalModuleDeclaration(node);
          }
          break;
        }
        case 128: {
          const result = this.tsParseInterfaceDeclaration(this.startNode());
          if (result) {
            if (!allowDeclaration) {
              this.raise(TSErrors.UnexpectedTypeDeclaration, result, "interface");
            }
            return result;
          }
          break;
        }
        case 126: {
          if (this.nextTokenIsStringLiteralOnSameLine()) {
            const node = this.startNode();
            this.next();
            return this.tsParseDeclaration(node, 126, false, decorators);
          } else if (this.nextTokenIsIdentifierOnSameLine()) {
            this.raise(TSErrors.InlineModuleDeclarationMustUseString, this.state.startLoc);
            const node = this.startNode();
            this.next();
            return this.tsParseDeclaration(node, 127, false, decorators);
          }
          break;
        }
        case 127: {
          if (this.nextTokenIsIdentifierOnSameLine()) {
            const node = this.startNode();
            this.next();
            return this.tsParseDeclaration(node, 127, false, decorators);
          }
          break;
        }
        case 129: {
          if (this.nextTokenIsIdentifierOnSameLine()) {
            const node = this.startNode();
            if (!allowDeclaration) {
              this.raise(TSErrors.UnexpectedTypeDeclaration, node, "type");
            }
            this.next();
            return this.tsParseTypeAliasDeclaration(node);
          }
          break;
        }
      }
    }
    return super.parseStatementContent(flags, decorators);
  }
  parseAccessModifier() {
    return this.tsParseModifier(AccessModifiers);
  }
  tsHasSomeModifiers(member, modifiers) {
    return modifiers.some((modifier) => {
      if (tsIsAccessModifier(modifier)) {
        return member.accessibility === modifier;
      }
      return !!member[modifier];
    });
  }
  tsIsStartOfStaticBlocks() {
    return this.isContextual(103) && this.lookaheadCharCode() === 123;
  }
  parseClassMember(classBody, member, state) {
    this.tsParseModifiers(ClassMemberModifiers, TSErrors.InvalidModifierOnTypeParameterPositions, member, true);
    const callParseClassMemberWithIsStatic = () => {
      if (this.tsIsStartOfStaticBlocks()) {
        this.next();
        this.next();
        if (this.tsHasSomeModifiers(member, ["declare", "private", "public", "protected", "override", "abstract", "readonly", "static"])) {
          this.raise(TSErrors.StaticBlockCannotHaveModifier, this.state.curPosition());
        }
        super.parseClassStaticBlock(classBody, member);
      } else {
        this.parseClassMemberWithIsStatic(classBody, member, state, !!member.static);
      }
    };
    if (member.declare) {
      this.tsInAmbientContext(callParseClassMemberWithIsStatic);
    } else {
      callParseClassMemberWithIsStatic();
    }
    if (member.decorators && member.decorators.length > 0 && !this.hasPlugin("decorators-legacy")) {
      if (member.type === "TSAbstractMethodDefinition" || member.type === "TSDeclareMethod") {
        this.raise(TSErrors.DecoratorAbstractMethod, member, {
          kind: "abstract method"
        });
      } else if (member.type === "ClassProperty" && member.abstract || member.type === "ClassProperty" && member.declare || member.type === "TSAbstractPropertyDefinition" || member.type === "PropertyDefinition" && member.declare) {
        this.raise(TSErrors.DecoratorAbstractMethod, member, {
          kind: member.declare ? "declare field" : "abstract field"
        });
      }
    }
  }
  parseClassMemberWithIsStatic(classBody, member, state, isStatic) {
    const idx = this.tsTryParseIndexSignature(member);
    if (idx) {
      classBody.body.push(idx);
      if (member.abstract) {
        this.raise(TSErrors.IndexSignatureHasAbstract, member);
      }
      if (member.accessibility) {
        this.raise(TSErrors.IndexSignatureHasAccessibility, member, {
          modifier: member.accessibility
        });
      }
      if (member.declare) {
        this.raise(TSErrors.IndexSignatureHasDeclare, member);
      }
      if (member.override) {
        this.raise(TSErrors.IndexSignatureHasOverride, member);
      }
      return;
    }
    if (!this.state.inAbstractClass && member.abstract) {
      this.raise(TSErrors.NonAbstractClassHasAbstractMethod, member);
    }
    if (member.override) {
      if (!state.hadSuperClass) {
        this.raise(TSErrors.OverrideNotInSubClass, member);
      }
    }
    super.parseClassMemberWithIsStatic(classBody, member, state, isStatic);
  }
  parsePostMemberNameModifiers(methodOrProp) {
    const optional = this.eat(13);
    if (optional) methodOrProp.optional = true;
    if (methodOrProp.readonly && this.match(6)) {
      this.raise(TSErrors.ClassMethodHasReadonly, methodOrProp);
    }
    if (methodOrProp.declare && this.match(6)) {
      this.raise(TSErrors.ClassMethodHasDeclare, methodOrProp);
    }
  }
  shouldParseExportDeclaration() {
    if (this.tsIsDeclarationStart()) return true;
    return super.shouldParseExportDeclaration();
  }
  parseConditional(expr, startLoc, refExpressionErrors) {
    if (!this.match(13)) return expr;
    if (refExpressionErrors != null) {
      const nextCh = this.lookaheadCharCode();
      if (nextCh === 44 || nextCh === 61 || nextCh === 58 || nextCh === 41) {
        this.setOptionalParametersError(refExpressionErrors);
        return expr;
      }
    }
    this.next();
    const node = this.startNodeAt(startLoc);
    node.test = expr;
    const oldInConditionalConsequent = this.state.inConditionalConsequent;
    this.state.inConditionalConsequent = true;
    node.consequent = this.parseMaybeAssignAllowIn();
    this.state.inConditionalConsequent = oldInConditionalConsequent;
    this.expect(10);
    node.alternate = this.parseMaybeAssign();
    return this.finishNode(node, "ConditionalExpression");
  }
  parseParenItem(node, startLoc) {
    const newNode = super.parseParenItem(node, startLoc);
    if (this.eat(13)) {
      newNode.optional = true;
      this.resetEndLocation(node);
    }
    if (this.match(10)) {
      const typeCastNode = this.startNodeAt(startLoc);
      typeCastNode.expression = node;
      typeCastNode.typeAnnotation = this.tsParseTypeAnnotation();
      return this.finishNode(typeCastNode, "TSTypeCastExpression");
    }
    return node;
  }
  parseExportDeclaration(node) {
    if (!this.state.isAmbientContext && this.isContextual(124)) {
      return this.tsInAmbientContext(() => this.parseExportDeclaration(node));
    }
    const startLoc = this.state.startLoc;
    const isDeclare = this.eatContextual(124);
    if (isDeclare && (this.isContextual(124) || !this.shouldParseExportDeclaration())) {
      throw this.raise(TSErrors.ExpectedAmbientAfterExportDeclare, this.state.startLoc);
    }
    const isIdentifier = tokenIsIdentifier(this.state.type);
    const declaration = isIdentifier && this.tsTryParseExportDeclaration() || super.parseExportDeclaration(node);
    if (!declaration) return null;
    if (declaration.type === "TSInterfaceDeclaration" || declaration.type === "TSTypeAliasDeclaration" || isDeclare) {
      node.exportKind = "type";
    }
    if (isDeclare && declaration.type !== "TSImportEqualsDeclaration") {
      this.resetStartLocation(declaration, startLoc);
      declaration.declare = true;
    }
    return declaration;
  }
  parseClassId(node, isStatement, optionalId, bindingType) {
    if ((!isStatement || optionalId) && this.isContextual(112)) {
      node.id = null;
      return;
    }
    super.parseClassId(node, isStatement, optionalId, node.declare ? 1024 : 8331);
    const typeParameters = this.tsTryParseTypeParameters(this.tsParseInOutConstModifiers);
    if (typeParameters) node.typeParameters = typeParameters;
  }
  parseClassPropertyAnnotation(node) {
    if (!node.optional) {
      if (this.eat(31)) {
        node.definite = true;
      } else if (this.eat(13)) {
        node.optional = true;
      }
    }
    const type = this.tsTryParseTypeAnnotation();
    if (type) node.typeAnnotation = type;
    if (node.definite) {
      if (this.match(25)) {
        this.raise(TSErrors.DeclaratorDefiniteAssertionWithInitializer, node);
      } else if (!type) {
        this.raise(TSErrors.DeclaratorDefiniteAssertionRequiresTypeAnnotation, node);
      }
    }
  }
  parseClassProperty(node) {
    this.parseClassPropertyAnnotation(node);
    if (this.state.isAmbientContext && !(node.readonly && !node.typeAnnotation) && this.match(25)) {
      this.raise(TSErrors.DeclareClassFieldHasInitializer, this.state.startLoc);
    }
    if (node.abstract && this.match(25)) {
      const {
        key
      } = node;
      this.raise(TSErrors.AbstractPropertyHasInitializer, this.state.startLoc, {
        propertyName: key.type === "Identifier" && !node.computed ? key.name : `[${this.input.slice(this.offsetToSourcePos(key.start), this.offsetToSourcePos(key.end))}]`
      });
    }
    return super.parseClassProperty(node);
  }
  parseClassPrivateProperty(node) {
    if (node.abstract) {
      this.raise(TSErrors.PrivateElementHasAbstract, node);
    }
    if (node.accessibility) {
      this.raise(TSErrors.PrivateElementHasAccessibility, node, {
        modifier: node.accessibility
      });
    }
    this.parseClassPropertyAnnotation(node);
    return super.parseClassPrivateProperty(node);
  }
  parseClassAccessorProperty(node) {
    this.parseClassPropertyAnnotation(node);
    if (node.optional) {
      this.raise(TSErrors.AccessorCannotBeOptional, node);
    }
    return super.parseClassAccessorProperty(node);
  }
  pushClassMethod(classBody, method, isGenerator, isAsync, isConstructor, allowsDirectSuper) {
    const typeParameters = this.tsTryParseTypeParameters(this.tsParseConstModifier);
    if (typeParameters && isConstructor) {
      this.raise(TSErrors.ConstructorHasTypeParameters, typeParameters);
    }
    const {
      declare = false,
      kind
    } = method;
    if (declare && (kind === "get" || kind === "set")) {
      this.raise(TSErrors.DeclareAccessor, method, {
        kind
      });
    }
    if (typeParameters) method.typeParameters = typeParameters;
    super.pushClassMethod(classBody, method, isGenerator, isAsync, isConstructor, allowsDirectSuper);
  }
  pushClassPrivateMethod(classBody, method, isGenerator, isAsync) {
    const typeParameters = this.tsTryParseTypeParameters(this.tsParseConstModifier);
    if (typeParameters) method.typeParameters = typeParameters;
    super.pushClassPrivateMethod(classBody, method, isGenerator, isAsync);
  }
  declareClassPrivateMethodInScope(node, kind) {
    if (node.type === "TSDeclareMethod") return;
    if (node.type === "MethodDefinition" && node.value.body == null) {
      return;
    }
    super.declareClassPrivateMethodInScope(node, kind);
  }
  parseClassSuper(node) {
    super.parseClassSuper(node);
    if (node.superClass) {
      if (node.superClass.type === "TSInstantiationExpression") {
        const tsInstantiationExpression = node.superClass;
        const superClass2 = tsInstantiationExpression.expression;
        this.takeSurroundingComments(superClass2, superClass2.start, superClass2.end);
        const superTypeArguments = tsInstantiationExpression.typeArguments;
        this.takeSurroundingComments(superTypeArguments, superTypeArguments.start, superTypeArguments.end);
        node.superClass = superClass2;
        node.superTypeArguments = superTypeArguments;
      } else if (this.match(43) || this.match(47)) {
        node.superTypeArguments = this.tsParseTypeArgumentsInExpression();
      }
    }
    if (this.eatContextual(112)) {
      node.implements = this.tsParseHeritageClause("implements");
    }
  }
  parseObjPropValue(prop, startLoc, isGenerator, isAsync, isPattern, isAccessor, refExpressionErrors) {
    const typeParameters = this.tsTryParseTypeParameters(this.tsParseConstModifier);
    if (typeParameters) prop.typeParameters = typeParameters;
    return super.parseObjPropValue(prop, startLoc, isGenerator, isAsync, isPattern, isAccessor, refExpressionErrors);
  }
  parseFunctionParams(node, isConstructor) {
    const typeParameters = this.tsTryParseTypeParameters(this.tsParseConstModifier);
    if (typeParameters) node.typeParameters = typeParameters;
    super.parseFunctionParams(node, isConstructor);
  }
  parseVarId(decl, kind) {
    super.parseVarId(decl, kind);
    if (decl.id.type === "Identifier" && !this.hasPrecedingLineBreak() && this.eat(31)) {
      decl.definite = true;
    }
    const type = this.tsTryParseTypeAnnotation();
    if (type) {
      decl.id.typeAnnotation = type;
      this.resetEndLocation(decl.id);
    }
  }
  parseAsyncArrowFromCallExpression(node, call) {
    if (this.match(10)) {
      node.returnType = this.tsParseTypeAnnotation();
    }
    return super.parseAsyncArrowFromCallExpression(node, call);
  }
  parseMaybeAssign(refExpressionErrors, isParenItem) {
    let state;
    let jsx2;
    let typeCast;
    if (this.hasPlugin("jsx") && (this.match(141) || this.match(43))) {
      state = this.state.clone();
      jsx2 = this.tryParse(() => super.parseMaybeAssign(refExpressionErrors, isParenItem), state);
      if (!jsx2.error) return jsx2.node;
      const {
        context
      } = this.state;
      const currentContext = context[context.length - 1];
      if (currentContext === types.j_oTag || currentContext === types.j_expr) {
        context.pop();
      }
    }
    if (!jsx2?.error && !this.match(43)) {
      return super.parseMaybeAssign(refExpressionErrors, isParenItem);
    }
    if (!state || state === this.state) state = this.state.clone();
    let typeParameters;
    const arrow = this.tryParse((abort) => {
      typeParameters = this.tsParseTypeParameters(this.tsParseConstModifier);
      const expr = super.parseMaybeAssign(refExpressionErrors, isParenItem);
      if (expr.type !== "ArrowFunctionExpression" || expr.extra?.parenthesized) {
        abort();
      }
      if (typeParameters?.params.length !== 0) {
        this.resetStartLocationFromNode(expr, typeParameters);
      }
      expr.typeParameters = typeParameters;
      if (this.hasPlugin("jsx") && expr.typeParameters.params.length === 1 && !expr.typeParameters.extra?.trailingComma) {
        const parameter = expr.typeParameters.params[0];
        if (!parameter.constraint) {
          this.raise(TSErrors.SingleTypeParameterWithoutTrailingComma, this.optionFlags & 256 ? createPositionWithColumnOffset(parameter.loc.end, 1) : parameter, {
            typeParameterName: parameter.name.name
          });
        }
      }
      return expr;
    }, state);
    if (!arrow.error && !arrow.aborted) {
      if (typeParameters) this.reportReservedArrowTypeParam(typeParameters);
      return arrow.node;
    }
    if (!jsx2) {
      assert(!this.hasPlugin("jsx"));
      typeCast = this.tryParse(() => super.parseMaybeAssign(refExpressionErrors, isParenItem), state);
      if (!typeCast.error) return typeCast.node;
    }
    if (jsx2?.node) {
      this.state = jsx2.failState;
      return jsx2.node;
    }
    if (arrow.node) {
      this.state = arrow.failState;
      if (typeParameters) this.reportReservedArrowTypeParam(typeParameters);
      return arrow.node;
    }
    if (typeCast?.node) {
      this.state = typeCast.failState;
      return typeCast.node;
    }
    throw jsx2?.error || arrow.error || typeCast?.error;
  }
  reportReservedArrowTypeParam(node) {
    if (node.params.length === 1 && !node.params[0].constraint && !node.extra?.trailingComma && this.getPluginOption("typescript", "disallowAmbiguousJSXLike")) {
      this.raise(TSErrors.ReservedArrowTypeParam, node);
    }
  }
  parseMaybeUnary(refExpressionErrors, sawUnary) {
    if (!this.hasPlugin("jsx") && this.match(43)) {
      return this.tsParseTypeAssertion();
    }
    return super.parseMaybeUnary(refExpressionErrors, sawUnary);
  }
  parseArrow(node) {
    if (this.match(10)) {
      const result = this.tryParse((abort) => {
        const returnType = this.tsParseTypeOrTypePredicateAnnotation(10);
        if (this.canInsertSemicolon() || !this.match(15)) abort();
        return returnType;
      });
      if (result.aborted) return;
      if (!result.thrown) {
        if (result.error) this.state = result.failState;
        node.returnType = result.node;
      }
    }
    return super.parseArrow(node);
  }
  parseFunctionParamType(param) {
    if (this.eat(13)) {
      param.optional = true;
    }
    const type = this.tsTryParseTypeAnnotation();
    if (type) param.typeAnnotation = type;
    this.resetEndLocation(param);
    return param;
  }
  isAssignable(node, isBinding) {
    switch (node.type) {
      case "TSTypeCastExpression":
        return this.isAssignable(node.expression, isBinding);
      case "TSParameterProperty":
        return true;
      default:
        return super.isAssignable(node, isBinding);
    }
  }
  toAssignable(node, isLHS = false) {
    if (tsIsTypeCast(node)) {
      if (isLHS) {
        this.expressionScope.recordArrowParameterBindingError(TSErrors.UnexpectedTypeCastInParameter, node);
      } else {
        this.raiseOnce(TSErrors.UnexpectedTypeCastInParameter, node);
      }
      this.toAssignable(node.expression, isLHS);
      return;
    }
    switch (node.type) {
      case "ParenthesizedExpression":
        this.toAssignableParenthesizedExpression(node, isLHS);
        break;
      case "AssignmentExpression":
        if (!isLHS && node.left.type === "TSTypeCastExpression") {
          node.left = this.typeCastToParameter(node.left);
        }
      default:
        super.toAssignable(node, isLHS);
    }
  }
  toAssignableParenthesizedExpression(node, isLHS) {
    if (tsIsTypeCast(node.expression) || node.expression.type === "ParenthesizedExpression") {
      this.toAssignable(node.expression, isLHS);
    } else {
      super.toAssignable(node, isLHS);
    }
  }
  checkToRestConversion(node, allowPattern) {
    if (tsIsTypeCast(node)) {
      this.checkToRestConversion(node.expression, false);
    } else {
      super.checkToRestConversion(node, allowPattern);
    }
  }
  isValidLVal(type, disallowCallExpression, isUnparenthesizedInAssign, binding) {
    switch (type) {
      case "TSTypeCastExpression":
        return true;
      case "TSParameterProperty":
        return "parameter";
      case "TSNonNullExpression":
        return "expression";
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSTypeAssertion":
        return (binding !== 64 || !isUnparenthesizedInAssign) && ["expression", true];
      default:
        return super.isValidLVal(type, disallowCallExpression, isUnparenthesizedInAssign, binding);
    }
  }
  parseBindingAtom() {
    if (this.state.type === 74) {
      return this.parseIdentifier(true);
    }
    return super.parseBindingAtom();
  }
  parseMaybeDecoratorArguments(expr, startLoc) {
    if (this.match(43) || this.match(47)) {
      const typeArguments = this.tsParseTypeArgumentsInExpression();
      if (this.match(6)) {
        const call = super.parseMaybeDecoratorArguments(expr, startLoc);
        call.typeArguments = typeArguments;
        return call;
      }
      this.unexpected(null, 6);
    }
    return super.parseMaybeDecoratorArguments(expr, startLoc);
  }
  checkCommaAfterRest(close) {
    if (this.state.isAmbientContext && this.match(8) && this.lookaheadCharCode() === close) {
      this.next();
      return false;
    }
    return super.checkCommaAfterRest(close);
  }
  isClassMethod() {
    return this.match(43) || super.isClassMethod();
  }
  isClassProperty() {
    return this.match(31) || this.match(10) || super.isClassProperty();
  }
  parseMaybeDefault(startLoc, left) {
    const node = super.parseMaybeDefault(startLoc, left);
    if (node.type === "AssignmentPattern" && node.typeAnnotation && node.right.start < node.typeAnnotation.start) {
      this.raise(TSErrors.TypeAnnotationAfterAssign, node.typeAnnotation);
    }
    return node;
  }
  getTokenFromCode(code2) {
    if (this.state.inType) {
      if (code2 === 62) {
        this.finishOp(44, 1);
        return;
      }
      if (code2 === 60) {
        this.finishOp(43, 1);
        return;
      }
    }
    super.getTokenFromCode(code2);
  }
  reScan_lt_gt() {
    const {
      type
    } = this.state;
    if (type === 43) {
      this.state.pos -= 1;
      this.readToken_lt();
    } else if (type === 44) {
      this.state.pos -= 1;
      this.readToken_gt();
    }
  }
  reScan_lt() {
    const {
      type
    } = this.state;
    if (type === 47) {
      this.state.pos -= 2;
      this.finishOp(43, 1);
      return 43;
    }
    return type;
  }
  toAssignableListItem(exprList, index, isLHS) {
    const node = exprList[index];
    if (node.type === "TSTypeCastExpression") {
      exprList[index] = this.typeCastToParameter(node);
    }
    super.toAssignableListItem(exprList, index, isLHS);
  }
  typeCastToParameter(node) {
    node.expression.typeAnnotation = node.typeAnnotation;
    this.resetEndLocationFromNode(node.expression, node.typeAnnotation);
    return node.expression;
  }
  shouldParseArrow(params) {
    if (this.match(10)) {
      return params.every((expr) => this.isAssignable(expr, true));
    }
    return super.shouldParseArrow(params);
  }
  shouldParseAsyncArrow() {
    if (this.match(10)) {
      if (this.state.inConditionalConsequent) return false;
      return true;
    }
    return super.shouldParseAsyncArrow();
  }
  parseParenAndDistinguishExpression(canStartArrow) {
    const oldInConditionalConsequent = this.state.inConditionalConsequent;
    this.state.inConditionalConsequent = false;
    const result = super.parseParenAndDistinguishExpression(canStartArrow);
    this.state.inConditionalConsequent = oldInConditionalConsequent;
    return result;
  }
  canHaveLeadingDecorator() {
    return super.canHaveLeadingDecorator() || this.isAbstractClass();
  }
  jsxParseOpeningElementAfterName(node) {
    if (this.match(43) || this.match(47)) {
      const typeArguments = this.tsTryParseAndCatch(() => this.tsParseTypeArgumentsInExpression());
      if (typeArguments) {
        node.typeArguments = typeArguments;
      }
    }
    return super.jsxParseOpeningElementAfterName(node);
  }
  getGetterSetterExpectedParamCount(method) {
    const baseCount = super.getGetterSetterExpectedParamCount(method);
    const params = this.getObjectOrClassMethodParams(method);
    const firstParam = params[0];
    const hasContextParam = firstParam && this.isThisParam(firstParam);
    return hasContextParam ? baseCount + 1 : baseCount;
  }
  parseCatchClauseParam() {
    const param = super.parseCatchClauseParam();
    const type = this.tsTryParseTypeAnnotation();
    if (type) {
      param.typeAnnotation = type;
      this.resetEndLocation(param);
    }
    return param;
  }
  tsInAmbientContext(cb) {
    const {
      isAmbientContext: oldIsAmbientContext,
      strict: oldStrict
    } = this.state;
    this.state.isAmbientContext = true;
    this.state.strict = false;
    try {
      return cb();
    } finally {
      this.state.isAmbientContext = oldIsAmbientContext;
      this.state.strict = oldStrict;
    }
  }
  parseClass(node, isStatement, optionalId) {
    const oldInAbstractClass = this.state.inAbstractClass;
    this.state.inAbstractClass = !!node.abstract;
    try {
      return super.parseClass(node, isStatement, optionalId);
    } finally {
      this.state.inAbstractClass = oldInAbstractClass;
    }
  }
  tsParseAbstractDeclaration(node, decorators) {
    if (this.match(76)) {
      node.abstract = true;
      return this.maybeTakeDecorators(decorators, this.parseClass(node, true, false));
    } else if (this.isContextual(128)) {
      if (!this.hasFollowingLineBreak()) {
        node.abstract = true;
        this.raise(TSErrors.NonClassMethodPropertyHasAbstractModifier, node);
        return this.tsParseInterfaceDeclaration(node);
      } else {
        return null;
      }
    }
    throw this.unexpected(null, 76);
  }
  parseMethod(node, isGenerator, isAsync, isConstructor, allowDirectSuper, type, inClassScope) {
    const method = super.parseMethod(node, isGenerator, isAsync, isConstructor, allowDirectSuper, type, inClassScope);
    if (method.abstract || method.type === "TSAbstractMethodDefinition") {
      const hasEstreePlugin = this.hasPlugin("estree");
      const methodFn = hasEstreePlugin ? method.value : method;
      if (methodFn.body) {
        const {
          key
        } = method;
        this.raise(TSErrors.AbstractMethodHasImplementation, method, {
          methodName: key.type === "Identifier" && !method.computed ? key.name : `[${this.input.slice(this.offsetToSourcePos(key.start), this.offsetToSourcePos(key.end))}]`
        });
      }
    }
    return method;
  }
  tsParseTypeParameterName() {
    return this.parseIdentifier();
  }
  shouldParseAsAmbientContext() {
    return !!this.getPluginOption("typescript", "dts");
  }
  parse() {
    if (this.shouldParseAsAmbientContext()) {
      this.state.isAmbientContext = true;
    }
    return super.parse();
  }
  getExpression() {
    if (this.shouldParseAsAmbientContext()) {
      this.state.isAmbientContext = true;
    }
    return super.getExpression();
  }
  parseExportSpecifier(node, isString, isInTypeExport, isMaybeTypeOnly) {
    if (!isString && isMaybeTypeOnly) {
      this.parseTypeOnlyExportSpecifier(node, isInTypeExport);
      return this.finishNode(node, "ExportSpecifier");
    }
    node.exportKind = "value";
    return super.parseExportSpecifier(node, isString, isInTypeExport, isMaybeTypeOnly);
  }
  parseImportSpecifier(specifier, importedIsString, isInTypeOnlyImport, isMaybeTypeOnly) {
    if (!importedIsString && isMaybeTypeOnly) {
      this.parseTypeOnlyImportSpecifier(specifier);
      return this.finishNode(specifier, "ImportSpecifier");
    }
    specifier.importKind = "value";
    return super.parseImportSpecifier(specifier, importedIsString, isInTypeOnlyImport, isMaybeTypeOnly);
  }
  checkImportSpecifier(specifier, isInTypeOnlyImport) {
    const hasTypeSpecifier = specifier.importKind === "type";
    if (hasTypeSpecifier && isInTypeOnlyImport) {
      this.raise(TSErrors.TypeModifierIsUsedInTypeImports, specifier);
    }
    super.checkImportSpecifier(specifier, isInTypeOnlyImport, hasTypeSpecifier || isInTypeOnlyImport ? 4098 : 4096);
  }
  parseTypeOnlyImportSpecifier(node) {
    let leftOfAs = node.imported;
    let hasTypeSpecifier = false;
    if (this.isContextual(90)) {
      const firstAs = this.parseIdentifier();
      if (this.isContextual(90)) {
        const secondAs = this.parseIdentifier();
        if (tokenIsKeywordOrIdentifier(this.state.type)) {
          hasTypeSpecifier = true;
          leftOfAs = firstAs;
          node.local = this.parseIdentifier();
        } else {
          node.local = secondAs;
        }
      } else if (tokenIsKeywordOrIdentifier(this.state.type)) {
        node.local = this.parseIdentifier();
      } else {
        hasTypeSpecifier = true;
        leftOfAs = firstAs;
      }
    } else if (tokenIsKeywordOrIdentifier(this.state.type)) {
      hasTypeSpecifier = true;
      leftOfAs = this.parseIdentifier(true);
    }
    node.imported = leftOfAs;
    node.importKind = hasTypeSpecifier ? "type" : "value";
    node.local ??= this.eatContextual(90) ? this.parseIdentifier() : this.cloneIdentifier(node.imported);
  }
  parseTypeOnlyExportSpecifier(node, isInTypeOnly) {
    const local = node.local;
    let hasTypeSpecifier = false;
    if (this.isContextual(90)) {
      const firstAs = this.parseIdentifier();
      if (this.isContextual(90)) {
        const secondAs = this.parseIdentifier();
        if (tokenIsKeywordOrIdentifier(this.state.type)) {
          hasTypeSpecifier = true;
          node.local = firstAs;
          node.exported = this.parseModuleExportName();
        } else {
          node.exported = secondAs;
        }
      } else if (tokenIsKeywordOrIdentifier(this.state.type)) {
        node.exported = this.parseModuleExportName();
      } else {
        hasTypeSpecifier = true;
        node.local = firstAs;
      }
    } else if (tokenIsKeywordOrIdentifier(this.state.type)) {
      hasTypeSpecifier = true;
      node.local = this.parseModuleExportName();
    }
    if (hasTypeSpecifier && isInTypeOnly) {
      this.raise(TSErrors.TypeModifierIsUsedInTypeExports, local);
    }
    node.exportKind = hasTypeSpecifier ? "type" : "value";
    node.exported ??= this.eatContextual(90) ? this.parseModuleExportName() : this.cloneIdentifier(node.local);
  }
  fillOptionalPropertiesForTSESLint(node) {
    switch (node.type) {
      case "ImportDeclaration":
        node.phase ??= null;
        return;
      case "ExpressionStatement":
        node.directive ??= void 0;
        return;
      case "RestElement":
        node.value = void 0;
      case "Identifier":
      case "ArrayPattern":
      case "AssignmentPattern":
      case "ObjectPattern":
        node.decorators ??= [];
        node.optional ??= false;
        node.typeAnnotation ??= void 0;
        return;
      case "TSParameterProperty":
        node.accessibility ??= void 0;
        node.decorators ??= [];
        node.override ??= false;
        node.readonly ??= false;
        node.static ??= false;
        return;
      case "TSEmptyBodyFunctionExpression":
        node.body = null;
      case "TSDeclareFunction":
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ClassMethod":
      case "ClassPrivateMethod":
        node.declare ??= false;
        node.returnType ??= void 0;
        node.typeParameters ??= void 0;
        return;
      case "Property":
        node.optional ??= false;
        return;
      case "TSMethodSignature":
      case "TSPropertySignature":
        node.optional ??= false;
      case "TSIndexSignature":
        node.accessibility ??= void 0;
        node.readonly ??= false;
        node.static ??= false;
        return;
      case "TSAbstractPropertyDefinition":
      case "PropertyDefinition":
      case "TSAbstractAccessorProperty":
      case "AccessorProperty":
        node.declare ??= false;
        node.definite ??= false;
        node.readonly ??= false;
        node.typeAnnotation ??= void 0;
      case "TSAbstractMethodDefinition":
      case "MethodDefinition":
        node.accessibility ??= void 0;
        node.decorators ??= [];
        node.override ??= false;
        node.optional ??= false;
        return;
      case "ClassExpression":
        node.id ??= null;
      case "ClassDeclaration":
        node.abstract ??= false;
        node.declare ??= false;
        node.decorators ??= [];
        node.implements ??= [];
        node.superTypeArguments ??= void 0;
        node.typeParameters ??= void 0;
        return;
      case "TSTypeAliasDeclaration":
      case "VariableDeclaration":
        node.declare ??= false;
        return;
      case "VariableDeclarator":
        node.definite ??= false;
        return;
      case "TSEnumDeclaration":
        node.const ??= false;
        node.declare ??= false;
        return;
      case "TSEnumMember":
        node.computed ??= false;
        return;
      case "TSImportType":
        node.qualifier ??= null;
        node.options ??= null;
        node.typeArguments ??= null;
        return;
      case "TSInterfaceDeclaration":
        node.declare ??= false;
        node.extends ??= [];
        return;
      case "TSMappedType":
        node.optional ??= false;
        node.readonly ??= void 0;
        return;
      case "TSModuleDeclaration":
        node.declare ??= false;
        node.global ??= node.kind === "global";
        return;
      case "TSTypeParameter":
        node.const ??= false;
        node.in ??= false;
        node.out ??= false;
        return;
    }
  }
  chStartsBindingIdentifierAndNotRelationalOperator(ch, pos) {
    if (isIdentifierStart(ch)) {
      keywordAndTSRelationalOperator.lastIndex = pos;
      if (keywordAndTSRelationalOperator.test(this.input)) {
        const endCh = this.codePointAtPos(keywordAndTSRelationalOperator.lastIndex);
        if (!isIdentifierChar(endCh) && endCh !== 92) {
          return false;
        }
      }
      return true;
    } else if (ch === 92) {
      return true;
    } else {
      return false;
    }
  }
  nextTokenIsIdentifierAndNotTSRelationalOperatorOnSameLine() {
    const next = this.nextTokenInLineStart();
    const nextCh = this.codePointAtPos(next);
    return this.chStartsBindingIdentifierAndNotRelationalOperator(nextCh, next);
  }
  nextTokenIsStringLiteralOnSameLine() {
    const next = this.nextTokenInLineStart();
    const nextCh = this.codePointAtPos(next);
    return nextCh === 34 || nextCh === 39;
  }
};
function isPossiblyLiteralEnum(expression) {
  if (expression.type !== "MemberExpression") return false;
  const {
    computed,
    property
  } = expression;
  if (computed && property.type !== "StringLiteral" && (property.type !== "TemplateLiteral" || property.expressions.length > 0)) {
    return false;
  }
  return isUncomputedMemberExpressionChain(expression.object);
}
function isValidAmbientConstInitializer(expression, estree2) {
  const {
    type
  } = expression;
  if (expression.extra?.parenthesized) {
    return false;
  }
  if (estree2) {
    if (type === "Literal") {
      const {
        value
      } = expression;
      if (typeof value === "string" || typeof value === "boolean") {
        return true;
      }
    }
  } else {
    if (type === "StringLiteral" || type === "BooleanLiteral") {
      return true;
    }
  }
  if (isNumber(expression, estree2) || isNegativeNumber(expression, estree2)) {
    return true;
  }
  if (type === "TemplateLiteral" && expression.expressions.length === 0) {
    return true;
  }
  if (isPossiblyLiteralEnum(expression)) {
    return true;
  }
  return false;
}
function isNumber(expression, estree2) {
  if (estree2) {
    return expression.type === "Literal" && (typeof expression.value === "number" || "bigint" in expression);
  }
  return expression.type === "NumericLiteral" || expression.type === "BigIntLiteral";
}
function isNegativeNumber(expression, estree2) {
  if (expression.type === "UnaryExpression") {
    const {
      operator,
      argument
    } = expression;
    if (operator === "-" && isNumber(argument, estree2)) {
      return true;
    }
  }
  return false;
}
function isUncomputedMemberExpressionChain(expression) {
  if (expression.type === "Identifier") return true;
  if (expression.type !== "MemberExpression" || expression.computed) {
    return false;
  }
  return isUncomputedMemberExpressionChain(expression.object);
}
function buildModifiersMap(allowed, disallow = []) {
  const map = /* @__PURE__ */ new Map();
  for (const modifier of allowed) {
    map.set(modifier, true);
  }
  for (const modifier of disallow) {
    map.set(modifier, false);
  }
  return map;
}
var PlaceholderErrorTemplates = {
  ClassNameIsRequired: "A class name is required.",
  UnexpectedSpace: "Unexpected space in placeholder."
};
var PlaceholderErrors = ParseErrorEnum`placeholders`(PlaceholderErrorTemplates);
var placeholders = (superClass) => class PlaceholdersParserMixin extends superClass {
  parsePlaceholder(expectedNode) {
    if (this.match(132)) {
      const node = this.startNode();
      this.next();
      this.assertNoSpace();
      node.name = super.parseIdentifier(true);
      this.assertNoSpace();
      this.expect(132);
      return this.finishPlaceholder(node, expectedNode);
    }
  }
  finishPlaceholder(node, expectedNode) {
    let placeholder = node;
    if (!placeholder.expectedNode || !placeholder.type) {
      placeholder = this.finishNode(placeholder, "Placeholder");
    }
    placeholder.expectedNode = expectedNode;
    return placeholder;
  }
  getTokenFromCode(code2) {
    if (code2 === 37 && this.input.charCodeAt(this.state.pos + 1) === 37) {
      this.finishOp(132, 2);
    } else {
      super.getTokenFromCode(code2);
    }
  }
  parseExprAtom(refExpressionErrors) {
    return this.parsePlaceholder("Expression") || super.parseExprAtom(refExpressionErrors);
  }
  parseIdentifier(liberal) {
    return this.parsePlaceholder("Identifier") || super.parseIdentifier(liberal);
  }
  checkReservedWord(word, startLoc, checkKeywords, isBinding) {
    if (word !== void 0) {
      super.checkReservedWord(word, startLoc, checkKeywords, isBinding);
    }
  }
  cloneIdentifier(node) {
    const cloned = super.cloneIdentifier(node);
    if (cloned.type === "Placeholder") {
      cloned.expectedNode = node.expectedNode;
    }
    return cloned;
  }
  cloneStringLiteral(node) {
    if (node.type === "Placeholder") {
      return this.cloneIdentifier(node);
    }
    return super.cloneStringLiteral(node);
  }
  parseBindingAtom() {
    return this.parsePlaceholder("Pattern") || super.parseBindingAtom();
  }
  isValidLVal(type, disallowCallExpression, isParenthesized, binding) {
    return type === "Placeholder" || super.isValidLVal(type, disallowCallExpression, isParenthesized, binding);
  }
  toAssignable(node, isLHS) {
    if (node && node.type === "Placeholder" && node.expectedNode === "Expression") {
      node.expectedNode = "Pattern";
    } else {
      super.toAssignable(node, isLHS);
    }
  }
  chStartsBindingIdentifier(ch, pos) {
    if (super.chStartsBindingIdentifier(ch, pos)) {
      return true;
    }
    const next = this.nextTokenStart();
    if (this.input.charCodeAt(next) === 37 && this.input.charCodeAt(next + 1) === 37) {
      return true;
    }
    return false;
  }
  verifyBreakContinue(node, isBreak) {
    if (node.label?.type === "Placeholder") return;
    super.verifyBreakContinue(node, isBreak);
  }
  parseExpressionStatement(node, expr, flags) {
    if (expr.type !== "Placeholder" || expr.extra?.parenthesized) {
      return super.parseExpressionStatement(node, expr, flags);
    }
    if (this.match(10)) {
      const stmt = node;
      stmt.label = this.finishPlaceholder(expr, "Identifier");
      this.next();
      stmt.body = flags & 8 ? super.parseStatementOrSloppyAnnexBFunctionDeclaration(true) : super.parseStatement();
      return this.finishNode(stmt, "LabeledStatement");
    }
    this.semicolon();
    const stmtPlaceholder = node;
    stmtPlaceholder.name = expr.name;
    return this.finishPlaceholder(stmtPlaceholder, "Statement");
  }
  parseBlock(allowDirectives, createNewLexicalScope, afterBlockParse) {
    return this.parsePlaceholder("BlockStatement") || super.parseBlock(allowDirectives, createNewLexicalScope, afterBlockParse);
  }
  parseFunctionId(requireId) {
    return this.parsePlaceholder("Identifier") || super.parseFunctionId(requireId);
  }
  parseClass(node, isStatement, optionalId) {
    const type = isStatement ? "ClassDeclaration" : "ClassExpression";
    this.next();
    const oldStrict = this.state.strict;
    const placeholder = this.parsePlaceholder("Identifier");
    if (placeholder) {
      if (this.match(77) || this.match(132) || this.match(2)) {
        node.id = placeholder;
      } else if (optionalId || !isStatement) {
        node.id = null;
        node.body = this.finishPlaceholder(placeholder, "ClassBody");
        return this.finishNode(node, type);
      } else {
        throw this.raise(PlaceholderErrors.ClassNameIsRequired, this.state.startLoc);
      }
    } else {
      this.parseClassId(node, isStatement, optionalId);
    }
    super.parseClassSuper(node);
    node.body = this.parsePlaceholder("ClassBody") || super.parseClassBody(!!node.superClass, oldStrict);
    return this.finishNode(node, type);
  }
  parseExport(node, decorators) {
    const placeholder = this.parsePlaceholder("Identifier");
    if (!placeholder) return super.parseExport(node, decorators);
    const node2 = node;
    if (!this.isContextual(95) && !this.match(8)) {
      node2.specifiers = [];
      node2.source = null;
      node2.declaration = this.finishPlaceholder(placeholder, "Declaration");
      return this.finishNode(node2, "ExportNamedDeclaration");
    }
    this.expectPlugin("exportDefaultFrom");
    const specifier = this.startNode();
    specifier.exported = placeholder;
    node2.specifiers = [this.finishNode(specifier, "ExportDefaultSpecifier")];
    return super.parseExport(node2, decorators);
  }
  isExportDefaultSpecifier() {
    if (this.match(61)) {
      const next = this.nextTokenStart();
      if (this.isUnparsedContextual(next, "from")) {
        if (this.input.startsWith(tokenLabelName(132), this.hasPlugin("exportDefaultFrom") ? this.nextTokenStartSince(next + 4) : this.nextTokenInLineStartSince(next + 4))) {
          return true;
        }
      }
    }
    return super.isExportDefaultSpecifier();
  }
  maybeParseExportDefaultSpecifier(node, maybeDefaultIdentifier) {
    if (node.specifiers?.length) {
      return true;
    }
    return super.maybeParseExportDefaultSpecifier(node, maybeDefaultIdentifier);
  }
  checkNamedExport() {
  }
  parseImport(node) {
    const placeholder = this.parsePlaceholder("Identifier");
    if (!placeholder) return super.parseImport(node);
    node.specifiers = [];
    if (!this.isContextual(95) && !this.match(8)) {
      node.source = this.finishPlaceholder(placeholder, "StringLiteral");
      this.semicolon();
      return this.finishNode(node, "ImportDeclaration");
    }
    const specifier = this.startNodeAtNode(placeholder);
    specifier.local = placeholder;
    node.specifiers.push(this.finishNode(specifier, "ImportDefaultSpecifier"));
    if (this.eat(8)) {
      const hasStarImport = this.maybeParseStarImportSpecifier(node);
      if (!hasStarImport) this.parseNamedOrFilteredImportSpecifiers(node);
    }
    this.expectContextual(95);
    node.source = this.parseImportSource();
    this.semicolon();
    return this.finishNode(node, "ImportDeclaration");
  }
  parseImportSource() {
    return this.parsePlaceholder("StringLiteral") || super.parseImportSource();
  }
  assertNoSpace() {
    if (this.state.start > this.offsetToSourcePos(this.state.lastTokEndLoc.index)) {
      this.raise(PlaceholderErrors.UnexpectedSpace, this.state.lastTokEndLoc);
    }
  }
};
var v8intrinsic = (superClass) => class V8IntrinsicMixin extends superClass {
  parseV8Intrinsic() {
    if (this.match(50)) {
      const v8IntrinsicStartLoc = this.state.startLoc;
      const node = this.startNode();
      this.next();
      if (tokenIsIdentifier(this.state.type)) {
        this.setLoc(this.state.startLoc);
        const name = this.parseIdentifierName();
        const identifier = this.createIdentifier(node, name);
        this.castNodeTo(identifier, "V8IntrinsicIdentifier");
        if (this.match(6)) {
          return identifier;
        }
      }
      this.unexpected(v8IntrinsicStartLoc);
    }
  }
  parseExprAtom(refExpressionErrors) {
    return this.parseV8Intrinsic() || super.parseExprAtom(refExpressionErrors);
  }
};
var PIPELINE_PROPOSALS = ["fsharp", "hack"];
var TOPIC_TOKENS = ["^^", "@@", "^", "%", "#"];
function validatePlugins(pluginsMap) {
  if (pluginsMap.has("decorators")) {
    if (pluginsMap.has("decorators-legacy")) {
      throw new Error("Cannot use the decorators and decorators-legacy plugin together");
    }
  }
  if (pluginsMap.has("flow") && pluginsMap.has("typescript")) {
    throw new Error("Cannot combine flow and typescript plugins.");
  }
  if (pluginsMap.has("placeholders") && pluginsMap.has("v8intrinsic")) {
    throw new Error("Cannot combine placeholders and v8intrinsic plugins.");
  }
  if (pluginsMap.has("pipelineOperator")) {
    const proposal = pluginsMap.get("pipelineOperator").proposal;
    if (!PIPELINE_PROPOSALS.includes(proposal)) {
      const proposalList = PIPELINE_PROPOSALS.map((p) => `"${p}"`).join(", ");
      throw new Error(`"pipelineOperator" requires "proposal" option whose value must be one of: ${proposalList}.`);
    }
    if (proposal === "hack") {
      if (pluginsMap.has("placeholders")) {
        throw new Error("Cannot combine placeholders plugin and Hack-style pipes.");
      }
      if (pluginsMap.has("v8intrinsic")) {
        throw new Error("Cannot combine v8intrinsic plugin and Hack-style pipes.");
      }
      const topicToken = pluginsMap.get("pipelineOperator").topicToken;
      if (!TOPIC_TOKENS.includes(topicToken)) {
        const tokenList = TOPIC_TOKENS.map((t) => `"${t}"`).join(", ");
        throw new Error(`"pipelineOperator" in "proposal": "hack" mode also requires a "topicToken" option whose value must be one of: ${tokenList}.`);
      }
    }
  }
  if (pluginsMap.has("moduleAttributes")) {
    throw new Error("`moduleAttributes` has been removed in Babel 8, please migrate to import attributes instead.");
  }
  if (pluginsMap.has("importAssertions")) {
    throw new Error("`importAssertions` has been removed in Babel 8, please use import attributes instead.");
  }
  if (pluginsMap.has("deprecatedImportAssert")) {
    console.warn("`deprecatedImportAssert` has been removed in Babel 8, please use import attributes instead.");
  } else if (pluginsMap.has("importAttributes") && pluginsMap.get("importAttributes").deprecatedAssertSyntax) {
    console.warn("The 'importAttributes' plugin has been removed in Babel 8. Please migrate any usage of `assert`-style attributes to `with`.");
  }
  if (pluginsMap.has("recordAndTuple")) {
    throw new Error("The 'recordAndTuple' plugin has been removed in Babel 8. Please remove it from your configuration.");
  }
  if (pluginsMap.has("asyncDoExpressions") && !pluginsMap.has("doExpressions")) {
    const error = new Error("'asyncDoExpressions' requires 'doExpressions', please add 'doExpressions' to parser plugins.");
    error.missingPlugins = "doExpressions";
    throw error;
  }
  if (pluginsMap.has("optionalChainingAssign") && pluginsMap.get("optionalChainingAssign").version !== "2023-07") {
    throw new Error("The 'optionalChainingAssign' plugin requires a 'version' option, representing the last proposal update. Currently, the only supported value is '2023-07'.");
  }
  if (pluginsMap.has("discardBinding") && pluginsMap.get("discardBinding").syntaxType !== "void") {
    throw new Error("The 'discardBinding' plugin requires a 'syntaxType' option. Currently the only supported value is 'void'.");
  }
  if (pluginsMap.has("decimal")) {
    throw new Error("The 'decimal' plugin has been removed in Babel 8. Please remove it from your configuration.");
  }
  if (pluginsMap.has("importReflection")) {
    throw new Error("The 'importReflection' plugin has been removed in Babel 8. Use 'sourcePhaseImports' instead, and replace 'import module' with 'import source' in your code.");
  }
  if (pluginsMap.has("deferredReexports") && !pluginsMap.has("deferredImportEvaluation")) {
    throw new Error("The 'deferredReexports' plugin requires 'deferredImportEvaluation'.");
  }
}
var mixinPlugins = {
  estree,
  jsx,
  flow,
  typescript,
  v8intrinsic,
  placeholders
};
var mixinPluginNames = Object.keys(mixinPlugins);
var Parser = class extends StatementParser {
  constructor(options, input, pluginsMap) {
    const normalizedOptions = getOptions(options);
    super(normalizedOptions, input);
    this.options = normalizedOptions;
    this.initializeScopes();
    this.plugins = pluginsMap;
    this.filename = normalizedOptions.sourceFilename;
    this.startIndex = normalizedOptions.startIndex;
    let optionFlags = 0;
    if (normalizedOptions.allowAwaitOutsideFunction) {
      optionFlags |= 1;
    }
    if (normalizedOptions.allowReturnOutsideFunction) {
      optionFlags |= 2;
    }
    if (normalizedOptions.allowImportExportEverywhere) {
      optionFlags |= 8;
    }
    if (normalizedOptions.allowSuperOutsideMethod) {
      optionFlags |= 16;
    }
    if (normalizedOptions.allowUndeclaredExports) {
      optionFlags |= 64;
    }
    if (normalizedOptions.allowNewTargetOutsideFunction) {
      optionFlags |= 4;
    }
    if (normalizedOptions.allowYieldOutsideFunction) {
      optionFlags |= 32;
    }
    if (normalizedOptions.ranges) {
      optionFlags |= 128;
    }
    if (normalizedOptions.locations === true) {
      optionFlags |= 256;
    }
    if (normalizedOptions.tokens) {
      optionFlags |= 512;
    }
    if (normalizedOptions.createImportExpressions) {
      optionFlags |= 1024;
    }
    if (normalizedOptions.createParenthesizedExpressions) {
      optionFlags |= 2048;
    }
    if (normalizedOptions.errorRecovery) {
      optionFlags |= 4096;
    }
    if (normalizedOptions.attachComment) {
      optionFlags |= 8192;
    }
    if (normalizedOptions.annexB) {
      optionFlags |= 16384;
    }
    this.optionFlags = optionFlags;
  }
  getScopeHandler() {
    return ScopeHandler;
  }
  parse() {
    this.enterInitialScopes();
    const file = this.startNode();
    const program = this.startNode();
    this.nextToken();
    file.errors = [];
    const result = this.parseTopLevel(file, program);
    result.errors = this.state.errors;
    result.comments.length = this.state.commentsLen;
    return result;
  }
};
function parse(input, options) {
  if (options?.sourceType === "unambiguous") {
    options = {
      ...options
    };
    try {
      options.sourceType = "module";
      const parser = getParser(options, input);
      const ast = parser.parse();
      if (parser.sawUnambiguousESM) {
        return ast;
      }
      if (parser.ambiguousScriptDifferentAst) {
        try {
          options.sourceType = "script";
          return getParser(options, input).parse();
        } catch {
        }
      } else {
        ast.program.sourceType = "script";
      }
      return ast;
    } catch (moduleError) {
      try {
        options.sourceType = "script";
        return getParser(options, input).parse();
      } catch {
      }
      throw moduleError;
    }
  } else {
    return getParser(options, input).parse();
  }
}
function generateExportedTokenTypes(internalTokenTypes) {
  const tokenTypes2 = {};
  for (const typeName of Object.keys(internalTokenTypes)) {
    tokenTypes2[typeName] = getExportedToken(internalTokenTypes[typeName]);
  }
  return tokenTypes2;
}
var tokTypes = generateExportedTokenTypes(tt);
function getParser(options, input) {
  let cls = Parser;
  const pluginsMap = /* @__PURE__ */ new Map();
  if (options?.plugins) {
    for (const plugin of options.plugins) {
      let name, opts;
      if (typeof plugin === "string") {
        name = plugin;
      } else {
        [name, opts] = plugin;
      }
      if (!pluginsMap.has(name)) {
        pluginsMap.set(name, opts || {});
      }
    }
    validatePlugins(pluginsMap);
    cls = getParserClass(pluginsMap);
  }
  return new cls(options, input, pluginsMap);
}
var parserClassCache = /* @__PURE__ */ new Map();
function getParserClass(pluginsMap) {
  const pluginList = [];
  for (const name of mixinPluginNames) {
    if (pluginsMap.has(name)) {
      pluginList.push(name);
    }
  }
  const key = pluginList.join("|");
  let cls = parserClassCache.get(key);
  if (!cls) {
    cls = Parser;
    for (const plugin of pluginList) {
      cls = mixinPlugins[plugin](cls);
    }
    parserClassCache.set(key, cls);
  }
  return cls;
}

// packages/core/src/app-intelligence/analyzer.ts
var import_enhanced_resolve = __toESM(require_lib2(), 1);
var ignored = /* @__PURE__ */ new Set(["node_modules", ".git", ".expo", ".next", ".yarn", "dist", "build", "out", "coverage", "Pods", ".gradle"]);
var sourcePattern = /\.(?:[cm]?[jt]sx?)$/;
var assetPattern = /\.(?:png|jpe?g|gif|webp|svg)$/i;
var extensions = (platform) => ["js", "jsx", "json", "ts", "tsx", "mjs", "cjs", "mts", "cts"].flatMap((ext) => [`.${platform}.${ext}`, `.native.${ext}`, `.${ext}`]);
var fingerprint = (value) => createHash("sha256").update(value).digest("hex");
var portable = (root, path) => relative(root, path).split(sep).join("/");
var inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith("/");
};
var packageName = (specifier) => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
function walkAst(node, visit) {
  if (!node || typeof node !== "object") return;
  const record = node;
  if (typeof record.type === "string") visit(record);
  for (const [key, child] of Object.entries(record)) {
    if (key === "loc" || key === "start" || key === "end" || key === "extra") continue;
    if (Array.isArray(child)) for (const item of child) walkAst(item, visit);
    else if (child && typeof child === "object") walkAst(child, visit);
  }
}
var isModuleCall = (node) => (node.type === "CallExpression" || node.type === "OptionalCallExpression") && node.arguments?.[0]?.type === "StringLiteral" && (node.callee?.type === "Import" || node.callee?.name === "require");
function componentRef(expression) {
  let local, specifier;
  walkAst(expression, (node) => {
    if (specifier) return;
    if (isModuleCall(node)) specifier = node.arguments[0].value;
    else if (!local && node.type === "Identifier" && node.name !== "require") local = node.name;
  });
  return specifier ? { specifier } : { local };
}
function parseSource(path, code2, diagnostics) {
  const found = { path, code: code2, imports: [], navigation: [], registrations: [], declared: /* @__PURE__ */ new Set() };
  try {
    const ast = parse(code2, { sourceType: "unambiguous", errorRecovery: true, plugins: ["jsx", "typescript", "decorators-legacy"] });
    walkAst(ast, (node) => {
      if (node.type === "ImportDeclaration" && typeof node.source?.value === "string") {
        for (const specifier of node.specifiers?.length ? node.specifiers : [void 0]) found.imports.push({ specifier: node.source.value, typeOnly: node.importKind === "type", dynamic: false, local: specifier?.local?.name });
      } else if ((node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && typeof node.source?.value === "string") {
        found.imports.push({ specifier: node.source.value, typeOnly: node.exportKind === "type", dynamic: false });
      } else if ((node.type === "CallExpression" || node.type === "OptionalCallExpression") && node.arguments?.[0]?.type === "StringLiteral") {
        if (isModuleCall(node)) found.imports.push({ specifier: node.arguments[0].value, typeOnly: false, dynamic: true });
        const method = node.callee?.property?.name ?? node.callee?.name;
        if (["navigate", "push", "replace"].includes(method)) found.navigation.push(node.arguments[0].value);
      } else if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
        if (typeof node.id?.name === "string") found.declared.add(node.id.name);
      } else if (node.type === "VariableDeclarator" && typeof node.id?.name === "string") {
        found.declared.add(node.id.name);
      } else if (node.type === "JSXOpeningElement") {
        const name = node.name?.type === "JSXMemberExpression" ? node.name.property?.name : node.name?.name;
        if (name !== "Screen") return;
        const attrs = new Map((node.attributes ?? []).filter((item) => item.type === "JSXAttribute").map((item) => [item.name?.name, item.value]));
        const screenName = attrs.get("name")?.value;
        const component = attrs.get("component") ?? attrs.get("getComponent");
        if (typeof screenName === "string") found.registrations.push({ name: screenName, ...componentRef(component?.expression) });
      }
    });
  } catch (error) {
    diagnostics.push({ code: "parse-error", file: path, message: error instanceof Error ? error.message.split("\n")[0] : String(error) });
  }
  return found;
}
function parseJsonc(text) {
  let out = "", inString = false, escaped = false, inLine = false, inBlock = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index], next = text[index + 1];
    if (inLine) {
      if (char === "\n") {
        inLine = false;
        out += char;
      }
      continue;
    }
    if (inBlock) {
      if (char === "*" && next === "/") {
        inBlock = false;
        index++;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === "/" && next === "/") {
      inLine = true;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlock = true;
      index++;
      continue;
    }
    if (char === '"') inString = true;
    out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}
async function resolveExtends(from, target) {
  const candidates = [];
  const add = (base) => {
    candidates.push(base);
    if (!extname(base)) candidates.push(`${base}.json`, join(base, "tsconfig.json"));
  };
  if (target.startsWith(".") || isAbsolute(target)) add(resolve(from, target));
  else for (let directory = from; ; directory = dirname(directory)) {
    add(join(directory, "node_modules", target));
    if (dirname(directory) === directory) break;
  }
  for (const candidate of candidates) try {
    return await realpath(candidate);
  } catch {
  }
  return null;
}
async function readAliases(root, diagnostics) {
  const aliases = [];
  const seen = /* @__PURE__ */ new Set();
  let file = join(root, "tsconfig.json");
  for (let depth = 0; file && depth < 10; depth++) {
    if (seen.has(file)) break;
    seen.add(file);
    let config;
    try {
      config = parseJsonc(await readFile(file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") diagnostics.push({ code: "tsconfig", file: portable(root, file), message: "Could not read tsconfig path aliases; normal module resolution was used." });
      return aliases;
    }
    const paths = config.compilerOptions?.paths;
    if (paths && typeof paths === "object") {
      const base = resolve(dirname(file), config.compilerOptions?.baseUrl ?? ".");
      for (const [pattern, targets] of Object.entries(paths)) {
        if (!Array.isArray(targets)) continue;
        const star = pattern.indexOf("*");
        aliases.push({ prefix: star < 0 ? pattern : pattern.slice(0, star), suffix: star < 0 ? "" : pattern.slice(star + 1), targets: targets.filter((value) => typeof value === "string").map((value) => resolve(base, value)) });
      }
      return aliases;
    }
    const parent = Array.isArray(config.extends) ? config.extends.at(-1) : config.extends;
    file = typeof parent === "string" ? await resolveExtends(dirname(file), parent) : null;
  }
  return aliases;
}
function packageFrom(path, specifier) {
  const segments = path.split(sep);
  const marker = segments.lastIndexOf("node_modules");
  if (marker < 0 || !segments[marker + 1]) return packageName(specifier);
  const first = segments[marker + 1];
  return first.startsWith("@") && segments[marker + 2] ? `${first}/${segments[marker + 2]}` : first;
}
function expoRoute(root, path) {
  const rel = portable(root, path);
  const marker = rel.match(/(?:^|\/)(app)\/(.+)\.(?:[cm]?[jt]sx?)$/);
  if (!marker || /(?:^|\/)_(?:layout|sitemap)$/.test(marker[2]) || /(?:^|\/)\+/.test(marker[2])) return null;
  const segments = marker[2].split("/").filter((segment) => !/^\(.*\)$/.test(segment));
  const last = segments.at(-1);
  if (last === "index") segments.pop();
  const route = `/${segments.join("/")}` || "/";
  return { id: `expo:${marker[2]}`, title: last === "index" ? segments.at(-1) ?? "Home" : last ?? "Home", route };
}
async function analyzeApp(projectPath2, options = {}) {
  const root = await realpath(projectPath2);
  const projectId = fingerprint(root).slice(0, 24);
  const generation = randomUUID();
  const diagnostics = [];
  const paths = [];
  const check = () => options.signal?.throwIfAborted();
  async function walk(directory) {
    check();
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !ignored.has(entry.name)) await walk(path);
      else if (entry.isFile() && (sourcePattern.test(entry.name) || assetPattern.test(entry.name))) paths.push(path);
    }
  }
  options.onProgress?.("Discovering source files");
  await walk(root);
  const files = /* @__PURE__ */ Object.create(null);
  const parsed = /* @__PURE__ */ new Map();
  for (const [index, path] of paths.entries()) {
    check();
    const content = await readFile(path);
    const rel = portable(root, path);
    files[rel] = { fingerprint: fingerprint(content), kind: sourcePattern.test(path) ? "source" : "asset", reach: 0 };
    if (sourcePattern.test(path)) parsed.set(rel, parseSource(rel, content.toString("utf8"), diagnostics));
    if (index > 0 && index % 100 === 0) options.onProgress?.(`Parsed ${index} of ${paths.length} files`);
  }
  const aliases = await readAliases(root, diagnostics);
  const requestsFor = (specifier) => {
    const requests = [specifier];
    for (const alias of aliases) if (specifier.startsWith(alias.prefix) && specifier.endsWith(alias.suffix)) {
      const middle = specifier.slice(alias.prefix.length, alias.suffix ? -alias.suffix.length : void 0);
      for (const target of alias.targets) requests.unshift(target.replaceAll("*", () => middle));
    }
    return requests;
  };
  const resolveFor = /* @__PURE__ */ new Map();
  for (const platform of ["ios", "android"]) resolveFor.set(platform, import_enhanced_resolve.default.create.sync({ extensions: extensions(platform), mainFields: ["react-native", "module", "main"], conditionNames: ["react-native", platform, "import", "require", "default"], symlinks: false }));
  const realCache = /* @__PURE__ */ new Map();
  const realOf = async (path) => {
    const cached = realCache.get(path);
    if (cached) return cached;
    let real = path;
    try {
      real = await realpath(path);
    } catch {
    }
    realCache.set(path, real);
    return real;
  };
  const edges = [];
  const packages = /* @__PURE__ */ Object.create(null);
  const localTargets = /* @__PURE__ */ new Map();
  const specifierTargets = /* @__PURE__ */ new Map();
  for (const source of parsed.values()) {
    const locals = /* @__PURE__ */ new Map();
    const specifiers = /* @__PURE__ */ new Map();
    for (const item of source.imports) {
      check();
      const resolved = /* @__PURE__ */ new Map();
      for (const platform of ["ios", "android"]) {
        for (const request of requestsFor(item.specifier)) {
          let result;
          try {
            result = resolveFor.get(platform)(resolve(root, dirname(source.path)), request);
          } catch {
            continue;
          }
          if (!result) continue;
          const real = await realOf(result);
          const appCode = inside(root, real) && !relative(root, real).split(sep).includes("node_modules");
          if (!appCode) {
            const name = packageFrom(result, item.specifier);
            packages[name] ??= { name, reach: 0, entry: inside(root, result) ? portable(root, result) : null };
            const key2 = packageRef(name);
            resolved.set(key2, [...resolved.get(key2) ?? [], platform]);
            break;
          }
          const target = portable(root, real);
          const key = fileRef(target);
          resolved.set(key, [...resolved.get(key) ?? [], platform]);
          if (item.local) locals.set(item.local, target);
          specifiers.set(item.specifier, target);
          break;
        }
      }
      if (resolved.size === 0 && !item.specifier.startsWith(".") && !item.specifier.startsWith("/") && !item.specifier.startsWith("#")) {
        const name = packageName(item.specifier);
        packages[name] ??= { name, reach: 0, entry: null };
        resolved.set(packageRef(name), ["ios", "android"]);
      }
      if (resolved.size === 0) diagnostics.push({ code: "unresolved-import", file: source.path, message: `Could not resolve ${item.specifier} for iOS or Android.` });
      for (const [to, platforms] of resolved) edges.push({ from: fileRef(source.path), to, kind: "import", specifier: item.specifier, platforms, dynamic: item.dynamic || void 0, typeOnly: item.typeOnly || void 0 });
    }
    localTargets.set(source.path, locals);
    specifierTargets.set(source.path, specifiers);
  }
  const screens = /* @__PURE__ */ Object.create(null);
  const screenByName = /* @__PURE__ */ new Map();
  for (const [path, source] of parsed) {
    const expo = expoRoute(root, join(root, path));
    if (expo) {
      screens[expo.id] = { title: expo.title, route: expo.route, source: path, layouts: [] };
      screenByName.set(expo.title.toLowerCase(), expo.id);
      screenByName.set(expo.route.toLowerCase(), expo.id);
    }
    for (const registration of source.registrations) {
      const id = `navigation:${registration.name}`;
      const target = registration.specifier ? specifierTargets.get(path)?.get(registration.specifier) : registration.local ? localTargets.get(path)?.get(registration.local) : void 0;
      const own = registration.local ? source.declared.has(registration.local) : false;
      if (!target && !own) diagnostics.push({ code: "unresolved-screen", file: path, message: `Could not tell which file renders ${registration.name}; it is mapped to its navigator.` });
      screens[id] = { title: registration.name, route: null, source: target ?? path, layouts: [] };
      screenByName.set(registration.name.toLowerCase(), id);
    }
  }
  for (const [id, screen] of Object.entries(screens)) {
    if (!screen.source) continue;
    const parts = dirname(screen.source).split("/");
    while (parts.length) {
      const directory = parts.join("/");
      const layout = Object.keys(files).find((path) => path.startsWith(`${directory}/_layout.`) && sourcePattern.test(path));
      if (layout) screen.layouts.push(layout);
      parts.pop();
    }
    edges.push({ from: screenRef(id), to: fileRef(screen.source), kind: "source", platforms: ["ios", "android"] });
    for (const layout of screen.layouts) edges.push({ from: screenRef(id), to: fileRef(layout), kind: "layout", platforms: ["ios", "android"] });
  }
  const owners = /* @__PURE__ */ new Map();
  for (const [id, screen] of Object.entries(screens)) if (screen.source) owners.set(screen.source, [...owners.get(screen.source) ?? [], id]);
  for (const source of parsed.values()) for (const name of source.navigation) {
    const to = screenByName.get(name.toLowerCase());
    for (const from of owners.get(source.path) ?? []) edges.push({ from: screenRef(from), to: to ? screenRef(to) : null, kind: "navigation", specifier: name, platforms: ["ios", "android"] });
  }
  const unique = [...new Map(edges.map((edge) => [JSON.stringify(edge), edge])).values()];
  const indexes = { screens: /* @__PURE__ */ Object.create(null), incoming: /* @__PURE__ */ Object.create(null), outgoing: /* @__PURE__ */ Object.create(null) };
  for (const [id, screen] of Object.entries(screens)) for (const key of new Set([id, screen.title, screen.route].filter(Boolean).map((value) => String(value).toLowerCase()))) (indexes.screens[key] ??= []).push(id);
  unique.forEach((edge, index) => {
    (indexes.outgoing[edge.from] ??= []).push(index);
    if (edge.to) (indexes.incoming[edge.to] ??= []).push(index);
  });
  for (const id of Object.keys(screens)) {
    check();
    const queue = [screenRef(id)];
    const visited = new Set(queue);
    for (let cursor = 0; cursor < queue.length; cursor++) for (const index of indexes.outgoing[queue[cursor]] ?? []) {
      const edge = unique[index];
      if (!edge.to || edge.kind === "navigation" || visited.has(edge.to)) continue;
      visited.add(edge.to);
      if (edge.to.startsWith("file:")) {
        const file = files[edge.to.slice(5)];
        if (file) file.reach++;
      } else if (edge.to.startsWith("package:")) {
        const pkg = packages[edge.to.slice(8)];
        if (pkg) pkg.reach++;
        continue;
      }
      queue.push(edge.to);
    }
  }
  const sourceFingerprint = fingerprint(Object.entries(files).map(([path, file]) => `${path}:${file.fingerprint}`).join("\n"));
  return { formatVersion: 1, meta: { projectId, generation, analyzedAt: (/* @__PURE__ */ new Date()).toISOString(), analyzerVersion: "mobile-dev-1", sourceFingerprint }, files, packages, screens, edges: unique, diagnostics, indexes };
}

// packages/core/src/app-intelligence/worker.ts
if (!parentPort) throw new Error("App Intelligence worker requires a parent port.");
var port = parentPort;
var { projectPath } = workerData;
try {
  const snapshot = await analyzeApp(projectPath, {
    onProgress: (message) => port.postMessage({ type: "progress", message })
  });
  port.postMessage({ type: "result", snapshot });
} catch (error) {
  port.postMessage({
    type: "error",
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error)
  });
}

//# debugId=34f690b4-aad2-58e8-8cd6-f0ee9f7e303d
