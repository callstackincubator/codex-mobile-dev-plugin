import { connectIosCapture } from "../../src/server/ios-mirror-client.ts";

const capture = await connectIosCapture(process.argv[2], "phone");
process.send?.({ ready: true });
process.on("message", async message => {
  try {
    if (message === "read") {
      const batch = await capture.read();
      process.send?.({ batch });
    }
    if (message === "close") { await capture.close(); process.exit(0); }
  } catch (error) {
    process.send?.({ error: error instanceof Error ? error.message : "Capture failed" });
  }
});
