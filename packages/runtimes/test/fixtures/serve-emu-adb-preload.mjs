import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";

// Only the packaged CLI under test loads this module. Give it a portable adb
// stand-in while exercising its real subprocess, IPC and shutdown behavior.
const adb = fileURLToPath(new URL("./serve-emu-adb.mjs", import.meta.url));
const { spawn } = childProcess;
childProcess.spawn = (command, args, options) => command === "adb"
  ? spawn(process.execPath, [adb, ...args], options)
  : spawn(command, args, options);
syncBuiltinESMExports();
