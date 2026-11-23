import { writeFileSync } from "node:fs";

const args = process.argv.slice(4); // Skip Node, this script and the device's -s <serial>.
if (args[0] === "forward" && args[1] === "tcp:0") {
  process.stdout.write("28000");
} else if (args[0] === "forward" && args[1] === "--remove") {
  writeFileSync(process.env.TEST_ADB_FORWARD_CLEANUP, args[2]);
} else if (args.includes("app_process")) {
  setInterval(() => {}, 1000);
} else if (args[1] === "cat") {
  if (process.env.TEST_ADB_FAILURE === "missing") {
    process.stderr.write("device private-device-id not found");
    process.exitCode = 1;
  } else {
    setInterval(() => {}, 1000);
  }
}
